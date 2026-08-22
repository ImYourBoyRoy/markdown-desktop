use comrak::{Arena, Options, nodes::NodeValue, parse_document};
use std::collections::HashSet;

use crate::model::{Heading, Issue, LinkInfo};

#[derive(Debug, Clone)]
pub struct RenderedMarkdown {
    pub html: String,
    pub headings: Vec<Heading>,
    pub links: Vec<LinkInfo>,
    pub issues: Vec<Issue>,
}

pub fn render(source: &str, profile: &str) -> RenderedMarkdown {
    let mut options = Options::default();
    let extended = matches!(profile, "extended" | "custom");
    let github = profile != "commonmarkStrict";

    options.extension.table = github;
    options.extension.strikethrough = github;
    options.extension.tasklist = github;
    options.extension.autolink = github;
    options.extension.tagfilter = github;
    options.extension.front_matter_delimiter = extended.then(|| "---".to_owned());
    options.extension.math_dollars = extended;
    options.extension.math_code = extended;
    options.extension.footnotes = extended;
    options.extension.alerts = extended;
    options.extension.wikilinks_title_after_pipe = extended;
    options.extension.header_id_prefix = Some(String::new());
    options.render.r#unsafe = false;

    let arena = Arena::new();
    let root = parse_document(&arena, source, &options);
    let mut raw_html = String::new();
    comrak::format_html(root, &options, &mut raw_html).expect("writing to String cannot fail");
    let html = ammonia::Builder::default().clean(&raw_html).to_string();

    let mut headings = Vec::new();
    let mut used_slugs = HashSet::new();
    let mut links = Vec::new();
    let mut issues = Vec::new();

    for node in root.descendants() {
        let value = node.data.borrow().value.clone();
        match value {
            NodeValue::Heading(heading) => {
                let text = collect_text(node).trim().to_owned();
                let base = slugify(&text);
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
            NodeValue::Link(link) => {
                let target = link.url;
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
                });
            }
            NodeValue::Image(_) => {}
            NodeValue::CodeBlock(code) if !code.info.is_empty() && !supported_fence(&code.info) => {
                issues.push(Issue {
                    severity: "info".to_owned(),
                    title: "Unknown code language".to_owned(),
                    detail: format!("No dedicated highlighter is configured for {}.", code.info),
                });
            }
            _ => {}
        }
    }

    RenderedMarkdown {
        html,
        headings,
        links,
        issues,
    }
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

fn collect_text<'a>(node: &'a comrak::nodes::AstNode<'a>) -> String {
    let mut text = String::new();
    for child in node.children() {
        let value = child.data.borrow().value.clone();
        match value {
            NodeValue::Text(value) => text.push_str(&value),
            NodeValue::Code(code) => text.push_str(&code.literal),
            NodeValue::SoftBreak | NodeValue::LineBreak => text.push(' '),
            _ => text.push_str(&collect_text(child)),
        }
    }
    text
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
        assert!(rendered.html.contains("<table>"));
        assert!(!rendered.html.contains("<script>"));
        assert_eq!(rendered.headings[0].slug, "hello-world");
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
}
