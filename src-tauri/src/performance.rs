//! Opt-in native performance probes.
//!
//! The application does not emit timing logs during ordinary use. Set
//! `MARKDOWN_DESKTOP_PERF=1` for local profiling; records contain operation
//! names, sizes, and durations only, never document paths or source content.

use std::sync::OnceLock;
use std::time::Duration;

pub fn enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var("MARKDOWN_DESKTOP_PERF").is_ok_and(|value| value == "1"))
}

pub fn record(
    operation: &str,
    duration: Duration,
    source_bytes: usize,
    output_bytes: Option<usize>,
    mapped_spans: Option<usize>,
) {
    if !enabled() {
        return;
    }
    let output = output_bytes
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_owned());
    let spans = mapped_spans
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_owned());
    eprintln!(
        "[markdown-desktop-perf] operation={operation} duration_ms={:.3} source_bytes={source_bytes} output_bytes={output} mapped_spans={spans}",
        duration.as_secs_f64() * 1_000.0,
    );
}
