use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use comrak::Options;
use comrak::nodes::{AstNode, NodeValue};
use sha2::{Digest, Sha256};

use crate::markdown_source_map::{line_starts, node_range};

/// Match the frontend fast-render threshold so large-document typing benefits
/// from block-scoped HTML formatting after the first render.
pub(crate) const INCREMENTAL_RENDER_MIN_BYTES: usize = 48_000;

#[derive(Debug, Clone)]
pub struct BlockRenderCache {
    pub profile: String,
    pub compatibility_target: String,
    pub fragments: Vec<CachedBlockFragment>,
}

#[derive(Debug, Clone)]
pub struct CachedBlockFragment {
    pub content_hash: String,
    pub source_byte_start: usize,
    pub source_byte_end: usize,
    pub html: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderStrategy {
    Full,
    BlockCold,
    Incremental,
}

impl RenderStrategy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::BlockCold => "block-cold",
            Self::Incremental => "incremental",
        }
    }
}

struct TopLevelBlock<'a> {
    node: &'a AstNode<'a>,
    start: usize,
    end: usize,
}

pub(crate) fn markdown_sanitizer() -> ammonia::Builder<'static> {
    let mut sanitizer = ammonia::Builder::default();
    sanitizer.add_tags(["details", "summary", "ins", "sub", "sup"]);
    sanitizer.add_tag_attributes("details", ["open"]);
    // GitHub README badge rows rely on <p align="center">. Ammonia allows
    // align on several tags by default but not on p; restore it explicitly.
    sanitizer.add_tag_attributes("p", ["align"]);
    sanitizer
        .add_generic_attributes(["data-sourcepos", "data-math-style"])
        .add_allowed_classes(
            "div",
            [
                "markdown-alert",
                "markdown-alert-note",
                "markdown-alert-tip",
                "markdown-alert-important",
                "markdown-alert-warning",
                "markdown-alert-caution",
            ],
        )
        .add_allowed_classes("p", ["markdown-alert-title"]);
    sanitizer.add_allowed_classes(
        "code",
        [
            "language-mermaid",
            "language-dot",
            "language-graphviz",
            "language-math",
        ],
    );
    sanitizer
}

pub(crate) fn block_content_hash(
    profile: &str,
    compatibility_target: &str,
    source_slice: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(profile.as_bytes());
    hasher.update(b"\0");
    hasher.update(compatibility_target.as_bytes());
    hasher.update(b"\0");
    hasher.update(source_slice.as_bytes());
    format!("sha256:{}", BASE64.encode(hasher.finalize()))
}

fn collect_top_level_blocks<'a>(
    source: &str,
    root: &'a AstNode<'a>,
    line_starts: &[usize],
) -> Vec<TopLevelBlock<'a>> {
    let mut blocks = Vec::new();
    for child in root.children() {
        let (value, sourcepos) = {
            let ast = child.data.borrow();
            (ast.value.clone(), ast.sourcepos)
        };
        if matches!(value, NodeValue::Document) {
            continue;
        }
        let Some((start, end)) = node_range(source, line_starts, child, &value, sourcepos) else {
            continue;
        };
        blocks.push(TopLevelBlock {
            node: child,
            start,
            end,
        });
    }
    blocks
}

fn document_supports_block_rendering<'a>(root: &'a AstNode<'a>) -> bool {
    for node in root.descendants() {
        let value = node.data.borrow().value.clone();
        if matches!(
            value,
            NodeValue::FootnoteReference(_)
                | NodeValue::FootnoteDefinition(_)
                | NodeValue::HtmlBlock(_)
                | NodeValue::HtmlInline(_)
        ) {
            return false;
        }
    }
    true
}

fn format_and_sanitize_block<'a>(
    node: &'a AstNode<'a>,
    options: &Options,
    sanitizer: &mut ammonia::Builder<'static>,
) -> String {
    let mut raw = String::new();
    comrak::format_html(node, options, &mut raw).expect("writing to String cannot fail");
    sanitizer.clean(&raw).to_string()
}

fn full_document_html<'a>(
    root: &'a AstNode<'a>,
    options: &Options,
    profile: &str,
    compatibility_target: &str,
) -> (String, BlockRenderCache, RenderStrategy) {
    let mut raw_html = String::new();
    comrak::format_html(root, options, &mut raw_html).expect("writing to String cannot fail");
    let sanitizer = markdown_sanitizer();
    let html = sanitizer.clean(&raw_html).to_string();
    (
        html,
        BlockRenderCache {
            profile: profile.to_owned(),
            compatibility_target: compatibility_target.to_owned(),
            fragments: Vec::new(),
        },
        RenderStrategy::Full,
    )
}

pub(crate) fn assemble_html<'a>(
    source: &str,
    root: &'a AstNode<'a>,
    options: &Options,
    cache: Option<&BlockRenderCache>,
    profile: &str,
    compatibility_target: &str,
) -> (String, BlockRenderCache, RenderStrategy) {
    // The first open is on the critical path. A single full-document format
    // and sanitize is materially cheaper than formatting and sanitizing every
    // top-level block just to populate a cache that has no prior fragments.
    // Once a render cache exists, the block path is used for edits and can
    // reuse unchanged fragments. This preserves correctness while moving the
    // cache warm-up cost out of startup/open.
    if source.len() < INCREMENTAL_RENDER_MIN_BYTES
        || !document_supports_block_rendering(root)
        || cache.is_none()
    {
        return full_document_html(root, options, profile, compatibility_target);
    }

    let source_line_starts = line_starts(source);
    let blocks = collect_top_level_blocks(source, root, &source_line_starts);
    if blocks.is_empty() {
        return full_document_html(root, options, profile, compatibility_target);
    }

    // HTML formatting has document-scoped heading ID state. Until that state
    // is represented in the cache, documents with generated heading IDs use
    // the whole-document formatter.
    if options.extension.header_id_prefix.is_some()
        && root
            .descendants()
            .any(|node| matches!(node.data.borrow().value, NodeValue::Heading(_)))
    {
        return full_document_html(root, options, profile, compatibility_target);
    }

    let hashes: Vec<String> = blocks
        .iter()
        .map(|block| {
            // Include resolved AST values (notably reference-link destinations)
            // and every node's coordinates, including same-byte-length edits
            // that move line boundaries. Source text alone is not a render key.
            let mut signature = source[block.start..block.end].to_owned();
            for node in block.node.descendants() {
                use std::fmt::Write;
                let ast = node.data.borrow();
                write!(&mut signature, "\0{:?}:{:?}", ast.sourcepos, ast.value)
                    .expect("writing to String cannot fail");
            }
            block_content_hash(profile, compatibility_target, &signature)
        })
        .collect();

    let prior = cache.filter(|cached| {
        cached.profile == profile
            && cached.compatibility_target == compatibility_target
            && cached.fragments.len() == hashes.len()
    });

    let mut sanitizer = markdown_sanitizer();
    let mut html = String::new();
    let mut fragments = Vec::with_capacity(blocks.len());
    let mut reused_any = false;

    for (index, block) in blocks.iter().enumerate() {
        let hash = &hashes[index];
        let fragment_html = if let Some(cached_store) = prior {
            let cached = &cached_store.fragments[index];
            if cached.content_hash == *hash {
                reused_any = true;
                cached.html.clone()
            } else {
                format_and_sanitize_block(block.node, options, &mut sanitizer)
            }
        } else {
            format_and_sanitize_block(block.node, options, &mut sanitizer)
        };
        fragments.push(CachedBlockFragment {
            content_hash: hash.clone(),
            source_byte_start: block.start,
            source_byte_end: block.end,
            html: fragment_html.clone(),
        });
        html.push_str(&fragment_html);
    }

    let strategy = if prior.is_some() && reused_any {
        RenderStrategy::Incremental
    } else {
        RenderStrategy::BlockCold
    };

    (
        html,
        BlockRenderCache {
            profile: profile.to_owned(),
            compatibility_target: compatibility_target.to_owned(),
            fragments,
        },
        strategy,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use comrak::{Arena, parse_document};

    fn large_fixture_source() -> String {
        let mut source = String::from("# Incremental render fixture\n\n");
        while source.len() < INCREMENTAL_RENDER_MIN_BYTES + 512 {
            source.push_str("Paragraph block with **bold** and `code` for cache coverage.\n\n");
            source.push_str("- list item one\n- list item two\n\n");
            source.push_str("> blockquote line\n\n");
        }
        source
    }

    macro_rules! github_options {
        () => {{
            let mut options = Options::default();
            options.extension.table = true;
            options.extension.strikethrough = true;
            options.extension.tasklist = true;
            options.extension.autolink = true;
            options.extension.math_dollars = true;
            options.extension.math_code = true;
            options.extension.footnotes = true;
            options.extension.alerts = true;
            options.render.r#unsafe = true;
            options.render.sourcepos = true;
            options
        }};
    }

    #[test]
    fn block_assembly_matches_full_document_html() {
        let source = large_fixture_source();
        let arena = Arena::new();
        let options = github_options!();
        let root = parse_document(&arena, &source, &options);
        let (_, seed, _) = full_document_html(root, &options, "github", "githubReadme");
        let (block_html, _, strategy) = assemble_html(
            &source,
            root,
            &options,
            Some(&seed),
            "github",
            "githubReadme",
        );
        assert_eq!(strategy, RenderStrategy::BlockCold);
        let (full_html, _, _) = full_document_html(root, &options, "github", "githubReadme");
        assert_eq!(block_html, full_html);
    }

    #[test]
    fn warmed_edits_match_full_render() {
        let original = format!(
            "First paragraph.\n\n[Reference][target]\n\n{}\n[target]: https://example.com/old\n",
            large_fixture_source()
        );
        let options = github_options!();
        let arena = Arena::new();
        let root = parse_document(&arena, &original, &options);
        let (_, seed, _) = full_document_html(root, &options, "github", "githubReadme");
        let (_, cache, _) = assemble_html(
            &original,
            root,
            &options,
            Some(&seed),
            "github",
            "githubReadme",
        );
        for edited in [
            original.replacen("First paragraph.", "First\nparagraph.", 1),
            original.replacen("First paragraph.", "First longer paragraph.\n", 1),
            original.replace("https://example.com/old", "https://example.com/new"),
        ] {
            let arena = Arena::new();
            let root = parse_document(&arena, &edited, &options);
            let (actual, _, _) = assemble_html(
                &edited,
                root,
                &options,
                Some(&cache),
                "github",
                "githubReadme",
            );
            let (expected, _, _) = full_document_html(root, &options, "github", "githubReadme");
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn document_scoped_html_and_heading_ids_use_full_render() {
        let mut options = github_options!();
        options.extension.header_id_prefix = Some(String::new());
        for source in [
            format!("<details>\n\n{}\n</details>\n", large_fixture_source()),
            format!("# Duplicate\n\n# Duplicate\n\n{}", large_fixture_source()),
        ] {
            let arena = Arena::new();
            let root = parse_document(&arena, &source, &options);
            let (expected, seed, _) = full_document_html(root, &options, "github", "githubReadme");
            let (actual, _, strategy) = assemble_html(
                &source,
                root,
                &options,
                Some(&seed),
                "github",
                "githubReadme",
            );
            assert_eq!(strategy, RenderStrategy::Full);
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn single_block_edit_reuses_cached_fragments() {
        let mut source = large_fixture_source();
        let arena = Arena::new();
        let options = github_options!();

        let root = parse_document(&arena, &source, &options);
        let empty_cache = BlockRenderCache {
            profile: "github".to_owned(),
            compatibility_target: "githubReadme".to_owned(),
            fragments: Vec::new(),
        };
        let (_, cache, strategy) = assemble_html(
            &source,
            root,
            &options,
            Some(&empty_cache),
            "github",
            "githubReadme",
        );
        assert_eq!(strategy, RenderStrategy::BlockCold);

        source.replace_range(0..1, "X");
        let arena2 = Arena::new();
        let root2 = parse_document(&arena2, &source, &options);
        let (_, cache2, strategy2) = assemble_html(
            &source,
            root2,
            &options,
            Some(&cache),
            "github",
            "githubReadme",
        );
        assert_eq!(strategy2, RenderStrategy::Incremental);
        assert_eq!(cache.fragments.len(), cache2.fragments.len());
        let changed = cache
            .fragments
            .iter()
            .zip(cache2.fragments.iter())
            .filter(|(left, right)| left.content_hash != right.content_hash)
            .count();
        assert_eq!(changed, 1, "expected exactly one reformatted block");
    }

    #[test]
    fn footnotes_force_full_document_render() {
        let mut source = large_fixture_source();
        source.push_str("\nFootnote reference [^1].\n\n[^1]: footnote body\n");
        let arena = Arena::new();
        let options = github_options!();
        let root = parse_document(&arena, &source, &options);
        let (_, cache, strategy) =
            assemble_html(&source, root, &options, None, "github", "githubReadme");
        assert_eq!(strategy, RenderStrategy::Full);
        assert!(cache.fragments.is_empty());
    }
}
