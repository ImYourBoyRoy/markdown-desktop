# Markdown Desktop architecture

This document is the durable architecture reference for Markdown Desktop. It
describes stable ownership and data-flow boundaries; the source code, tests,
`README.md`, and `AGENTS.md` remain authoritative when this document is stale.
Operational commands and release rules belong in `AGENTS.md` and `README.md`.

## System shape

Markdown Desktop is a viewer-first Tauri application with a Svelte webview and
a Rust native core. The webview owns presentation state and user interaction;
Rust owns filesystem, security, decoding, rendering, persistence, and native
integration. The source Markdown string is the only editable document
authority.

```text
User input
   |
   +--> Rendered view / CodeMirror source editor
   |          |
   |          +--> source-range patch or selection transaction
   |                       |
   |                       v
   |                App shell tab state
   |                       |
   |          latest-only render controller
   |                       |
   |                       v
   +--> Tauri IPC --> Rust store / markdown / security domains
                              |
                              +--> decoded source, sanitized HTML,
                                   source map, diagnostics, metadata
```

The application shell remains mounted while document, workspace, and
intelligence surfaces own their scroll regions. Expensive editor and renderer
features are progressively loaded.

## Frontend ownership

### `src/App.svelte`

`App.svelte` is the stateful application orchestrator. It owns:

- the open-tab collection and active tab;
- view mode, editing, drawers, sidebars, dialogs, menus, and status feedback;
- the authoritative in-memory source for each open document;
- selection, hover, Find, visual-draft, conflict, recovery, and history state;
- application event registration and user-facing command wiring.

It must not become a second renderer, source serializer, or native filesystem
boundary. Remaining extraction from this file must use explicit callbacks or
pure transitions so tab identity, source revisions, and async result guards do
not acquire a second owner.

### Focused components

The components under `src/components/` render focused surfaces and emit
intent. In particular:

- `DocumentSurface.svelte` composes the rendered pane and source drawer.
- `MarkdownView.svelte` owns rendered DOM enhancement, visual editing, and
  pointer/keyboard interaction for the current rendered revision.
- `MarkdownEditor.svelte` owns the lazy CodeMirror adapter and converts its
  line-ending coordinates at the editor boundary.
- `WorkspaceSidebar.svelte`, `InspectorSidebar.svelte`, `DocumentTabs.svelte`,
  `AppToolbar.svelte`, and the modal/menu components own their local surface
  markup and accessibility behavior, not document authority.

### Frontend contracts and controllers

Pure helpers and narrowly scoped controllers live under `src/lib/`:

- `app-shell.ts` contains shared tab, shell, conflict, and request contracts.
- `document-tab-revision.ts` contains source/render revision transitions.
- `selection-bridge.ts` projects selections only through the exact current
  source-map revision and preserves cross-block rendered drags.
- `source-selection-index.ts` provides indexed source-map overlap lookup.
- `rendered-snapshot-cache.ts` bounds already-produced render reuse for
  undo/redo and tab restoration; it never invokes a renderer.
- `render-controller.ts` owns render generations, latest-only coalescing,
  debounce timers, stale-result rejection, snapshot publication, and recovery
  scheduling. It updates shell state only through callbacks.
- `pane-scroll-sync.ts` performs the pure two-pane alignment calculation and
  DOM scroll operation after the shell's animation-frame scheduling.
- `source-map.ts`, `line-ending-coords.ts`, `source-patch.ts`, and the visual
  editing helpers keep source coordinates, UTF-8/UTF-16 conversion, and
  bounded edits explicit and testable.

The frontend may request a render or patch, but it never treats rendered HTML
as an editable document model.

## Native ownership

`src-tauri/src/lib.rs` registers plugins, menus, commands, and the single
instance boundary. `src-tauri/src/security.rs` is the path, URL, asset, and
capability boundary. `src-tauri/src/markdown.rs` coordinates Comrak rendering,
sanitization, diagnostics, and rendered metadata; source-map construction and
coordinate helpers are kept in `markdown_source_map.rs`.

The store is split by domain and reexported through `store.rs` so existing
command registration and tests retain one stable surface:

| Module | Owns |
| --- | --- |
| `store.rs` | save/conflict/lifecycle orchestration, atomic writes, watchers, and reexports |
| `store_types.rs` | shared state, IDs, errors, grants, and initialization |
| `store_workspace.rs` | workspace open/refresh, scan, tree, FTS indexing, and search |
| `store_documents.rs` | document open/read/render and document-record helpers |
| `store_assets.rs` | local/remote asset resolution, staging, and consolidation |
| `store_paths.rs` | native pickers, one-use path grants, and bounded imports |
| `store_recovery.rs` | recovery snapshot save, list, restore, and discard |

The document open/read/render path is one blocking native worker transaction:
read bytes, decode authored format, render/sanitize, build the source map, and
return the document result. Do not reintroduce duplicate reads or a second
frontend render for the same accepted result.

## Revision and selection contract

Markdown source is authoritative and source maps are revision-bound. A mapping
is usable only when its source text, map, and source hash describe the same
rendered revision. Source-map ranges are end-exclusive byte ranges against the
exact authored source revision; UTF-16 editor offsets and CRLF conversion are
handled explicitly at the CodeMirror boundary.

Selection flow is symmetric:

1. A rendered text/object selection resolves through the current map to a
   source range, then updates CodeMirror and the rendered selection state from
   the same transaction.
2. A source selection queries the indexed map for overlapping owners and
   projects back to rendered text or a complete mapped object span.
3. A cross-block rendered drag remains a cross-block selection; it is not
   collapsed to the first object under the pointer.
4. Any stale source, map ID, hash, or revision is rejected rather than guessed.

Visual edits produce bounded source patches. Unrelated Markdown is never
reserialized from rendered HTML. Save, undo/redo, recovery, and external-change
handling operate on the same source/revision tuple.

## Performance invariants

- Render requests are latest-only per tab; pending work coalesces and stale
  completions cannot publish state.
- Large-source rendering uses the existing native worker and incremental block
  cache where its invalidation contract is valid; unsafe cases fall back to a
  complete render.
- Render snapshots are bounded by count and HTML size and reuse only already
  produced output.
- Source-map overlap queries reuse an index rather than scanning and sorting
  every mapped span for each selection event.
- Split-pane scroll synchronization is coalesced through animation frames;
  it does not run layout work for every intermediate event.
- Mermaid, Graphviz, CodeMirror, Mammoth, and other expensive optional paths
  remain lazy/on-demand. Optional chunks must not enter the startup graph.
- New extraction must not add a render, source serialization, filesystem read,
  observer, or reactive invalidation to the typing or selection hot path.

## IPC and security invariants

- After the initial native picker/startup boundary, the UI uses opaque document,
  workspace, and grant IDs rather than arbitrary filesystem paths.
- Rust revalidates workspace-relative paths, one-use grants, symlink/canonical
  boundaries, local assets, remote HTTP(S) destinations, redirects, and SVG
  content.
- Rendered HTML is sanitized and the webview has explicit Tauri capabilities
  and CSP; untrusted Markdown remains inert.
- Tauri command names are compatibility contracts. Refactors may move command
  implementations, but must preserve command names, argument meaning, and
  result shape unless a migration is explicitly approved.

## Refactor policy

The safe order for reducing large files is:

1. extract pure types/transitions and add focused tests;
2. extract one cohesive native domain while preserving command attributes and
   crate-local reexports;
3. extract one callback-bounded frontend controller while preserving the
   shell's state authority;
4. run `pnpm check`, focused tests, the full frontend suite, native formatting,
   Clippy, native tests, production build, and the relevant packaged smoke;
5. update this document and `MEMORY.md` with the new owner and evidence.

Avoid arbitrary line-count-driven wrappers. A module is justified when it has
one cohesive responsibility, a stable input/output boundary, and tests or
runtime evidence that demonstrate it did not duplicate work.

<!-- BEGIN GENERATED FILE INVENTORY -->
## Cold-start file inventory

This section is generated by `pnpm architecture:refresh` and validated by
`pnpm architecture:check`. It intentionally excludes this document itself,
generated output, dependency trees, and build artifacts. Bytes are raw UTF-8
file sizes; lines are logical source lines with a terminal newline excluded.
Refresh it after source or documentation changes so cold models can trust the
routing table below.

Inventory totals: 245 files / 49,783 lines / 2,013,067 B. Runtime (excluding this generator): 152 files / 29,469 lines / 1,216,866 B. Tests/benchmarks: 68 files / 6,028 lines / 240,956 B.

### Read first

| Priority | File | Why it matters |
| ---: | --- | --- |
| 1 | `AGENTS.md` → `ARCHITECTURE.md` → `README.md` | Operating contract, stable ownership map, and user/developer workflow. |
| 2 | `src/App.svelte` → `src/components/DocumentSurface.svelte` | Shell state authority and the two-pane document surface. |
| 3 | `src/lib/document-revision.ts` → `src/lib/selection-bridge.ts` → `src/lib/source-map.ts` | Exact revision-bound selection and source-coordinate contract. |
| 4 | `src/lib/render-controller.ts` → `src/lib/rendered-snapshot-cache.ts` → `src/lib/latest-task-queue.ts` | Render coalescing, stale-result protection, and bounded reuse. |
| 5 | `src-tauri/src/lib.rs` → `src-tauri/src/store.rs` → `src-tauri/src/markdown.rs` → `src-tauri/src/security.rs` | IPC registration, persistence, rendering, and native security boundaries. |
| 6 | `src-tauri/src/store_*.rs` → `src-tauri/src/source_format.rs` → `src-tauri/src/markdown_source_map.rs` | Native domain ownership and authored-source preservation. |

### Largest maintained runtime files

| File | Lines | Bytes | Summary |
| --- | ---: | ---: | --- |
| `src/App.svelte` | 3,826 | 168,764 B | Stateful shell authority for tabs, modes, selection, lifecycle, commands, conflicts, recovery, and UI orchestration. |
| `src/components/MarkdownView.svelte` | 2,303 | 102,612 B | Rendered Markdown DOM, mapped selection, visual editing, drag/drop, and rich-content enhancement lifecycle. |
| `src-tauri/src/markdown.rs` | 1,645 | 60,707 B | Comrak rendering, sanitization, diagnostics, metadata, and render orchestration. |
| `src/lib/source-map.ts` | 826 | 34,452 B | Source-map range ownership, byte/character conversion, and mapped selection resolution. |
| `src/styles/app-shell.css` | 298 | 33,538 B | Application shell layout, panes, toolbar, tabs, dialogs, menus, and shared visual tokens. |
| `src-tauri/src/store.rs` | 928 | 33,171 B | Save, conflict, watcher, atomic-write, lifecycle orchestration, and domain reexports. |
| `src-tauri/src/markdown_source_map.rs` | 903 | 32,478 B | Source-map construction, byte ranges, mapped HTML metadata, and coordinate helpers. |
| `src-tauri/src/assistant.rs` | 940 | 31,045 B | Deferred assistant/provider boundary and local provider lifecycle types. |
| `src/components/EditorRibbon.svelte` | 484 | 28,909 B | Editing ribbon actions for formatting, insertion, block movement, and review controls. |
| `src-tauri/src/store_documents.rs` | 698 | 22,891 B | Document open/read/render and document record/recovery helpers. |
| `src-tauri/src/store_assets.rs` | 616 | 22,768 B | Asset resolution, staging, safe copy/link, and consolidation commands. |
| `src/components/AssistantPanel.svelte` | 360 | 19,409 B | Deferred assistant surface and provider-status UI; no provider calls by default. |

### Frontend UI, components, and styles

Start with `App.svelte` for state ownership, then move to the focused component or stylesheet named by the behavior under investigation.

| File | Lines | Bytes | Summary |
| --- | ---: | ---: | --- |
| `src/App.svelte` | 3,826 | 168,764 B | Stateful shell authority for tabs, modes, selection, lifecycle, commands, conflicts, recovery, and UI orchestration. |
| `src/components/AppToolbar.svelte` | 52 | 2,091 B | Top application toolbar, document identity, navigation, and primary actions. |
| `src/components/AssistantPanel.svelte` | 360 | 19,409 B | Deferred assistant surface and provider-status UI; no provider calls by default. |
| `src/components/CommandPalette.svelte` | 29 | 1,585 B | Command-palette dialog and filtered command presentation. |
| `src/components/ContextMenu.svelte` | 139 | 7,709 B | Themed rendered/source context menu surface. |
| `src/components/DocumentSurface.svelte` | 216 | 12,290 B | Composes rendered document and lazy source-editor panes with shared selection callbacks. |
| `src/components/DocumentTabs.svelte` | 37 | 1,344 B | Document tab strip, active state, close affordances, and tab navigation events. |
| `src/components/EditorRibbon.svelte` | 484 | 28,909 B | Editing ribbon actions for formatting, insertion, block movement, and review controls. |
| `src/components/FileTree.svelte` | 28 | 1,363 B | Accessible bounded workspace file-tree rendering. |
| `src/components/InspectorSidebar.svelte` | 78 | 6,028 B | Outline, links, issues, and properties inspector panels. |
| `src/components/MarkdownEditor.svelte` | 329 | 15,108 B | Lazy CodeMirror adapter with source changes, selections, Find, and coordinate conversion. |
| `src/components/MarkdownView.svelte` | 2,303 | 102,612 B | Rendered Markdown DOM, mapped selection, visual editing, drag/drop, and rich-content enhancement lifecycle. |
| `src/components/RecentDocuments.svelte` | 47 | 1,889 B | Recent-document list and removal/open actions. |
| `src/components/RibbonOverflowMenu.svelte` | 33 | 867 B | Overflow menu for ribbon actions that do not fit the available width. |
| `src/components/SettingsModal.svelte` | 63 | 5,189 B | Settings dialog for profile, compatibility, editing, assets, and application preferences. |
| `src/components/UpdateBanner.svelte` | 21 | 805 B | Signed-update status and install confirmation banner. |
| `src/components/WorkspaceSidebar.svelte` | 122 | 6,461 B | Workspace open/scan controls, recent documents, search, and file navigation sidebar. |
| `src/main.ts` | 7 | 178 B | Svelte/Tauri application bootstrap and root mount. |
| `src/styles.css` | 15 | 567 B | Global style entry point importing the split stylesheet modules. |
| `src/styles/app-shell.css` | 298 | 33,538 B | Application shell layout, panes, toolbar, tabs, dialogs, menus, and shared visual tokens. |
| `src/styles/assistant-panel.css` | 40 | 4,140 B | Assistant panel styling. |
| `src/styles/editor-ribbon.css` | 38 | 4,094 B | Editor ribbon and formatting control styling. |
| `src/styles/file-tree.css` | 9 | 843 B | Workspace file-tree styling. |
| `src/styles/inspector.css` | 6 | 270 B | Inspector sidebar styling. |
| `src/styles/markdown-editor.css` | 11 | 1,131 B | CodeMirror/source-editor styling. |
| `src/styles/markdown-view.css` | 84 | 10,593 B | Rendered Markdown, mapped decorations, visual editing, and rich-content styling. |
| `src/styles/recent-documents.css` | 13 | 1,567 B | Recent-document list styling. |
| `src/styles/ribbon-overflow.css` | 12 | 1,571 B | Ribbon overflow menu styling. |
| `src/styles/update-banner.css` | 5 | 493 B | Update banner styling. |
| `src/vite-env.d.ts` | 11 | 265 B | Vite environment and asset type declarations. |

### Frontend libraries and contracts

These modules are the preferred home for pure transitions, source-coordinate rules, bounded queues, and testable browser adapters.

| File | Lines | Bytes | Summary |
| --- | ---: | ---: | --- |
| `src/lib/acceptance-app-support.ts` | 87 | 3,747 B | Shared app-facing callbacks and helpers used by packaged acceptance probes. |
| `src/lib/acceptance-app.ts` | 186 | 8,133 B | Acceptance-probe orchestration through the real application shell. |
| `src/lib/acceptance-bridge.ts` | 323 | 13,382 B | Browser/native acceptance bridge and deterministic probe state. |
| `src/lib/acceptance-input.ts` | 53 | 2,381 B | Synthetic keyboard, pointer, composition, and DOM input helpers. |
| `src/lib/acceptance-runner-types.ts` | 11 | 316 B | Types shared by acceptance runners and probe steps. |
| `src/lib/acceptance-runner.ts` | 146 | 6,252 B | Reusable acceptance step runner and reporting. |
| `src/lib/acceptance-selection.ts` | 254 | 9,453 B | Selection-specific acceptance probes and exact source/render assertions. |
| `src/lib/app-settings.ts` | 168 | 6,102 B | Typed persisted application settings with native and browser fallback boundaries. |
| `src/lib/app-shell.ts` | 79 | 2,849 B | Shared shell contracts, tab construction, and source-map selection helpers. |
| `src/lib/app-utils.ts` | 29 | 1,169 B | Cross-platform Markdown association/path helpers and safe export escaping. |
| `src/lib/asset-drop.ts` | 29 | 1,101 B | Pure planning for dropped-asset insertion and grant handling. |
| `src/lib/asset-path.ts` | 25 | 1,068 B | Asset-folder normalization and safe relative asset path helpers. |
| `src/lib/assistant-settings.ts` | 80 | 2,906 B | Assistant preference types and persisted setting helpers. |
| `src/lib/block-move.ts` | 240 | 9,154 B | Source-preserving mapped block movement and valid target calculation. |
| `src/lib/block-selection.ts` | 67 | 2,087 B | Rendered block selection and source-span selection helpers. |
| `src/lib/browser-settings.ts` | 21 | 683 B | Safe local browser-preview setting persistence. |
| `src/lib/clipboard.ts` | 8 | 335 B | Lazy clipboard conversion boundary for HTML, text, and image data. |
| `src/lib/compatibility.ts` | 47 | 1,628 B | Compatibility-target issue filtering and calm status summaries. |
| `src/lib/context-copy.ts` | 33 | 1,328 B | Context-menu copy resolution for rendered, source, and complete-document content. |
| `src/lib/details-edit.ts` | 65 | 2,431 B | Safe source patching for HTML details-summary visual edits. |
| `src/lib/document-diagnostics.ts` | 14 | 621 B | Merge and freshness helpers for filesystem/reference diagnostics. |
| `src/lib/document-metrics.ts` | 29 | 760 B | Bounded document size, line, and character metrics. |
| `src/lib/document-revision.ts` | 146 | 5,500 B | Source/render revision tuple, mapping-source selection, and stale-map guards. |
| `src/lib/document-tab-revision.ts` | 121 | 3,857 B | Pure tab transitions for source edits, render completion, snapshots, and visual history. |
| `src/lib/fence.ts` | 81 | 3,261 B | Fenced-code context and body extraction helpers. |
| `src/lib/find.ts` | 153 | 6,428 B | Document Find matching and source-map projection to rendered IDs. |
| `src/lib/formatting.ts` | 176 | 6,359 B | Source-range formatting actions and bounded text-edit results. |
| `src/lib/html-sub-spans.ts` | 230 | 8,936 B | Source-aware HTML sub-span extraction for mapped rendered content. |
| `src/lib/inserts.ts` | 341 | 14,482 B | Source-preserving Markdown insertion, image, heading, and block helpers. |
| `src/lib/invoke-error.ts` | 72 | 2,248 B | Typed normalization of Tauri invoke errors and scan-depth input. |
| `src/lib/ipc.ts` | 290 | 9,928 B | Typed frontend/native command wrappers and opaque grant/document boundaries. |
| `src/lib/latest-task-queue.ts` | 36 | 1,132 B | Single-flight latest-request queue with stale-key invalidation. |
| `src/lib/line-ending-coords.ts` | 114 | 3,639 B | CRLF/LF and UTF-16/UTF-8 coordinate conversion at the editor boundary. |
| `src/lib/markdown-profile.ts` | 33 | 1,345 B | Markdown profile and diagram capability policy. |
| `src/lib/markdown-tooltip.ts` | 35 | 1,724 B | Delayed accessible tooltip state and content helpers. |
| `src/lib/markdown-view-block-editing.ts` | 259 | 10,943 B | Rendered block editing and source-patch adapters. |
| `src/lib/markdown-view-decoration.ts` | 79 | 3,401 B | Rendered selection, hover, and mapped DOM decoration helpers. |
| `src/lib/markdown-view-dom-commit.ts` | 134 | 5,618 B | Guarded full and incremental rendered DOM commit planning. |
| `src/lib/markdown-view-dom.ts` | 284 | 11,540 B | Rendered DOM lookup, mapping, selection, and coordinate helpers. |
| `src/lib/markdown-view-insertion.ts` | 131 | 5,331 B | Rendered insertion-zone and visual insertion behavior. |
| `src/lib/markdown-view-render.ts` | 161 | 6,326 B | Rendered view enhancement/render adapter orchestration. |
| `src/lib/markdown-view-rich-content.ts` | 129 | 5,635 B | Lazy image, diagram, math, and rich-content enhancement. |
| `src/lib/markdown-view-visual-editing.ts` | 211 | 7,357 B | Visual-edit lifecycle, caret, composition, and source-patch callbacks. |
| `src/lib/mermaid-runtime.ts` | 8 | 263 B | Lazy Mermaid runtime facade used by the optional renderer build. |
| `src/lib/pane-scroll-sync.ts` | 93 | 3,539 B | Two-pane line/marker alignment after coalesced selection-driven scroll. |
| `src/lib/paste.ts` | 227 | 9,260 B | Semantic clipboard/import conversion and safe Markdown normalization. |
| `src/lib/performance.ts` | 116 | 3,382 B | Opt-in low-overhead counters and timing spans without source/path recording. |
| `src/lib/recent-documents.ts` | 40 | 1,549 B | Bounded recent-path normalization and recency ordering. |
| `src/lib/render-controller.ts` | 185 | 6,997 B | Render generations, latest-only coalescing, debounce, stale guards, snapshots, and recovery callbacks. |
| `src/lib/render-guard.ts` | 9 | 329 B | Pure source/generation equality guard for accepted render results. |
| `src/lib/rendered-pane-contract.ts` | 41 | 1,292 B | Rendered-pane editing and interaction contract helpers. |
| `src/lib/rendered-snapshot-cache.ts` | 78 | 2,473 B | Bounded reuse/restoration of already-produced rendered snapshots. |
| `src/lib/rich-visual-edit.ts` | 180 | 7,425 B | Rich rendered element visual-edit planning and source replacement. |
| `src/lib/safe-image.ts` | 48 | 1,813 B | Safe image source and rendered-image policy helpers. |
| `src/lib/selection-bridge.ts` | 58 | 2,105 B | Exact bidirectional rendered/source selection projection against current maps. |
| `src/lib/selection-highlight.ts` | 40 | 1,746 B | Non-mutating rendered text-range highlighting with safe fallback. |
| `src/lib/slash.ts` | 162 | 7,509 B | Slash-command availability, parsing, and source insertion helpers. |
| `src/lib/source-context.ts` | 121 | 4,962 B | Source-editor context target and map lookup helpers. |
| `src/lib/source-history.ts` | 50 | 1,408 B | Bounded source undo/redo history entries and append logic. |
| `src/lib/source-map.ts` | 826 | 34,452 B | Source-map range ownership, byte/character conversion, and mapped selection resolution. |
| `src/lib/source-patch.ts` | 109 | 4,113 B | Validated source-range patch application without whole-document reserialization. |
| `src/lib/source-selection-index.ts` | 229 | 8,601 B | Indexed source-map overlap queries for repeated selection projection. |
| `src/lib/source-sync.ts` | 90 | 3,341 B | CodeMirror change-range synchronization into authoritative source text. |
| `src/lib/tab-history.ts` | 13 | 531 B | Pure back/forward tab-history removal and replacement. |
| `src/lib/table-edit.ts` | 328 | 13,480 B | Safe GFM table selection context and source-preserving table edits. |
| `src/lib/toc.ts` | 142 | 4,923 B | Table-of-contents heading tree construction. |
| `src/lib/types.ts` | 229 | 4,760 B | Shared frontend IPC, document, rendering, workspace, and diagnostics types. |
| `src/lib/updater.ts` | 198 | 6,455 B | Signed updater state, notes, banner policy, and install lifecycle helpers. |
| `src/lib/view-mode.ts` | 24 | 690 B | View-mode visibility and effective-mode transitions. |
| `src/lib/visual-draft.ts` | 25 | 980 B | Visual draft state and bounded draft source patch helpers. |
| `src/lib/visual-edit.ts` | 75 | 3,719 B | Simple rendered block edit classification and Markdown serialization. |
| `src/lib/visual-structure.ts` | 323 | 13,611 B | Mapped heading/list/table structure editing patches. |

### Native Rust core

Rust owns filesystem, security, decoding, rendering, persistence, workspace indexing, and native integration. `store.rs` reexports the split store domains.

| File | Lines | Bytes | Summary |
| --- | ---: | ---: | --- |
| `src-tauri/src/acceptance.rs` | 46 | 1,739 B | Native acceptance fixture setup and probe command boundary. |
| `src-tauri/src/asset_ops.rs` | 330 | 11,680 B | Native local/remote asset validation and filesystem operations. |
| `src-tauri/src/assistant.rs` | 940 | 31,045 B | Deferred assistant/provider boundary and local provider lifecycle types. |
| `src-tauri/src/default_app.rs` | 435 | 14,732 B | Platform default-Markdown-application detection and registration helpers. |
| `src-tauri/src/document_lint.rs` | 34 | 1,220 B | Filesystem/reference linting independent from the expensive render path. |
| `src-tauri/src/github_host_oracle.rs` | 123 | 4,324 B | GitHub README compatibility fixture/oracle implementation. |
| `src-tauri/src/lib.rs` | 207 | 8,429 B | Tauri builder, plugin order, menus, command registration, and app lifecycle. |
| `src-tauri/src/main.rs` | 6 | 195 B | Native process entry point delegating to the Tauri library. |
| `src-tauri/src/markdown.rs` | 1,645 | 60,707 B | Comrak rendering, sanitization, diagnostics, metadata, and render orchestration. |
| `src-tauri/src/markdown_incremental.rs` | 445 | 15,009 B | Incremental Markdown block-cache invalidation and partial render planning. |
| `src-tauri/src/markdown_source_map.rs` | 903 | 32,478 B | Source-map construction, byte ranges, mapped HTML metadata, and coordinate helpers. |
| `src-tauri/src/model.rs` | 230 | 6,152 B | Shared native data models serialized across IPC. |
| `src-tauri/src/performance.rs` | 35 | 1,146 B | Opt-in native performance measurement commands. |
| `src-tauri/src/phase0_benchmark.rs` | 145 | 5,768 B | Native Phase 0 render/index benchmark harness. |
| `src-tauri/src/security.rs` | 200 | 7,677 B | Canonical path, grant, URL, asset, SVG, and capability security boundary. |
| `src-tauri/src/source_format.rs` | 206 | 6,568 B | Encoding, BOM, line-ending, final-newline, and atomic source-format preservation. |
| `src-tauri/src/store.rs` | 928 | 33,171 B | Save, conflict, watcher, atomic-write, lifecycle orchestration, and domain reexports. |
| `src-tauri/src/store_assets.rs` | 616 | 22,768 B | Asset resolution, staging, safe copy/link, and consolidation commands. |
| `src-tauri/src/store_documents.rs` | 698 | 22,891 B | Document open/read/render and document record/recovery helpers. |
| `src-tauri/src/store_paths.rs` | 379 | 11,970 B | Native pickers, one-use path grants, and bounded import reads. |
| `src-tauri/src/store_recovery.rs` | 216 | 7,319 B | Recovery snapshot save, list, restore, and discard lifecycle. |
| `src-tauri/src/store_types.rs` | 157 | 4,311 B | Native shared state, identifiers, errors, grants, and initialization. |
| `src-tauri/src/store_workspace.rs` | 325 | 11,528 B | Workspace open/refresh, indexing, search, scan depth, and tree commands. |
| `src-tauri/src/workspace_scan.rs` | 483 | 17,321 B | Bounded workspace traversal and Markdown descendant tree construction. |

### Maintenance, build, and acceptance scripts

Use these scripts through the package commands documented in `README.md`; they are project-scoped and should preserve dry-run/apply boundaries.

| File | Lines | Bytes | Summary |
| --- | ---: | ---: | --- |
| `scripts/accessibility_audit.mjs` | 118 | 4,346 B | Static accessibility and capability audit used by verification. |
| `scripts/align-typescript.mjs` | 14 | 971 B | Keeps supported TypeScript package lines aligned with the Svelte toolchain. |
| `scripts/architecture_inventory.mjs` | 379 | 27,664 B | Generates and checks this architecture file inventory from the current tree. |
| `scripts/build_app.mjs` | 144 | 6,309 B | Stages platform-specific portable and installable application artifacts. |
| `scripts/build_optional_renderers.mjs` | 47 | 1,656 B | Builds Mermaid and other optional renderer assets outside the startup graph. |
| `scripts/full_upgrade.mjs` | 90 | 5,516 B | Runs the explicit reversible stable dependency/toolchain/CI upgrade workflow. |
| `scripts/generate_github_fixtures.mjs` | 12 | 428 B | Generates pinned GitHub README compatibility fixtures. |
| `scripts/github_host_oracle.mjs` | 29 | 1,042 B | Runs the GitHub-host fixture/oracle verification command. |
| `scripts/native_smoke.mjs` | 111 | 6,352 B | Runs native command and packaged-runtime smoke checks. |
| `scripts/normalize-workflow-comments.mjs` | 16 | 671 B | Normalizes workflow comments used by upgrade maintenance. |
| `scripts/optional_renderer_smoke.mjs` | 74 | 3,070 B | Verifies optional renderer assets produce bounded SVG output. |
| `scripts/packaged_acceptance.mjs` | 135 | 4,938 B | Launches the release binary and exercises real WebView acceptance flows. |
| `scripts/phase0_baseline.mjs` | 80 | 2,469 B | Runs Phase 0/1 frontend and native performance baseline probes. |
| `scripts/purge_build_environment.mjs` | 199 | 7,502 B | Safely purges project build output and optionally rebuilds within existing ranges. |
| `scripts/render_commit_benchmark.mjs` | 22 | 737 B | Runs the opt-in rendered DOM commit benchmark. |
| `scripts/report-upgrade-limits.mjs` | 13 | 1,031 B | Reports unresolved upstream upgrade constraints and dependency limits. |
| `scripts/selection_acceptance.mjs` | 54 | 1,662 B | Runs source/render selection contract acceptance suites. |
| `scripts/sync-rust-minimum.mjs` | 11 | 845 B | Synchronizes the Rust manifest minimum with the selected stable toolchain. |
| `scripts/uninstall_smoke.mjs` | 204 | 9,087 B | Verifies installer uninstall cleanup on supported package paths. |
| `scripts/updater_config_audit.mjs` | 89 | 5,282 B | Audits updater metadata, signatures, URLs, and release configuration. |
| `scripts/upgrade-plan.mjs` | 66 | 3,141 B | Builds the reviewed dependency/toolchain upgrade plan. |
| `scripts/upgrade-process.mjs` | 23 | 1,150 B | Executes one resumable upgrade process step. |
| `scripts/upgrade-snapshot.mjs` | 56 | 2,714 B | Creates/restores project metadata snapshots for upgrade rollback. |
| `scripts/verify-toolchains.mjs` | 18 | 1,165 B | Checks Node, pnpm, Rust, Cargo, and required toolchain compatibility. |
| `scripts/verify_dependencies.mjs` | 37 | 1,587 B | Runs the project dependency, security, build, accessibility, and native gates. |
| `scripts/visual_acceptance.mjs` | 77 | 2,555 B | Runs curated visual-editor unit/integration acceptance suites. |
| `scripts/workflow-comments.mjs` | 5 | 235 B | Maintains stable comments and metadata in GitHub workflows. |

### Tests and benchmarks

Test filenames map directly to the production contract they exercise. Benchmark files are opt-in and do not run in the normal suite.

| File | Lines | Bytes | Summary |
| --- | ---: | ---: | --- |
| `scripts/upgrade.test.mjs` | 106 | 6,549 B | Focused regression tests for upgrade. |
| `src/App.test.ts` | 39 | 1,639 B | Focused regression tests for App. |
| `src/components/ContextMenu.test.ts` | 106 | 3,982 B | Focused regression tests for ContextMenu. |
| `src/components/EditorRibbon.test.ts` | 70 | 2,717 B | Focused regression tests for EditorRibbon. |
| `src/components/MarkdownView.test.ts` | 1,686 | 59,467 B | Focused regression tests for MarkdownView. |
| `src/lib/acceptance-bridge.test.ts` | 96 | 3,706 B | Focused regression tests for acceptance bridge. |
| `src/lib/acceptance-selection.test.ts` | 53 | 2,255 B | Focused regression tests for acceptance selection. |
| `src/lib/app-settings.test.ts` | 54 | 1,870 B | Focused regression tests for app settings. |
| `src/lib/app-utils.test.ts` | 25 | 1,169 B | Focused regression tests for app utils. |
| `src/lib/asset-drop.test.ts` | 34 | 966 B | Focused regression tests for asset drop. |
| `src/lib/asset-path.test.ts` | 28 | 1,214 B | Focused regression tests for asset path. |
| `src/lib/assistant-settings.test.ts` | 22 | 776 B | Focused regression tests for assistant settings. |
| `src/lib/block-move.test.ts` | 161 | 6,482 B | Focused regression tests for block move. |
| `src/lib/block-selection.test.ts` | 30 | 1,445 B | Focused regression tests for block selection. |
| `src/lib/browser-settings.test.ts` | 27 | 910 B | Focused regression tests for browser settings. |
| `src/lib/compatibility.test.ts` | 27 | 1,442 B | Focused regression tests for compatibility. |
| `src/lib/context-copy.test.ts` | 33 | 1,076 B | Focused regression tests for context copy. |
| `src/lib/details-edit.test.ts` | 34 | 1,632 B | Focused regression tests for details edit. |
| `src/lib/document-diagnostics.test.ts` | 17 | 844 B | Focused regression tests for document diagnostics. |
| `src/lib/document-metrics.test.ts` | 12 | 429 B | Focused regression tests for document metrics. |
| `src/lib/document-revision.test.ts` | 95 | 3,202 B | Focused regression tests for document revision. |
| `src/lib/document-tab-revision.test.ts` | 129 | 4,250 B | Focused regression tests for document tab revision. |
| `src/lib/fence.test.ts` | 34 | 1,503 B | Focused regression tests for fence. |
| `src/lib/find.test.ts` | 123 | 5,202 B | Focused regression tests for find. |
| `src/lib/formatting.test.ts` | 52 | 2,514 B | Focused regression tests for formatting. |
| `src/lib/html-sub-spans.test.ts` | 85 | 3,727 B | Focused regression tests for html sub spans. |
| `src/lib/inserts.test.ts` | 149 | 7,437 B | Focused regression tests for inserts. |
| `src/lib/invoke-error.test.ts` | 49 | 1,470 B | Focused regression tests for invoke error. |
| `src/lib/latest-task-queue.test.ts` | 46 | 1,840 B | Focused regression tests for latest task queue. |
| `src/lib/line-ending-coords.codemirror.test.ts` | 35 | 1,282 B | Focused regression tests for line ending coords.codemirror. |
| `src/lib/line-ending-coords.test.ts` | 64 | 3,111 B | Focused regression tests for line ending coords. |
| `src/lib/markdown-profile.test.ts` | 19 | 1,105 B | Focused regression tests for markdown profile. |
| `src/lib/markdown-tooltip.test.ts` | 21 | 1,062 B | Focused regression tests for markdown tooltip. |
| `src/lib/markdown-view-dom-commit.benchmark.test.ts` | 72 | 2,628 B | Opt-in benchmark for markdown view dom commit. |
| `src/lib/markdown-view-dom-commit.test.ts` | 105 | 4,477 B | Focused regression tests for markdown view dom commit. |
| `src/lib/markdown-view-insertion.test.ts` | 47 | 1,964 B | Focused regression tests for markdown view insertion. |
| `src/lib/markdown-view-render.test.ts` | 73 | 3,011 B | Focused regression tests for markdown view render. |
| `src/lib/markdown-view-rich-content.test.ts` | 57 | 2,405 B | Focused regression tests for markdown view rich content. |
| `src/lib/markdown-view-visual-editing.test.ts` | 47 | 1,679 B | Focused regression tests for markdown view visual editing. |
| `src/lib/pane-scroll-sync.test.ts` | 30 | 1,299 B | Focused regression tests for pane scroll sync. |
| `src/lib/paste.test.ts` | 87 | 3,627 B | Focused regression tests for paste. |
| `src/lib/phase0-performance.test.ts` | 124 | 4,334 B | Focused regression tests for phase0 performance. |
| `src/lib/phase0-selection-contract.test.ts` | 105 | 4,962 B | Focused regression tests for phase0 selection contract. |
| `src/lib/recent-documents.test.ts` | 35 | 1,348 B | Focused regression tests for recent documents. |
| `src/lib/render-controller.test.ts` | 118 | 4,251 B | Focused regression tests for render controller. |
| `src/lib/render-guard.test.ts` | 10 | 425 B | Focused regression tests for render guard. |
| `src/lib/rendered-pane-contract.test.ts` | 21 | 891 B | Focused regression tests for rendered pane contract. |
| `src/lib/rendered-snapshot-cache.test.ts` | 86 | 3,062 B | Focused regression tests for rendered snapshot cache. |
| `src/lib/rich-visual-edit.test.ts` | 106 | 5,068 B | Focused regression tests for rich visual edit. |
| `src/lib/safe-image.test.ts` | 42 | 1,691 B | Focused regression tests for safe image. |
| `src/lib/selection-bridge.test.ts` | 73 | 2,354 B | Focused regression tests for selection bridge. |
| `src/lib/selection-highlight.test.ts` | 52 | 2,367 B | Focused regression tests for selection highlight. |
| `src/lib/slash.test.ts` | 41 | 2,327 B | Focused regression tests for slash. |
| `src/lib/source-context.test.ts` | 57 | 2,700 B | Focused regression tests for source context. |
| `src/lib/source-history.test.ts` | 47 | 2,276 B | Focused regression tests for source history. |
| `src/lib/source-map.test.ts` | 314 | 14,556 B | Focused regression tests for source map. |
| `src/lib/source-patch.test.ts` | 67 | 2,402 B | Focused regression tests for source patch. |
| `src/lib/source-selection-index.test.ts` | 76 | 3,289 B | Focused regression tests for source selection index. |
| `src/lib/source-sync.test.ts` | 62 | 2,037 B | Focused regression tests for source sync. |
| `src/lib/tab-history.test.ts` | 20 | 789 B | Focused regression tests for tab history. |
| `src/lib/table-edit.test.ts` | 92 | 4,938 B | Focused regression tests for table edit. |
| `src/lib/toc.test.ts` | 33 | 1,646 B | Focused regression tests for toc. |
| `src/lib/types.test.ts` | 9 | 290 B | Focused regression tests for types. |
| `src/lib/updater.test.ts` | 130 | 5,344 B | Focused regression tests for updater. |
| `src/lib/view-mode.test.ts` | 21 | 1,008 B | Focused regression tests for view mode. |
| `src/lib/visual-draft.test.ts` | 31 | 784 B | Focused regression tests for visual draft. |
| `src/lib/visual-edit.test.ts` | 58 | 2,790 B | Focused regression tests for visual edit. |
| `src/lib/visual-structure.test.ts` | 119 | 3,662 B | Focused regression tests for visual structure. |

### Configuration, workflows, and project documents

These files define toolchains, dependency graphs, packaging, permissions, CI, and the human-facing project contract.

| File | Lines | Bytes | Summary |
| --- | ---: | ---: | --- |
| `.github/workflows/ci.yml` | 162 | 4,614 B | Quality, security, cross-platform build, and test automation. |
| `.github/workflows/release.yml` | 479 | 24,928 B | Signed six-family release build, publication, and post-publication verification. |
| `.gitignore` | 81 | 1,061 B | Generated output, local credentials, runtime state, and continuity-file boundaries. |
| `AGENTS.md` | 86 | 6,931 B | Repository operating contract, invariants, required workflows, and safety boundaries. |
| `IMPLEMENTATION_STATUS.md` | 726 | 56,293 B | Current implementation checkpoint and evidence summary. |
| `LICENSE` | 21 | 1,086 B | MIT license text. |
| `MEMORY.md` | 667 | 80,073 B | Local continuity record of architecture decisions, validation, risks, and next actions. |
| `README.md` | 391 | 26,461 B | Published user/developer guide for installation, usage, commands, releases, and limitations. |
| `SECURITY.md` | 52 | 3,567 B | Security model, audit findings, upstream advisories, and unresolved platform boundaries. |
| `docs/PHASE-0-PERFORMANCE.md` | 137 | 6,049 B | Phase 0 performance matrix, baseline, budgets, and evidence limits. |
| `docs/PHASE-1-PERFORMANCE.md` | 122 | 6,830 B | Phase 1 optimization results, deltas, and remaining packaged gates. |
| `mobile_todo.md` | 148 | 7,234 B | Android/mobile product contract, workstreams, non-goals, and acceptance gates. |
| `package.json` | 107 | 4,464 B | Frontend package metadata, dependency versions, and maintenance/build scripts. |
| `pnpm-lock.yaml` | 4,045 | 133,883 B | Resolved JavaScript dependency graph. |
| `pnpm-workspace.yaml` | 4 | 70 B | pnpm workspace and build-approval configuration. |
| `rust-toolchain.toml` | 6 | 238 B | Stable Rust channel and rustfmt/Clippy component selection. |
| `src-tauri/Cargo.lock` | 6,396 | 155,125 B | Resolved Rust dependency graph. |
| `src-tauri/Cargo.toml` | 53 | 1,861 B | Rust package metadata, compiler floor, Tauri dependencies, and native features. |
| `src-tauri/capabilities/default.json` | 15 | 362 B | Explicit webview permissions and command capabilities. |
| `src-tauri/tauri.conf.json` | 100 | 3,202 B | Default Tauri window, bundle, CSP, file association, and updater configuration. |
| `src-tauri/tauri.release.conf.json` | 6 | 113 B | Release-only signing and updater overlay configuration. |
| `tsconfig.json` | 18 | 519 B | TypeScript compiler configuration for Svelte and native-aligned types. |
| `vite.config.ts` | 64 | 1,986 B | Vite/Rolldown entry, lazy chunk, alias, and production build configuration. |
| `vitest.config.ts` | 21 | 631 B | Vitest environment, pooling, timeout, and test-discovery configuration. |

### Inventory maintenance

- Run `pnpm architecture:check` in verification to fail on stale metrics or missing summaries.
- Run `pnpm architecture:refresh` after adding, removing, renaming, or materially resizing a maintained file.
- Add a curated summary to `scripts/architecture_inventory.mjs` when a new maintained file is introduced; do not accept an opaque fallback summary.
<!-- END GENERATED FILE INVENTORY -->

## Current architecture checkpoint

As of 2026-09-13, the native store domains and the frontend shell contracts,
snapshot cache, selection bridge, and render controller are separated. The
remaining large frontend surface is the stateful shell orchestration itself.
The next extraction should be chosen from a callback-bounded lifecycle domain
only after preserving the packaged bidirectional-selection and render-latency
evidence. Current local packaged evidence is Windows-specific and synthetic;
it does not certify target-OS input timing, accessibility, signing, or live
updater installation.
