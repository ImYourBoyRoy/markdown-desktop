//! ./src-tauri/src/source_format.rs
//! Decode and re-encode Markdown bytes while preserving encoding, BOM,
//! recorded line endings, and final-newline policy. Used by save and recovery.

use anyhow::{Result, anyhow};
use std::path::Path;

pub fn decode_bytes(
    bytes: &[u8],
    path: &Path,
) -> Result<(String, String, bool, String, bool, Vec<String>)> {
    let (encoding, bom, source) = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        (
            "UTF-8".to_owned(),
            true,
            std::str::from_utf8(&bytes[3..])
                .map_err(|_| anyhow!("{} contains invalid UTF-8", path.display()))?
                .to_owned(),
        )
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        (
            "UTF-16 LE".to_owned(),
            true,
            decode_utf16(&bytes[2..], true, path)?,
        )
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        (
            "UTF-16 BE".to_owned(),
            true,
            decode_utf16(&bytes[2..], false, path)?,
        )
    } else if let Ok(source) = std::str::from_utf8(bytes) {
        ("UTF-8".to_owned(), false, source.to_owned())
    } else {
        return Err(anyhow!(
            "{} is not valid UTF-8 or UTF-16 Markdown",
            path.display()
        ));
    };
    let (line_ending, final_newline, newline_sequences) = infer_text_format(&source);
    Ok((
        source,
        encoding,
        bom,
        line_ending,
        final_newline,
        newline_sequences,
    ))
}

fn decode_utf16(bytes: &[u8], little_endian: bool, path: &Path) -> Result<String> {
    if !bytes.len().is_multiple_of(2) {
        return Err(anyhow!(
            "{} contains a truncated UTF-16 code unit",
            path.display()
        ));
    }
    let units = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| {
            let pair = [pair[0], pair[1]];
            if little_endian {
                u16::from_le_bytes(pair)
            } else {
                u16::from_be_bytes(pair)
            }
        })
        .collect::<Vec<_>>();
    String::from_utf16(&units).map_err(|_| anyhow!("{} contains invalid UTF-16", path.display()))
}

/// Infer the text-format metadata needed to re-encode a recovered source when
/// the original file is no longer available. This intentionally works on the
/// decoded source so legacy recovery snapshots can still preserve CRLF/CR/LF
/// and final-newline behavior.
pub fn infer_text_format(source: &str) -> (String, bool, Vec<String>) {
    let newline_sequences = source
        .as_bytes()
        .iter()
        .enumerate()
        .filter_map(|(index, byte)| match byte {
            b'\n' => Some(if index > 0 && source.as_bytes()[index - 1] == b'\r' {
                "CRLF".to_owned()
            } else {
                "LF".to_owned()
            }),
            b'\r' if source.as_bytes().get(index + 1) != Some(&b'\n') => Some("CR".to_owned()),
            _ => None,
        })
        .collect::<Vec<_>>();
    let line_ending = if newline_sequences.iter().any(|ending| ending == "CRLF") {
        "CRLF"
    } else if newline_sequences.iter().any(|ending| ending == "CR") {
        "CR"
    } else {
        "LF"
    }
    .to_owned();
    let final_newline = source.ends_with('\n') || source.ends_with('\r');
    (line_ending, final_newline, newline_sequences)
}

pub fn apply_recorded_newlines(
    source: &str,
    line_ending: &str,
    recorded_final: bool,
    recorded_sequences: &[String],
) -> String {
    let fallback = match line_ending {
        "CRLF" => "\r\n",
        "CR" => "\r",
        _ => "\n",
    };
    let normalized = source.replace("\r\n", "\n").replace('\r', "\n");
    let separator_count = normalized.matches('\n').count();
    if separator_count == recorded_sequences.len() && !recorded_sequences.is_empty() {
        let mut out = String::with_capacity(source.len());
        for (index, part) in normalized.split('\n').enumerate() {
            if index > 0 {
                out.push_str(match recorded_sequences[index - 1].as_str() {
                    "CRLF" => "\r\n",
                    "CR" => "\r",
                    _ => "\n",
                });
            }
            out.push_str(part);
        }
        return out;
    }

    let mut out = String::new();
    for (index, part) in normalized.split('\n').enumerate() {
        if index > 0 {
            let ending = recorded_sequences
                .get(index - 1)
                .map(|value| match value.as_str() {
                    "CRLF" => "\r\n",
                    "CR" => "\r",
                    _ => "\n",
                })
                .unwrap_or(fallback);
            out.push_str(ending);
        }
        out.push_str(part);
    }
    if recorded_final && !out.ends_with(['\n', '\r']) {
        out.push_str(fallback);
    }
    out
}

pub fn encode_source(
    source: &str,
    encoding: &str,
    bom: bool,
    line_ending: &str,
    final_newline: bool,
    newline_sequences: &[String],
) -> Result<Vec<u8>> {
    let prepared = apply_recorded_newlines(source, line_ending, final_newline, newline_sequences);
    let mut bytes = match encoding {
        "UTF-16 LE" => prepared.encode_utf16().flat_map(u16::to_le_bytes).collect(),
        "UTF-16 BE" => prepared.encode_utf16().flat_map(u16::to_be_bytes).collect(),
        "UTF-8" => prepared.into_bytes(),
        _ => return Err(anyhow!("unsupported Markdown encoding: {encoding}")),
    };
    if bom {
        let prefix: &[u8] = match encoding {
            "UTF-16 LE" => &[0xFF, 0xFE],
            "UTF-16 BE" => &[0xFE, 0xFF],
            _ => &[0xEF, 0xBB, 0xBF],
        };
        bytes.splice(0..0, prefix.iter().copied());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_round_trips_ascii_unicode_surrogates_and_mixed_newlines() {
        let source = "# Notes\r\né 😀\r文\n";
        for (encoding, prefix, little) in [
            ("UTF-16 LE", [0xff, 0xfe], true),
            ("UTF-16 BE", [0xfe, 0xff], false),
        ] {
            let expected = prefix
                .into_iter()
                .chain(source.encode_utf16().flat_map(|unit| {
                    if little {
                        unit.to_le_bytes()
                    } else {
                        unit.to_be_bytes()
                    }
                }))
                .collect::<Vec<_>>();
            let (decoded, actual_encoding, bom, ending, final_newline, sequences) =
                decode_bytes(&expected, Path::new("test.md")).unwrap();
            assert_eq!(decoded, source);
            assert_eq!(actual_encoding, encoding);
            assert_eq!(
                encode_source(&decoded, encoding, bom, &ending, final_newline, &sequences).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn malformed_bom_text_is_rejected_without_replacement_characters() {
        for bytes in [
            &[0xef, 0xbb, 0xbf, 0xff][..],
            &[0xff, 0xfe, 0x41],
            &[0xff, 0xfe, 0, 0xd8],
            &[0xfe, 0xff, 0xdc, 0],
        ] {
            assert!(decode_bytes(bytes, Path::new("invalid.md")).is_err());
        }
    }

    #[test]
    fn apply_recorded_newlines_converts_lf_editor_text_to_crlf() {
        let out = apply_recorded_newlines("# Title\n\nBody", "CRLF", false, &[]);
        assert_eq!(out, "# Title\r\n\r\nBody");
    }

    #[test]
    fn apply_recorded_newlines_keeps_user_trailing_newline() {
        let out = apply_recorded_newlines("hi\n", "LF", false, &[]);
        assert_eq!(out, "hi\n");
    }

    #[test]
    fn apply_recorded_newlines_restores_recorded_final_newline() {
        let out = apply_recorded_newlines("hi", "CRLF", true, &[]);
        assert_eq!(out, "hi\r\n");
    }

    #[test]
    fn decode_and_encode_preserve_mixed_and_repeated_line_endings() {
        let path = Path::new("fixture.md");
        let bytes = b"one\r\n\r\ntwo\rthree\n";
        let (source, encoding, bom, line_ending, final_newline, sequences) =
            decode_bytes(bytes, path).unwrap();
        assert_eq!(sequences, ["CRLF", "CRLF", "CR", "LF"]);
        assert_eq!(
            encode_source(
                &source,
                &encoding,
                bom,
                &line_ending,
                final_newline,
                &sequences,
            )
            .unwrap(),
            bytes
        );
    }
}
