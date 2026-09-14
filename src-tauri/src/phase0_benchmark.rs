//! Explicit Phase 0 native timing benchmark.
//!
//! This is intentionally ignored by the normal test suite because it creates
//! a temporary workspace and measures wall-clock performance. Run it through
//! `pnpm phase0:baseline` or the documented cargo command.

use crate::markdown::render_for_file_with_target;
use crate::workspace_scan::{build_tree, index_workspace, search_files};
use serde_json::json;
use std::fs;
use std::path::Path;
use std::time::Instant;
use tempfile::TempDir;

const SAMPLES: usize = 7;

fn percentile(samples: &[f64], percentile: f64) -> f64 {
    let mut sorted = samples.to_vec();
    sorted.sort_by(f64::total_cmp);
    let index = ((sorted.len() as f64 * percentile).ceil() as usize)
        .saturating_sub(1)
        .min(sorted.len().saturating_sub(1));
    sorted[index]
}

fn median(samples: &[f64]) -> f64 {
    percentile(samples, 0.5)
}

fn markdown_fixture(minimum_bytes: usize) -> String {
    let mut source = String::from(
        "# Phase 0 benchmark\n\nA paragraph with **strong**, *emphasis*, a [link](docs/readme.md), and Unicode: Café 😀.\n\n- [ ] task\n- [x] completed task\n\n| Name | Value |\n| --- | --- |\n| alpha | beta |\n\n```rust\nfn main() { println!(\"hello\"); }\n```\n\n",
    );
    let mut index = 0;
    while source.len() < minimum_bytes {
        source.push_str(&format!(
            "## Section {index}\n\nRepeated benchmark content with a stable source map owner and a local image ![badge](assets/badge-{index}.png).\n\n",
        ));
        index += 1;
    }
    source
}

fn measure_render(source: &str) -> (Vec<f64>, usize, usize) {
    let warmup = render_for_file_with_target(source, "github", Some("README.md"), "none");
    let mut samples = Vec::with_capacity(SAMPLES);
    let mut html_bytes = warmup.html.len();
    let mut mapped_spans = warmup.source_map.spans.len();
    for _ in 0..SAMPLES {
        let started = Instant::now();
        let rendered = render_for_file_with_target(source, "github", Some("README.md"), "none");
        samples.push(started.elapsed().as_secs_f64() * 1_000.0);
        html_bytes = rendered.html.len();
        mapped_spans = rendered.source_map.spans.len();
        assert!(!rendered.html.is_empty());
        assert!(!rendered.source_map.spans.is_empty());
    }
    (samples, html_bytes, mapped_spans)
}

fn create_workspace() -> TempDir {
    let workspace = tempfile::tempdir().expect("create benchmark workspace");
    let source = "# Search fixture\n\nphase-zero-search-token with **mapped** content.\n";
    for index in 0..250 {
        let folder = workspace.path().join(format!("section-{}", index % 10));
        fs::create_dir_all(&folder).expect("create benchmark folder");
        fs::write(folder.join(format!("document-{index}.md")), source)
            .expect("write benchmark markdown");
    }
    fs::write(workspace.path().join("notes.txt"), "unsupported").expect("write unsupported file");
    workspace
}

fn measure_tree(root: &Path) -> (f64, f64, usize) {
    let mut samples = Vec::with_capacity(SAMPLES);
    let mut files = 0;
    for _ in 0..SAMPLES {
        let mut count = 0;
        let mut warnings = Vec::new();
        let started = Instant::now();
        let tree = build_tree(root, root, 0, 3, &mut count, &mut warnings);
        samples.push(started.elapsed().as_secs_f64() * 1_000.0);
        files = crate::workspace_scan::count_markdown_tree(&tree);
    }
    (median(&samples), percentile(&samples, 0.95), files)
}

#[test]
#[ignore = "Phase 0 wall-clock benchmark; run explicitly"]
fn phase0_native_benchmark() {
    let render_sizes = [10 * 1024, 100 * 1024, 500 * 1024];
    let render_results = render_sizes
        .into_iter()
        .map(|size| {
            let source = markdown_fixture(size);
            let (samples, html_bytes, mapped_spans) = measure_render(&source);
            json!({
                "sourceBytes": source.len(),
                "htmlBytes": html_bytes,
                "mappedSpans": mapped_spans,
                "medianMs": median(&samples),
                "p95Ms": percentile(&samples, 0.95),
            })
        })
        .collect::<Vec<_>>();

    let workspace = create_workspace();
    let (tree_median_ms, tree_p95_ms, visible_files) = measure_tree(workspace.path());
    let db_path = workspace.path().join("phase0-index.sqlite3");
    let mut index_samples = Vec::with_capacity(SAMPLES);
    for _ in 0..SAMPLES {
        let started = Instant::now();
        index_workspace(&db_path, workspace.path(), 3).expect("index benchmark workspace");
        index_samples.push(started.elapsed().as_secs_f64() * 1_000.0);
    }
    let mut search_samples = Vec::with_capacity(SAMPLES);
    let mut search_results = 0;
    for _ in 0..SAMPLES {
        let started = Instant::now();
        let results = search_files(workspace.path(), "phase-zero-search-token", 3);
        search_samples.push(started.elapsed().as_secs_f64() * 1_000.0);
        search_results = results.len();
    }

    assert_eq!(visible_files, 250);
    assert_eq!(search_results, 50);
    println!(
        "PHASE0_NATIVE_BENCHMARK={}",
        serde_json::to_string(&json!({
            "samples": SAMPLES,
            "render": render_results,
            "workspace": {
                "files": visible_files,
                "treeMedianMs": tree_median_ms,
                "treeP95Ms": tree_p95_ms,
                "indexMedianMs": median(&index_samples),
                "indexP95Ms": percentile(&index_samples, 0.95),
                "searchMedianMs": median(&search_samples),
                "searchP95Ms": percentile(&search_samples, 0.95),
                "searchReturned": search_results,
            },
        }))
        .expect("serialize Phase 0 benchmark"),
    );
}
