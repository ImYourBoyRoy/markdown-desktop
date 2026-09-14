use comrak::{Arena, Options, nodes::NodeValue, parse_document};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use crate::markdown_incremental::{BlockRenderCache, RenderStrategy, assemble_html};
#[cfg(test)]
use crate::markdown_source_map::{SOURCE_MAP_VERSION, source_hash};
use crate::markdown_source_map::{
    alert_marker_start, build_source_map, code_fence_marker, collect_text, line_starts,
    mask_user_sourcepos_attributes, node_range, normalize_alert_markers, sourcepos_to_range,
};
use crate::model::{Heading, Issue, LinkInfo, MappedSpan, RenderedBlock, SourceMap};

#[cfg(test)]
use std::collections::BTreeMap;
const GITHUB_README_LIMITS_URL: &str = "https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes";
const GITHUB_REPOSITORY_LIMITS_URL: &str =
    "https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits";
const GITHUB_LARGE_FILES_URL: &str = "https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github";
pub const DEFAULT_COMPATIBILITY_TARGET: &str = "githubReadme";
const GITHUB_README_TARGET: &str = "githubReadme";

pub fn normalize_compatibility_target(value: Option<&str>) -> &'static str {
    match value {
        Some("none") => "none",
        _ => DEFAULT_COMPATIBILITY_TARGET,
    }
}

#[derive(Debug, Clone)]
pub struct RenderedMarkdown {
    pub html: String,
    pub headings: Vec<Heading>,
    pub links: Vec<LinkInfo>,
    pub issues: Vec<Issue>,
    pub source_map: SourceMap,
    pub render_strategy: RenderStrategy,
    pub block_cache: BlockRenderCache,
    pub blocks: Vec<RenderedBlock>,
}

pub fn render(source: &str, profile: &str) -> RenderedMarkdown {
    render_with_context(source, profile, false, DEFAULT_COMPATIBILITY_TARGET, None)
}

/// Render using the editor profile while applying compatibility diagnostics
/// for the requested advisory target. The target never changes Comrak
/// options, HTML, or source-map construction.
pub fn render_for_file_with_target(
    source: &str,
    profile: &str,
    file_name: Option<&str>,
    compatibility_target: &str,
) -> RenderedMarkdown {
    render_for_file_with_target_cached(source, profile, file_name, compatibility_target, None)
}

pub fn render_for_file_with_target_cached(
    source: &str,
    profile: &str,
    file_name: Option<&str>,
    compatibility_target: &str,
    cache: Option<&BlockRenderCache>,
) -> RenderedMarkdown {
    let is_readme = file_name.map(is_github_readme_name).unwrap_or(false);
    render_with_context(
        source,
        profile,
        is_readme,
        normalize_compatibility_target(Some(compatibility_target)),
        cache,
    )
}

fn render_with_context(
    source: &str,
    profile: &str,
    is_readme: bool,
    compatibility_target: &str,
    cache: Option<&BlockRenderCache>,
) -> RenderedMarkdown {
    let mut options = Options::default();
    let extended = matches!(profile, "extended" | "custom");
    let github = profile != "commonmarkStrict";

    options.extension.table = github;
    options.extension.strikethrough = github;
    options.extension.tasklist = github;
    options.extension.autolink = github;
    // Comrak's GFM tagfilter extension is deprecated and removed in 0.56.
    // Disallowed raw HTML (script, iframe, xmp, …) is stripped by Ammonia below
    // instead of relying on Comrak's escape-at-render tagfilter.
    options.extension.front_matter_delimiter = extended.then(|| "---".to_owned());
    // GitHub documents both dollar-delimited math and reference footnotes in
    // Markdown files. Keep them enabled for the GitHub profile while leaving
    // CommonMark Strict genuinely strict.
    options.extension.math_dollars = github;
    options.extension.math_code = github;
    options.extension.footnotes = github;
    // GitHub READMEs support the [!NOTE] family; strict CommonMark does not.
    options.extension.alerts = github || extended;
    options.extension.wikilinks_title_after_pipe = extended;
    options.extension.header_id_prefix = Some(String::new());
    // Raw HTML is passed through the existing Ammonia sanitizer below. Keeping
    // this enabled is required for GitHub-documented tags such as <ins>,
    // <sub>, <sup>, and <details>; unsafe tags/attributes remain removed by
    // the sanitizer and are covered by the security tests.
    options.render.r#unsafe = true;
    // Keep only generated source positions as a bridge for the sanitized
    // preview. The frontend validates them against SourceMap before creating
    // any map IDs; user HTML attributes are never treated as IDs.
    options.render.sourcepos = true;

    let arena = Arena::new();
    // Comrak 0.54 recognizes the alert marker in lowercase, while GitHub's
    // documented README syntax uses uppercase markers. Normalize only the
    // parser input, preserving byte length and the user's original source so
    // source positions and source-authoritative edits remain exact.
    let parser_source = mask_user_sourcepos_attributes(&normalize_alert_markers(source, github));
    let root = parse_document(&arena, &parser_source, &options);
    let source_map = build_source_map(source, root);
    // The source map is already authoritative for every AST node. Keep a
    // borrowed range index for the hot link/image/block lookups below rather
    // than scanning every span once per AST node.
    let span_lookup = build_span_lookup(&source_map);
    let (html, block_cache, render_strategy) =
        assemble_html(source, root, &options, cache, profile, compatibility_target);
    let root_block_kinds = [
        "heading",
        "paragraph",
        "blockquote",
        "list",
        "code_block",
        "table",
        "thematic_break",
        "details",
        "alert",
        "math",
        "html_block",
        "html_layout_table",
    ];
    let blocks = block_cache
        .fragments
        .iter()
        .filter_map(|fragment| {
            let map_id = root_block_kinds
                .iter()
                .find_map(|kind| {
                    span_lookup
                        .get(&(*kind, fragment.source_byte_start, fragment.source_byte_end))
                        .copied()
                })?
                .to_owned();
            Some(RenderedBlock {
                map_id,
                html: fragment.html.clone(),
            })
        })
        .collect();

    let mut headings = Vec::new();
    let mut used_slugs = HashSet::new();
    let mut heading_bases = HashSet::new();
    let mut links = Vec::new();
    let mut issues = Vec::new();
    let source_line_starts = line_starts(source);

    for node in root.descendants() {
        let value = node.data.borrow().value.clone();
        match value {
            NodeValue::Heading(heading) => {
                let text = collect_text(node).trim().to_owned();
                let base = slugify(&text);
                if compatibility_target == GITHUB_README_TARGET
                    && !heading_bases.insert(base.clone())
                {
                    issues.push(issue_for_node(
                        source,
                        &source_line_starts,
                        &source_map,
                        node,
                        IssueDraft {
                            kind: "heading",
                            profile,
                            code: "heading.duplicate-anchor",
                            severity: "info",
                            title: "Duplicate heading anchor",
                            detail: format!("GitHub will disambiguate the anchor for {text:?}; links should target the generated suffix."),
                        },
                    ));
                }
                let mut slug = base.clone();
                let mut suffix = 1;
                while !used_slugs.insert(slug.clone()) {
                    suffix += 1;
                    slug = format!("{base}-{suffix}");
                }
                headings.push(Heading {
                    level: heading.level,
                    text,
                    slug,
                });
            }
            NodeValue::BlockQuote | NodeValue::MultilineBlockQuote(_)
                if profile == "commonmarkStrict" =>
            {
                let sourcepos = node.data.borrow().sourcepos;
                let uses_github_alert = sourcepos_to_range(source, &source_line_starts, sourcepos)
                    .and_then(|(start, end)| source.get(start..end))
                    .is_some_and(|value| {
                        value.lines().any(|line| alert_marker_start(line).is_some())
                    });
                if uses_github_alert {
                    issues.push(issue_for_node(
                        source,
                        &source_line_starts,
                        &source_map,
                        node,
                        IssueDraft {
                            kind: "blockquote",
                            profile,
                            code: "profile.github-alert",
                            severity: "warning",
                            title: "GitHub alert is outside CommonMark Strict",
                            detail: "This [!NOTE] family is a GitHub Markdown extension; strict CommonMark will render it as an ordinary blockquote. Local saving remains available.".to_owned(),
                        },
                    ));
                }
            }
            NodeValue::Link(link) => {
                let map_id =
                    map_id_for_node(source, &source_line_starts, &span_lookup, node, "link");
                let target = link.url;
                if is_unsafe_target(&target) {
                    issues.push(issue_for_node(
                        source,
                        &source_line_starts,
                        &source_map,
                        node,
                        IssueDraft {
                            kind: "link",
                            profile,
                            code: "url.unsafe-scheme",
                            severity: "error",
                            title: "Unsafe link URL",
                            detail: "javascript:, data:, file:, and vbscript: URLs are not allowed in Markdown output.".to_owned(),
                        },
                    ));
                } else if is_absolute_local_path(&target) {
                    issues.push(issue_for_node(
                        source,
                        &source_line_starts,
                        &source_map,
                        node,
                        IssueDraft {
                            kind: "link",
                            profile,
                            code: "path.absolute-local",
                            severity: "warning",
                            title: "Absolute local path",
                            detail: "Use a repository/document-relative link so the file remains portable.".to_owned(),
                        },
                    ));
                }
                let kind = link_kind(&target).to_owned();
                let status = if kind == "external" {
                    "external"
                } else {
                    "unverified"
                };
                links.push(LinkInfo {
                    target,
                    label: collect_text(node),
                    kind,
                    status: status.to_owned(),
                    map_id,
                });
            }
            NodeValue::Image(image) => {
                if is_unsafe_target(&image.url) {
                    issues.push(issue_for_node(
                        source,
                        &source_line_starts,
                        &source_map,
                        node,
                        IssueDraft {
                            kind: "image",
                            profile,
                            code: "url.unsafe-scheme",
                            severity: "error",
                            title: "Unsafe image URL",
                            detail: "javascript:, data:, file:, and vbscript: URLs are not allowed in Markdown output.".to_owned(),
                        },
                    ));
                } else if is_absolute_local_path(&image.url) {
                    issues.push(issue_for_node(
                        source,
                        &source_line_starts,
                        &source_map,
                        node,
                        IssueDraft {
                            kind: "image",
                            profile,
                            code: "path.absolute-local",
                            severity: "warning",
                            title: "Absolute local image path",
                            detail: "Use a repository/document-relative image path so the README remains portable.".to_owned(),
                        },
                    ));
                }
                if collect_text(node).trim().is_empty() {
                    issues.push(issue_for_node(
                        source,
                        &source_line_starts,
                        &source_map,
                        node,
                        IssueDraft {
                            kind: "image",
                            profile,
                            code: "image.missing-alt",
                            severity: "warning",
                            title: "Image has no alt text",
                            detail:
                                "Add descriptive alt text for accessibility and GitHub rendering."
                                    .to_owned(),
                        },
                    ));
                }
            }
            NodeValue::HtmlBlock(block) if profile == "commonmarkStrict" => {
                let lower = block.literal.to_ascii_lowercase();
                if lower.contains("<details") || lower.contains("<summary") {
                    issues.push(issue_for_node(
                        source,
                        &source_line_starts,
                        &source_map,
                        node,
                        IssueDraft {
                            kind: "details",
                            profile,
                            code: "profile.details-html",
                            severity: "info",
                            title: "HTML disclosure behavior is profile-specific",
                            detail: "CommonMark permits raw HTML, but <details>/<summary> interaction is not a CommonMark feature and may differ outside GitHub. Local saving remains available.".to_owned(),
                        },
                    ));
                }
            }
            NodeValue::HtmlInline(value) if profile == "commonmarkStrict" => {
                let lower = value.to_ascii_lowercase();
                if ["<ins", "</ins", "<sub", "</sub", "<sup", "</sup"]
                    .iter()
                    .any(|marker| lower.contains(marker))
                {
                    issues.push(issue_for_node(
                        source,
                        &source_line_starts,
                        &source_map,
                        node,
                        IssueDraft {
                            kind: "html_inline",
                            profile,
                            code: "profile.semantic-html",
                            severity: "info",
                            title: "Semantic HTML mark is profile-specific",
                            detail: "CommonMark preserves this raw HTML, but its semantic rendering is not a CommonMark feature. GitHub/Extended profiles provide the documented editor affordance.".to_owned(),
                        },
                    ));
                }
            }
            NodeValue::CodeBlock(code) => {
                let language = code
                    .info
                    .split_whitespace()
                    .next()
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                if !code.info.is_empty() && !supported_fence(&code.info) {
                    issues.push(issue_for_node(
                        source,
                        &source_line_starts,
                        &source_map,
                        node,
                        IssueDraft {
                            kind: "code_block",
                            profile,
                            code: "fence.unknown-language",
                            severity: "info",
                            title: "Unknown code language",
                            detail: format!(
                                "No dedicated highlighter is configured for {}.",
                                code.info
                            ),
                        },
                    ));
                }
                if matches!(language.as_str(), "dot" | "graphviz")
                    && compatibility_target == GITHUB_README_TARGET
                {
                    issues.push(issue_for_node(
                        source,
                        &source_line_starts,
                        &source_map,
                        node,
                        IssueDraft {
                            kind: "code_block",
                            profile,
                            code: "diagram.graphviz-portability",
                            severity: "warning",
                            title: "Graphviz preview is not portable",
                            detail: "This app can render Graphviz/DOT locally in the Extended profile; GitHub and CommonMark may display this as an ordinary code fence. Local saving remains available.".to_owned(),
                        },
                    ));
                }
            }
            _ => {}
        }
    }

    if profile == "commonmarkStrict" {
        issues.extend(strict_source_profile_issues(source, profile));
    }

    if let Some(issue) = markdown_size_issue(source.len(), profile, is_readme) {
        issues.push(issue);
    }

    apply_compatibility_target(&mut issues, compatibility_target);

    RenderedMarkdown {
        html,
        headings,
        links,
        issues,
        source_map,
        render_strategy,
        block_cache,
        blocks,
    }
}

struct IssueDraft<'a> {
    kind: &'a str,
    profile: &'a str,
    code: &'a str,
    severity: &'a str,
    title: &'a str,
    detail: String,
}

type SpanLookup<'a> = HashMap<(&'a str, usize, usize), &'a str>;

fn build_span_lookup(source_map: &SourceMap) -> SpanLookup<'_> {
    let mut lookup = HashMap::with_capacity(source_map.spans.len());
    for span in &source_map.spans {
        lookup
            .entry((
                span.kind.as_str(),
                span.source_byte_start,
                span.source_byte_end,
            ))
            .or_insert(span.map_id.as_str());
    }
    lookup
}

fn map_id_for_node<'a>(
    source: &str,
    line_starts: &[usize],
    span_lookup: &SpanLookup<'_>,
    node: &'a comrak::nodes::AstNode<'a>,
    kind: &str,
) -> Option<String> {
    let value = node.data.borrow().value.clone();
    let sourcepos = node.data.borrow().sourcepos;
    let (start, end) = node_range(source, line_starts, node, &value, sourcepos)?;
    span_lookup
        .get(&(kind, start, end))
        .map(|map_id| (*map_id).to_owned())
}

fn issue_for_node<'a>(
    source: &str,
    line_starts: &[usize],
    source_map: &SourceMap,
    node: &'a comrak::nodes::AstNode<'a>,
    draft: IssueDraft<'_>,
) -> Issue {
    let value = node.data.borrow().value.clone();
    let sourcepos = node.data.borrow().sourcepos;
    let range = node_range(source, line_starts, node, &value, sourcepos);
    let mapped = range.and_then(|(start, end)| {
        source_map.spans.iter().find(|span| {
            span.kind == draft.kind
                && span.source_byte_start == start
                && span.source_byte_end == end
        })
    });
    Issue {
        code: draft.code.to_owned(),
        severity: draft.severity.to_owned(),
        scope: issue_scope(draft.code).to_owned(),
        target: None,
        profile: draft.profile.to_owned(),
        title: draft.title.to_owned(),
        detail: draft.detail,
        learn_more: None,
        map_id: mapped.map(|span| span.map_id.clone()),
        source_byte_start: range.map(|(start, _)| start),
        source_byte_end: range.map(|(_, end)| end),
    }
}

fn markdown_size_issue(bytes: usize, profile: &str, is_readme: bool) -> Option<Issue> {
    let (code, severity, title, threshold, learn_more) = if bytes > 100 * 1024 * 1024 {
        (
            "github.object-too-large",
            "error",
            "File exceeds GitHub's regular object limit",
            "100 MiB",
            GITHUB_REPOSITORY_LIMITS_URL,
        )
    } else if bytes > 50 * 1024 * 1024 {
        (
            "github.large-object",
            "warning",
            "Large GitHub object",
            "50 MiB",
            GITHUB_LARGE_FILES_URL,
        )
    } else if bytes > 1024 * 1024 {
        (
            "github.object-recommended",
            "warning",
            "File exceeds GitHub's recommended object size",
            "1 MiB",
            GITHUB_REPOSITORY_LIMITS_URL,
        )
    } else if is_readme && bytes > 500 * 1024 {
        (
            "github.readme-truncated",
            "info",
            "README may be truncated on GitHub",
            "500 KiB",
            GITHUB_README_LIMITS_URL,
        )
    } else {
        return None;
    };
    Some(Issue {
        code: code.to_owned(),
        severity: severity.to_owned(),
        scope: issue_scope(code).to_owned(),
        target: None,
        profile: profile.to_owned(),
        title: title.to_owned(),
        detail: format!(
            "This Markdown file is {}; the compatibility threshold is {}. Local saving remains available.",
            format_bytes(bytes),
            threshold
        ),
        learn_more: Some(learn_more.to_owned()),
        map_id: None,
        source_byte_start: None,
        source_byte_end: None,
    })
}

fn strict_source_profile_issues(source: &str, profile: &str) -> Vec<Issue> {
    let mut issues = Vec::new();
    let mut lines = Vec::new();
    let mut offset = 0;
    for line in source.split_inclusive(['\n', '\r']) {
        let content = line.trim_end_matches(['\n', '\r']);
        lines.push((offset, content));
        offset += line.len();
    }
    if lines.is_empty() && !source.is_empty() {
        lines.push((0, source));
    }

    let mut fenced = None;
    let mut index = 0;
    while index + 1 < lines.len() {
        let (start, line) = lines[index];
        if let Some((fence_char, fence_length)) = fenced {
            if let Some((candidate_char, candidate_length)) = code_fence_marker(line)
                && candidate_char == fence_char
                && candidate_length >= fence_length
            {
                fenced = None;
            }
            index += 1;
            continue;
        }
        if let Some(marker) = code_fence_marker(line) {
            fenced = Some(marker);
            index += 1;
            continue;
        }

        let (_, separator) = lines[index + 1];
        if looks_like_pipe_row(line) && looks_like_gfm_separator(separator) {
            issues.push(Issue {
                code: "profile.gfm-table".to_owned(),
                severity: "warning".to_owned(),
                scope: "profile".to_owned(),
                target: None,
                profile: profile.to_owned(),
                title: "GFM table is outside CommonMark Strict".to_owned(),
                detail: "This pipe table relies on GitHub Flavored Markdown; another strict CommonMark renderer may display the source as plain text. The table range is not mapped by the strict parser. Local saving remains available.".to_owned(),
                learn_more: None,
                map_id: None,
                source_byte_start: Some(start),
                source_byte_end: Some(lines[index + 1].0 + separator.len()),
            });
            index += 2;
            continue;
        }
        index += 1;
    }
    issues
}

fn looks_like_pipe_row(line: &str) -> bool {
    let trimmed = line.trim();
    let without_edges = trimmed
        .strip_prefix('|')
        .unwrap_or(trimmed)
        .strip_suffix('|')
        .unwrap_or(trimmed.strip_prefix('|').unwrap_or(trimmed));
    without_edges.contains('|') || (trimmed.starts_with('|') && trimmed.ends_with('|'))
}

fn looks_like_gfm_separator(line: &str) -> bool {
    let trimmed = line.trim();
    if !looks_like_pipe_row(trimmed) {
        return false;
    }
    let without_edges = trimmed
        .strip_prefix('|')
        .unwrap_or(trimmed)
        .strip_suffix('|')
        .unwrap_or(trimmed.strip_prefix('|').unwrap_or(trimmed));
    let cells = without_edges.split('|').map(str::trim).collect::<Vec<_>>();
    cells.len() >= 2
        && cells.iter().all(|cell| {
            let value = cell.strip_prefix(':').unwrap_or(cell);
            let value = value.strip_suffix(':').unwrap_or(value);
            !value.is_empty() && value.chars().all(|character| character == '-')
        })
}

fn is_github_readme_name(file_name: &str) -> bool {
    let name = Path::new(file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name)
        .to_ascii_lowercase();
    matches!(
        name.as_str(),
        "readme.md" | "readme.markdown" | "readme.mdown" | "readme.mkdn" | "readme.mkdown"
    )
}

fn format_bytes(bytes: usize) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.2} MiB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.1} KiB", bytes as f64 / 1024.0)
    }
}

fn is_unsafe_target(target: &str) -> bool {
    let lower = target.trim().to_ascii_lowercase();
    lower.starts_with("javascript:")
        || lower.starts_with("vbscript:")
        || lower.starts_with("data:")
        || lower.starts_with("file:")
}

fn is_absolute_local_path(target: &str) -> bool {
    let trimmed = target.trim();
    trimmed.starts_with("\\\\")
        || (trimmed.len() >= 2
            && trimmed.as_bytes()[0].is_ascii_alphabetic()
            && trimmed.as_bytes()[1] == b':')
}

/// Add document-relative missing-reference and local-asset size issues.
/// This is deliberately separate from `render`, which has no filesystem base.
pub fn lint_local_references(
    document_dir: &Path,
    source_map: &SourceMap,
    profile: &str,
    compatibility_target: &str,
    workspace_root: Option<&Path>,
) -> Vec<Issue> {
    let mut issues = Vec::new();
    let root = workspace_root
        .and_then(|path| fs::canonicalize(path).ok())
        .unwrap_or_else(|| {
            fs::canonicalize(document_dir).unwrap_or_else(|_| document_dir.to_path_buf())
        });
    for span in &source_map.spans {
        let (kind, key, missing_code, missing_title) = match span.kind.as_str() {
            "image" => (
                "image",
                "src",
                "image.missing-target",
                "Missing local image",
            ),
            "link" => (
                "link",
                "target",
                "link.missing-target",
                "Missing local link target",
            ),
            _ => continue,
        };
        let Some(target) = span.attrs.get(key).and_then(Value::as_str) else {
            continue;
        };
        let target = target.split(['#', '?']).next().unwrap_or_default().trim();
        if target.is_empty()
            || target.starts_with('#')
            || is_unsafe_target(target)
            || target.starts_with("http://")
            || target.starts_with("https://")
            || target.starts_with("mailto:")
            || target.starts_with("tel:")
        {
            continue;
        }
        let root_relative = target.starts_with('/') && !target.starts_with("//");
        let candidate = if root_relative {
            let Some(workspace_root) = workspace_root else {
                issues.push(issue_for_span(
                    span,
                    profile,
                    "path.root-relative-unresolved",
                    "warning",
                    "Repository-root path cannot be checked",
                    "This /path reference is repository-root-relative on GitHub, but no workspace root is open for local validation.".to_owned(),
                ));
                continue;
            };
            let relative_target = target.trim_start_matches('/');
            if relative_target.is_empty() || relative_path_escapes(relative_target) {
                issues.push(issue_for_span(
                    span,
                    profile,
                    "path.outside-workspace-root",
                    "warning",
                    "Path escapes the workspace root",
                    "Keep repository-root-relative references inside the authorized workspace."
                        .to_owned(),
                ));
                continue;
            }
            workspace_root.join(relative_target.replace('/', std::path::MAIN_SEPARATOR_STR))
        } else {
            if is_absolute_local_path(target)
                || !relative_path_within_root(document_dir, &root, target)
            {
                issues.push(issue_for_span(
                    span,
                    profile,
                    "path.outside-document-root",
                    "warning",
                    "Path escapes the document root",
                    "Keep local references within the authorized document/workspace context."
                        .to_owned(),
                ));
                continue;
            }
            document_dir.join(target.replace('/', std::path::MAIN_SEPARATOR_STR))
        };
        match fs::metadata(&candidate) {
            Ok(metadata) => {
                if kind == "image" {
                    issues.extend(asset_size_issues(
                        metadata.len(),
                        profile,
                        span,
                        compatibility_target,
                    ));
                }
                if let Ok(canonical) = fs::canonicalize(&candidate)
                    && !canonical.starts_with(&root)
                {
                    issues.push(issue_for_span(
                        span,
                        profile,
                        "path.outside-document-root",
                        "warning",
                        "Path resolves outside the document root",
                        "The referenced file is outside the authorized local context.".to_owned(),
                    ));
                }
            }
            Err(_) => issues.push(issue_for_span(
                span,
                profile,
                missing_code,
                "warning",
                missing_title,
                format!(
                    "The local reference {target:?} does not resolve beside this Markdown file."
                ),
            )),
        }
    }
    apply_compatibility_target(&mut issues, compatibility_target);
    issues
}

fn issue_for_span(
    span: &MappedSpan,
    profile: &str,
    code: &str,
    severity: &str,
    title: &str,
    detail: String,
) -> Issue {
    issue_for_span_with_learn_more(span, profile, code, severity, title, detail, None)
}

fn issue_for_span_with_learn_more(
    span: &MappedSpan,
    profile: &str,
    code: &str,
    severity: &str,
    title: &str,
    detail: String,
    learn_more: Option<&str>,
) -> Issue {
    Issue {
        code: code.to_owned(),
        severity: severity.to_owned(),
        scope: issue_scope(code).to_owned(),
        target: None,
        profile: profile.to_owned(),
        title: title.to_owned(),
        detail,
        learn_more: learn_more.map(str::to_owned),
        map_id: Some(span.map_id.clone()),
        source_byte_start: Some(span.source_byte_start),
        source_byte_end: Some(span.source_byte_end),
    }
}

fn relative_path_escapes(target: &str) -> bool {
    let mut depth = 0_i32;
    for component in Path::new(target).components() {
        match component {
            std::path::Component::ParentDir if depth == 0 => return true,
            std::path::Component::ParentDir => depth -= 1,
            std::path::Component::Normal(_) => depth += 1,
            std::path::Component::CurDir => {}
            std::path::Component::RootDir | std::path::Component::Prefix(_) => return true,
        }
    }
    false
}

fn relative_path_within_root(base: &Path, root: &Path, target: &str) -> bool {
    let base = fs::canonicalize(base).unwrap_or_else(|_| base.to_path_buf());
    let mut current = base;
    for component in Path::new(&target.replace('/', std::path::MAIN_SEPARATOR_STR)).components() {
        match component {
            std::path::Component::Normal(value) => current.push(value),
            std::path::Component::ParentDir => {
                if !current.pop() || !current.starts_with(root) {
                    return false;
                }
            }
            std::path::Component::CurDir => {}
            std::path::Component::RootDir | std::path::Component::Prefix(_) => return false,
        }
    }
    current.starts_with(root)
}

fn asset_size_issues(
    bytes: u64,
    profile: &str,
    span: &MappedSpan,
    compatibility_target: &str,
) -> Vec<Issue> {
    let mut issues = Vec::new();
    let github_threshold = if compatibility_target != GITHUB_README_TARGET {
        None
    } else if bytes > 100 * 1024 * 1024 {
        Some((
            "github.asset-too-large",
            "error",
            "Image exceeds GitHub's regular object limit",
            "100 MiB",
        ))
    } else if bytes > 50 * 1024 * 1024 {
        Some((
            "github.asset-large",
            "warning",
            "Large GitHub image object",
            "50 MiB",
        ))
    } else if bytes > 1024 * 1024 {
        Some((
            "github.asset-recommended",
            "warning",
            "Image exceeds GitHub's recommended object size",
            "1 MiB",
        ))
    } else {
        None
    };
    if let Some((code, severity, title, threshold)) = github_threshold {
        issues.push(issue_for_span_with_learn_more(
            span,
            profile,
            code,
            severity,
            title,
            format!(
                "This asset is {}; the GitHub compatibility threshold is {}. Local saving remains available.",
                format_bytes(bytes as usize),
                threshold
            ),
            Some(if code == "github.asset-large" {
                GITHUB_LARGE_FILES_URL
            } else {
                GITHUB_REPOSITORY_LIMITS_URL
            }),
        ));
    }
    if bytes > 20 * 1024 * 1024 {
        issues.push(issue_for_span(
            span,
            profile,
            "app.asset-import-limit",
            "error",
            "Image exceeds this app's asset limit",
            format!(
                "This asset is {}; Markdown remains editable, but this app will not load it as a local preview asset above 20 MiB.",
                format_bytes(bytes as usize)
            ),
        ));
    }
    issues
}

fn issue_scope(code: &str) -> &'static str {
    if code.starts_with("profile.") || code == "fence.unknown-language" {
        "profile"
    } else if code.starts_with("github.")
        || code == "diagram.graphviz-portability"
        || code == "heading.duplicate-anchor"
    {
        "compatibility"
    } else {
        "general"
    }
}

fn apply_compatibility_target(issues: &mut Vec<Issue>, compatibility_target: &str) {
    let target_enabled = compatibility_target == GITHUB_README_TARGET;
    for issue in issues.iter_mut() {
        if issue.scope == "compatibility" && target_enabled {
            issue.target = Some(GITHUB_README_TARGET.to_owned());
        }
    }
    issues.retain(|issue| issue.scope != "compatibility" || target_enabled);
}

pub fn slugify(input: &str) -> String {
    let mut slug = String::new();
    let mut pending_dash = false;
    for ch in input.chars().flat_map(char::to_lowercase) {
        if ch.is_alphanumeric() {
            if pending_dash && !slug.is_empty() {
                slug.push('-');
            }
            pending_dash = false;
            slug.push(ch);
        } else if ch.is_whitespace() || ch == '-' {
            pending_dash = true;
        }
    }
    slug.trim_matches('-').to_owned()
}

fn link_kind(target: &str) -> &str {
    if target.starts_with("http://")
        || target.starts_with("https://")
        || target.starts_with("mailto:")
    {
        "external"
    } else if target.starts_with('#') {
        "heading"
    } else {
        "local"
    }
}

fn supported_fence(info: &str) -> bool {
    let language = info
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        language.as_str(),
        "" | "text"
            | "plaintext"
            | "md"
            | "markdown"
            | "js"
            | "javascript"
            | "ts"
            | "typescript"
            | "rust"
            | "rs"
            | "python"
            | "py"
            | "bash"
            | "sh"
            | "shell"
            | "powershell"
            | "ps"
            | "json"
            | "yaml"
            | "toml"
            | "html"
            | "css"
            | "sql"
            | "mermaid"
            | "dot"
            | "graphviz"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_gfm_and_keeps_raw_html_inert() {
        let rendered = render(
            "# Hello World\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>",
            "github",
        );
        assert!(rendered.html.contains("<table"));
        assert!(!rendered.html.contains("<script>"));
        assert_eq!(rendered.headings[0].slug, "hello-world");
    }

    #[test]
    fn github_profile_renders_github_alerts() {
        let rendered = render("> [!NOTE]\n> Keep this portable.\n", "github");
        assert!(rendered.html.contains("markdown-alert"));
        assert!(rendered.html.contains("Keep this portable."));
        let strict = render("> [!NOTE]\n> Keep this portable.\n", "commonmarkStrict");
        assert!(!strict.html.contains("markdown-alert"));
    }

    #[test]
    fn github_profile_renders_math_and_footnotes() {
        let rendered = render(
            "Euler: $e^{i\\pi} + 1 = 0$[^identity].\n\n[^identity]: Euler's identity.\n\n```math\nx^2\n```\n",
            "github",
        );
        assert!(rendered.html.contains("data-math-style=\"inline\""));
        assert!(rendered.html.contains("href=\"#fn-identity\""));
        assert!(rendered.html.contains("language-math"));

        let strict = render("$x$[^x]\n\n[^x]: note\n", "commonmarkStrict");
        assert!(!strict.html.contains("data-math-style"));
        assert!(!strict.html.contains("data-footnote-ref"));
    }

    #[test]
    fn strict_profile_reports_github_alerts_and_semantic_html() {
        let rendered = render(
            "> [!WARNING]\n> Review this before publishing.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n<ins>underlined</ins>\n\n<details>\n<summary>More</summary>\n\nBody\n\n</details>\n\n```md\n| not | a table |\n| --- | --- |\n```",
            "commonmarkStrict",
        );

        assert!(rendered.issues.iter().any(|issue| {
            issue.code == "profile.github-alert"
                && issue.severity == "warning"
                && issue.map_id.is_some()
        }));
        assert!(rendered.issues.iter().any(|issue| {
            issue.code == "profile.semantic-html"
                && issue.severity == "info"
                && issue.map_id.is_some()
        }));
        assert!(rendered.issues.iter().any(|issue| {
            issue.code == "profile.details-html"
                && issue.severity == "info"
                && issue.map_id.is_some()
        }));
        assert!(rendered.issues.iter().any(|issue| {
            issue.code == "profile.gfm-table"
                && issue.severity == "warning"
                && issue.map_id.is_none()
                && issue.source_byte_start
                    == Some("> [!WARNING]\n> Review this before publishing.\n\n".len())
        }));
        assert_eq!(
            rendered
                .issues
                .iter()
                .filter(|issue| issue.code == "profile.gfm-table")
                .count(),
            1
        );
    }

    #[test]
    fn alert_normalization_preserves_fenced_code_and_crlf_bytes() {
        let source = "```md\r\n> [!NOTE]\r\n```\r\n\r\n> [!WARNING]\r\n> Check this.\r\n";
        let normalized = normalize_alert_markers(source, true);
        assert!(normalized.contains("```md\r\n> [!NOTE]\r\n"));
        assert!(normalized.contains("> [!warning]\r\n> Check this."));
        assert_eq!(normalized.len(), source.len());
    }

    #[test]
    fn duplicate_heading_slugs_are_distinct() {
        let rendered = render("# Same\n\n## Same\n", "github");
        assert_eq!(rendered.headings[0].slug, "same");
        assert_eq!(rendered.headings[1].slug, "same-2");
    }

    #[test]
    fn sanitizes_unsafe_links_attributes_and_embeds() {
        let rendered = render(
            "[run](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n<iframe src=\"https://evil.example\"></iframe><object data=x></object>",
            "github",
        );
        let html = rendered.html.to_ascii_lowercase();
        assert!(!html.contains("javascript:"));
        assert!(!html.contains("onerror"));
        assert!(!html.contains("<iframe"));
        assert!(!html.contains("<object"));
    }

    #[test]
    fn ammonia_covers_gfm_disallowed_raw_html_tags() {
        // GFM tagfilter blacklist (title, textarea, style, xmp, iframe, noembed,
        // noframes, script, plaintext). Comrak no longer enables that extension;
        // Ammonia must keep these tags inert in rendered output.
        let rendered = render(
            "<title>t</title><textarea>a</textarea><style>b{}</style><xmp>c</xmp>\n\
             <iframe></iframe><noembed></noembed><noframes></noframes>\n\
             <script>alert(1)</script><plaintext>d\n\
             <XMP>upper</XMP>",
            "github",
        );
        let html = rendered.html.to_ascii_lowercase();
        for tag in [
            "title",
            "textarea",
            "style",
            "xmp",
            "iframe",
            "noembed",
            "noframes",
            "script",
            "plaintext",
        ] {
            assert!(
                !html.contains(&format!("<{tag}")),
                "expected Ammonia to remove GFM-disallowed <{tag}>"
            );
        }
    }

    #[test]
    fn preserves_safe_html_marks_and_details_through_sanitization() {
        let rendered = render(
            "<ins>underlined</ins> <sub>2</sub> <sup>3</sup>\n\n<details open>\n<summary>Overview</summary>\n\nBody\n\n</details>",
            "github",
        );
        assert!(rendered.html.contains("<ins>underlined</ins>"));
        assert!(rendered.html.contains("<sub>2</sub>"));
        assert!(rendered.html.contains("<sup>3</sup>"));
        assert!(rendered.html.contains(r#"<details open="">"#));
        assert!(rendered.html.contains("<summary>Overview</summary>"));
        assert!(
            rendered
                .source_map
                .spans
                .iter()
                .any(|span| span.kind == "details")
        );
    }

    #[test]
    fn preserves_paragraph_align_for_github_badge_rows() {
        let rendered = render(
            "<p align=\"center\">\n<a href=\"https://example.com\"><img alt=\"CI\" src=\"https://example.com/badge.svg\" /></a>\n</p>\n",
            "github",
        );
        assert!(
            rendered.html.contains(r#"align="center""#)
                || rendered.html.contains("align='center'")
                || rendered.html.contains(r#"align=center"#),
            "expected centered paragraph align to survive sanitization, got {}",
            rendered.html
        );
    }

    #[test]
    fn raw_html_cannot_impersonate_generated_source_positions() {
        let source = "<h1 data-sourcepos=\"2:1-2:8\">Spoofed</h1>\n\n# Genuine\n";
        let rendered = render(source, "github");
        let html = rendered.html.to_ascii_lowercase();

        assert!(!html.contains("data-sourcepos=\"2:1-2:8\""));
        assert!(html.contains("data-sourcepos=\"3:1-3:9\""));
        assert!(
            rendered
                .source_map
                .spans
                .iter()
                .any(|span| span.kind == "heading"
                    && &source[span.source_byte_start..span.source_byte_end] == "# Genuine")
        );
    }

    #[test]
    fn sourcepos_mask_does_not_change_code_contents() {
        let source =
            "`<h1 data-sourcepos=\"1:1-1:2\">`\n\n```html\n<h1 data-sourcepos=\"2:1-2:2\">\n```\n";
        assert_eq!(mask_user_sourcepos_attributes(source), source);
        let rendered = render(source, "github");
        assert!(rendered.html.contains("data-sourcepos"));
    }

    #[test]
    fn source_map_ranges_are_exact_and_have_context_attributes() {
        let source = "# Café\n\n**bold** and [link](docs/a.md)\n\n- [x] done\n\n```rust\nlet x = 1;\n```\n\n![Alt](img.png)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n";
        let rendered = render(source, "github");
        let map = &rendered.source_map;
        assert_eq!(map.version, SOURCE_MAP_VERSION);
        assert_eq!(map.source_hash, source_hash(source));
        assert!(!map.spans.is_empty());
        assert!(rendered.html.contains("data-sourcepos"));

        let mut map_ids = HashSet::new();
        for span in &map.spans {
            assert!(
                map_ids.insert(&span.map_id),
                "duplicate map id: {}",
                span.map_id
            );
            assert!(span.source_byte_start < span.source_byte_end);
            assert!(span.source_byte_end <= source.len());
            assert!(source.is_char_boundary(span.source_byte_start));
            assert!(source.is_char_boundary(span.source_byte_end));
        }

        let mapped_text = |kind: &str| {
            let span = map
                .spans
                .iter()
                .find(|span| span.kind == kind)
                .unwrap_or_else(|| panic!("missing {kind} span"));
            &source[span.source_byte_start..span.source_byte_end]
        };
        assert_eq!(mapped_text("heading"), "# Café");
        assert_eq!(mapped_text("code_block"), "```rust\nlet x = 1;\n```");
        assert_eq!(mapped_text("image"), "![Alt](img.png)");
        assert_eq!(mapped_text("table"), "| A | B |\n| - | - |\n| 1 | 2 |");

        let heading = map
            .spans
            .iter()
            .find(|span| span.kind == "heading")
            .unwrap();
        assert_eq!(heading.attrs.get("level"), Some(&Value::from(1_u8)));
        let code = map
            .spans
            .iter()
            .find(|span| span.kind == "code_block")
            .unwrap();
        assert_eq!(code.attrs.get("fenced"), Some(&Value::from(true)));
        assert_eq!(code.attrs.get("language"), Some(&Value::from("rust")));
        let image = map.spans.iter().find(|span| span.kind == "image").unwrap();
        assert_eq!(image.attrs.get("alt"), Some(&Value::from("Alt")));
        let table = map.spans.iter().find(|span| span.kind == "table").unwrap();
        assert_eq!(table.attrs.get("columns"), Some(&Value::from(2_usize)));
        let table_cells = map
            .spans
            .iter()
            .filter(|span| span.kind == "table_cell")
            .map(|span| &source[span.source_byte_start..span.source_byte_end])
            .collect::<Vec<_>>();
        assert!(table_cells.iter().any(|cell| cell.contains("A")));
        assert!(table_cells.iter().any(|cell| cell.contains("2")));
        let task = map
            .spans
            .iter()
            .find(|span| span.kind == "task_item")
            .unwrap();
        assert_eq!(task.attrs.get("checked"), Some(&Value::from(true)));
    }

    #[test]
    fn large_renders_expose_source_mapped_fragments_for_webview_commits() {
        let source = (0..900)
            .map(|index| format!("Paragraph {index} with enough content for block rendering.\n"))
            .collect::<Vec<_>>()
            .join("\n");
        let initial = render_for_file_with_target(&source, "github", Some("README.md"), "none");
        assert_eq!(initial.render_strategy, RenderStrategy::Full);
        assert!(initial.blocks.is_empty());
        let rendered = render_for_file_with_target_cached(
            &source,
            "github",
            Some("README.md"),
            "none",
            Some(&initial.block_cache),
        );

        assert_eq!(rendered.html, initial.html);
        assert!(rendered.blocks.len() > 100);
        assert!(rendered.blocks.iter().all(|block| {
            rendered
                .source_map
                .spans
                .iter()
                .any(|span| span.map_id == block.map_id)
        }));
        assert!(rendered.blocks.iter().all(|block| !block.html.is_empty()));
    }

    #[test]
    fn source_map_covers_nested_lists_and_both_code_forms() {
        let source = "- outer\n  - inner [link](./docs.md)\n\nafter list\n\n    indented code\n\n```\nplain code\n```\n";
        let rendered = render(source, "github");
        let map = &rendered.source_map;
        let text_for = |kind: &str, expected: &str| {
            assert!(
                map.spans.iter().any(|span| {
                    span.kind == kind
                        && &source[span.source_byte_start..span.source_byte_end] == expected
                }),
                "missing {kind} range for {expected:?}"
            );
        };
        text_for("list", "- outer\n  - inner [link](./docs.md)");
        text_for("list_item", "- inner [link](./docs.md)");
        text_for("link", "[link](./docs.md)");
        text_for("code_block", "    indented code");
        text_for("code_block", "```\nplain code\n```");
    }

    #[test]
    fn source_map_handles_crlf_lone_cr_and_multibyte_offsets() {
        let source = "## Café\r\n\r\nfirst\rsecond\n\n```\r\n好\r\n```";
        let rendered = render(source, "github");
        let map = &rendered.source_map;

        assert!(map.spans.iter().any(|span| {
            span.kind == "heading"
                && &source[span.source_byte_start..span.source_byte_end] == "## Café"
        }));
        for span in &map.spans {
            assert!(source.is_char_boundary(span.source_byte_start));
            assert!(source.is_char_boundary(span.source_byte_end));
            assert_eq!(
                source.as_bytes()[span.source_byte_start..span.source_byte_end].len(),
                span.source_byte_end - span.source_byte_start
            );
        }

        let first = source.find("first").unwrap();
        let second = source.find("second").unwrap();
        assert_eq!(&source[first..first + "first".len()], "first");
        assert_eq!(&source[second..second + "second".len()], "second");
    }

    #[test]
    fn source_hash_changes_when_decoded_source_changes() {
        assert_ne!(source_hash("# one"), source_hash("# two"));
        assert_eq!(source_hash("# one"), source_hash("# one"));
    }

    #[test]
    fn lint_emits_stable_source_mapped_issues() {
        let source = "# Same\n\n# Same\n\n![](missing.png)\n\n[bad](javascript:alert(1))\n\n```brainfuck\n+\n```\n";
        let rendered = render(source, "github");
        let codes = rendered
            .issues
            .iter()
            .map(|issue| issue.code.as_str())
            .collect::<HashSet<_>>();
        assert!(codes.contains("heading.duplicate-anchor"));
        assert!(codes.contains("image.missing-alt"));
        assert!(codes.contains("url.unsafe-scheme"));
        assert!(codes.contains("fence.unknown-language"));
        for issue in &rendered.issues {
            assert_eq!(issue.profile, "github");
            if issue.code != "github.readme-truncated" {
                assert!(
                    issue.map_id.is_some(),
                    "{} should identify its source object",
                    issue.code
                );
                assert!(issue.source_byte_start < issue.source_byte_end);
            }
        }
    }

    #[test]
    fn graphviz_is_warned_for_the_github_target_independent_of_editor_profile() {
        let source = "```dot\ndigraph G { A -> B }\n```\n";
        let github = render(source, "github");
        let issue = github
            .issues
            .iter()
            .find(|issue| issue.code == "diagram.graphviz-portability")
            .expect("GitHub should warn about local-only Graphviz rendering");
        assert_eq!(issue.severity, "warning");
        assert!(issue.map_id.is_some());

        let extended = render(source, "extended");
        assert!(
            extended
                .issues
                .iter()
                .any(|issue| issue.code == "diagram.graphviz-portability")
        );
        let none = render_for_file_with_target(source, "extended", Some("README.md"), "none");
        assert!(
            !none
                .issues
                .iter()
                .any(|issue| issue.code == "diagram.graphviz-portability")
        );
    }

    #[test]
    fn compatibility_target_does_not_change_preview_or_source_map() {
        let source = "# Title\n\n```dot\ndigraph G { A -> B }\n```\n";
        let github = render_for_file_with_target(
            source,
            "extended",
            Some("README.md"),
            DEFAULT_COMPATIBILITY_TARGET,
        );
        let none = render_for_file_with_target(source, "extended", Some("README.md"), "none");

        assert_eq!(github.html, none.html);
        assert_eq!(github.headings, none.headings);
        assert_eq!(github.links, none.links);
        assert_eq!(github.source_map.source_hash, none.source_map.source_hash);
        assert_eq!(github.source_map.spans, none.source_map.spans);
        assert!(
            github
                .issues
                .iter()
                .any(|issue| issue.target.as_deref() == Some(DEFAULT_COMPATIBILITY_TARGET))
        );
        assert!(
            !none
                .issues
                .iter()
                .any(|issue| issue.scope == "compatibility")
        );
    }

    #[test]
    fn local_reference_lint_distinguishes_existing_and_missing_files() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("present.png"), b"image").unwrap();
        let source =
            "![present](present.png)\n\n![missing](missing.png)\n\n[elsewhere](../outside.md)\n";
        let rendered = render(source, "github");
        let issues = lint_local_references(
            directory.path(),
            &rendered.source_map,
            "github",
            DEFAULT_COMPATIBILITY_TARGET,
            None,
        );
        assert!(
            issues
                .iter()
                .any(|issue| issue.code == "image.missing-target")
        );
        assert!(
            issues
                .iter()
                .any(|issue| issue.code == "path.outside-document-root")
        );
        assert!(
            !issues
                .iter()
                .any(|issue| issue.detail.contains("present.png"))
        );
        assert!(issues.iter().all(|issue| issue.map_id.is_some()));
    }

    #[test]
    fn local_reference_lint_resolves_workspace_root_paths_without_rejecting_parent_links() {
        let workspace = tempfile::tempdir().unwrap();
        let docs = workspace.path().join("docs");
        fs::create_dir_all(workspace.path().join("assets")).unwrap();
        fs::create_dir_all(&docs).unwrap();
        fs::write(workspace.path().join("assets/present.png"), b"image").unwrap();
        let source = "![root](/assets/present.png)\n\n![parent](../assets/present.png)\n\n![missing](/assets/missing.png)\n";
        let rendered = render(source, "github");
        let issues = lint_local_references(
            &docs,
            &rendered.source_map,
            "github",
            DEFAULT_COMPATIBILITY_TARGET,
            Some(workspace.path()),
        );

        assert!(
            !issues
                .iter()
                .any(|issue| issue.detail.contains("present.png"))
        );
        assert!(issues.iter().any(|issue| {
            issue.code == "image.missing-target" && issue.detail.contains("missing.png")
        }));
        assert!(
            !issues
                .iter()
                .any(|issue| issue.code == "path.outside-document-root")
        );
    }

    #[test]
    fn root_relative_reference_without_workspace_has_one_unresolved_issue() {
        let directory = tempfile::tempdir().unwrap();
        let source = "![root](/assets/present.png)\n";
        let rendered = render(source, "github");
        assert!(
            !rendered
                .issues
                .iter()
                .any(|issue| issue.code == "path.absolute-local")
        );

        let issues = lint_local_references(
            directory.path(),
            &rendered.source_map,
            "github",
            DEFAULT_COMPATIBILITY_TARGET,
            None,
        );
        assert_eq!(
            issues
                .iter()
                .filter(|issue| issue.code == "path.root-relative-unresolved")
                .count(),
            1
        );
        assert!(
            !issues
                .iter()
                .any(|issue| issue.code == "path.absolute-local")
        );
    }

    #[test]
    fn size_warning_uses_highest_applicable_threshold() {
        let source = "x".repeat(500 * 1024 + 1);
        let rendered = render(&source, "github");
        assert!(rendered.issues.is_empty());
        let rendered = render_for_file_with_target(
            &source,
            "github",
            Some("README.md"),
            DEFAULT_COMPATIBILITY_TARGET,
        );
        assert_eq!(rendered.issues.len(), 1);
        assert_eq!(rendered.issues[0].code, "github.readme-truncated");
        assert_eq!(
            rendered.issues[0].learn_more.as_deref(),
            Some(GITHUB_README_LIMITS_URL)
        );
        let rendered = render_for_file_with_target(
            &source,
            "github",
            Some("guide.md"),
            DEFAULT_COMPATIBILITY_TARGET,
        );
        assert!(rendered.issues.is_empty());
        let source = "x".repeat(1024 * 1024 + 1);
        let rendered = render(&source, "github");
        assert_eq!(rendered.issues[0].code, "github.object-recommended");
        assert_eq!(
            rendered.issues[0].learn_more.as_deref(),
            Some(GITHUB_REPOSITORY_LIMITS_URL)
        );
    }

    #[test]
    fn asset_size_issues_keep_github_and_app_scopes_separate() {
        let span = MappedSpan {
            map_id: "image".to_owned(),
            kind: "image".to_owned(),
            source_byte_start: 0,
            source_byte_end: 10,
            attrs: BTreeMap::new(),
        };
        let recommended = asset_size_issues(
            2 * 1024 * 1024,
            "github",
            &span,
            DEFAULT_COMPATIBILITY_TARGET,
        );
        assert_eq!(recommended.len(), 1);
        assert_eq!(recommended[0].code, "github.asset-recommended");
        assert_eq!(
            recommended[0].learn_more.as_deref(),
            Some(GITHUB_REPOSITORY_LIMITS_URL)
        );

        let over_app_limit = asset_size_issues(
            21 * 1024 * 1024,
            "github",
            &span,
            DEFAULT_COMPATIBILITY_TARGET,
        );
        assert_eq!(
            over_app_limit
                .iter()
                .map(|issue| issue.code.as_str())
                .collect::<HashSet<_>>(),
            HashSet::from(["github.asset-recommended", "app.asset-import-limit"])
        );
    }
}
