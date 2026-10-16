//! Prove that a source range is the definition Comrak actually uses before
//! permitting a shared-reference edit. Lexical similarity is insufficient.
use crate::store::CommandError;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReferenceEdit {
    occurrence_from: usize,
    occurrence_to: usize,
    definition_from: usize,
    definition_to: usize,
    label: String,
}

fn definition_is_authoritative(source: &str, edit: &ReferenceEdit) -> bool {
    if source.len() > 50 * 1024 * 1024
        || edit.definition_from >= edit.definition_to
        || edit.occurrence_from >= edit.occurrence_to
        || edit.definition_to > source.len()
        || edit.occurrence_to > source.len()
        || edit.label.contains(['\n', '\r'])
        || !(edit.definition_to <= edit.occurrence_from
            || edit.occurrence_to <= edit.definition_from)
        || [
            edit.definition_from,
            edit.definition_to,
            edit.occurrence_from,
            edit.occurrence_to,
        ]
        .iter()
        .any(|offset| !source.is_char_boundary(*offset))
    {
        return false;
    }
    let marker = "https://reference-validation.invalid/definition";
    let replacement = format!("[{}]: {marker}", edit.label);
    let mut probe = source.to_owned();
    probe.replace_range(edit.definition_from..edit.definition_to, &replacement);
    let delta = replacement.len() as isize - (edit.definition_to - edit.definition_from) as isize;
    let from = if edit.definition_from < edit.occurrence_from {
        edit.occurrence_from.checked_add_signed(delta)
    } else {
        Some(edit.occurrence_from)
    };
    let to = if edit.definition_from < edit.occurrence_from {
        edit.occurrence_to.checked_add_signed(delta)
    } else {
        Some(edit.occurrence_to)
    };
    crate::markdown::render(&probe, "github")
        .source_map
        .spans
        .iter()
        .any(|span| {
            Some(span.source_byte_start) == from
                && Some(span.source_byte_end) == to
                && matches!(span.kind.as_str(), "link" | "image")
                && span
                    .attrs
                    .get(if span.kind == "image" {
                        "src"
                    } else {
                        "target"
                    })
                    .and_then(|value| value.as_str())
                    == Some(marker)
        })
}

#[tauri::command]
pub(crate) async fn validate_reference_edit(
    source: String,
    edit: ReferenceEdit,
) -> Result<bool, CommandError> {
    tauri::async_runtime::spawn_blocking(move || definition_is_authoritative(&source, &edit))
        .await
        .map_err(|error| CommandError::Message(format!("reference validation failed: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parser_proof_rejects_comments_raw_html_fences_and_duplicate_definitions() {
        for prefix in [
            "<!--\n[guide]: /same\n-->\n\n",
            "<div>\n[guide]: /same\n</div>\n\n",
            "```\n``` not a closer\n[guide]: /same\n```\n\n",
            "[guide]: /first\n\n",
        ] {
            let source = format!("{prefix}[guide]: /same\n\n[Read][guide]");
            let occurrence = source.rfind("[Read]").unwrap();
            let first = source.find("[guide]:").unwrap();
            let candidate = ReferenceEdit {
                occurrence_from: occurrence,
                occurrence_to: source.len(),
                definition_from: first,
                definition_to: first + "[guide]: /same".len(),
                label: "guide".into(),
            };
            if prefix.starts_with("[guide]:") {
                let later = ReferenceEdit {
                    definition_from: prefix.len(),
                    definition_to: prefix.len() + "[guide]: /same".len(),
                    ..candidate
                };
                assert!(!definition_is_authoritative(&source, &later));
            } else {
                assert!(!definition_is_authoritative(&source, &candidate));
                let correct = ReferenceEdit {
                    definition_from: prefix.len(),
                    definition_to: prefix.len() + "[guide]: /same".len(),
                    ..candidate
                };
                assert!(definition_is_authoritative(&source, &correct));
            }
        }
    }
}
