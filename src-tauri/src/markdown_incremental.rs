use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use comrak::Options;
use comrak::html::Anchorizer;
use comrak::nodes::{AstNode, NodeValue};
use sha2::{Digest, Sha256};
use url::Url;

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
    sanitizer.add_tags([
        "details", "summary", "ins", "sub", "sup", "video", "source", "iframe",
    ]);
    sanitizer.add_tag_attributes("details", ["open"]);
    sanitizer.add_tag_attributes("img", ["width", "height", "align"]);
    sanitizer.add_tag_attributes(
        "video",
        [
            "controls",
            "preload",
            "playsinline",
            "poster",
            "width",
            "height",
            "src",
        ],
    );
    sanitizer.add_tag_attributes("source", ["src", "type"]);
    sanitizer.add_tag_attributes(
        "iframe",
        [
            "src",
            "title",
            "width",
            "height",
            "loading",
            "allow",
            "allowfullscreen",
            "referrerpolicy",
        ],
    );
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

fn allowed_embed_url(value: &str) -> bool {
    let Ok(url) = Url::parse(value.trim()) else {
        return false;
    };
    if url.scheme() != "https" {
        return false;
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let path = url.path();
    (matches!(
        host.as_str(),
        "www.youtube-nocookie.com" | "www.youtube.com"
    ) && path.starts_with("/embed/"))
        || (host == "player.vimeo.com" && path.starts_with("/video/"))
        || (matches!(host.as_str(), "drive.google.com" | "www.drive.google.com")
            && path.starts_with("/file/")
            && path.ends_with("/preview"))
}

fn html_attribute(markup: &str, name: &str) -> Option<String> {
    let lower = markup.to_ascii_lowercase();
    let needle = format!("{name}=");
    let start = lower.find(&needle)? + needle.len();
    let value = markup[start..].trim_start();
    if let Some(quoted) = value.strip_prefix('"') {
        return quoted.split('"').next().map(str::to_owned);
    }
    if let Some(quoted) = value.strip_prefix('\'') {
        return quoted.split('\'').next().map(str::to_owned);
    }
    Some(value.split([' ', '\t', '\r', '\n', '>']).next()?.to_owned())
}

/// Keep provider embeds narrow even though raw HTML is enabled for other safe
/// Markdown features. CSP is a second boundary; this output boundary also
/// keeps exported/sanitized HTML from retaining arbitrary remote frames.
fn strip_unapproved_iframes(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    let mut output = String::with_capacity(raw.len());
    let mut cursor = 0;
    while let Some(relative_start) = lower[cursor..].find("<iframe") {
        let start = cursor + relative_start;
        let after_name = start + "<iframe".len();
        if !matches!(
            lower.as_bytes().get(after_name),
            Some(b'>') | Some(b' ') | Some(b'\t') | Some(b'\r') | Some(b'\n')
        ) {
            cursor = after_name;
            continue;
        }
        let Some(relative_end) = lower[after_name..].find('>') else {
            output.push_str(&raw[cursor..]);
            return output;
        };
        let tag_end = after_name + relative_end;
        let tag = &raw[start..=tag_end];
        output.push_str(&raw[cursor..start]);
        if html_attribute(tag, "src").is_some_and(|src| allowed_embed_url(&src)) {
            output.push_str(tag);
            cursor = tag_end + 1;
            continue;
        }
        let content_start = tag_end + 1;
        if let Some(relative_close) = lower[content_start..].find("</iframe>") {
            cursor = content_start + relative_close + "</iframe>".len();
        } else {
            cursor = content_start;
        }
    }
    output.push_str(&raw[cursor..]);
    output
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

const HTML_VOID_TAGS: [&str; 13] = [
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track",
];

fn html_tag_end(value: &str, start: usize) -> Option<usize> {
    let mut quote = None;
    for (offset, character) in value[start + 1..].char_indices() {
        match quote {
            Some(delimiter) if character == delimiter => quote = None,
            Some(_) => {}
            None if character == '\'' || character == '"' => quote = Some(character),
            None if character == '>' => return Some(start + 1 + offset),
            None => {}
        }
    }
    None
}

/// Return whether a raw HTML block is self-contained in its AST literal.
///
/// Comrak can represent an opening container such as `<details>` and its
/// closing tag as separate HTML blocks around Markdown children. Formatting
/// those nodes independently would move the children outside the container,
/// so only blocks whose tag stack closes inside the same literal may use the
/// incremental renderer. Malformed HTML conservatively falls back to the full
/// document renderer.
fn html_block_is_self_contained(literal: &str) -> bool {
    let mut stack = Vec::new();
    let mut cursor = 0;
    while let Some(relative_start) = literal[cursor..].find('<') {
        let start = cursor + relative_start;
        let Some(end) = html_tag_end(literal, start) else {
            return false;
        };
        let markup = &literal[start..=end];
        cursor = end + 1;
        if markup.starts_with("<!--") {
            if !markup.ends_with("-->") {
                return false;
            }
            continue;
        }
        if markup.starts_with("<!") || markup.starts_with("<?") {
            continue;
        }
        let bytes = markup.as_bytes();
        let mut index = 1;
        let closing = bytes.get(index) == Some(&b'/');
        if closing {
            index += 1;
        }
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        let name_start = index;
        while bytes
            .get(index)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b':' || *byte == b'-')
        {
            index += 1;
        }
        if index == name_start {
            return false;
        }
        let name = markup[name_start..index].to_ascii_lowercase();
        if closing {
            if stack.pop().as_deref() != Some(name.as_str()) {
                return false;
            }
            continue;
        }
        let self_closing = markup[..markup.len() - 1].trim_end().ends_with('/');
        if !self_closing && !HTML_VOID_TAGS.contains(&name.as_str()) {
            stack.push(name);
        }
    }
    stack.is_empty()
}

fn document_supports_block_rendering<'a>(root: &'a AstNode<'a>) -> bool {
    // A top-level raw HTML block is an opaque, self-contained fragment: Comrak
    // emits it without consulting sibling Markdown nodes, so formatting and
    // sanitizing that block independently preserves the full-document output.
    // Inline raw HTML remains document-scoped because it can change the
    // surrounding paragraph's structure. Footnotes also retain their global
    // numbering/definition context and must use the full renderer.
    for node in root.descendants() {
        let value = node.data.borrow().value.clone();
        match value {
            NodeValue::FootnoteReference(_)
            | NodeValue::FootnoteDefinition(_)
            | NodeValue::HtmlInline(_) => return false,
            NodeValue::HtmlBlock(block) if !html_block_is_self_contained(&block.literal) => {
                return false;
            }
            _ => {}
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
    let raw = strip_unapproved_iframes(&raw);
    sanitizer.clean(&raw).to_string()
}

fn escaped_html_text(value: &str) -> String {
    let mut escaped = String::new();
    comrak::html::escape(&mut escaped, value).expect("writing to String cannot fail");
    escaped
}

/// Format one heading with the document-wide anchorizer while keeping the
/// existing block cache boundary. Comrak's normal formatter owns an
/// anchorizer inside its document context, so formatting each top-level block
/// independently would otherwise reset duplicate-heading suffixes. Rendering
/// the fragment without IDs and adding the exact Comrak anchor markup here
/// preserves full-document output while allowing non-heading blocks to reuse
/// their cached HTML.
fn format_and_sanitize_heading_block<'a>(
    node: &'a AstNode<'a>,
    options: &Options,
    sanitizer: &mut ammonia::Builder<'static>,
    anchorizer: &mut Anchorizer,
) -> String {
    let heading_text = node.collect_text();
    let id = anchorizer.anchorize(&heading_text);
    let prefix = options
        .extension
        .header_id_prefix
        .as_deref()
        .unwrap_or_default();
    let href_prefix = if options.extension.header_id_prefix_in_href {
        prefix
    } else {
        ""
    };

    let mut fragment_options = options.clone();
    fragment_options.extension.header_id_prefix = None;
    let mut raw = String::new();
    comrak::format_html(node, &fragment_options, &mut raw).expect("writing to String cannot fail");
    let mut raw = strip_unapproved_iframes(&raw);
    let Some(tag_start) = raw.find("<h") else {
        return sanitizer.clean(&raw).to_string();
    };
    let Some(level) = raw.as_bytes().get(tag_start + 2).copied() else {
        return sanitizer.clean(&raw).to_string();
    };
    if !(b'1'..=b'6').contains(&level) {
        return sanitizer.clean(&raw).to_string();
    }
    let opening_attributes = format!(" id=\"{}{}\"", prefix, id,);
    raw.insert_str(tag_start + 3, &opening_attributes);

    let level = level as char;
    let closing = format!("</h{level}>");
    let Some(closing_start) = raw.rfind(&closing) else {
        return sanitizer.clean(&raw).to_string();
    };
    let escaped_text = escaped_html_text(&heading_text);
    let anchor = format!(
        "<a href=\"#{href_prefix}{id}\" aria-label=\"Link to heading '{escaped_text}'\" data-heading-content=\"{escaped_text}\" class=\"anchor\"></a>",
    );
    raw.insert_str(closing_start, &anchor);
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
    let raw_html = strip_unapproved_iframes(&raw_html);
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
    let mut anchorizer = Anchorizer::new();
    let mut html = String::new();
    let mut fragments = Vec::with_capacity(blocks.len());
    let mut reused_any = false;

    for (index, block) in blocks.iter().enumerate() {
        let hash = &hashes[index];
        let is_heading = options.extension.header_id_prefix.is_some()
            && matches!(block.node.data.borrow().value, NodeValue::Heading(_));
        let fragment_html = if is_heading {
            // Heading IDs and duplicate suffixes depend on all prior headings,
            // so regenerate only this small fragment against the shared
            // document anchorizer instead of reusing stale cached IDs.
            format_and_sanitize_heading_block(block.node, options, &mut sanitizer, &mut anchorizer)
        } else if let Some(cached_store) = prior {
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
    fn document_scoped_html_still_uses_full_render() {
        let mut options = github_options!();
        options.extension.header_id_prefix = Some(String::new());
        let source = format!("<details>\n\n{}\n</details>\n", large_fixture_source());
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

    #[test]
    fn inline_html_still_uses_full_document_render() {
        let source = format!(
            "Paragraph with <span>inline HTML</span>.\n\n{}",
            large_fixture_source()
        );
        let arena = Arena::new();
        let options = github_options!();
        let root = parse_document(&arena, &source, &options);
        let (_, seed, _) = full_document_html(root, &options, "github", "githubReadme");
        let (actual, _, strategy) = assemble_html(
            &source,
            root,
            &options,
            Some(&seed),
            "github",
            "githubReadme",
        );
        assert_eq!(strategy, RenderStrategy::Full);
        let (expected, _, _) = full_document_html(root, &options, "github", "githubReadme");
        assert_eq!(actual, expected);
    }

    #[test]
    fn self_contained_html_block_uses_incremental_rendering() {
        let mut options = github_options!();
        options.extension.header_id_prefix = Some(String::new());
        let source = format!(
            "<p align=\"center\"><a href=\"https://example.com\"><img src=\"badge.png\" alt=\"Badge\" /></a></p>\n\n{}",
            large_fixture_source()
        );
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
        assert_eq!(strategy, RenderStrategy::BlockCold);
        assert_eq!(actual, expected);
    }

    #[test]
    fn incremental_heading_fragments_preserve_document_anchor_ids() {
        let mut options = github_options!();
        options.extension.header_id_prefix = Some(String::new());
        let source = format!("# Duplicate\n\n# Duplicate\n\n{}", large_fixture_source());
        let arena = Arena::new();
        let root = parse_document(&arena, &source, &options);
        let (expected, seed, _) = full_document_html(root, &options, "github", "githubReadme");
        let (actual, cache, strategy) = assemble_html(
            &source,
            root,
            &options,
            Some(&seed),
            "github",
            "githubReadme",
        );
        assert_eq!(strategy, RenderStrategy::BlockCold);
        assert_eq!(actual, expected);

        let edited = source.replace("Paragraph block", "Edited paragraph block");
        let arena = Arena::new();
        let root = parse_document(&arena, &edited, &options);
        let (actual, _, strategy) = assemble_html(
            &edited,
            root,
            &options,
            Some(&cache),
            "github",
            "githubReadme",
        );
        let (expected, _, _) = full_document_html(root, &options, "github", "githubReadme");
        assert_eq!(strategy, RenderStrategy::Incremental);
        assert_eq!(actual, expected);
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
