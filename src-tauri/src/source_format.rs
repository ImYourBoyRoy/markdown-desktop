//! ./src-tauri/src/source_format.rs
//! Decode and re-encode Markdown bytes while preserving encoding, BOM,
//! recorded line endings, and final-newline policy. Used by save and recovery.

use anyhow::{Result, anyhow};
use encoding_rs::{UTF_8, UTF_16BE, UTF_16LE};
use std::path::Path;

pub fn decode_bytes(bytes: &[u8], path: &Path) -> Result<(String, String, bool, String, bool)> {
    let (encoding, bom, source) = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        (
            "UTF-8".to_owned(),
            true,
            UTF_8
                .decode_without_bom_handling(&bytes[3..])
                .0
                .into_owned(),
        )
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        (
            "UTF-16 LE".to_owned(),
            true,
            UTF_16LE
                .decode_without_bom_handling(&bytes[2..])
                .0
                .into_owned(),
        )
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        (
            "UTF-16 BE".to_owned(),
            true,
            UTF_16BE
                .decode_without_bom_handling(&bytes[2..])
                .0
                .into_owned(),
        )
    } else if let Ok(source) = std::str::from_utf8(bytes) {
        ("UTF-8".to_owned(), false, source.to_owned())
    } else {
        return Err(anyhow!(
            "{} is not valid UTF-8 or UTF-16 Markdown",
            path.display()
        ));
    };
    let line_ending = if source.contains("\r\n") {
        "CRLF"
    } else if source.contains('\r') {
        "CR"
    } else {
        "LF"
    }
    .to_owned();
    let final_newline = source.ends_with('\n') || source.ends_with('\r');
    Ok((source, encoding, bom, line_ending, final_newline))
}

pub fn apply_recorded_newlines(source: &str, line_ending: &str, recorded_final: bool) -> String {
    let ending = match line_ending {
        "CRLF" => "\r\n",
        "CR" => "\r",
        _ => "\n",
    };
    let normalized = source.replace("\r\n", "\n").replace('\r', "\n");
    let keep_final = recorded_final || normalized.ends_with('\n');
    let body = normalized.trim_end_matches('\n');
    let mut out = body.replace('\n', ending);
    if keep_final {
        out.push_str(ending);
    }
    out
}

pub fn encode_source(
    source: &str,
    encoding: &str,
    bom: bool,
    line_ending: &str,
    final_newline: bool,
) -> Result<Vec<u8>> {
    let prepared = apply_recorded_newlines(source, line_ending, final_newline);
    let mut bytes = match encoding {
        "UTF-16 LE" => UTF_16LE.encode(&prepared).0.into_owned(),
        "UTF-16 BE" => UTF_16BE.encode(&prepared).0.into_owned(),
        _ => prepared.into_bytes(),
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
    fn apply_recorded_newlines_converts_lf_editor_text_to_crlf() {
        let out = apply_recorded_newlines("# Title\n\nBody", "CRLF", false);
        assert_eq!(out, "# Title\r\n\r\nBody");
    }

    #[test]
    fn apply_recorded_newlines_keeps_user_trailing_newline() {
        let out = apply_recorded_newlines("hi\n", "LF", false);
        assert_eq!(out, "hi\n");
    }

    #[test]
    fn apply_recorded_newlines_restores_recorded_final_newline() {
        let out = apply_recorded_newlines("hi", "CRLF", true);
        assert_eq!(out, "hi\r\n");
    }
}
