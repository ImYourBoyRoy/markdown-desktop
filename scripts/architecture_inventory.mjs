import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const architecturePath = path.join(root, 'ARCHITECTURE.md');
const generatedStart = '<!-- BEGIN GENERATED FILE INVENTORY -->';
const generatedEnd = '<!-- END GENERATED FILE INVENTORY -->';
const sourceRoots = ['src', 'src-tauri/src', 'scripts'];
const keyFiles = [
  'README.md',
  'mobile_todo.md',
  'AGENTS.md',
  'IMPLEMENTATION_STATUS.md',
  'MEMORY.md',
  'SECURITY.md',
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'rust-toolchain.toml',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src-tauri/tauri.conf.json',
  'src-tauri/tauri.release.conf.json',
  'src-tauri/capabilities/default.json',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.gitignore',
  'docs/PHASE-0-PERFORMANCE.md',
  'docs/PHASE-1-PERFORMANCE.md',
  'LICENSE',
];

const summaries = new Map(Object.entries({
  'src/App.svelte': 'Stateful shell authority for tabs, modes, selection, lifecycle, commands, conflicts, recovery, and UI orchestration.',
  'src/main.ts': 'Svelte/Tauri application bootstrap and root mount.',
  'src/styles.css': 'Global style entry point importing the split stylesheet modules.',
  'src/vite-env.d.ts': 'Vite environment and asset type declarations.',
  'src/components/AppToolbar.svelte': 'Top application toolbar, document identity, navigation, and primary actions.',
  'src/components/AssistantPanel.svelte': 'Deferred assistant surface and provider-status UI; no provider calls by default.',
  'src/components/CommandPalette.svelte': 'Command-palette dialog and filtered command presentation.',
  'src/components/ContextMenu.svelte': 'Themed rendered/source context menu surface.',
  'src/components/DocumentSurface.svelte': 'Composes rendered document and lazy source-editor panes with shared selection callbacks.',
  'src/components/DocumentTabs.svelte': 'Document tab strip, active state, close affordances, and tab navigation events.',
  'src/components/EditorRibbon.svelte': 'Editing ribbon actions for formatting, insertion, block movement, and review controls.',
  'src/components/FileTree.svelte': 'Accessible bounded workspace file-tree rendering.',
  'src/components/InspectorSidebar.svelte': 'Outline, links, issues, and properties inspector panels.',
  'src/components/MarkdownEditor.svelte': 'Lazy CodeMirror adapter with source changes, selections, Find, and coordinate conversion.',
  'src/components/MarkdownView.svelte': 'Rendered Markdown DOM, mapped selection, visual editing, drag/drop, and rich-content enhancement lifecycle.',
  'src/components/MediaPreview.svelte': 'Accessible image and diagram lightbox with outside-click, Escape, close, and bounded zoom controls.',
  'src/components/RecentDocuments.svelte': 'Recent-document list and removal/open actions.',
  'src/components/ReaderFullscreenBar.svelte': 'Renderer-focused fullscreen controls with independent sidebar toggles and reversible exit.',
  'src/components/RibbonOverflowMenu.svelte': 'Overflow menu for ribbon actions that do not fit the available width.',
  'src/components/SettingsModal.svelte': 'Settings dialog for profile, compatibility, editing, assets, and application preferences.',
  'src/components/UpdateBanner.svelte': 'Signed-update status and install confirmation banner.',
  'src/components/WorkspaceSidebar.svelte': 'Workspace open/scan controls, recent documents, search, and file navigation sidebar.',
  'src/styles/app-shell.css': 'Application shell layout, panes, toolbar, tabs, dialogs, menus, and shared visual tokens.',
  'src/styles/assistant-panel.css': 'Assistant panel styling.',
  'src/styles/editor-ribbon.css': 'Editor ribbon and formatting control styling.',
  'src/styles/file-tree.css': 'Workspace file-tree styling.',
  'src/styles/inspector.css': 'Inspector sidebar styling.',
  'src/styles/markdown-editor.css': 'CodeMirror/source-editor styling.',
  'src/styles/markdown-view.css': 'Rendered Markdown, mapped decorations, visual editing, and rich-content styling.',
  'src/styles/media-preview.css': 'Zoomable image and diagram preview dialog styling with responsive and reduced-motion behavior.',
  'src/styles/recent-documents.css': 'Recent-document list styling.',
  'src/styles/reader-fullscreen.css': 'Reader-focused fullscreen shell, sidebar controls, and responsive focus-bar styling.',
  'src/styles/ribbon-overflow.css': 'Ribbon overflow menu styling.',
  'src/styles/update-banner.css': 'Update banner styling.',

  'src/lib/acceptance-app-support.ts': 'Shared app-facing callbacks and helpers used by packaged acceptance probes.',
  'src/lib/acceptance-app.ts': 'Acceptance-probe orchestration through the real application shell.',
  'src/lib/acceptance-bridge.ts': 'Browser/native acceptance bridge and deterministic probe state.',
  'src/lib/acceptance-input.ts': 'Synthetic keyboard, pointer, composition, and DOM input helpers.',
  'src/lib/acceptance-runner-types.ts': 'Types shared by acceptance runners and probe steps.',
  'src/lib/acceptance-runner.ts': 'Reusable acceptance step runner and reporting.',
  'src/lib/acceptance-selection.ts': 'Selection-specific acceptance probes and exact source/render assertions.',
  'src/lib/app-settings.ts': 'Typed persisted application settings with native and browser fallback boundaries.',
  'src/lib/app-shell.ts': 'Shared shell contracts, tab construction, and source-map selection helpers.',
  'src/lib/app-utils.ts': 'Cross-platform Markdown association/path helpers and safe export escaping.',
  'src/lib/asset-drop.ts': 'Pure planning for dropped-asset insertion and grant handling.',
  'src/lib/asset-path.ts': 'Asset-folder normalization and safe relative asset path helpers.',
  'src/lib/assistant-settings.ts': 'Assistant preference types and persisted setting helpers.',
  'src/lib/block-move.ts': 'Source-preserving mapped block movement and valid target calculation.',
  'src/lib/block-selection.ts': 'Rendered block selection and source-span selection helpers.',
  'src/lib/browser-settings.ts': 'Safe local browser-preview setting persistence.',
  'src/lib/clipboard.ts': 'Lazy clipboard conversion boundary for HTML, text, and image data.',
  'src/lib/compatibility.ts': 'Compatibility-target issue filtering and calm status summaries.',
  'src/lib/context-copy.ts': 'Context-menu copy resolution for rendered, source, and complete-document content.',
  'src/lib/details-edit.ts': 'Safe source patching for HTML details-summary visual edits.',
  'src/lib/document-diagnostics.ts': 'Merge and freshness helpers for filesystem/reference diagnostics.',
  'src/lib/document-metrics.ts': 'Bounded document size, line, and character metrics.',
  'src/lib/document-revision.ts': 'Source/render revision tuple, mapping-source selection, and stale-map guards.',
  'src/lib/document-tab-revision.ts': 'Pure tab transitions for source edits, render completion, snapshots, and visual history.',
  'src/lib/fence.ts': 'Fenced-code context and body extraction helpers.',
  'src/lib/find.ts': 'Document Find matching and source-map projection to rendered IDs.',
  'src/lib/formatting.ts': 'Source-range formatting actions and bounded text-edit results.',
  'src/lib/html-sub-spans.ts': 'Source-aware HTML sub-span extraction for mapped rendered content.',
  'src/lib/inserts.ts': 'Source-preserving Markdown insertion, image, heading, and block helpers.',
  'src/lib/invoke-error.ts': 'Typed normalization of Tauri invoke errors and scan-depth input.',
  'src/lib/ipc.ts': 'Typed frontend/native command wrappers and opaque grant/document boundaries.',
  'src/lib/latest-task-queue.ts': 'Single-flight latest-request queue with stale-key invalidation.',
  'src/lib/line-ending-coords.ts': 'CRLF/LF and UTF-16/UTF-8 coordinate conversion at the editor boundary.',
  'src/lib/markdown-profile.ts': 'Markdown profile and diagram capability policy.',
  'src/lib/markdown-tooltip.ts': 'Delayed accessible tooltip state and content helpers.',
  'src/lib/markdown-view-block-editing.ts': 'Rendered block editing and source-patch adapters.',
  'src/lib/markdown-view-decoration.ts': 'Rendered selection, hover, and mapped DOM decoration helpers.',
  'src/lib/markdown-view-dom-commit.ts': 'Guarded full and incremental rendered DOM commit planning.',
  'src/lib/markdown-view-dom.ts': 'Rendered DOM lookup, mapping, selection, and coordinate helpers.',
  'src/lib/markdown-view-insertion.ts': 'Rendered insertion-zone and visual insertion behavior.',
  'src/lib/markdown-view-render.ts': 'Rendered view enhancement/render adapter orchestration.',
  'src/lib/markdown-view-rich-content.ts': 'Lazy image, diagram, math, and rich-content enhancement.',
  'src/lib/media-preview.ts': 'Display-only media preview types and bounded zoom-step helpers.',
  'src/lib/markdown-view-visual-editing.ts': 'Visual-edit lifecycle, caret, composition, and source-patch callbacks.',
  'src/lib/mermaid-runtime.ts': 'Lazy Mermaid runtime facade used by the optional renderer build.',
  'src/lib/pane-scroll-sync.ts': 'Two-pane line/marker alignment after coalesced selection-driven scroll.',
  'src/lib/paste.ts': 'Semantic clipboard/import conversion and safe Markdown normalization.',
  'src/lib/performance.ts': 'Opt-in low-overhead counters and timing spans without source/path recording.',
  'src/lib/recent-documents.ts': 'Bounded recent-path normalization and recency ordering.',
  'src/lib/render-controller.ts': 'Render generations, latest-only coalescing, debounce, stale guards, snapshots, and recovery callbacks.',
  'src/lib/render-guard.ts': 'Pure source/generation equality guard for accepted render results.',
  'src/lib/rendered-pane-contract.ts': 'Rendered-pane editing and interaction contract helpers.',
  'src/lib/rendered-snapshot-cache.ts': 'Bounded reuse/restoration of already-produced rendered snapshots.',
  'src/lib/rich-visual-edit.ts': 'Rich rendered element visual-edit planning and source replacement.',
  'src/lib/safe-image.ts': 'Safe image source and rendered-image policy helpers.',
  'src/lib/selection-bridge.ts': 'Exact bidirectional rendered/source selection projection against current maps.',
  'src/lib/selection-highlight.ts': 'Non-mutating rendered text-range highlighting with safe fallback.',
  'src/lib/slash.ts': 'Slash-command availability, parsing, and source insertion helpers.',
  'src/lib/source-context.ts': 'Source-editor context target and map lookup helpers.',
  'src/lib/source-history.ts': 'Bounded source undo/redo history entries and append logic.',
  'src/lib/source-map.ts': 'Source-map range ownership, byte/character conversion, and mapped selection resolution.',
  'src/lib/source-patch.ts': 'Validated source-range patch application without whole-document reserialization.',
  'src/lib/source-selection-index.ts': 'Indexed source-map overlap queries for repeated selection projection.',
  'src/lib/source-sync.ts': 'CodeMirror change-range synchronization into authoritative source text.',
  'src/lib/tab-history.ts': 'Pure back/forward tab-history removal and replacement.',
  'src/lib/table-edit.ts': 'Safe GFM table selection context and source-preserving table edits.',
  'src/lib/toc.ts': 'Table-of-contents heading tree construction.',
  'src/lib/types.ts': 'Shared frontend IPC, document, rendering, workspace, and diagnostics types.',
  'src/lib/updater.ts': 'Signed updater state, notes, banner policy, and install lifecycle helpers.',
  'src/lib/view-mode.ts': 'Startup preference normalization, initial pane state, and active-mode visibility helpers.',
  'src/lib/visual-draft.ts': 'Visual draft state and bounded draft source patch helpers.',
  'src/lib/visual-edit.ts': 'Simple rendered block edit classification and Markdown serialization.',
  'src/lib/visual-structure.ts': 'Mapped heading/list/table structure editing patches.',

  'src-tauri/src/main.rs': 'Native process entry point delegating to the Tauri library.',
  'src-tauri/src/lib.rs': 'Tauri builder, plugin order, menus, command registration, and app lifecycle.',
  'src-tauri/src/model.rs': 'Shared native data models serialized across IPC.',
  'src-tauri/src/security.rs': 'Canonical path, grant, URL, asset, SVG, and capability security boundary.',
  'src-tauri/src/source_format.rs': 'Encoding, BOM, line-ending, final-newline, and atomic source-format preservation.',
  'src-tauri/src/markdown.rs': 'Comrak rendering, sanitization, diagnostics, metadata, and render orchestration.',
  'src-tauri/src/markdown_source_map.rs': 'Source-map construction, byte ranges, mapped HTML metadata, and coordinate helpers.',
  'src-tauri/src/markdown_incremental.rs': 'Incremental Markdown block-cache invalidation and partial render planning.',
  'src-tauri/src/document_lint.rs': 'Filesystem/reference linting independent from the expensive render path.',
  'src-tauri/src/workspace_scan.rs': 'Bounded workspace traversal and Markdown descendant tree construction.',
  'src-tauri/src/asset_ops.rs': 'Native local/remote asset validation and filesystem operations.',
  'src-tauri/src/default_app.rs': 'Platform default-Markdown-application detection and registration helpers.',
  'src-tauri/src/assistant.rs': 'Deferred assistant/provider boundary and local provider lifecycle types.',
  'src-tauri/src/github_host_oracle.rs': 'GitHub README compatibility fixture/oracle implementation.',
  'src-tauri/src/acceptance.rs': 'Native acceptance fixture setup and probe command boundary.',
  'src-tauri/src/performance.rs': 'Opt-in native performance measurement commands.',
  'src-tauri/src/phase0_benchmark.rs': 'Native Phase 0 render/index benchmark harness.',
  'src-tauri/src/store.rs': 'Save, conflict, watcher, atomic-write, lifecycle orchestration, and domain reexports.',
  'src-tauri/src/store_types.rs': 'Native shared state, identifiers, errors, grants, and initialization.',
  'src-tauri/src/store_workspace.rs': 'Workspace open/refresh, indexing, search, scan depth, and tree commands.',
  'src-tauri/src/store_documents.rs': 'Document open/read/render and document record/recovery helpers.',
  'src-tauri/src/store_assets.rs': 'Asset resolution, staging, safe copy/link, and consolidation commands.',
  'src-tauri/src/store_paths.rs': 'Native pickers, one-use path grants, and bounded import reads.',
  'src-tauri/src/store_recovery.rs': 'Recovery snapshot save, list, restore, and discard lifecycle.',

  'scripts/accessibility_audit.mjs': 'Static accessibility and capability audit used by verification.',
  'scripts/align-typescript.mjs': 'Keeps supported TypeScript package lines aligned with the Svelte toolchain.',
  'scripts/architecture_inventory.mjs': 'Generates and checks this architecture file inventory from the current tree.',
  'scripts/block_drag_browser.mjs': 'Runs an isolated headless Chromium mouse drag against the rendered block handle.',
  'scripts/build_app.mjs': 'Stages platform-specific portable and installable application artifacts.',
  'scripts/build_optional_renderers.mjs': 'Builds Mermaid and other optional renderer assets outside the startup graph.',
  'scripts/full_upgrade.mjs': 'Runs the explicit reversible stable dependency/toolchain/CI upgrade workflow.',
  'scripts/generate_github_fixtures.mjs': 'Generates pinned GitHub README compatibility fixtures.',
  'scripts/github_host_oracle.mjs': 'Runs the GitHub-host fixture/oracle verification command.',
  'scripts/native_smoke.mjs': 'Runs native command and packaged-runtime smoke checks.',
  'scripts/normalize-workflow-comments.mjs': 'Normalizes workflow comments used by upgrade maintenance.',
  'scripts/optional_renderer_smoke.mjs': 'Verifies optional renderer assets produce bounded SVG output.',
  'scripts/packaged_acceptance.mjs': 'Launches the release binary and exercises real WebView acceptance flows.',
  'scripts/phase0_baseline.mjs': 'Runs Phase 0/1 frontend and native performance baseline probes.',
  'scripts/purge_build_environment.mjs': 'Safely purges project build output and optionally rebuilds within existing ranges.',
  'scripts/render_commit_benchmark.mjs': 'Runs the opt-in rendered DOM commit benchmark.',
  'scripts/report-upgrade-limits.mjs': 'Reports unresolved upstream upgrade constraints and dependency limits.',
  'scripts/selection_acceptance.mjs': 'Runs source/render selection contract acceptance suites.',
  'scripts/sync-rust-minimum.mjs': 'Synchronizes the Rust manifest minimum with the selected stable toolchain.',
  'scripts/uninstall_smoke.mjs': 'Verifies installer uninstall cleanup on supported package paths.',
  'scripts/updater_config_audit.mjs': 'Audits updater metadata, signatures, URLs, and release configuration.',
  'scripts/upgrade-plan.mjs': 'Builds the reviewed dependency/toolchain upgrade plan.',
  'scripts/upgrade-process.mjs': 'Executes one resumable upgrade process step.',
  'scripts/upgrade-snapshot.mjs': 'Creates/restores project metadata snapshots for upgrade rollback.',
  'scripts/update-pnpm.mjs': 'Updates the active pnpm installation and verifies the resolved stable command.',
  'scripts/verify_dependencies.mjs': 'Runs the project dependency, security, build, accessibility, and native gates.',
  'scripts/verify-toolchains.mjs': 'Checks Node, pnpm, Rust, Cargo, and required toolchain compatibility.',
  'scripts/visual_acceptance.mjs': 'Runs curated visual-editor unit/integration acceptance suites.',
  'scripts/workflow-comments.mjs': 'Maintains stable comments and metadata in GitHub workflows.',
  'scripts/fixtures/block-drag-fixture.ts': 'Mounts a small mapped MarkdownView fixture and records the source-safe move result.',
  'scripts/fixtures/block-drag.html': 'Vite-served browser fixture page for real mouse-driven block-move verification.',
  'scripts/fixtures/mermaid-visual.ts': 'Loads the Mermaid Markdown fixture through the production rich-content renderer and asserts visible native SVG labels.',
  'scripts/fixtures/mermaid-visual.html': 'Vite-served visual fixture page for inspecting the Mermaid Markdown rendering path.',

  'README.md': 'Published user/developer guide for installation, usage, commands, releases, and limitations.',
  'mobile_todo.md': 'Android/mobile product contract, workstreams, non-goals, and acceptance gates.',
  'AGENTS.md': 'Repository operating contract, invariants, required workflows, and safety boundaries.',
  'IMPLEMENTATION_STATUS.md': 'Current implementation checkpoint and evidence summary.',
  'MEMORY.md': 'Local continuity record of architecture decisions, validation, risks, and next actions.',
  'SECURITY.md': 'Security model, audit findings, upstream advisories, and unresolved platform boundaries.',
  'package.json': 'Frontend package metadata, dependency versions, and maintenance/build scripts.',
  'pnpm-workspace.yaml': 'pnpm workspace and build-approval configuration.',
  'pnpm-lock.yaml': 'Resolved JavaScript dependency graph.',
  'tsconfig.json': 'TypeScript compiler configuration for Svelte and native-aligned types.',
  'vite.config.ts': 'Vite/Rolldown entry, lazy chunk, alias, and production build configuration.',
  'vitest.config.ts': 'Vitest environment, pooling, timeout, and test-discovery configuration.',
  'rust-toolchain.toml': 'Stable Rust channel and rustfmt/Clippy component selection.',
  'src-tauri/Cargo.toml': 'Rust package metadata, compiler floor, Tauri dependencies, and native features.',
  'src-tauri/Cargo.lock': 'Resolved Rust dependency graph.',
  'src-tauri/tauri.conf.json': 'Default Tauri window, bundle, CSP, file association, and updater configuration.',
  'src-tauri/tauri.release.conf.json': 'Release-only signing and updater overlay configuration.',
  'src-tauri/capabilities/default.json': 'Explicit webview permissions and command capabilities.',
  '.github/workflows/ci.yml': 'Quality, security, cross-platform build, and test automation.',
  '.github/workflows/release.yml': 'Signed six-family release build, publication, and post-publication verification.',
  '.gitignore': 'Generated output, local credentials, runtime state, and continuity-file boundaries.',
  'docs/PHASE-0-PERFORMANCE.md': 'Phase 0 performance matrix, baseline, budgets, and evidence limits.',
  'docs/PHASE-1-PERFORMANCE.md': 'Phase 1 optimization results, deltas, and remaining packaged gates.',
  'LICENSE': 'MIT license text.',
}));

function relativePath(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function collectFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(filePath);
    if (!entry.isFile()) return [];
    return [filePath];
  });
}

function isTestFile(filePath) {
  return /(?:\.test|\.benchmark\.test)\.(?:ts|mjs)$/.test(filePath);
}

function humanTestTarget(filePath) {
  return path.basename(filePath)
    .replace(/\.benchmark\.test\.(?:ts|mjs)$/, '')
    .replace(/\.test\.(?:ts|mjs)$/, '')
    .replace(/[-_]/g, ' ');
}

function summaryFor(filePath) {
  if (summaries.has(filePath)) return summaries.get(filePath);
  if (isTestFile(filePath)) {
    const benchmark = filePath.includes('.benchmark.test.');
    return `${benchmark ? 'Opt-in benchmark' : 'Focused regression tests'} for ${humanTestTarget(filePath)}.`;
  }
  throw new Error(`Missing architecture summary for ${filePath}`);
}

function metricsFor(filePath) {
  const content = fs.readFileSync(path.join(root, filePath));
  const text = content.toString('utf8');
  const logicalLines = text.length === 0
    ? 0
    : text.split(/\r\n|\n|\r/).length - (/(?:\r\n|\n|\r)$/.test(text) ? 1 : 0);
  return { path: filePath, lines: logicalLines, bytes: content.length, test: isTestFile(filePath) };
}

function formatNumber(value) {
  return value.toLocaleString('en-US');
}

function table(rows) {
  const header = '| File | Lines | Bytes | Summary |\n| --- | ---: | ---: | --- |';
  const body = rows.map((row) => `| \`${row.path}\` | ${formatNumber(row.lines)} | ${formatNumber(row.bytes)} B | ${summaryFor(row.path)} |`);
  return [header, ...body].join('\n');
}

function totals(rows) {
  return `${formatNumber(rows.length)} files / ${formatNumber(rows.reduce((sum, row) => sum + row.lines, 0))} lines / ${formatNumber(rows.reduce((sum, row) => sum + row.bytes, 0))} B`;
}

function section(title, rows, note) {
  return [`### ${title}`, '', note, '', table(rows), ''].join('\n');
}

const discovered = sourceRoots.flatMap((sourceRoot) => collectFiles(path.join(root, sourceRoot)))
  .map(relativePath)
  .filter((filePath) => filePath !== 'ARCHITECTURE.md');
const discoveredPaths = new Set(discovered);
const allPaths = [...new Set([...discovered, ...keyFiles])]
  .filter((filePath) => filePath !== 'ARCHITECTURE.md' && fs.existsSync(path.join(root, filePath)))
  .sort();
const rows = allPaths.map(metricsFor);
const runtimeRows = rows.filter((row) => discoveredPaths.has(row.path)
  && !row.test
  && row.path !== 'scripts/architecture_inventory.mjs');
const testRows = rows.filter((row) => row.test);
const frontendRows = runtimeRows.filter((row) => row.path.startsWith('src/') && !row.path.startsWith('src/lib/'));
const libraryRows = runtimeRows.filter((row) => row.path.startsWith('src/lib/'));
const nativeRows = runtimeRows.filter((row) => row.path.startsWith('src-tauri/src/'));
const scriptRows = rows.filter((row) => !row.test && row.path.startsWith('scripts/'));
const configRows = rows.filter((row) => !discoveredPaths.has(row.path));
const largestRows = [...runtimeRows].sort((left, right) => right.bytes - left.bytes).slice(0, 12);

const generated = [
  '## Cold-start file inventory',
  '',
  'This section is generated by `pnpm architecture:refresh` and validated by',
  '`pnpm architecture:check`. It intentionally excludes this document itself,',
  'generated output, dependency trees, and build artifacts. Bytes are raw UTF-8',
  'file sizes; lines are logical source lines with a terminal newline excluded.',
  'Refresh it after source or documentation changes so cold models can trust the',
  'routing table below.',
  '',
  `Inventory totals: ${totals(rows)}. Runtime (excluding this generator): ${totals(runtimeRows)}. Tests/benchmarks: ${totals(testRows)}.`,
  '',
  '### Read first',
  '',
  '| Priority | File | Why it matters |',
  '| ---: | --- | --- |',
  '| 1 | `AGENTS.md` → `ARCHITECTURE.md` → `README.md` | Operating contract, stable ownership map, and user/developer workflow. |',
  '| 2 | `src/App.svelte` → `src/components/DocumentSurface.svelte` | Shell state authority and the two-pane document surface. |',
  '| 3 | `src/lib/document-revision.ts` → `src/lib/selection-bridge.ts` → `src/lib/source-map.ts` | Exact revision-bound selection and source-coordinate contract. |',
  '| 4 | `src/lib/render-controller.ts` → `src/lib/rendered-snapshot-cache.ts` → `src/lib/latest-task-queue.ts` | Render coalescing, stale-result protection, and bounded reuse. |',
  '| 5 | `src-tauri/src/lib.rs` → `src-tauri/src/store.rs` → `src-tauri/src/markdown.rs` → `src-tauri/src/security.rs` | IPC registration, persistence, rendering, and native security boundaries. |',
  '| 6 | `src-tauri/src/store_*.rs` → `src-tauri/src/source_format.rs` → `src-tauri/src/markdown_source_map.rs` | Native domain ownership and authored-source preservation. |',
  '',
  '### Largest maintained runtime files',
  '',
  '| File | Lines | Bytes | Summary |',
  '| --- | ---: | ---: | --- |',
  ...largestRows.map((row) => `| \`${row.path}\` | ${formatNumber(row.lines)} | ${formatNumber(row.bytes)} B | ${summaryFor(row.path)} |`),
  '',
  section('Frontend UI, components, and styles', frontendRows, 'Start with `App.svelte` for state ownership, then move to the focused component or stylesheet named by the behavior under investigation.'),
  section('Frontend libraries and contracts', libraryRows, 'These modules are the preferred home for pure transitions, source-coordinate rules, bounded queues, and testable browser adapters.'),
  section('Native Rust core', nativeRows, 'Rust owns filesystem, security, decoding, rendering, persistence, workspace indexing, and native integration. `store.rs` reexports the split store domains.'),
  section('Maintenance, build, and acceptance scripts', scriptRows, 'Use these scripts through the package commands documented in `README.md`; they are project-scoped and should preserve dry-run/apply boundaries.'),
  section('Tests and benchmarks', testRows, 'Test filenames map directly to the production contract they exercise. Benchmark files are opt-in and do not run in the normal suite.'),
  section('Configuration, workflows, and project documents', configRows, 'These files define toolchains, dependency graphs, packaging, permissions, CI, and the human-facing project contract.'),
  '### Inventory maintenance',
  '',
  '- Run `pnpm architecture:check` in verification to fail on stale metrics or missing summaries.',
  '- Run `pnpm architecture:refresh` after adding, removing, renaming, or materially resizing a maintained file.',
  '- Add a curated summary to `scripts/architecture_inventory.mjs` when a new maintained file is introduced; do not accept an opaque fallback summary.',
].join('\n');

function replaceGeneratedSection(document) {
  const checkpointHeading = '\n## Current architecture checkpoint';
  const start = document.indexOf(generatedStart);
  const end = document.indexOf(generatedEnd);
  const hasMarkers = start >= 0 && end >= start;
  const before = hasMarkers
    ? document.slice(0, start).trimEnd()
    : document.slice(0, document.indexOf(checkpointHeading)).trimEnd();
  const after = hasMarkers
    ? document.slice(end + generatedEnd.length).trim()
    : document.slice(document.indexOf(checkpointHeading)).trim();
  if (!after) throw new Error('Could not locate the architecture checkpoint heading');
  return `${before}\n\n${generatedStart}\n${generated}\n${generatedEnd}\n\n${after}\n`;
}

const current = fs.readFileSync(architecturePath, 'utf8');
const next = replaceGeneratedSection(current);
if (process.argv.includes('--check')) {
  if (current !== next) {
    console.error('ARCHITECTURE.md inventory is stale; run pnpm architecture:refresh');
    if (process.argv.includes('--debug')) {
      let firstDifference = 0;
      while (firstDifference < current.length
        && firstDifference < next.length
        && current[firstDifference] === next[firstDifference]) firstDifference += 1;
      console.error(`First difference at byte ${firstDifference}`);
      console.error(`current: ${JSON.stringify(current.slice(firstDifference, firstDifference + 180))}`);
      console.error(`next:    ${JSON.stringify(next.slice(firstDifference, firstDifference + 180))}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Architecture inventory is current (${totals(rows)}).`);
  }
} else {
  fs.writeFileSync(architecturePath, next, 'utf8');
  console.log(`Architecture inventory refreshed (${totals(rows)}).`);
}
