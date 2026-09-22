# Markdown Desktop implementation status

This is the tracked continuity checkpoint for the local editor build. The
detailed execution work order remains local and gitignored at
`Tasks/8-27-2026_Tasklist.md`; this file records the state that must survive a
clone or handoff.

Updated: 2026-09-21

## Release v1.1.1 published (2026-09-21)

- Version metadata is aligned at `1.1.1` in `package.json`,
  `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and
  `src-tauri/tauri.conf.json`.
- The release includes source-preserving rendered block deletion and visible
  drag feedback, synchronized rendered/source slash commands, expanded inline
  and rich-block insertion options, history cleanup controls, updater retry and
  install handling, and a direct five-section editing ribbon without the
  redundant Tabs overflow menu.
- Local validation before publication passed the full frontend suite (341
  passed / 2 skipped), Svelte diagnostics (zero errors/warnings), production
  build, visual acceptance (90/90), accessibility source audit, architecture
  check, and Windows x64 MSI/NSIS bundling.
- Commit `46afb4e44118a9bffd7636319c0a9db1fdc79fd6` is on `main`, and the
  annotated `v1.1.1` tag resolves to that exact commit locally and remotely.
- [Main CI run 35686193053](https://github.com/ImYourBoyRoy/markdown-desktop/actions/runs/35686193053)
  passed all seven jobs: quality/security plus Windows x64/ARM64, macOS
  Intel/Apple Silicon, and Linux x64/ARM64 native smoke coverage.
- [Release run 35686693103](https://github.com/ImYourBoyRoy/markdown-desktop/actions/runs/35686693103)
  passed all six platform builds and the publish-and-verify job.
- [Public release v1.1.1](https://github.com/ImYourBoyRoy/markdown-desktop/releases/tag/v1.1.1)
  is non-draft and non-prerelease with 29 assets. Its signed `latest.json`
  reports version `1.1.1`, contains 18 signed platform entries, and every
  updater URL resolves to an asset in the published release.

## Release v1.1.0 published (2026-09-21)

- Version metadata is aligned at `1.1.0` in `package.json`, `src-tauri/Cargo.toml`,
  `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`.
- `fixtures/mermaid/visual.md` and the Vite-served visual fixture exercise the
  Mermaid 12 Markdown fence through the production rich-content renderer. The
  inspected result showed the complete flowchart, eight readable labels, one
  SVG, and zero `foreignObject` elements.
- Local release verification passed after the bump: 331 frontend tests / 2
  skipped, zero Svelte diagnostics, renderer smoke, updater audit, Windows
  `1.1.0` MSI/NSIS bundling, and packaged acceptance 17/17.
- Main CI run [`35589789004`](https://github.com/ImYourBoyRoy/markdown-desktop/actions/runs/35589789004)
  passed quality/security gates and native smoke on Windows x64/ARM64, macOS
  Intel/Apple Silicon, and Linux x64/ARM64.
- Release run [`35591268944`](https://github.com/ImYourBoyRoy/markdown-desktop/actions/runs/35591268944)
  passed all six release builds, publication, and post-publication updater
  verification. The public release is
  [`v1.1.0`](https://github.com/ImYourBoyRoy/markdown-desktop/releases/tag/v1.1.0),
  an explicit non-draft, non-prerelease with 29 assets; `latest.json` reports
  version `1.1.0` and signed metadata for every platform/package entry.
- The annotated `v1.1.0` tag resolves to release commit
  `1132c9cf94e541e334a4064d9adfab342f774cd8`. Apple Developer
  signing/notarization remains intentionally deferred; this is distinct from
  the signed updater metadata verified by the release workflow.

## Fresh dependency/toolchain validation (2026-09-21)

- Node `26.9.0`, pnpm `12.5.1`, Rust/Cargo `1.98.1`; pnpm remains a minimum
  `12.3.4+` policy rather than an exact project pin. There are no Git
  submodules in this repository.
- Mermaid is now intentionally on `^12.0.0`. The optional renderer uses
  native SVG labels, keeps its lazy graph split, and the macOS bundle declares
  the Mermaid 12 WebKit floor (`14.4`). The upgrade-policy tests allow Mermaid
  11/12 and block later majors pending review.
- Fresh purge removed project-owned install/build output, regenerated both
  lockfiles, and preserved shared pnpm/Cargo stores. `lodash-es` is pinned by
  the workspace override to `4.18.1` to remove Mermaid's transitive audit
  advisory without suppressing audit output.
- The end-to-end `full:upgrade` workflow completed successfully and now uses
  `scripts/update-pnpm.mjs` so Windows npm-managed pnpm shims are upgraded
  through their owning npm installation and the active resolved command is
  verified afterward. Its restore-contention regression test was corrected to
  remain valid while the workflow itself holds the upgrade lock.
- `pnpm verify:dependencies` passed: 331 frontend tests / 2 skipped, zero
  Svelte diagnostics, build, renderer smoke, accessibility and updater audits,
  clean npm audit, Rust fmt/check/clippy, 89 native tests / 1 ignored, cargo
  audit, and cargo deny. Local Windows Tauri release bundling produced MSI and
  NSIS installers; packaged acceptance passed 17/17 probes.
- The only remaining freshness notes are exact parent constraints in the GTK /
  GLib and Tauri crypto dependency graph (`toml`, `toml_datetime`, `toml_edit`,
  `generic-array`); forced precise upgrades fail resolution. Cargo audit's
  seven upstream maintenance/unsoundness warnings and cargo-deny duplicate
  crate notices remain documented upstream conditions, not hidden failures.

## Release v1.0.3 publication and verification (2026-09-15)

- `v1.0.3` is published at
  [GitHub Releases](https://github.com/ImYourBoyRoy/markdown-desktop/releases/tag/v1.0.3)
  from exact commit `5b5ce924022d03e762deba2e27cbacfe97ee4fe4`.
- Continuous Integration run
  [`35003870279`](https://github.com/ImYourBoyRoy/markdown-desktop/actions/runs/35003870279)
  passed quality/security gates and native smoke/artifact verification on
  Windows x64/ARM64, macOS Intel/Apple Silicon, and Linux x64/ARM64.
- Release run
  [`35004603599`](https://github.com/ImYourBoyRoy/markdown-desktop/actions/runs/35004603599)
  passed all six release builds, prepublication asset/signature verification,
  publication, and postpublication verification.
- The live release contains 29 assets with unique names. All 29 public asset
  endpoints returned HTTP 200. `latest.json` reports version `1.0.3`; its 18
  platform/package entries resolve to 12 published updater assets and contain
  signed updater metadata. Apple Developer signing/notarization remains
  intentionally deferred; this is distinct from the signed updater metadata.
- The release fixes rendered-view block drag tracking when pointer capture
  retargets events, improves rendered-block drop hit-testing, and retains
  source-boundary validation and keyboard reordering. Exact packaged Windows
  x64 acceptance passed 17/17 checks; selection acceptance passed 47/47.

## Release v1.0.2 publication and CI follow-up (2026-09-14)

- The `v1.0.2` release is published at
  [GitHub Releases](https://github.com/ImYourBoyRoy/markdown-desktop/releases/tag/v1.0.2),
  with the six platform families and signed updater metadata verified by
  publication run `34870524308`.
- CI and release workflows use the non-exact pnpm `12` channel while the
  project toolchain check enforces the `12.3.4+` floor.
- The first Windows CI repair exposed a second runner-specific issue: the
  hosted Windows `pnpm` shim returned success without running script bodies.
  Windows native jobs now install through `pnpm.cmd` and invoke build, smoke,
  and uninstall scripts with `node` directly, so missing staged artifacts
  cannot be hidden by a false-positive smoke step.
- The CI-discovered `RUSTSEC-2026-0285` `rustls 0.23.44` vulnerability was
  resolved by locking `rustls 0.23.45`; the current cargo audit has zero
  vulnerabilities and seven documented upstream maintenance/unsoundness
  warnings. Post-fix CI run
  [`34897036643`](https://github.com/ImYourBoyRoy/markdown-desktop/actions/runs/34897036643)
  passed quality/security plus native smoke and artifact verification on
  Windows x64/ARM64, macOS Intel/Apple Silicon, and Linux x64/ARM64.
- The four partial Actions artifacts from cancelled pre-fix run `34896063607`
  were explicitly deleted. Release verification run
  [`34908604168`](https://github.com/ImYourBoyRoy/markdown-desktop/actions/runs/34908604168)
  passed against the published release without rebuilding or republishing.
  The final live audit found 29/29 uploaded assets, no duplicate names, all 18
  updater platforms resolved to uploaded assets with signed companions, and
  HTTP 200 for every public asset endpoint.

## Architecture boundary (2026-09-13)

- The canonical stable architecture reference is [ARCHITECTURE.md](./ARCHITECTURE.md).
- Frontend shell contracts, bounded rendered-snapshot reuse, exact selection
  projection, and latest-only render lifecycle now live in
  `src/lib/app-shell.ts`, `src/lib/rendered-snapshot-cache.ts`,
  `src/lib/selection-bridge.ts`, and `src/lib/render-controller.ts`.
  `App.svelte` remains the single stateful shell authority.
- The native store is split into `store_types.rs`, `store_workspace.rs`,
  `store_documents.rs`, `store_assets.rs`, `store_paths.rs`, and
  `store_recovery.rs`, with `store.rs` retaining lifecycle/save orchestration
  and stable command reexports.
- The next safe boundary is another callback-bounded lifecycle domain. Do not
  move selection, source-map revision, or tab authority into a second store.
- `pnpm architecture:check` now verifies the cold-start file inventory in
  `ARCHITECTURE.md` (245 maintained files with exact sizes, line counts, and
  curated summaries).

## Current dependency and renderer closure (2026-09-13)

- The production Vite graph no longer contains Mermaid or Graphviz. Mermaid
  is emitted as a code-split on-demand renderer and Graphviz as a standalone  on-demand asset; `pnpm build` completes without the former large-chunk  advisory. `pnpm smoke:renderers` loads both generated assets and verifies  SVG output.
- `cargo update` advanced the resolvable lockfile lines to `reqwest 0.13.5`
  and `hybrid-array 0.4.15`. The four older Cargo lines still reported as  available are exact or parent-constrained by the stable GTK/Tauri graph.
- `cargo audit --json` reports seven visible upstream maintenance/unsoundness
  warnings: one GLib, one GTK macro, and
  five URLPattern Unicode crates. Their roots and the no-fork/no-incompatible-  override boundary are recorded in `SECURITY.md`.
- The optional renderer export contract is covered by a stable facade and an  automated smoke command; the latter uses only bounded jsdom CSSOM/SVG test  shims and does not substitute for packaged WebView evidence.

## Latest verification (2026-09-13)

- Compatible patch updates are installed and locked: Vite 8.3.0,
  `@types/node` 26.6.2, Tauri CLI 2.11.5, and the current Tauri 2.11.x
  plugin lines. Mermaid 12 is now the supported renderer line after its
  native-SVG migration and explicit macOS 14.4 WebKit floor review; TypeScript
  7 remains the native compiler alias while the Svelte peer-compatible editor
  compiler stays on TypeScript 6.
- `pnpm check` reports 0 errors and 0 warnings. The full frontend suite passed
  65 files / 323 tests, with 2 opt-in performance benchmarks skipped. Rust formatting,
  `cargo check`, Clippy with `-D warnings`, and native tests passed (89 tests,
  1 intentionally ignored).
- Production `pnpm build` passes on Vite 8.3.0 without build warnings. The
  focused selection and visual gates pass 47/47 and 87/87; renderer smoke,
  source accessibility, updater configuration, and Windows x64 MSI/NSIS
  packaging pass; the current release no-bundle build and packaged acceptance
  completed 17/17 with 69.8 ms synthetic split latency.
- The source-to-rendered selection painter now preserves coordinate offsets
  across generated control labels, keeps editable HTML untouched, and clears
  only its own browser ranges. Workspace index-worker startup failures now
  clear their reservation and emit a terminal status instead of leaving the
  UI permanently busy.
- Rendered block movement is pointer-owned with pointer capture and native
  HTML dragging disabled on the custom handle, so a WebView drag gesture cannot
  steal the source-preserving move path. Disk document open/read now performs
  one read/decode/render/source-map transaction inside a blocking native worker,
  removing duplicate I/O and decode work. Rich-content lazy loading shares
  bounded observers across images and diagrams.
- Mermaid 12 uses explicit Dagre/classic rendering defaults and native SVG
  labels. The bundle declares macOS 14.4 as its minimum system version because
  Mermaid 12 targets ES2024 and Safari 17.4+. The upgrade policy now fails
  closed only for Mermaid majors after 12. The GLib warning remains an
  upstream Tauri GTK3/WebKitGTK boundary; no unsafe Cargo override or
  prerelease host migration was introduced.

## Phase 0 measurement baseline (2026-09-02)

- Added opt-in frontend/native instrumentation and a reproducible baseline
  command. It records startup/open/render queue/coalescing, source-map and
  rendered-pane work, cross-pane selection/scroll events, native render time,
  and workspace scan/index/search time without recording source text or paths.
- Added `fixtures/phase0/selection-mixed.md` and four source/render contract
  probes covering Unicode coordinates, mixed Markdown/raw-HTML ownership,
  cross-owner selection, and stale-map rejection.
- The final captured local baseline found native debug render at approximately
  25 ms / 383 ms / 2,416 ms median for 10 KiB / 100 KiB / 500 KiB sources, and
  1,852 ms median for indexing 250 files. These are local debug measurements, not
  packaged or target-OS acceptance evidence; the full matrix and proposed
  budgets are in `docs/PHASE-0-PERFORMANCE.md`.
- `pnpm phase0:selection` passed. `pnpm phase0:baseline` passed after the
  Windows console-capture fix; the broad Vitest runner and target-OS gates
  remain separate evidence boundaries.

## Phase 1 performance optimization (2026-09-02)

- Native source-map/block association now uses a borrowed range index; large
  first opens use one full format/sanitize pass and seed the per-document block
  cache for later edits. Workspace FTS rebuilds use one prepared transaction
  with rollback safety. Frontend raw-HTML and source-position mapping avoid
  repeated quadratic scans and per-node source re-encoding.
- Final local debug evidence: 500 KiB render p95 1,275.0 ms (down from the
  Phase 0 2,470.8 ms baseline); 250-file FTS index p95 94.8 ms (down from
  1,939.1 ms); source-map DOM attachment p95 37.39 ms in jsdom (down from
  74.30 ms). Packaged interaction latency and pointer selection remain open.
- `pnpm phase1:baseline` passed with no benchmark failures. Full details and
  evidence limits are in `docs/PHASE-1-PERFORMANCE.md`.

## Historical Phase 0–2 responsiveness and selection closure (2026-09-02)

- Source typing now forwards CodeMirror change ranges and applies them to the
  authoritative source cache, avoiding a second full-document serialization on
  every keystroke. Opening files, links, and workspaces performs blocking reads,
  decoding, rendering, and tree scanning in native worker tasks; workspace
  counts reuse the visible scan tree instead of walking the filesystem twice.
- Source renders are single-flight per tab with latest-request coalescing and
  stale-generation/source guards. Large rendered updates expose source-mapped
  block fragments, allowing a changed visual block to replace only its DOM root;
  the full-document commit remains a guarded fallback when a fragment cannot be
  resolved. Cross-pane scroll work is coalesced and collapsed source carets do
  not trigger rendered scrolling.
- Rendered text ranges now map to exact source ranges, mapped HTML objects keep
  deterministic complete-span selection, and stale object-click suppression no
  longer swallows a real rendered text range. The source mirror is updated from
  that same selection transaction.
- Verification: `pnpm check` (0 errors / 0 warnings), focused source/selection
  tests (4 files / 13 tests), `pnpm smoke:visual` (12 files / 84 tests),
  `pnpm smoke:selection` (8 files / 43 tests), Clippy with `-D warnings`,
  native tests (82), `pnpm build:app`, `pnpm smoke:native`, and packaged
  acceptance (14/14 steps) passed. The packaged probe recorded 4.7 ms average
  split-typing cost under its 2,000 ms budget.
- Remaining evidence boundary: the packaged probe uses direct webview DOM
  ranges, not OS-level pointer-drag automation. Target-OS accessibility,
  screen-reader behavior, IME nuances, and non-Windows runtime/package gates
  still require their respective environments. The broad `pnpm test` runner
  previously hung after startup on this workstation and is not claimed as a
  passing full-suite gate. Repository-wide `cargo fmt --check` also reports
  pre-existing formatting drift in the dirty native tree; no broad formatter
  rewrite was applied. Large optional frontend chunks remain intentionally lazy; the current Vite build emits no warning.

## Open Recent history (2026-08-31)

- Added a bounded, local Open Recent list for up to five Markdown paths. It is
  available from the native File menu and command palette, displays each
  path, supports removal, and validates existing Markdown files in Rust before
  showing or opening them.
- Recent opens use the existing one-use native document grant boundary. Missing
  files are removed instead of being opened through a raw path from the UI.
- Source/helper tests and native path-validation coverage are included. Direct
  packaged dialog interaction remains a runtime acceptance item until observed.

## Latest compatibility-lens slice (2026-08-31)

- The editor profile and compatibility target are now separate concepts. The
  existing `github` / `extended` / `commonmarkStrict` profile still controls
  local parsing and preview behavior; the new persisted `githubReadme` target
  controls only advisory diagnostics and defaults to GitHub README. `none`
  disables target-only findings without hiding general safety or profile
  diagnostics.
- Rust remains the single diagnostics authority. Issues now carry a scope and
  optional compatibility target, and target filtering reuses the same parsed
  document/source map; changing the target does not run a second render or
  alter HTML, source maps, editing, or saving.
- The document header has one quiet `GitHub README · …` indicator. It reports
  document-scoped advisories, explains that repository-wide checks are not
  included, and opens the Issues pane in the matching filter. The Issues pane
  retains an explicit All/GitHub README scope choice, while Settings labels the
  controls as **Editor profile** and **Check against**.
- Verification: compatibility helper tests (3), application-settings tests
  (4), native tests (70), full frontend tests (38 files / 213 tests),
  `pnpm check`, production build, Rust fmt, Clippy, `pnpm build:app`, and
  `pnpm smoke:native` passed. The packaged chip click/filter path remains a
  direct UI acceptance item, not claimed from compilation or native smoke.
- Remaining boundary: strict authoring is not introduced in this slice;
  existing profile gates remain unchanged. GitHub-host fixtures/oracle,
  repository-wide diagnostics, complete visual-editor acceptance, and
  Workstream 15 Assistant/Ollama remain separate later work.

## Latest packaged rendered Save/reload acceptance slice (2026-08-31)

- An isolated temporary copy of the repository README was opened by the fresh
  Windows x64 portable build. In visual Edit mode, a rendered paragraph
  accepted a bounded text change; Done committed the source-range edit, and
  Ctrl+S reported `Saved atomically`.
- A read-only disk check found the visual probe, and a fresh packaged launch
  reopened the temporary file without a recovery prompt with the saved probe
  present in the rendered document. The temporary file was removed afterward;
  the repository README was never edited or saved by this probe.
- Remaining boundary: source-range undo/redo and discard continuity,
  dual-pane selection/Find projection, IME, multi-object pointer selection,
  file-picker behavior, controlled latency, target-OS accessibility, and
  GitHub-host fixture/oracle evidence remain open. Workstream 15
  Assistant/Ollama and the Workstream 12B layout experiment remain deferred.

## Latest packaged Save/reload acceptance slice (2026-08-31)

- An isolated temporary copy of the repository README was opened by the fresh
  Windows x64 portable build. Source editing accepted a bounded text change;
  Save cleared the unsaved state, and a read-only disk check found the saved
  probe in the temporary file.
- After the process was stopped, a fresh packaged launch reopened the same
  temporary file without a recovery prompt and the saved probe was present in
  the reloaded document. The temporary file was then removed; the repository
  README was never edited or saved by this probe.
- Remaining boundary: visual Save/reload after a rendered edit, source-range
  undo/redo and discard continuity, dual-pane selection/Find projection, IME,
  multi-object pointer selection, file-picker behavior, controlled latency,
  target-OS accessibility, and GitHub-host fixture/oracle evidence remain open.
  Workstream 15 Assistant/Ollama and the Workstream 12B layout experiment remain
  deferred.

## Latest packaged source and Find acceptance slice (2026-08-31)

- A fresh Windows x64 portable process opened the repository `README.md`,
  switched to Source mode, accepted literal source-editor typing, and exposed
  the unsaved state without mutating the file on disk.
- The app-owned in-document Ctrl+F opened its own Find bar, accepted a query,
  reported `1 of 1`, and highlighted the matching source text. This proves the
  packaged source/search path; it does not yet prove Save, dual-pane visual
  Find projection, or IME behavior.
- The process was stopped without Save/Done. A read-only check confirmed both
  runtime probe strings were absent from the on-disk `README.md`.
- Remaining boundary: packaged Save and reload, visual/source dual-pane Find
  projection, multi-object pointer selection, IME, file-picker behavior,
  controlled latency, target-OS accessibility, and GitHub-host fixture/oracle
  evidence remain open. Workstream 15 Assistant/Ollama and the Workstream 12B
  layout experiment remain deferred.

## Latest selection and native read hardening (2026-08-31)

- Source-selection projection now builds an immutable interval index once per
  trusted render. Cross-pane source selections use a binary-search overlap
  query instead of filtering and sorting every mapped object on each event;
  the index is cleared with the rendered DOM so stale map state cannot survive
  teardown.
- Image asset reads use a bounded stream with an early metadata check and a
  post-read growth check. HTML/DOCX imports use the same pattern at the
  existing 30 MB import ceiling. Workspace Markdown indexing/search already
  uses a bounded 30 MB read, so background work cannot allocate unbounded file
  contents from a discovered path.
- Verification: focused source-selection/render/MarkdownView suites (35 tests
  across 3 files); the new native import-limit regression; `pnpm check`;
  Rust fmt; and the affected native test passed. The broader package/build
  evidence remains recorded below; the bounded-read change does not alter the
  source-authoritative patch contract.
- A fresh rebuilt Windows x64 portable probe opened `README.md`, entered Edit
  mode, focused a rendered paragraph, accepted literal typing, and updated the
  rendered block while the source pane remained mapped. The probe process was
  terminated without Save/Done and the on-disk `README.md` was verified
  unchanged. This proves one packaged visual-caret/type path, not the complete
  desktop acceptance gate.
- Remaining boundary: source-pane save, multi-object pointer selection,
  IME, file-picker behavior, controlled latency, target-OS accessibility, and
  GitHub-host fixture/oracle evidence remain open. Workstream 15
  Assistant/Ollama and the Workstream 12B layout experiment remain deferred.

## Latest continuous visual authoring and responsibility split (2026-08-31)

- Source-aware structural keyboard editing now covers supported plain and rich
  paragraphs/list items: Enter splits, Backspace joins compatible adjacent
  blocks, and Tab/Shift+Tab changes list indentation. Rich splits/joins clone
  only the active inline subtree before serializing each bounded source range,
  so browser contenteditable merge behavior cannot silently become the source.
- Visual Ctrl/Cmd+B/I/U/K continues to route through the existing source-range
  formatting transaction. Unsupported nested lists, images, hard breaks, and
  ambiguous blocks remain source-only rather than being guessed at.
- Keyboard structure handling now lives in the focused
  `src/lib/markdown-view-visual-editing.ts` adapter; `MarkdownView.svelte`
  retains render, slash-menu, and lifecycle ownership. Source-only reveal
  controls explain common reasons such as image objects, nested lists, and
  hard breaks.
- Visual selections are captured against the previous trusted map before a
  source-authoritative render refresh and restored against the new map when
  the range remains exact. Formatting actions provide their post-patch source
  selection so wrapper insertion does not leave the rendered pane visibly
  selected at stale offsets. The logic lives in
  `src/lib/markdown-view-render.ts`.
- Verification: focused visual-structure/MarkdownView/source-map suites (53
  tests across 3 files); visual-render continuity tests (2 tests); full frontend
  suite (37 files / 209 tests); `pnpm
  check`; `pnpm build`; accessibility source audit; dev-server-backed WCAGate
  (2,181 surfaces / 0 active findings, run 2026-08-31); Rust fmt; Clippy with
  `-D warnings`; native all-feature tests (67); `pnpm build:app`; `pnpm
  smoke:native`; and `git diff --check` passed. The fresh package passed one
  visual paragraph caret/type probe; source-pane save, IME, broader pointer
  selection, and controlled typing latency remain open. The first
  package attempt was correctly blocked while the test app held the portable
  executable; after closing that instance, packaging completed.

## Latest non-AI editor acceptance hardening (2026-08-30)

- Ordinary rich paragraph editing now preserves soft-wrapped line endings when
  the rendered text still exposes those boundaries, while ambiguous collapsed
  wraps remain source-only so visual editing cannot silently reflow untouched
  Markdown. Literal Markdown punctuation is escaped through the bounded rich
  serializer instead of forcing otherwise ordinary paragraphs into source-only
  mode.
- The ribbon tab strip now has a semantic compact `Tabs` disclosure backed by
  its own component and stylesheet, so narrow windows have a direct path to
  every Home/Insert/Layout/Block/Review tab. Rendered find, hover, visual
  selection, and source-projected selection use visibly different chrome.
- Added direct component coverage for object-first context menus and compact
  ribbon navigation. No source-wide reserialization or AI/provider behavior was
  added.
- Verification: focused suite 3 files / 13 tests; full frontend suite 35 files /
  188 tests; `pnpm check`; `pnpm build`; `pnpm accessibility:audit`;
  `pnpm wcagate:doctor`; WCAGate 2,181 surfaces / 0 active findings; Rust fmt;
  `cargo clippy --all-targets --all-features -- -D warnings`; `cargo test
  --all-features` (67 passed); `pnpm audit --audit-level high`; `cargo audit`
  (18 existing allowed warnings); `cargo deny check`; `pnpm build:app`;
  `pnpm smoke:native`; and `git diff --check` all passed.
- Remaining boundary: this is automated, source, browser/Vite, and package-level
  evidence. Direct packaged pointer/IME/file-picker latency, target-OS
  screen-reader behavior, and a controlled end-to-end desktop acceptance pass
  remain unverified. The known optional visualization chunks still exceed the
  Vite warning threshold. W12B and Assistant/Ollama remain deferred.

## Architecture and performance refactor (2026-08-29)

- The Svelte shell now delegates toolbar, tabs, workspace navigation,
  document surface, inspector, context menu, command palette, and settings to
  focused components. Styling was moved out of Svelte components into
  `src/styles/` imports; no inline component `<style>` blocks remain.
- Native asset/path helpers now live in `src-tauri/src/asset_ops.rs`; the
  existing store command paths are preserved through crate-local re-exports.
- Source-map construction, source-position conversion, alert normalization,
  and mapped-text extraction now live in `src-tauri/src/markdown_source_map.rs`;
  `markdown.rs` retains render/lint orchestration and the existing test/API
  boundary.
- `MarkdownView.svelte` now delegates its explicit DOM/range mapping helpers,
  rendered decorations, optional rich-content rendering, and fenced-code/
  details block-editing adapters to focused `src/lib/markdown-view-*.ts`
  modules. The component retains the shared enhance lifecycle, slash handling,
  drag/drop state, and source-patch callbacks so those responsibilities do not
  acquire a second mutable document authority.
- Rendered-pane highlight updates skip unchanged map sets, and source-selection
  projection reuses indexed mapped elements/spans instead of rescanning the
  full rendered DOM. Pointer hover also avoids repeating layout and tooltip
  work while the pointer remains on the same mapped object. These are targeted
  reductions in repeated work, not proof that packaged interaction latency is
  solved.
- Verification in this pass: `pnpm check`; full frontend Vitest suite (32
  files / 179 tests); `pnpm build`; `pnpm accessibility:audit`; Rust fmt check;
  `cargo check --all-targets`; `cargo clippy --all-targets --all-features
  -- -D warnings`; and `cargo test --all-features` (67 tests) passed. The
  Windows x64 `pnpm build:app` bundle and `pnpm smoke:native` also passed. The
  production build retains the existing non-failing large optional
  visualization-chunk warning.
- Remaining boundary: `App.svelte` is still a large stateful application
  orchestrator, and `MarkdownView.svelte` still owns its shared interaction
  lifecycle by design. Splitting those remaining seams safely requires a
  controller/store boundary and dedicated regression coverage; arbitrary
  wrapper extraction would risk duplicate state or source-patch races. Direct
  packaged pointer/IME/file-picker interaction, target-OS accessibility, and
  runtime performance measurements remain unverified. Assistant/Ollama remains
  parked and was not expanded in this pass.

## Product invariants

- Markdown source is authoritative; visual actions are bounded source-range
  patches, never whole-document HTML or rich-document serialization.
- Rust owns filesystem access, path grants, local/remote asset policy,
  encoding/line-ending preservation, conflict handling, and native IPC.
- Rendered HTML is sanitized. Unsupported or ambiguous visual blocks remain
  source-editable rather than being silently rewritten.
- GitHub compatibility is a named profile claim backed by fixtures/evidence;
  local rendering alone is not proof of github.com behavior.
- The shipped application has no MCP runtime and no silent workspace RAG.

## Workstream status

| Workstream | State | Evidence / boundary |
| --- | --- | --- |
| 0 | Complete | `/Tasks/` ignore rule verified locally. |
| 1 | Complete | Rust source maps, UTF-8 byte ranges, source hashes, stale-map rejection, and frontend conversion are implemented and tested. |
| 2 | Complete | App-owned Ctrl/Cmd+F with source and visual mapping; Replace remains deferred. |
| 3 | Complete | Bidirectional hover/selection mapping now includes exact safe inline projection, surrogate/hard-break protection, owner-outline fallback, and cross-tab selection invalidation; final desktop interaction/accessibility evidence remains. |
| 4 | Complete locally; runtime interaction partial | Source drawer preserves the mounted CodeMirror editor after first open; simple blocks, task items/checkboxes, table cells, details summaries, supported rich inline blocks, and regular fenced code bodies use bounded patches. Visual paragraph Shift+Enter now creates a source-preservable hard break rather than a DOM-only newline. Render/source/split state now reports an effective split view when the collapsible source drawer is open from Render. Cross-pane hover/selection repaint and source-drawer focus return are hardened. Async import/paste/drop/Save As operations now bind their result to the original tab/source snapshot so tab switches cannot redirect or clobber edits. Visual Save now flushes the focused mapped contenteditable before taking its source snapshot. Explicit Done editing flushes the focused block before returning to reading view. Save, Undo/Redo, navigation, and leaving Edit flush pending visual DOM edits and refuse to tear down an active IME composition; the composition state is explicit on the mapped editor. Pending unblurred visual DOM edits are marked and protected from external-change reloads and tab close. Ambiguous inline blocks, diagrams, and indented code expose a source-reveal route. Regular fenced code edits preserve markers/line endings and reject closing-fence injection. Slash cancellation restores the pre-token inline DOM, and the render enhancement pass no longer attaches duplicate listeners on initial mount. Missing-original recovery snapshots now restore into a dirty tab with preserved format metadata so the user can complete an explicit Save As. Stable-toolchain native runtime evidence covers visual paragraph edit, atomic save with surrounding Markdown preserved, source drawer open/close, app-owned Ctrl+F with a dual-pane match, and packaged Restore/render of a missing-original snapshot. Mixed root movement coverage now includes blockquotes, fenced code, tables, and headings. |
| 5–7 | Implemented locally; acceptance in progress | Slash shell, blank-document slash insertion, pointer selection of the clicked slash command, source-preserving `/toc`, ribbon shell/gating with a compact all-tabs disclosure, fence chrome, tooltips, source-coordinate context-menu routing, profile-gated Mermaid (including strict-profile slash suppression), and Graphviz profile gating exist. Fence language controls now explicitly remain source-only for indented code; slash fence detection rejects info-bearing lines as false closing markers. |
| 8–11 | Implemented locally; final object/runtime evidence partial | Context actions, keyboard-open context menus, direct fenced-code copy, delayed/focus tooltips, shared table-selection context, ribbon and rendered table-toolbar controls, asset-path handling, native consolidation, Rust-owned reveal, native image replacement, and app-owned non-secret asset-folder settings exist. Native asset-drop routing deterministically discards unused one-time grants when no document or an unsupported file is dropped; focused routing tests cover those paths. Source-pane context menus now preserve a selected CodeMirror range when the pointer remains inside that selection. Generic copy now prefers rendered selection, then the active source selection, then the complete authoritative source. |
| 12A | Implemented locally; desktop interaction partial | Sequential block movement is implemented with shared source-range transactions; hidden definitions and opaque HTML are excluded from visible movement. Drag handles expose before/after zones plus a dashed beside-edge fallback that performs a sequential move and explains why persisted columns are unavailable; leaving a drop target now clears all drop-zone indicators. Final desktop drag/keyboard interaction evidence remains. |
| 12B | Optional / not enabled | Side-by-side persisted layout remains fixture-gated and must not weaken sequential GitHub Markdown. |
| 13A | Complete | Stable Issue contract, unsafe-scheme and duplicate-heading diagnostics, README/object-size scopes, contextual local-path classification, clickable mapped/no-range Issues, and advisory-save behavior are implemented and tested. |
| 13B–14 | In progress | Base lint remains advisory and now includes strict-profile portability diagnostics for GitHub alerts, GFM tables when parsed, details HTML, and semantic HTML marks. Fence/asset extensions, core block-movement hardening, and final editor/accessibility acceptance remain, along with target-runtime gates. |
| 15 | Implemented previously; parked and excluded from minimum editor milestone | Assistant Phase 1 remains isolated for later work, but its panel is no longer exposed or eagerly imported by the minimum editor shell. No further Assistant/Ollama work should proceed until the visual-editor acceptance gate passes; proposed patches, HTTPS providers, Settings-only model lifecycle, typed app tools, and compression remain later phases. |

## Current resume point

Return to the visual-editor acceptance gate before doing any more Assistant
work. The core source/tests are substantial, and source typing/render
scheduling is now debounced; packaged pointer/IME/file-picker behavior and
target-OS accessibility remain partial. Verify the complete Edit → rendered-pane
typing → source-range patch → Save flow, then repeat for ribbon, source drawer,
cross-pane selection/hover, block movement, and issue/source reveal. Assistant
Phase 1 remains parked, hidden from the minimum editor shell, and is not part
of the minimum editor milestone. Do not restart Workstreams 1–3 without
evidence that their current tests or contracts regressed.

## Local verification recorded

- `pnpm check` — passed with 0 errors and 0 warnings after the latest editor changes.
- Full frontend Vitest suite — 31 files / 174 tests passed after fenced-code visual editing coverage; the suite includes Svelte component harness, IME/paste visual-edit coverage, task-checkbox coverage, source mapping, movement, profile capability, browser-settings, source-copy resolution, keyboard-menu focus restoration, Assistant settings contract tests, and fence-body safety coverage.
- `pnpm build` — passed; existing large-chunk warnings remain for diagram assets.
- Latest frontend suite — 32 files / 179 tests passed after setext-aware `/toc`, safe slash fence detection, targeted mapped-highlight updates, and removal of the parked Assistant panel from the minimum shell.
- Latest production build — passed after the same changes; the Assistant panel is no longer eagerly imported, while optional Mermaid/Graphviz/KaTeX chunks remain lazy and the existing large-chunk warnings remain non-failing.
- Secure local-image reveal slice — Rust command registration, canonical document/workspace re-resolution, remote/unsafe/non-image rejection, and native opener integration compile and pass the native gates; live file-manager interaction remains unverified.
- Native image replacement slice — the picker uses a one-time `asset-pick` grant and the existing validated copy/collision pipeline, then patches only the mapped image reference; stale document changes refuse the patch. End-to-end picker/file-manager interaction remains unverified.
- Native Rust formatting, `clippy -D warnings`, and 67 all-feature tests passed after the latest native and editor changes, including strict-profile portability diagnostics, missing-original recovery metadata, exclusive asset collision handling, and Assistant HTTP-boundary tests.
- Assistant Phase 1 — native Ollama discovery/feedback module and in-process HTTP mock tests pass (7 focused tests); live read-only inspection of a user-supplied endpoint confirmed dynamic version/tags/show fields and a mixed chat/vision/embedding/reranker inventory. The endpoint and model names are not stored in source or defaults. This slice is parked and is not the minimum editor milestone; interactive Assistant use, target-OS evidence, provider mock coverage through the UI, and all later phases remain pending.
- Dependency/security gates — `pnpm audit --audit-level high` reported no known vulnerabilities; `cargo audit` completed with 18 existing allowed maintenance/unsoundness/yanked warnings; `cargo deny check` passed advisories, bans, licenses, and sources with expected duplicate-crate warnings.
- `pnpm accessibility:audit` — passed for all 7 Svelte files.
- `pnpm wcagate:doctor` — passed; required browser/axe tooling and Chromium are available.
- `pnpm wcagate:audit` — Gate PASS with 2,253 surfaces and 0 active failed/unresolved findings after the Assistant panel was added; this is evidence-gate output, not a WCAG conformance score.
- Windows packaging — `pnpm build:app` rebuilt and staged the x64 portable executable, MSI, and NSIS installer from the current source; the rebuilt portable app opened a Markdown fixture. The bridge could not complete click/type while an unrelated foreground Ollama window obscured the app, so this does not prove packaged pointer/IME/file-picker interaction or target-OS accessibility.
- Beside-edge movement fallback — focused `MarkdownView`/block-movement tests passed (27 tests); a beside drop remains sequential and reports the unsupported persisted-column boundary instead of writing unverified HTML layout.
- Stable-toolchain `pnpm tauri dev` runtime smoke — temporary Markdown fixture opened through the native app; visual editing changed only the mapped paragraph, disk remained unchanged before Save, Save reported atomic success, the source drawer opened and closed, and `RUNTIME_FIND_TOKEN` produced `1 of 1` with visual/source highlights. The fixture and dev process were removed afterward; native file-picker and tab-close automation were not counted as acceptance evidence because the test bridge did not activate those controls reliably.
- Stable-toolchain visual table smoke — a table cell was exposed as `Editable Markdown table cell`, the in-canvas table toolbar rendered with accessible add/delete/move row and column controls, and the shared table-selection state was visible in the ribbon. After wiring the rendered toolbar callback, `+ Row` successfully inserted a blank row in memory; the app reported `Updated Markdown source without reserializing the document`, showed the dirty state and 12 rendered lines, and the disk fixture remained unchanged before Save. The computer-use bridge still misrouted some unrelated indexed/coordinate actions, so keyboard/pointer coverage remains partial; source-level table mutations remain covered by 7 focused tests and the full suite.
- Native asset-drop routing tests — 3 focused planner cases passed: no active document and unsupported drops discard all one-time grants, while a mixed drop retains only the supported image grant and discards unrelated files. The native drop flow remains unverified through a real desktop drag gesture.
- Async native-operation ordering — import, clipboard image paste, asset drop, consolidation, and Save As now use captured tab/source/selection state and re-resolve the target after awaits; `pnpm check` and focused source/asset transaction tests pass. A deliberate tab-switch desktop race has not been automated yet.
- Missing-original recovery — the rebuilt packaged Windows executable successfully restored the recovery snapshot, created the dirty `runtime-editor-fixture` tab, rendered the recovered table, and dismissed the recovery modal. Native recovery metadata tests cover backward-compatible snapshots and CRLF/LF/CR inference. The actual Save As picker destination was not selected during this pass, so picker behavior remains unverified.
- Source context-menu routing — CodeMirror right-clicks now resolve the source coordinate through the same trusted map resolver before opening the themed object menu; visual and source panes therefore share object actions without exposing a browser context menu.
- Clipboard/import safety — DOMPurify now sanitizes the conversion boundary before HTML becomes Markdown, and the shared destination policy removes unsafe URL schemes, event attributes, source sets, and presentation styles; guided link/image destinations use Markdown-safe escaping for delimiter-containing URLs. Focused paste/insert tests pass.
- Core usability hardening — guided image insertion now preserves safe delimiter-containing destinations and optional titles; fence context menus expose direct code copy; mapped tooltips use pointer delay/leave dismissal and keyboard focus; the asset-folder preference uses the app-owned Tauri store with a browser-only fallback; new assets use exclusive collision-safe creation; drag indicators clear on leave; source context menus preserve an in-selection CodeMirror range; and generic copy now falls back from rendered selection to source selection and then complete active source. Full frontend tests (30 files/166 tests), native tests (59), `pnpm check`, production build, accessibility audit, WCAGate (2,181 surfaces/0 active findings), Windows packaging, and native smoke pass. Native settings persistence and packaged interaction remain unverified.
- Target-platform packaging, signing, installer, live-updater, and desktop accessibility evidence are not implied by these local checks.

## Latest local hardening slice (2026-08-29)

- Global keyboard handling now opens the themed context menu from both the
  standard `ContextMenu` key and `Shift+F10`, anchoring to the focused mapped
  object or resolving the active source-editor selection through the trusted
  source map. Existing menu arrow navigation and opener-focus restoration are
  preserved.
- Focused verification: `src/App.test.ts` (3 tests), `pnpm check`, full
  frontend suite (30 files / 168 tests), `pnpm build`, WCAGate (2,181 surfaces /
  0 active findings), `pnpm build:app`, and `pnpm smoke:native` all passed.
- This proves source/browser/package smoke behavior only. A real packaged
  keyboard interaction, target-OS screen reader, and native accessibility
  inspection remain unverified.

## Latest local hardening slice (2026-08-29)

- `MarkdownView` clears the beside-edge drag indicator on `dragleave`, preventing a stale visual drop target after the pointer exits a block.
- `MarkdownEditor` preserves an existing source selection for a block-aware context menu when the user right-clicks inside that selection; point context menus remain point-based otherwise.
- Focused verification: `pnpm check` passed with 0 errors/0 warnings; `MarkdownView`, block-movement, and source-context tests passed (31 tests).
- These changes do not alter the Markdown source model. Packaged drag/pointer interaction and target-OS accessibility remain unverified.

## Latest visual-editor hardening slice (2026-08-29)

- Regular fenced code bodies are now contenteditable in rendered Edit mode when
  the source map identifies a safe fenced block. The fence marker, info string,
  closing marker, line endings, and surrounding Markdown are preserved through
  a bounded source patch. Mermaid, Graphviz, math, indented code, and
  fence-looking injected lines remain source-only or are rejected.
- Focused fence/MarkdownView tests: 27 passed. Full frontend suite: 31 files /
  174 tests. `pnpm check`, `pnpm build`, Rust fmt, native all-feature tests (67),
  `pnpm build:app`, and `git diff --check` passed.
- The current rebuilt portable app opened the fixture and exposed the Edit
  control, rendered code block, source editor, and ribbon. Packaged click/type
  verification could not be completed because an unrelated foreground Ollama
  window obscured the app; this remains an explicit runtime gate.

## Latest performance and minimum-shell slice (2026-08-29)

- Source-editor typing updates the authoritative in-memory Markdown
  immediately, but schedules the expensive native render/source-map/sanitizer
  refresh after a short idle pause. The last valid rendered surface stays
  mounted while that refresh is pending; saves and source patches still use the
  latest source.
- Rendered-pane highlight updates now touch only map IDs whose highlight state
  changed, and cross-pane source-selection projection skips intentionally stale
  maps during the debounce window. This reduces repeated full-preview scans on
  large documents without weakening stale-map rejection.
- The TOC helper now includes ordinary ATX and setext headings, follows the Rust
  slug/duplicate-anchor contract, excludes fenced content, and preserves source
  line endings. Slash fence detection uses the same valid-closing-marker rule.
- Assistant Phase 1 source files remain available for the later workstream, but
  the minimum shell does not expose or eagerly import the Assistant panel.
- Verification: `pnpm check`; focused editor/TOC/slash/App suites (4 files / 35
  tests); full frontend suite (32 files / 179 tests); `pnpm build`;
  `pnpm accessibility:audit`; `pnpm build:app`; `pnpm smoke:native`; and
  `git diff --check` passed. Windows package generation and native smoke are
  package-level evidence only; direct packaged pointer/IME/picker interaction
  and target-OS accessibility remain unverified.

## Latest performance and rich-render synchronization slice (2026-08-29)

- The CodeMirror source editor now retains its latest serialized document
  revision so parent-source synchronization does not serialize the entire
  document a second time merely to compare equal values. Find decorations
  skip redundant CodeMirror transactions when match, active, and hover ranges
  are unchanged.
- Lazy math/diagram replacements now require the current render generation and
  a connected source node. Successful replacements refresh the mapped-element
  index, reapply highlight state, and project the current source selection;
  stale asynchronous work cannot replace a newer preview.
- Added focused replacement/guard coverage in
  `src/lib/markdown-view-rich-content.test.ts`.
- Verification: focused suite 3 files / 27 tests; full frontend suite 33 files
  / 182 tests; `pnpm check`; `pnpm build`; `pnpm accessibility:audit`;
  dev-server-backed WCAGate (2,181 surfaces / 0 findings); `pnpm build:app`;
  `pnpm smoke:native`; and `git diff --check` passed.
- Remaining boundary: these changes reduce known redundant work and close a
  stale-rich-render mapping risk, but no end-to-end packaged latency baseline
  exists yet. The existing large optional visualization-chunk warnings remain
  bundle warnings, not runtime-speed evidence. Assistant/Ollama remains
  deferred.

## Latest selection-latency hardening (2026-08-29)

- The source-selection hot path now builds one revision-scoped UTF-8-byte to
  UTF-16 index and reuses it for visual mapping, Find, block movement, and
  table context instead of re-encoding the entire source for each event.
- Rendered selection projection is frame-coalesced, ignores document-wide
  `selectionchange` events originating outside the rendered pane, suppresses
  duplicate snapshots, and caches the expensive inline visible-text mapping
  for each rendered element. CodeMirror hover coordinates are also sampled
  once per animation frame, and unchanged hover map IDs no longer invalidate
  ribbon/preview state.
- Root-block movement resolution no longer performs pairwise quadratic
  containment/de-duplication work during selection-driven derived updates;
  both ribbon directions share one indexed safety pass.
- The same index now carries map-ID and kind lookups, and rendered text-node
  prefixes avoid repeated DOM range stringification for non-editable content.
  Editable blocks keep the conservative DOM fallback because their children
  can change before the next source-authoritative render.
- Verification: focused suite 6 files / 58 tests, full frontend suite 34 files
  / 184 tests, `pnpm check`, `pnpm build`, `pnpm build:app`, `pnpm smoke:native`,
  and `git diff --check` passed. A fresh rebuilt portable app selected source
  text and projected the selection into the rendered pane; the automation
  call completed in about 137 ms, which is an interaction observation rather
  than a controlled latency benchmark.
- Remaining boundary: direct human pointer-drag latency, IME behavior, and
  target-OS accessibility still need a controlled packaged acceptance pass.
  Known large visualization chunks remain bundle warnings, and Assistant/
  Ollama is still deferred.

## Rich clipboard conversion slice (2026-08-30)

- Rich HTML paste now works in the source editor and supported visual blocks.
  Clipboard HTML is sanitized before conversion, Word-style list paragraphs
  and literal bullet-list payloads are normalized, presentation attributes are
  discarded, and the destination policy still rejects unsafe schemes.
- Visual paste captures an exact mapped source selection or caret and applies
  the converted Markdown through the existing source-patch transaction; it
  never inserts untrusted HTML into the rendered DOM. Code blocks and ambiguous
  visual structures retain their source-only behavior.
- Focused verification: paste, source-map, and MarkdownView suites passed (48
  tests); `pnpm check` passed with 0 errors and 0 warnings. Full frontend,
  packaged pointer/IME/picker, target-OS accessibility, and GitHub-host fixture
  evidence remain separate gates.

## Latest render responsiveness and object-mapping slice (2026-08-31)

- Native Markdown rendering, source-map construction, sanitization, and
  document-scoped lint now execute in a Tauri blocking worker. The existing
  debounce, generation checks, stale-map rejection, and last-valid-preview
  behavior remain in place; this moves CPU-heavy work off the command/UI path
  without introducing a second renderer.
- Optional KaTeX enhancement no longer delays map readiness or ordinary visual
  interaction. Resolved local/remote images use a bounded per-view cache with
  in-flight request deduplication, and failed loads are not cached.
- Validated SVG image references are now supported in the preview path. The
  native fetch/read boundary still validates and bounds the bytes; the frontend
  sanitizes SVG before creating the image data URI and removes scripts,
  foreign content, external references, and active styling. SVG drag/drop and
  reveal remain restricted because they are file-authoring operations rather
  than passive preview.
- Source-map attachment now associates raw HTML `<a>` and `<img>` elements
  with their enclosing trusted source span, while preserving Markdown image and
  link mappings. The Links inspector selects a mapped link in both panes; its
  separate open control retains navigation behavior.
- CodeMirror Markdown syntax colors now use theme tokens: links are a calm blue
  and light-mode syntax colors have sufficient separation from normal text.
  The bottom status bar retains `Ready` and adds active-source line and Unicode
  character counts.
- Verification: `pnpm check` (0 errors / 0 warnings); focused frontend suite
  (4 files / 28 tests); full frontend suite (39 files / 216 tests); `cargo fmt
  --check`; `cargo check --all-targets --all-features`; native tests (70);
  `cargo clippy --all-targets --all-features -- -D warnings`; `pnpm build`;
  `pnpm build:app`; `pnpm smoke:native`; and `git diff --check` passed.
- Boundary: the packaged smoke gate proves artifact launch/integrity, not direct
  human image-load timing, pointer hover/selection, IME behavior, or target-OS
  accessibility. Large optional visualization chunks remain build warnings;
  controlled runtime latency, GitHub-host fixtures/oracle evidence, W12B, and
  Assistant/Ollama remain open or deferred.

## 2026-08-31 — Source/visual transaction and interaction hardening

- Status: implemented and automated/package-smoke verified; direct packaged
  undo/link/context-menu interaction and controlled latency remain open.
- Changes: unified source-editor and visual range edits behind app-owned
  undo/redo history; removed the competing CodeMirror undo/redo key bindings;
  made visual draft source updates immediate while retaining the last valid
  rendered DOM until one guarded post-edit refresh; and kept crash-recovery
  scheduling independent of blur. Added guarded Reload from Disk with dirty
  confirmation, revision/external-change checks, render-generation cleanup,
  and recovery/history reset. Added source-pane Ctrl/Cmd-click link opening,
  area-aware mapped/raw-HTML link and image context targets, and rendered
  between-block insertion zones.
- Source safety: visual drafts validate the expected mapped source slice before
  every patch; stale maps reject without leaving non-authoritative DOM text;
  reload never silently discards dirty source; external links use the native
  opener while relative Markdown links remain document navigation.
- Verification: `pnpm check` passed with 0 errors and 0 warnings; focused
  source-context/visual-draft/context-menu/MarkdownView coverage passed (38
  tests); full frontend suite passed (42 files / 225 tests); Rust fmt/check,
  70 native tests, and Clippy with warnings denied passed; `pnpm build`,
  `pnpm build:app`, and `pnpm smoke:native` passed. Packaged probes separately
  proved rendered typing, source typing plus app-owned Find, source Save/
  reload, and rendered Save/reload on isolated temporary copies.
- Boundary: the packaged probe did not establish direct undo/redo, modifier
  click, right-click, broad pointer selection, IME, or controlled latency.
  Visual rendering intentionally does not rebuild the preview on every
  keystroke; it updates source state immediately and refreshes after the
  bounded commit debounce. Unsupported/ambiguous structures remain source-only
  where a safe range patch is not yet defined. Existing large visualization
  chunk warnings remain non-failing; GitHub-host fixtures/oracle, W12B, and
  Assistant/Ollama remain deferred.

## 2026-08-31 — Editor history grouping and context actions

- Status: implemented and locally verified; direct packaged interaction remains
  an open acceptance gate.
- Changes: added a focused source-history module that coalesces continuous
  source typing and same-block visual drafts into bounded undo units while
  leaving structural/ribbon/paste/asset actions independent. Added ordinary
  paragraph, list, task, blockquote, alert, and details duplicate/delete
  actions to the area-aware context menu, all routed through the existing
  source-range transaction.
- Verification: focused tests passed (37 tests), full frontend tests passed
  (43 files / 229 tests), and `pnpm check` passed with 0 errors and 0 warnings.
  `pnpm build` passed; `pnpm build:app` produced the Windows x64 portable, MSI,
  and NSIS artifacts; `pnpm smoke:native` passed against the staged portable
  executable; and `git diff --check` passed.
- Boundary: this does not yet prove multi-step undo/redo, context-menu action
  execution, pointer selection, IME, or controlled latency in the packaged
  desktop app. The explicit 9A save/reopen observation is also still open;
  optional 9B/12B, GitHub-host fixtures/oracle, and Assistant/Ollama remain
  deferred.

## 2026-08-31 — Context-menu reachability and accessibility-audit hardening

- Mapped-object context menus now expose object actions first and global app
  actions afterward, including Open Markdown, Open Workspace, view switching,
  Settings, and About. Long menus scroll within the viewport.
- The source accessibility audit now tracks Svelte brace-expression depth,
  avoiding false positives when comparisons appear inside attributes.
- Verification passed: focused ContextMenu tests (4); full frontend tests
  (43 files / 229 tests); `pnpm check`; `pnpm build`; source accessibility
  audit; WCAGate (2,206 surfaces / 0 findings); high-severity dependency audit;
  Rust fmt, Clippy, and 70 native tests; Windows x64 package generation;
  native smoke; and `git diff --check`.
- This closes a source/UI gap but does not claim packaged context-menu action
  execution, packaged undo/redo, pointer/IME/drag-drop/file-picker behavior,
  controlled latency, or target-OS accessibility. AI/Ollama, optional 9B, and
  optional 12B remain deferred.

## 2026-08-31 — Final pre-AI editor verification and Find replacement

- Find now includes Replace and Replace all. The implementation validates the
  current source revision, rejects overlapping or stale ranges before editing,
  applies multiple ranges from right to left, preserves unrelated bytes and
  line endings, and records the operation in the shared source undo history.
  The responsive Find bar keeps both inputs and actions usable at narrow
  widths.
- Cross-pane selection projection now reuses a revision-scoped interval index
  and applies source-selected state to every DOM element carrying the mapped
  object ID. This keeps raw HTML links/images highlighted together with their
  enclosing visual owner.
- Verification: `pnpm check`; full frontend suite (43 files / 233 tests);
  `pnpm build`; source accessibility audit; WCAGate (2,206 surfaces / 0 active
  findings); `pnpm audit --audit-level high`; Rust fmt, Clippy with warnings
  denied, and 70 native tests; `cargo audit` (18 existing allowed upstream
  warnings); `cargo deny check` (policy categories pass with duplicate-crate
  warnings); `pnpm build:app`; Windows x64 native smoke; and `git diff --check`
  all passed.
- Boundary: the rebuilt package proves artifact generation and startup only.
  Direct packaged Replace/Undo/redo, context-action execution, broad pointer
  selection, IME, drag/drop, native picker, target-OS screen-reader behavior,
  and controlled latency remain unverified in this environment. Optional
  syntax highlighting, 9B HTML extensions, 12B side-by-side layout, current
  GitHub-host fixtures/oracle, and Assistant/Ollama remain deferred.

## 2026-08-31 — Cross-pane history and mapped-object synchronization hardening

- Status: implemented and focused-tested; direct packaged Undo/Redo, pointer,
  IME, and controlled-latency evidence remain open.
- Changes: source selection now resolves contained inline ranges proportionally
  while cross-block selections retain every affected owner. Rendered image/link
  hover and selection include enclosing mapped HTML owners, source selections
  reveal the rendered target, and raw HTML blocks receive between-block insert
  anchors. Undo/Redo now restores a bounded matching rendered snapshot when
  available and remounts only on history actions, preventing ordinary typing
  from paying the reset cost. The no-workspace Files panel now displays the
  current five-item recent Markdown history with active-file state, and action
  messages return to Ready after 6.5 seconds unless they are still busy.
- Verification: `pnpm check` passed with 0 errors and 0 warnings; focused
  cross-pane/source-selection/MarkdownView/App coverage passed (47 tests);
  Rust fmt, Clippy with warnings denied, and 71 native tests passed; `pnpm
  build` and `pnpm build:app` passed; Windows x64 native smoke passed; the
  source accessibility audit passed for 17 Svelte files.
- Boundary: the broad Vitest invocation did not produce a clean process exit in
  this workstation's runner even though the affected focused suites passed;
  the exact spawned test processes were stopped after the harness failed to
  terminate them. This is not recorded as a full-suite pass. Package smoke
  proves launch/artifact integrity, not direct packaged cross-pane interaction,
  pointer selection, IME, or latency. AI/Ollama remains deferred.
