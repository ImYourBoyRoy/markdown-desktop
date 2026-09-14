# Phase 0 performance and correctness baseline

Updated: 2026-09-02

Phase 0 establishes repeatable evidence before the next performance refactor.
It does not claim that the application already meets the targets below, and it
does not substitute for a packaged, target-OS interaction measurement.

## What Phase 0 covers

- Opt-in browser instrumentation for startup, document open, source changes,
  render queue requests/coalescing, native render IPC duration, filesystem lint,
  rendered-pane enhancement, source-map attachment/index construction,
  rendered selection commits, source-selection projection, and split-pane
  synchronization.
- Native opt-in timing records for render worker/total time and workspace tree,
  indexing, and search operations. Records contain operation names and sizes,
  never source text or document paths.
- A source/render contract fixture covering Unicode, Markdown links/images,
  raw HTML links/images, and details blocks.
- Correctness probes for UTF-8-byte/UTF-16 mapping, stale-map rejection,
  cross-owner selection, and mixed Markdown/raw-HTML object ownership.
- Deterministic frontend and native timing probes. The native probe creates a
  temporary 250-file workspace and removes it with the test process.

## Reproduce

Run from the repository root with Node 26, pnpm 12.3.4 or newer, and Rust meeting Cargo.toml's minimum:

```text
pnpm phase0:selection
pnpm phase0:baseline
```

`phase0:baseline` runs seven samples after one warm-up for each case and prints
`PHASE0_BASELINE=<JSON>` to stdout. It does not write a report file. Redirect
the output to an operator-owned local file when a historical comparison is
needed. The frontend portion uses jsdom and the native portion uses Cargo's
debug test profile; both are local/simulated evidence, not target-OS proof.

To enable live application instrumentation during a local desktop run:

```powershell
$env:VITE_MARKDOWN_DESKTOP_PERF = '1'
$env:MARKDOWN_DESKTOP_PERF = '1'
pnpm tauri dev
```

With the flag enabled, inspect `window.__MARKDOWN_DESKTOP_PERF__.snapshot()`
from the webview console. Instrumentation is disabled by default.

## Baseline captured on 2026-09-02

The following is one local run of `pnpm phase0:baseline`; timings vary with
machine load and dependency caches.

### Frontend/jsdom probe

Fixture: 320 mapped paragraphs, 26,130 source bytes, 37,220 rendered HTML
bytes, and 320 mapped spans.

| Operation | Median | p95 | Evidence boundary |
| --- | ---: | ---: | --- |
| Source selection index build | 1.21 ms | 2.73 ms | jsdom/Vitest only |
| 2,000 indexed selection queries | 0.70 ms | 1.33 ms | pure mapping helper only |
| Source-map DOM attachment | 62.45 ms | 74.30 ms | jsdom DOM only |
| Full DOM commit | 54.00 ms | — | jsdom DOM only |
| Incremental DOM commit | 78.33 ms | — | jsdom DOM only; slower in this run |

The DOM commit comparison is diagnostic, not a pass/fail claim. jsdom does not
model WebView2/WebKit layout, paint, or pointer latency; the slower incremental
result means the optimization must be re-measured in the packaged application
before it is treated as a benefit.

### Native debug benchmark

| Case | Source | HTML | Mapped spans | Median | p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small README-like document | 10.3 KiB | 24.2 KiB | 606 | 25.3 ms | 27.1 ms |
| Medium README-like document | 100.1 KiB | 241.0 KiB | 5,772 | 383.4 ms | 424.7 ms |
| Large README-like document | 500.1 KiB | 1.18 MiB | 28,368 | 2,416.0 ms | 2,470.8 ms |

Workspace fixture: 250 Markdown files in ten directories plus one unsupported
file. Tree construction median was 201.4 ms, SQLite FTS indexing median was
1,851.7 ms (p95 1,939.1 ms), and direct bounded search median was 18.3 ms (p95
19.1 ms). Search intentionally returns at most 50 results.

These numbers identify native render and workspace indexing as Phase 1
optimization candidates. They do not measure complete open-to-interactive time,
IPC scheduling, WebView paint, image/diagram enhancement, or human pointer
drag latency.

### Repeat capture on 2026-09-13

The same seven-sample harness was rerun after the worker/open-path and pointer
interaction corrections. This is a repeatable local comparison, not a new
packaged or target-OS claim.

| Operation | Median | p95 |
| --- | ---: | ---: |
| Source selection index build | 1.22 ms | 2.74 ms |
| 2,000 indexed selection queries | 0.52 ms | 0.55 ms |
| Source-map DOM attachment | 33.86 ms | 58.21 ms |
| Full DOM commit | 45.94 ms | — |
| Incremental DOM commit | 30.43 ms | — |
| 10 KiB native render | 45.36 ms | 60.82 ms |
| 100 KiB native render | 352.75 ms | 553.36 ms |
| 500 KiB native render | 1,425.81 ms | 1,565.91 ms |
| 250-file workspace tree | 219.23 ms | 225.57 ms |
| 250-file workspace FTS index | 98.22 ms | 101.16 ms |
| 250-file workspace search | 19.15 ms | 19.62 ms |

The 500 KiB render, workspace index, tree, and search samples remain within
their proposed local p95 budgets except the 100 KiB render by a small margin
in this run. The source-map attachment and commit numbers remain jsdom-only;
the packaged WebView interaction gate is tracked separately.

## Proposed budgets for the next gate

These are explicit engineering targets, not current pass claims. Phase 1 must
measure them in a release-like packaged build on the supported Windows target
before changing the status to verified.

| Boundary | Target |
| --- | ---: |
| 10 KiB native render p95 | ≤ 100 ms |
| 100 KiB native render p95 | ≤ 500 ms |
| 500 KiB native render p95 | ≤ 2,000 ms |
| 250-file workspace tree p95 | ≤ 250 ms |
| 250-file workspace FTS index p95 | ≤ 1,000 ms |
| 250-file workspace search p95 | ≤ 100 ms |
| Indexed selection query batch p95 | ≤ 1 ms |
| Source-map attachment in packaged WebView | ≤ 16 ms for 320 blocks |
| Rendered selection to source-selection commit | ≤ 16 ms p95 |

The budgets deliberately separate native work, pure mapping work, and WebView
work. A passing unit or jsdom probe cannot close the packaged interaction gate.
