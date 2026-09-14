use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use comrak::nodes::{AlertType, ListType, NodeValue, Sourcepos};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};

use crate::model::{MappedSpan, SourceMap};

pub(crate) const SOURCE_MAP_VERSION: u32 = 1;

pub(crate) fn build_source_map<'a>(
    source: &str,
    root: &'a comrak::nodes::AstNode<'a>,
) -> SourceMap {
    let line_starts = line_starts(source);
    let mut spans = Vec::new();
    let mut occurrences: HashMap<(String, usize, usize), usize> = HashMap::new();

    for node in root.descendants() {
        let (value, sourcepos) = {
            let ast = node.data.borrow();
            (ast.value.clone(), ast.sourcepos)
        };
        let Some(kind) = map_kind(&value) else {
            continue;
        };
        let Some((source_byte_start, source_byte_end)) =
            node_range(source, &line_starts, node, &value, sourcepos)
        else {
            continue;
        };
        let key = (kind.to_owned(), source_byte_start, source_byte_end);
        let occurrence = occurrences.entry(key).or_insert(0);
        let map_id = format!("map-{kind}-{source_byte_start}-{source_byte_end}-{occurrence}");
        *occurrence += 1;
        spans.push(MappedSpan {
            map_id,
            kind: kind.to_owned(),
            source_byte_start,
            source_byte_end,
            attrs: map_attrs(node, &value),
        });
    }

    append_html_sub_spans(source, &mut spans);

    SourceMap {
        version: SOURCE_MAP_VERSION,
        source_hash: source_hash(source),
        spans,
    }
}

fn append_html_sub_spans(source: &str, spans: &mut Vec<MappedSpan>) {
    let parents: Vec<MappedSpan> = spans
        .iter()
        .filter(|span| {
            matches!(
                span.kind.as_str(),
                "html_block" | "html_inline" | "html_layout_table"
            )
        })
        .cloned()
        .collect();

    for parent in parents {
        if parent.source_byte_end > source.len()
            || !source.is_char_boundary(parent.source_byte_start)
            || !source.is_char_boundary(parent.source_byte_end)
        {
            continue;
        }
        let literal = &source[parent.source_byte_start..parent.source_byte_end];
        let mut link_index = 0usize;
        let mut image_index = 0usize;
        let mut cursor = 0usize;
        while cursor < literal.len() {
            let Some(rel_start) = literal[cursor..].find('<') else {
                break;
            };
            let tag_start = cursor + rel_start;
            let tag_slice = &literal[tag_start..];
            let (tag_name, kind, attr_name, counter) = if tag_slice.len() >= 2
                && tag_slice.as_bytes().get(1) == Some(&b'a')
                && tag_slice
                    .as_bytes()
                    .get(2)
                    .is_none_or(|next| !next.is_ascii_alphanumeric())
            {
                ("a", "html_link", "href", &mut link_index)
            } else if tag_slice.len() >= 4
                && tag_slice[1..].starts_with("img")
                && tag_slice
                    .as_bytes()
                    .get(4)
                    .is_none_or(|next| !next.is_ascii_alphanumeric())
            {
                ("img", "html_image", "src", &mut image_index)
            } else {
                cursor = tag_start + 1;
                continue;
            };
            let Some(rel_end) = tag_slice.find('>') else {
                cursor = tag_start + 1;
                continue;
            };
            let tag_end = tag_start + rel_end + 1;
            let tag_markup = &literal[tag_start..tag_end];
            let Some(value) = markup_attribute_value(tag_markup, attr_name) else {
                cursor = tag_end;
                continue;
            };
            let occurrence = *counter;
            *counter += 1;
            let suffix = if tag_name == "a" {
                format!("html-link-{occurrence}")
            } else {
                format!("html-image-{occurrence}")
            };
            let mut attrs = BTreeMap::new();
            attrs.insert("parentMapId".into(), Value::from(parent.map_id.clone()));
            attrs.insert(attr_name.into(), Value::from(value));
            spans.push(MappedSpan {
                map_id: format!("{}#{suffix}", parent.map_id),
                kind: kind.to_owned(),
                source_byte_start: parent.source_byte_start + tag_start,
                source_byte_end: parent.source_byte_start + tag_end,
                attrs,
            });
            cursor = tag_end;
        }
    }
}

fn markup_attribute_value(tag: &str, attribute: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut search_from = 0usize;
    while let Some(rel) = lower[search_from..].find(attribute) {
        let index = search_from + rel;
        let after = tag.get(index + attribute.len()..)?.trim_start();
        if !after.starts_with('=') {
            search_from = index + attribute.len();
            continue;
        }
        let value_part = after[1..].trim_start();
        if let Some(stripped) = value_part.strip_prefix('"') {
            let end = stripped.find('"')?;
            let value = stripped[..end].trim();
            return (!value.is_empty()).then(|| value.to_owned());
        }
        if let Some(stripped) = value_part.strip_prefix('\'') {
            let end = stripped.find('\'')?;
            let value = stripped[..end].trim();
            return (!value.is_empty()).then(|| value.to_owned());
        }
        let end = value_part
            .find(|character: char| character.is_whitespace() || character == '>')
            .unwrap_or(value_part.len());
        let value = value_part[..end].trim();
        return (!value.is_empty()).then(|| value.to_owned());
    }
    None
}

fn map_kind(value: &NodeValue) -> Option<&'static str> {
    match value {
        NodeValue::FrontMatter(_) => Some("front_matter"),
        NodeValue::BlockQuote | NodeValue::MultilineBlockQuote(_) => Some("blockquote"),
        NodeValue::List(_) => Some("list"),
        NodeValue::Item(_) => Some("list_item"),
        NodeValue::DescriptionList => Some("description_list"),
        NodeValue::DescriptionItem(_) => Some("description_item"),
        NodeValue::DescriptionTerm => Some("description_term"),
        NodeValue::DescriptionDetails => Some("description_details"),
        NodeValue::CodeBlock(_) => Some("code_block"),
        NodeValue::HtmlBlock(block) => {
            let lower = block.literal.to_ascii_lowercase();
            if lower.contains("<details") {
                Some("details")
            } else if lower.contains("<table") {
                Some("html_layout_table")
            } else {
                Some("html_block")
            }
        }
        NodeValue::Paragraph => Some("paragraph"),
        NodeValue::Heading(_) => Some("heading"),
        NodeValue::ThematicBreak => Some("thematic_break"),
        NodeValue::FootnoteDefinition(_) => Some("footnote_definition"),
        NodeValue::Table(_) => Some("table"),
        NodeValue::TableRow(_) => Some("table_row"),
        NodeValue::TableCell => Some("table_cell"),
        NodeValue::Text(_) => Some("text"),
        NodeValue::TaskItem(_) => Some("task_item"),
        NodeValue::SoftBreak => Some("soft_break"),
        NodeValue::LineBreak => Some("line_break"),
        NodeValue::Code(_) => Some("inline_code"),
        NodeValue::HtmlInline(_) => Some("html_inline"),
        NodeValue::Emph => Some("emphasis"),
        NodeValue::Strong => Some("strong"),
        NodeValue::Strikethrough => Some("strikethrough"),
        NodeValue::Highlight => Some("highlight"),
        NodeValue::Insert | NodeValue::Underline => Some("underline"),
        NodeValue::Superscript => Some("superscript"),
        NodeValue::Subscript => Some("subscript"),
        NodeValue::Link(_) => Some("link"),
        NodeValue::Image(_) => Some("image"),
        NodeValue::FootnoteReference(_) => Some("footnote_reference"),
        NodeValue::Math(_) => Some("math"),
        NodeValue::WikiLink(_) => Some("wiki_link"),
        NodeValue::SpoileredText => Some("spoiler"),
        NodeValue::Alert(_) => Some("alert"),
        NodeValue::Subtext => Some("subtext"),
        NodeValue::BlockDirective(_) => Some("block_directive"),
        _ => None,
    }
}

fn map_attrs<'a>(
    node: &'a comrak::nodes::AstNode<'a>,
    value: &NodeValue,
) -> BTreeMap<String, Value> {
    let mut attrs = BTreeMap::new();
    match value {
        NodeValue::Heading(heading) => {
            attrs.insert("level".into(), Value::from(heading.level));
            attrs.insert("setext".into(), Value::from(heading.setext));
        }
        NodeValue::CodeBlock(code) => {
            attrs.insert("fenced".into(), Value::from(code.fenced));
            attrs.insert("info".into(), Value::from(code.info.clone()));
            attrs.insert(
                "language".into(),
                Value::from(
                    code.info
                        .split_whitespace()
                        .next()
                        .unwrap_or_default()
                        .to_owned(),
                ),
            );
        }
        NodeValue::Link(link) => {
            attrs.insert("target".into(), Value::from(link.url.clone()));
            attrs.insert("title".into(), Value::from(link.title.clone()));
        }
        NodeValue::Image(image) => {
            attrs.insert("src".into(), Value::from(image.url.clone()));
            attrs.insert("title".into(), Value::from(image.title.clone()));
            attrs.insert("alt".into(), Value::from(collect_text(node)));
        }
        NodeValue::List(list) => {
            attrs.insert(
                "ordered".into(),
                Value::from(matches!(list.list_type, ListType::Ordered)),
            );
            attrs.insert("tight".into(), Value::from(list.tight));
            attrs.insert("taskList".into(), Value::from(list.is_task_list));
        }
        NodeValue::Table(table) => {
            attrs.insert("columns".into(), Value::from(table.num_columns));
            attrs.insert("rows".into(), Value::from(table.num_rows));
        }
        NodeValue::TableRow(header) => {
            attrs.insert("header".into(), Value::from(*header));
        }
        NodeValue::TaskItem(task) => {
            attrs.insert("checked".into(), Value::from(task.symbol.is_some()));
            if let Some(symbol) = task.symbol {
                attrs.insert("symbol".into(), Value::from(symbol.to_string()));
            }
        }
        NodeValue::FootnoteDefinition(footnote) => {
            attrs.insert("name".into(), Value::from(footnote.name.clone()));
        }
        NodeValue::FootnoteReference(footnote) => {
            attrs.insert("name".into(), Value::from(footnote.name.clone()));
        }
        NodeValue::Math(math) => {
            attrs.insert("display".into(), Value::from(math.display_math));
        }
        NodeValue::Alert(alert) => {
            attrs.insert(
                "type".into(),
                Value::from(alert_type_name(alert.alert_type)),
            );
        }
        NodeValue::BlockDirective(directive) => {
            attrs.insert("info".into(), Value::from(directive.info.clone()));
        }
        _ => {}
    }
    attrs
}

fn alert_type_name(alert_type: AlertType) -> &'static str {
    match alert_type {
        AlertType::Note => "note",
        AlertType::Tip => "tip",
        AlertType::Important => "important",
        AlertType::Warning => "warning",
        AlertType::Caution => "caution",
    }
}

pub(crate) fn source_hash(source: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source.as_bytes());
    format!("sha256:{}", BASE64.encode(hasher.finalize()))
}

pub(crate) fn normalize_alert_markers(source: &str, enabled: bool) -> String {
    if !enabled || !source.contains("[!") {
        return source.to_owned();
    }

    let mut normalized = String::with_capacity(source.len());
    let mut fenced: Option<(u8, usize)> = None;

    for line in source.split_inclusive(['\n', '\r']) {
        let line_without_newline = line.trim_end_matches(['\n', '\r']);
        let mut rendered_line = line_without_newline.to_owned();

        if fenced.is_none()
            && let Some((marker_start, marker_length)) = alert_marker_start(line_without_newline)
            && let Some(marker) = rendered_line.get_mut(marker_start..marker_start + marker_length)
        {
            marker.make_ascii_lowercase();
        }

        normalized.push_str(&rendered_line);
        normalized.push_str(&line[line_without_newline.len()..]);

        if let Some((fence_char, fence_length)) = fenced {
            if let Some((candidate_char, candidate_length)) =
                code_fence_marker(line_without_newline)
                && candidate_char == fence_char
                && candidate_length >= fence_length
            {
                fenced = None;
            }
        } else if let Some(marker) = code_fence_marker(line_without_newline) {
            fenced = Some(marker);
        }
    }

    normalized
}

/// Prevent user-authored raw HTML from impersonating Comrak's generated
/// `data-sourcepos` bridge attribute. The parser copy must remain byte-for-byte
/// the same length so source positions still address the original source. Code
/// fences and inline code are left untouched because their contents are user
/// visible source, not HTML attributes.
pub(crate) fn mask_user_sourcepos_attributes(source: &str) -> String {
    const SOURCEPOS_NAME: &[u8] = b"data-sourcepos";

    if !source
        .as_bytes()
        .windows(SOURCEPOS_NAME.len())
        .any(|window| window.eq_ignore_ascii_case(SOURCEPOS_NAME))
    {
        return source.to_owned();
    }

    let mut masked = source.as_bytes().to_vec();
    let mut fenced: Option<(u8, usize)> = None;
    let mut inline_code_ticks: Option<usize> = None;
    let mut line_start = 0;

    while line_start < masked.len() {
        let mut content_end = line_start;
        while content_end < masked.len()
            && masked[content_end] != b'\n'
            && masked[content_end] != b'\r'
        {
            content_end += 1;
        }

        let line = &source.as_bytes()[line_start..content_end];
        let line_fence = code_fence_marker_bytes(line);
        if fenced.is_none() && line_fence.is_none() {
            mask_sourcepos_in_line(&mut masked[line_start..content_end], &mut inline_code_ticks);
        }

        if let Some((fence_char, fence_length)) = fenced {
            if let Some((candidate_char, candidate_length)) = code_fence_marker_bytes(line)
                && candidate_char == fence_char
                && candidate_length >= fence_length
            {
                fenced = None;
            }
        } else if let Some(marker) = line_fence {
            fenced = Some(marker);
        }

        content_end = match masked.get(content_end) {
            Some(b'\r') if masked.get(content_end + 1) == Some(&b'\n') => content_end + 2,
            Some(b'\r' | b'\n') => content_end + 1,
            _ => content_end,
        };
        line_start = content_end;
    }

    String::from_utf8(masked).expect("masking ASCII attribute names preserves UTF-8")
}

fn mask_sourcepos_in_line(line: &mut [u8], inline_code_ticks: &mut Option<usize>) {
    const SOURCEPOS_NAME: &[u8] = b"data-sourcepos";
    const MASKED_NAME: &[u8] = b"data-source-xx";

    let mut index = 0;
    let mut in_tag = false;
    let mut quote = None;

    while index < line.len() {
        if let Some(quote_byte) = quote {
            if line[index] == quote_byte {
                quote = None;
            }
            index += 1;
            continue;
        }

        if in_tag {
            match line[index] {
                b'\'' | b'"' => quote = Some(line[index]),
                b'>' => in_tag = false,
                _ => {}
            }

            if line[index..].len() >= SOURCEPOS_NAME.len()
                && line[index..index + SOURCEPOS_NAME.len()].eq_ignore_ascii_case(SOURCEPOS_NAME)
                && (index == 0 || is_html_attribute_boundary(line[index - 1]))
                && (index + SOURCEPOS_NAME.len() == line.len()
                    || is_html_attribute_boundary(line[index + SOURCEPOS_NAME.len()]))
            {
                line[index..index + MASKED_NAME.len()].copy_from_slice(MASKED_NAME);
                index += MASKED_NAME.len();
                continue;
            }

            index += 1;
            continue;
        }

        if line[index] == b'`' {
            let start = index;
            while index < line.len() && line[index] == b'`' {
                index += 1;
            }
            let run_length = index - start;
            if *inline_code_ticks == Some(run_length) {
                *inline_code_ticks = None;
            } else if inline_code_ticks.is_none() {
                *inline_code_ticks = Some(run_length);
            }
            continue;
        }

        if inline_code_ticks.is_some() {
            index += 1;
            continue;
        }

        if line[index] == b'<'
            && line
                .get(index + 1)
                .is_some_and(|byte| byte.is_ascii_alphabetic() || *byte == b'/' || *byte == b'!')
        {
            in_tag = true;
        }
        index += 1;
    }
}

fn is_html_attribute_boundary(byte: u8) -> bool {
    byte.is_ascii_whitespace() || matches!(byte, b'/' | b'>' | b'=')
}

fn code_fence_marker_bytes(line: &[u8]) -> Option<(u8, usize)> {
    let mut index = 0;
    while index < line.len() && index < 3 && line[index] == b' ' {
        index += 1;
    }
    let marker = *line.get(index)?;
    if marker != b'`' && marker != b'~' {
        return None;
    }

    let start = index;
    while index < line.len() && line[index] == marker {
        index += 1;
    }
    (index - start >= 3).then_some((marker, index - start))
}

pub(crate) fn alert_marker_start(line: &str) -> Option<(usize, usize)> {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() && index < 3 && bytes[index] == b' ' {
        index += 1;
    }

    let quote_start = index;
    while index < bytes.len() && bytes[index] == b'>' {
        index += 1;
    }
    if index == quote_start || bytes.get(index) != Some(&b' ') {
        return None;
    }

    let marker_start = index + 1;
    if bytes.get(marker_start..marker_start + 2) != Some(b"[!") {
        return None;
    }

    ["note", "tip", "important", "warning", "caution"]
        .iter()
        .find_map(|name| {
            let marker_length = 3 + name.len();
            let candidate = bytes.get(marker_start + 2..marker_start + 2 + name.len())?;
            let closing = bytes.get(marker_start + marker_length - 1)?;
            (candidate.eq_ignore_ascii_case(name.as_bytes()) && *closing == b']')
                .then_some((marker_start, marker_length))
        })
}

pub(crate) fn code_fence_marker(line: &str) -> Option<(u8, usize)> {
    code_fence_marker_bytes(line.as_bytes())
}

pub(crate) fn line_starts(source: &str) -> Vec<usize> {
    let bytes = source.as_bytes();
    let mut starts = vec![0];
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'\r' if bytes.get(index + 1) == Some(&b'\n') => {
                index += 2;
                starts.push(index);
            }
            b'\r' | b'\n' => {
                index += 1;
                starts.push(index);
            }
            _ => index += 1,
        }
    }
    starts
}

pub(crate) fn sourcepos_to_range(
    source: &str,
    line_starts: &[usize],
    sourcepos: Sourcepos,
) -> Option<(usize, usize)> {
    let start = position_to_offset(
        source,
        line_starts,
        sourcepos.start.line,
        sourcepos.start.column,
        false,
    )?;
    let end = position_to_offset(
        source,
        line_starts,
        sourcepos.end.line,
        sourcepos.end.column,
        true,
    )?;
    if start > end || !source.is_char_boundary(start) || !source.is_char_boundary(end) {
        return None;
    }
    Some((start, end))
}

pub(crate) fn node_range<'a>(
    source: &str,
    line_starts: &[usize],
    node: &'a comrak::nodes::AstNode<'a>,
    value: &NodeValue,
    sourcepos: Sourcepos,
) -> Option<(usize, usize)> {
    if let Some((start, end)) = sourcepos_to_range(source, line_starts, sourcepos) {
        if let NodeValue::CodeBlock(code) = value
            && !code.fenced
        {
            let line_start = *line_starts.get(sourcepos.start.line.checked_sub(1)?)?;
            return Some((line_start, end));
        }
        return Some((start, end));
    }

    if !matches!(value, NodeValue::Item(_) | NodeValue::TaskItem(_)) {
        return None;
    }

    let task_line = match value {
        NodeValue::TaskItem(task) if task.symbol_sourcepos.start.line > 0 => {
            Some(task.symbol_sourcepos.start.line)
        }
        _ => None,
    };
    let mut first_line = task_line;
    let mut end = None;
    for descendant in node.descendants() {
        let descendant_pos = descendant.data.borrow().sourcepos;
        if let Some((_, descendant_end)) = sourcepos_to_range(source, line_starts, descendant_pos) {
            first_line = first_line
                .or(Some(descendant_pos.start.line))
                .map(|line| line.min(descendant_pos.start.line));
            end = Some(end.unwrap_or(0).max(descendant_end));
        }
    }
    let line = first_line?;
    let start = *line_starts.get(line.checked_sub(1)?)?;
    let end = end.or_else(|| line_end(source, line_starts, line))?;
    (start < end && source.is_char_boundary(start) && source.is_char_boundary(end))
        .then_some((start, end))
}

fn line_end(source: &str, line_starts: &[usize], line: usize) -> Option<usize> {
    let start = *line_starts.get(line.checked_sub(1)?)?;
    let next_start = line_starts.get(line).copied().unwrap_or(source.len());
    let line_bytes = &source.as_bytes()[start..next_start];
    let newline_len = if line_bytes.ends_with(b"\r\n") {
        2
    } else if line_bytes.ends_with(b"\r") || line_bytes.ends_with(b"\n") {
        1
    } else {
        0
    };
    Some(next_start - newline_len)
}

fn position_to_offset(
    source: &str,
    line_starts: &[usize],
    line: usize,
    column: usize,
    end: bool,
) -> Option<usize> {
    if line == 0 || (!end && column == 0) {
        return None;
    }
    if end && column == 0 {
        return line
            .checked_sub(1)
            .and_then(|previous_line| line_end(source, line_starts, previous_line));
    }
    let line_start = *line_starts.get(line - 1)?;
    let offset = line_start.checked_add(if end { column } else { column - 1 })?;
    (offset <= source.len()).then_some(offset)
}

pub(crate) fn collect_text<'a>(node: &'a comrak::nodes::AstNode<'a>) -> String {
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

#[cfg(test)]
fn parse_sourcepos(value: &str) -> Option<Sourcepos> {
    let (start, end) = value.split_once('-')?;
    let (start_line, start_column) = start.split_once(':')?;
    let (end_line, end_column) = end.split_once(':')?;
    Some(Sourcepos {
        start: comrak::nodes::LineColumn {
            line: start_line.parse().ok()?,
            column: start_column.parse().ok()?,
        },
        end: comrak::nodes::LineColumn {
            line: end_line.parse().ok()?,
            column: end_column.parse().ok()?,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use comrak::{Arena, Options, parse_document};

    fn source_map_for(markdown: &str) -> SourceMap {
        let arena = Arena::new();
        let mut options = Options::default();
        options.render.r#unsafe = true;
        options.render.sourcepos = true;
        let root = parse_document(&arena, markdown, &options);
        build_source_map(markdown, root)
    }

    #[test]
    fn html_block_emits_link_and_image_sub_spans() {
        let markdown =
            "<p><a href=\"https://example.com\"><img src=\"badge.svg\" alt=\"Badge\" /></a></p>";
        let source_map = source_map_for(markdown);
        let parent = source_map
            .spans
            .iter()
            .find(|span| span.kind == "html_block")
            .expect("html block span");
        let link = source_map
            .spans
            .iter()
            .find(|span| span.kind == "html_link")
            .expect("html link sub-span");
        let image = source_map
            .spans
            .iter()
            .find(|span| span.kind == "html_image")
            .expect("html image sub-span");
        assert!(
            link.map_id
                .starts_with(&format!("{}#html-link-", parent.map_id))
        );
        assert!(
            image
                .map_id
                .starts_with(&format!("{}#html-image-", parent.map_id))
        );
        assert_eq!(
            link.attrs
                .get("parentMapId")
                .and_then(|value| value.as_str()),
            Some(parent.map_id.as_str())
        );
        assert_eq!(
            image.attrs.get("src").and_then(|value| value.as_str()),
            Some("badge.svg")
        );
        assert!(link.source_byte_start >= parent.source_byte_start);
        assert!(image.source_byte_end <= parent.source_byte_end);
        let link_markup = &markdown[link.source_byte_start..link.source_byte_end];
        assert!(link_markup.starts_with("<a"));
        let image_markup = &markdown[image.source_byte_start..image.source_byte_end];
        assert!(image_markup.starts_with("<img"));
    }

    #[test]
    fn acceptance_fixture_badge_image_span_covers_opening_tag() {
        let markdown = "# Acceptance Fixture\n\nPACKAGED_VISUAL_PROBE edited paragraph for packaged acceptance.\n\n<p align=\"center\"><a href=\"https://example.com\"><img src=\"PACKAGED_BADGE_PROBE.png\" alt=\"Badge\" /></a></p>\n\nRUNTIME_FIND_TOKEN is searchable in this document.\n";
        let source_map = source_map_for(markdown);
        let image = source_map
            .spans
            .iter()
            .find(|span| span.kind == "html_image")
            .expect("html image sub-span");
        let image_markup = &markdown[image.source_byte_start..image.source_byte_end];
        assert!(
            image_markup.starts_with("<img"),
            "image span was {image_markup:?}"
        );
        assert!(image_markup.contains("PACKAGED_BADGE_PROBE"));
    }

    #[test]
    fn readme_heading_with_inline_image_keeps_atx_markers_in_heading_span() {
        let markdown = "# <img src=\"./src-tauri/icons/icon.png\" alt=\"\" width=\"40\" /> Markdown Desktop\n\nA focused desktop viewer and editor for ordinary Markdown files.\n";
        let source_map = source_map_for(markdown);
        let heading = source_map
            .spans
            .iter()
            .find(|span| span.kind == "heading")
            .expect("heading");
        let paragraph = source_map
            .spans
            .iter()
            .find(|span| span.kind == "paragraph")
            .expect("paragraph");
        let heading_text = &markdown[heading.source_byte_start..heading.source_byte_end];
        let paragraph_text = &markdown[paragraph.source_byte_start..paragraph.source_byte_end];
        assert!(
            heading_text.starts_with("# <img"),
            "heading must keep ATX markers for source selection fidelity, got {heading_text:?}"
        );
        assert!(
            paragraph_text.starts_with("A focused"),
            "paragraph started with {paragraph_text:?}"
        );
    }

    #[test]
    fn features_heading_and_list_spans_match_readme_offsets() {
        let markdown = include_str!("../../README.md");
        let source_map = source_map_for(markdown);
        let features_at = markdown.find("## Features").expect("Features heading");
        let list_at = markdown
            .find("- **Rendered, Source, and Split**")
            .expect("features list");
        let table_at = markdown.find("<table>").expect("theme table");

        let heading = source_map
            .spans
            .iter()
            .find(|span| {
                span.kind == "heading"
                    && span.source_byte_start <= features_at
                    && span.source_byte_end >= features_at + "## Features".len()
            })
            .expect("Features heading span");
        let list = source_map
            .spans
            .iter()
            .find(|span| {
                span.kind == "list"
                    && span.source_byte_start <= list_at
                    && span.source_byte_end > list_at
            })
            .expect("Features list span");

        let heading_text = &markdown[heading.source_byte_start..heading.source_byte_end];
        let list_text = &markdown[list.source_byte_start..list.source_byte_end];
        assert_eq!(heading_text, "## Features");
        assert!(
            list_text.starts_with("- **Rendered, Source, and Split**"),
            "list started with {:?}",
            &list_text[..list_text.len().min(40)]
        );
        assert!(
            list.source_byte_end <= table_at,
            "list span leaked into the following table: end={} table={}",
            list.source_byte_end,
            table_at
        );
        eprintln!(
            "heading={}..{} list={}..{} table={}",
            heading.source_byte_start,
            heading.source_byte_end,
            list.source_byte_start,
            list.source_byte_end,
            table_at
        );

        // Also prove the HTML sourcepos bridge converts back to the same bytes
        // the trusted span table uses. A drift here attaches the wrong map id.
        let rendered = crate::markdown::render(markdown, "github");
        let h2 = rendered
            .html
            .split("<h2")
            .nth(1)
            .and_then(|chunk| chunk.split("</h2>").next())
            .expect("Features h2 html");
        let sourcepos = h2
            .split("data-sourcepos=\"")
            .nth(1)
            .and_then(|chunk| chunk.split('"').next())
            .expect("h2 sourcepos");
        let line_starts = line_starts(markdown);
        let (start, end) = sourcepos_to_range(
            markdown,
            &line_starts,
            parse_sourcepos(sourcepos).expect("parse sourcepos"),
        )
        .expect("sourcepos range");
        assert_eq!(
            (start, end),
            (heading.source_byte_start, heading.source_byte_end),
            "HTML sourcepos {sourcepos} drifted from heading span"
        );
        eprintln!("h2 sourcepos={sourcepos} html-bytes={start}..{end}");

        let items: Vec<_> = source_map
            .spans
            .iter()
            .filter(|span| {
                span.kind == "list_item"
                    && span.source_byte_start >= list.source_byte_start
                    && span.source_byte_end <= list.source_byte_end
            })
            .collect();
        assert!(!items.is_empty(), "expected list items under Features");
        let first = items[0];
        let last = items[items.len() - 1];
        let first_text = &markdown[first.source_byte_start..first.source_byte_end];
        assert!(
            first_text.starts_with("- **Rendered"),
            "first list item started with {:?}",
            &first_text[..first_text.len().min(32)]
        );
        assert!(
            last.source_byte_end <= table_at,
            "last list item leaked into table"
        );
        eprintln!(
            "items={} first={}..{} last={}..{}",
            items.len(),
            first.source_byte_start,
            first.source_byte_end,
            last.source_byte_start,
            last.source_byte_end
        );
    }
}
