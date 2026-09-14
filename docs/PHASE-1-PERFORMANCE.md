# Phase 1 performance optimization

Updated: 2026-09-13

## Audit corrections (2026-09-07)

The measurements below remain historical; they are not measurements of the
corrected cached-render path. Cache keys now include resolved AST values and
source positions. Raw HTML, footnotes, and generated heading-ID documents use
full rendering. The block-equivalence test now actually warms the cache, and
regressions cover shifted lines and reference-definition changes. Partial DOM
commits require unchanged surrounding fragments and valid source-map IDs.

Selection indexing now searches non-decreasing prefix maxima; the 10,000-range
regression visits only the matching disjoint tail entry. Nested enclosing
ranges can still require intervening scans. Native filesystem-only diagnostics
replace the previous duplicate full-render request. Render coalescing is owned
by a separately tested queue. Rich paste is lazy-loaded: the production entry
chunk decreased from 684.56 kB to 400.31 kB (not a measured startup-time claim).

The latest open-path correction moves the complete disk read, decode, render,
and source-map transaction into one native blocking worker. The previous path
read and decoded the same document once to build its record and again during
the render load. The new path returns the refreshed record and rendered result
together, removing that duplicate I/O/decode work without blocking the async
command runtime. Rendered image and diagram enhancement also shares bounded
IntersectionObservers instead of creating one observer per node.

On this workstation the full frontend suite completed (314 passed, two opt-in
benchmarks skipped). Native tests passed (89, one ignored benchmark), Clippy
passed, and formatting is clean. Synthetic packaged tests require actual
composition results and await split preview completion. Real OS input,
accessibility, and cross-platform runtime verification remain gates.

Final Windows release-WebView verification: `pnpm tauri build --no-bundle`
passed, then the acceptance harness passed 14/14 steps against the freshly
built executable. Exact rendered text selection and Japanese composition
handlers passed; five synthetic split edits averaged 66.3 ms through preview
completion and two animation frames, below the 150 ms average budget. This is
a small-fixture synthetic result, not large-document p95 or OS input evidence.

Phase 1 applies the Phase 0 evidence to the slowest measured paths while
preserving source-authoritative Markdown, exact source maps, and safe workspace
index behavior. The measurements below are local debug/jsdom evidence. They do
not close the packaged WebView or target-OS interaction gates.

## Implemented optimizations

- Native render metadata and rendered-block association use one borrowed
  source-map range index instead of scanning every mapped span for each link,
  image, or block.
- The first large-document open uses one full-document format/sanitize pass.
  The native open/read path seeds the per-document block cache so the next
  source render can enter block-cold or incremental assembly without repeating
  the initial cache build.
- Block assembly remains exact: the cached block path is tested against the
  full-document HTML, and stale/unsupported constructs retain the full-render
  fallback.
- Workspace FTS rebuilds use one prepared SQLite transaction. A failed rebuild
  rolls back instead of leaving a partially replaced index, and concurrent
  readers retain the previous committed index until the replacement commits.
- Raw-HTML sub-span byte offsets advance through each source gap once, and
  frontend source-position conversion caches line starts and encoded byte size
  per DOM attachment pass. Trusted DOM descriptor and span lookups use indexed
  maps rather than repeated linear searches.

## Reproduce

Run from the repository root with Node 26, pnpm 12.3.4 or newer, and the repository Rust
toolchain:

```text
pnpm phase1:baseline
```

The command is intentionally the same seven-sample harness as Phase 0, so the
JSON marker remains `PHASE0_BASELINE`. It prints to stdout and does not write a
report or mutate project documents.

## Measured result

The comparison uses the Phase 0 capture in
[PHASE-0-PERFORMANCE.md](./PHASE-0-PERFORMANCE.md) and the final Phase 1 local
run on 2026-09-02. Timings vary with machine load and caches.

| Operation | Phase 0 median / p95 | Phase 1 median / p95 | Observation |
| --- | ---: | ---: | --- |
| 10 KiB native render | 25.3 / 27.1 ms | 26.2 / 33.3 ms | Within proposed budget; effectively unchanged |
| 100 KiB native render | 383.4 / 424.7 ms | 255.9 / 294.6 ms | Faster local open-path render |
| 500 KiB native render | 2,416.0 / 2,470.8 ms | 1,254.6 / 1,275.0 ms | Within proposed p95 budget |
| 250-file FTS index | 1,851.7 / 1,939.1 ms | 92.1 / 94.8 ms | Within proposed p95 budget |
| 250-file tree | 191.2 / not captured | 195.2 / 210.0 ms | Within proposed p95 budget |
| 250-file direct search | 19.1 / 22.6 ms | 18.3 / 19.5 ms | Within proposed p95 budget |
| Source-map DOM attachment | 62.45 / 74.30 ms | 21.08 / 37.39 ms | jsdom-only improvement |
| Indexed selection query batch | 0.70 / 1.33 ms | 0.88 / 1.85 ms | Close, but p95 budget is not closed |

The native render and indexing results are strong enough to close their local
Phase 1 budgets. The frontend numbers are diagnostic only: jsdom does not model
WebView2/WebKit layout, paint, compositor scheduling, or pointer behavior.
The incremental DOM probe still measured slower than its full-commit control in
jsdom (20.96 ms versus 40.48 ms in this run); it remains a packaged-runtime
experiment, not a claimed win.

## Remaining gates

- The rebuilt Windows packaged acceptance now covers exact bidirectional
  rendered/source text and object selection, cross-block selection, pointer
  block movement, composition, undo/redo, save/reload, and split edits. Its
  synthetic five-edit split probe averaged 66.3 ms against the 150 ms budget.
  This closes the local packaged interaction probe, not physical pointer,
  compositor, or target-OS accessibility timing.
- Measure large-document first-open and repeated-edit p95 in release-like
  WebView2, and repeat the interaction checks on Linux WebKitGTK and macOS
  WKWebView. The current jsdom/native baselines cannot close those gates.
- Keep the full Vitest, Rust, target-OS accessibility, signing, and live
  updater evidence separately labeled; the current local suite and Windows
  packaged evidence do not make universal cross-platform claims.

Phase 2 should retain changes only when they improve a measured target boundary
without weakening the source-map or source-authority contracts. The pointer
drag path is now pointer-owned and the legacy HTML drag listeners remain only
for compatibility with older embedders/test harnesses.
