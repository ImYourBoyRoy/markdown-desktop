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

### Persistence, media, and workspace lifecycle

`document-recovery-controller.ts` owns per-document serialized writes/clears
and a 750 ms first-change timer. Continuous input does not postpone protection
indefinitely. The shell drains pending saves, Save As operations, and recovery
before native shutdown approval; failures retain the live document. Confirmed
updater installation freezes editing and drains recovery before permitting its
installer/relaunch exit. Rust performs persistence, inspection, recovery, and
search work on workers. Recovery source retains its saved disk baseline.

`inert-media-html.ts` removes resource-bearing attributes before any preview
HTML is parsed or mounted. Only the active allowed enhancement may restore
them. `media-asset-cache.ts` coalesces requests, limits concurrency to four,
and bounds reuse to 16 entries / 8 MiB. History has a 128 MiB aggregate budget;
rendered snapshot retention counts source/maps/HTML with 32 MiB per-tab and
64 MiB global budgets. The editor ribbon remains lazy-loaded.

`media_stream.rs` owns opaque, document-scoped local video grants and rechecks
canonical containment on every GET/HEAD/range request. File size is capped at
2 GiB and individual range reads at 8 MiB. Grants are revoked on close; no
generic filesystem or HTTP API is exposed. Direct remote video remains a
bounded validated download. `reference_validation.rs` proves shared-definition
edits with Comrak before the frontend patches source.

The active workspace has one recursive native watcher and one coalesced index
worker. Closed-file changes refresh FTS, the visible tree, and indexed link
edges. Search uses source snippets and matching-line navigation. Backlinks are
resolved Markdown links in the workspace index, queried through opaque IDs.
Local link, image, video, lint, and backlink paths share one percent-decoding
and canonical authorization boundary in `asset_ops.rs`.

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
  shared interaction lifecycle for the current rendered revision. Its mapped
  block grip/delete/drag lifecycle is delegated to
  `markdown-view-block-controls.ts` through explicit source-authoritative
  callbacks.
- `MediaPreview.svelte` owns the display-only image/video/provider-embed/diagram
  lightbox, including focus, close, and bounded zoom behavior; it never edits
  source.
- `ReaderFullscreenBar.svelte` owns the renderer-focus controls and independent
  Files/Inspect sidebar toggles while `App.svelte` retains view-state authority.
- `MarkdownEditor.svelte` owns the lazy CodeMirror adapter and converts its
  line-ending coordinates at the editor boundary. Its source-selection bridge
  consumes only revision-current issue ranges; safe fix actions
  call back into the shell's source transaction rather than mutating CodeMirror
  as a second document authority.
- `WorkspaceSidebar.svelte`, `InspectorSidebar.svelte`, `DocumentTabs.svelte`,
  `AppToolbar.svelte`, and the modal/menu components own their local surface
  markup and accessibility behavior, not document authority.
- `EditorRibbon.svelte` owns the direct five-section editing navigation. Its
  command groups scroll independently on narrow windows while Save and Done
  remain in a fixed action rail; it does not maintain a second overflow tab
  model.

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
- `visual-text-transaction.ts` converts one contiguous visible-text change
  into a bounded Markdown-body transaction. Ordinary rendered typing uses the
  current source projection to preserve heading/list markers, inline marks,
  link destinations, entities, line endings, and untouched source bytes; it
  never serializes the rendered DOM back into a replacement document. The DOM
  is an input/projection surface only. Hard breaks, checkbox-state edits, and
  delimiter changes remain explicit conservative serializer fallbacks;
  ambiguous mappings are rejected and kept source-assisted.
- `rich-visual-edit.ts` is therefore a bounded fallback for the small set of
  DOM structures whose visible text alone cannot express the source edit. It
  is not the ordinary typing path and must remain scoped to one mapped block.
- `visual-editor-contract.ts` is the shared capability vocabulary for rendered
  text editing, property editing, movement, deletion, and source reveal. The
  ribbon, block controls, and source-only affordances must use this contract
  instead of independently guessing from a map kind.
- `image-editor.ts`, `link-editor.ts`, and `reference-editor.ts` own the safe
  property editors for direct inline objects, shared reference definitions,
  and constrained raw-HTML opening tags. Reference edits patch only the
  occurrence and its resolved definition; raw HTML edits touch only whitelisted
  `href`/`title` attributes and never serialize the nested body. Ordinary
  Markdown remains ordinary Markdown; explicit image sizing/alignment is
  represented as visible safe `<img>` attributes in profiles that support HTML
  extensions. Reference-image layout remains source-assisted because converting
  a shared definition to HTML would detach every other occurrence.
- `document-loading.ts` and `DocumentLoading.svelte` own the explicit opening
  and preview-mount phases for document navigation. The shell yields to a
  compositor frame before committing a large WebView tree, keeps the loading
  surface over the document pane while the first mapped revision mounts, and
  never presents a fabricated completion percentage.
- `large-document-mount.ts` owns the bounded WebView mount for large sanitized
  HTML revisions. It splits only trusted top-level fragments, appends bounded
  batches with compositor yields, aborts superseded revisions, and attaches
  the source map once after the complete fragment order is present. It does
  not create a second Markdown model or map each chunk independently.
- `source-completions.ts` is the bounded CodeMirror completion authority for
  recognizable Markdown contexts. It reuses the slash registry and accepts
  only the workspace-relative Markdown paths already exposed by the authorized
  workspace tree; it never scans arbitrary filesystem paths from the webview.
  Explicit empty-line snippets and Extended-profile HTML attributes are static,
  local options and do not invoke a language service.
- `document-diagnostics.ts` performs small local structural/accessibility checks
  during idle time and merges them with native filesystem/reference lint without
  replacing Rust's path/security authority. Diagnostics carry source offsets and
  current map IDs when the rendered revision is current; only fixes carrying the
  matching source hash can enter the shared source history.
- `spellcheck.ts` owns the local WebView spell-check preference and attributes.
  Source editing and the focused rendered prose block receive the platform
  dictionary hint; visual code surfaces explicitly opt out. No document text
  is sent to a provider by this layer.
- `project-links.ts` is the explicit HTTPS allowlist for About, author, and
  optional Venmo support actions; user-facing external actions do not accept
  arbitrary URLs from document content.
- `markdown-view-rich-content.ts` owns the lazy Mermaid/Graphviz/math pipeline
  and generation-guarded replacement refresh after asynchronous output.
- `media.ts` owns source-preserving local/direct/provider media insertion and
  strict provider URL normalization. `MarkdownView.svelte` resolves media near
  the viewport, delays the loading affordance to avoid flicker, and opens
  display-only previews without changing Markdown. Raw video/source and
  provider iframe objects remain mapped to exact source spans, including
  standard `<source>` children.
- `markdown-view-block-controls.ts` owns the non-contenteditable block-control
  layer: grip placement, pointer capture, lifted drag preview, vertical
  before/after target feedback, legacy native drag compatibility, keyboard
  movement, delete actions, and listener/observer teardown. It never mutates
  Markdown directly; the shell supplies guarded move/delete transactions.

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

Six-dot block handles and their adjacent delete actions belong to the dedicated
`src/lib/markdown-view-block-controls.ts` non-contenteditable control layer.
Handles track the active pointer from the window capture phase so
nested editor handlers cannot swallow movement or release events. The drop
target resolves through the current mapped DOM and a per-gesture block-bounds
snapshot when pointer capture or WebView hit-testing retargets the event; the
snapshot is refreshed on containing-scroll and resize events, not per pointer
move. Nearby whitespace can resolve to its nearest block. Drops are explicitly
vertical `before`/`after` operations; there is no misleading side-by-side edge
zone because arbitrary columns do not have a safe portable Markdown source
representation. A drop then uses
`src/lib/block-move.ts` to patch only safe mapped source ranges; opaque source
content crossed by the move remains a hard refusal, not content to relocate.
Delete uses the same current map/revision guard and removes only the selected
root block plus a safe adjacent whitespace gap, so undo restores the exact
source range and opaque Markdown is never crossed. Rendered insertion zones use
the same `slash.ts` command registry as CodeMirror, including dialog-backed
commands, and carry an explicit source caret so a command is inserted at the
visible gap rather than guessed at document end.

Visual edits produce bounded source patches. Unrelated Markdown is never
reserialized from rendered HTML. Inline source-map fallback attachment groups
links, images, and semantic marks by their nearest mapped block owner before
using a global order fallback, so repeated marks in separate blocks cannot
steal each other's IDs. Save, undo/redo, recovery, and external-change
handling operate on the same source/revision tuple. List indentation also
requires a real preceding compatible list line; Tab cannot manufacture a
visually indented line that Markdown would parse as an unrelated block.

The rendered editor is intentionally a structured projection rather than a
free-form HTML editor. Direct headings, paragraphs, leaf list items, supported
inline marks, table cells, task state, images, and details summaries have
  bounded visual transactions. Nested-list containers, unresolved references,
  arbitrary raw HTML, soft-wrap ambiguities, and syntax-heavy fences expose a
  clear source escape hatch. Resolved reference links/images and constrained
  raw-HTML link attributes are safe property transactions but not DOM
  reserialization surfaces. That boundary is a quality feature: a visual
  control that can silently flatten Markdown is worse than a source-assisted
  object that says exactly why it needs source editing.

## Performance invariants

- Render requests are latest-only per tab; pending work coalesces and stale
  completions cannot publish state.
- Large-source rendering uses the existing native worker and incremental block
  cache where its invalidation contract is valid; unsafe cases fall back to a
  complete render.
- Document navigation exposes a two-phase loading surface and yields before
  large source/HTML commits so native work and WebView mounting are visible as
  work rather than a frozen previous document. The loading state is generation-
  guarded so stale opens cannot dismiss a newer document's indicator.
- Large rendered HTML is mounted in bounded top-level fragment batches when it
  exceeds the size/block threshold. The browser yields between batches and
  source-map attachment runs once against the completed DOM, preserving global
  inline/raw-HTML mapping order. Reader-only large documents additionally use
  native `content-visibility: auto` containment on top-level blocks, reducing
  offscreen paint/layout work without removing mapped nodes. A single unusually
  large top-level block still uses the safe full parse path; a windowed DOM is
  intentionally outside the editable source-preserving editor contract.
- This remains progressive mounting rather than destructive virtualization. The
  current editor keeps the complete trusted DOM once mounted because source-map
  attachment, browser selection, contenteditable caret ownership, and
  cross-block drag geometry all depend on stable neighboring nodes. Reader mode
  uses browser-native containment instead of replacing offscreen blocks with
  guessed placeholders. Do not introduce a windowed DOM into the editing
  surface without scroll-anchor, selection, IME, drag, and source-projection
  acceptance evidence.
- Render snapshots are bounded by count and HTML size and reuse only already
  produced output.
- Source-map overlap queries reuse an index rather than scanning and sorting
  every mapped span for each selection event.
- Split-pane scroll synchronization is coalesced through animation frames;
  it does not run layout work for every intermediate event.
- Mermaid, Graphviz, CodeMirror, Mammoth, and other expensive optional paths
  remain lazy/on-demand. Optional chunks must not enter the startup graph.
- Video, provider embeds, diagrams, and math use near-viewport enhancement.
  Their loading affordance appears only after a short delay, so fast content
  does not flicker while slow optional work remains visibly in progress. Local
  and direct video reads stay bounded because the current native media bridge
  returns a validated data URI.
- Image and diagram previews reuse already-resolved/sanitized display data; they
  do not trigger a source read, serialization, or render. Mermaid diagrams use
  native SVG text so the sanitizer cannot remove labels as HTML `foreignObject`
  content.
- New extraction must not add a render, source serialization, filesystem read,
  observer, or reactive invalidation to the typing or selection hot path.

## IPC and security invariants

- After the initial native picker/startup boundary, the UI uses opaque document,
  workspace, and grant IDs rather than arbitrary filesystem paths.
- Rust revalidates workspace-relative paths, one-use grants, symlink/canonical
  boundaries, local assets, remote HTTP(S) destinations, redirects, and SVG
  content.
- Rendered HTML is sanitized and the webview has explicit Tauri capabilities
  and CSP; untrusted Markdown remains inert. Video/source elements are resolved
  only inside the authorized document/workspace and under a 32 MB limit.
  Provider iframes are restricted to HTTPS YouTube, Vimeo, and Google Drive
  embed origins; arbitrary frames are removed before HTML reaches the webview.
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

Inventory totals: 296 files / 58,481 lines / 2,345,320 B. Runtime (excluding this generator): 187 files / 36,847 lines / 1,533,548 B. Tests/benchmarks: 86 files / 7,763 lines / 314,482 B.

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
| `src/App.svelte` | 4,530 | 197,268 B | Stateful shell authority for tabs, modes, selection, lifecycle, commands, conflicts, recovery, and UI orchestration. |
| `src/components/MarkdownView.svelte` | 2,631 | 118,264 B | Rendered Markdown DOM, mapped selection, visual editing, drag/drop, and rich-content enhancement lifecycle. |
| `src-tauri/src/markdown.rs` | 1,674 | 62,047 B | Comrak rendering, sanitization, diagnostics, metadata, and render orchestration. |
| `src/lib/source-map.ts` | 983 | 41,494 B | Source-map range ownership, byte/character conversion, and mapped selection resolution. |
| `src/styles/app-shell.css` | 347 | 38,982 B | Application shell layout, panes, toolbar, tabs, dialogs, menus, and shared visual tokens. |
| `src-tauri/src/store.rs` | 1,068 | 38,125 B | Save, conflict, watcher, atomic-write, lifecycle orchestration, and domain reexports. |
| `src/components/EditorRibbon.svelte` | 612 | 36,440 B | Editing ribbon actions for formatting, insertion, block movement, and review controls. |
| `src-tauri/src/markdown_source_map.rs` | 906 | 32,607 B | Source-map construction, byte ranges, mapped HTML metadata, and coordinate helpers. |
| `src-tauri/src/assistant.rs` | 940 | 31,045 B | Deferred assistant/provider boundary and local provider lifecycle types. |
| `src-tauri/src/markdown_incremental.rs` | 773 | 27,316 B | Incremental Markdown block-cache invalidation and partial render planning. |
| `src-tauri/src/store_assets.rs` | 726 | 26,543 B | Asset resolution, staging, safe copy/link, and consolidation commands. |
| `src/lib/markdown-view-block-controls.ts` | 539 | 22,834 B | Rendered block grip, delete, drag-preview, keyboard-move, and drop-target lifecycle. |

### Frontend UI, components, and styles

Start with `App.svelte` for state ownership, then move to the focused component or stylesheet named by the behavior under investigation.

| File | Lines | Bytes | Summary |
| --- | ---: | ---: | --- |
| `src/App.svelte` | 4,530 | 197,268 B | Stateful shell authority for tabs, modes, selection, lifecycle, commands, conflicts, recovery, and UI orchestration. |
| `src/components/AppToolbar.svelte` | 52 | 2,320 B | Top application toolbar, document identity, navigation, and primary actions. |
| `src/components/AssistantPanel.svelte` | 360 | 19,409 B | Deferred assistant surface and provider-status UI; no provider calls by default. |
| `src/components/CommandPalette.svelte` | 29 | 1,585 B | Command-palette dialog and filtered command presentation. |
| `src/components/ContextMenu.svelte` | 139 | 7,709 B | Themed rendered/source context menu surface. |
| `src/components/DocumentLoading.svelte` | 22 | 1,045 B | Accessible two-phase document-open and preview-mount loading surface. |
| `src/components/DocumentSurface.svelte` | 250 | 14,259 B | Composes rendered document and lazy source-editor panes with shared selection callbacks. |
| `src/components/DocumentTabs.svelte` | 37 | 1,581 B | Document tab strip, active state, close affordances, and tab navigation events. |
| `src/components/EditorRibbon.svelte` | 612 | 36,440 B | Editing ribbon actions for formatting, insertion, block movement, and review controls. |
| `src/components/FileTree.svelte` | 28 | 1,336 B | Accessible bounded workspace file-tree rendering. |
| `src/components/InspectorSidebar.svelte` | 91 | 6,947 B | Outline, links, issues, and properties inspector panels. |
| `src/components/MarkdownEditor.svelte` | 386 | 18,094 B | Lazy CodeMirror adapter with source changes, selections, Find, and coordinate conversion. |
| `src/components/MarkdownView.svelte` | 2,631 | 118,264 B | Rendered Markdown DOM, mapped selection, visual editing, drag/drop, and rich-content enhancement lifecycle. |
| `src/components/MediaPreview.svelte` | 135 | 6,144 B | Accessible image, video, embed, and diagram lightbox with outside-click, Escape, close, and bounded zoom controls. |
| `src/components/ReaderFullscreenBar.svelte` | 29 | 1,000 B | Renderer-focused fullscreen controls with independent sidebar toggles and reversible exit. |
| `src/components/RecentDocuments.svelte` | 52 | 2,163 B | Recent-document list with per-item removal, clear-history, and open actions. |
| `src/components/SettingsModal.svelte` | 69 | 6,383 B | Settings dialog for profile, compatibility, editing, assets, and application preferences. |
| `src/components/UpdateBanner.svelte` | 21 | 785 B | Signed-update status and install confirmation banner. |
| `src/components/WorkspaceSidebar.svelte` | 134 | 7,497 B | Workspace open/scan controls, removable/clearable recent documents, search, and file navigation sidebar. |
| `src/main.ts` | 7 | 178 B | Svelte/Tauri application bootstrap and root mount. |
| `src/styles.css` | 16 | 607 B | Global style entry point importing the split stylesheet modules. |
| `src/styles/app-shell.css` | 347 | 38,982 B | Application shell layout, panes, toolbar, tabs, dialogs, menus, and shared visual tokens. |
| `src/styles/assistant-panel.css` | 40 | 4,140 B | Assistant panel styling. |
| `src/styles/editor-ribbon.css` | 73 | 7,504 B | Editor ribbon and formatting control styling. |
| `src/styles/file-tree.css` | 9 | 843 B | Workspace file-tree styling. |
| `src/styles/inspector.css` | 6 | 270 B | Inspector sidebar styling. |
| `src/styles/markdown-editor.css` | 12 | 1,216 B | CodeMirror/source-editor styling. |
| `src/styles/markdown-view.css` | 177 | 17,865 B | Rendered Markdown, mapped decorations, visual editing, and rich-content styling. |
| `src/styles/media-preview.css` | 33 | 4,286 B | Zoomable image, video, embed, and diagram preview dialog styling with responsive and reduced-motion behavior. |
| `src/styles/reader-fullscreen.css` | 23 | 2,027 B | Reader-focused fullscreen shell, sidebar controls, and responsive focus-bar styling. |
| `src/styles/recent-documents.css` | 17 | 1,950 B | Recent-document list styling. |
| `src/styles/update-banner.css` | 5 | 493 B | Update banner styling. |
| `src/vite-env.d.ts` | 11 | 265 B | Vite environment and asset type declarations. |

### Frontend libraries and contracts

These modules are the preferred home for pure transitions, source-coordinate rules, bounded queues, and testable browser adapters.

| File | Lines | Bytes | Summary |
| --- | ---: | ---: | --- |
| `src/lib/acceptance-app-support.ts` | 109 | 4,804 B | Shared app-facing callbacks and helpers used by packaged acceptance probes. |
| `src/lib/acceptance-app.ts` | 309 | 14,177 B | Acceptance-probe orchestration through the real application shell. |
| `src/lib/acceptance-bridge.ts` | 357 | 14,840 B | Browser/native acceptance bridge and deterministic probe state. |
| `src/lib/acceptance-input.ts` | 83 | 3,756 B | Synthetic keyboard, pointer, composition, and DOM input helpers. |
| `src/lib/acceptance-runner-types.ts` | 11 | 305 B | Types shared by acceptance runners and probe steps. |
| `src/lib/acceptance-runner.ts` | 167 | 7,252 B | Reusable acceptance step runner and reporting. |
| `src/lib/acceptance-selection.ts` | 272 | 10,401 B | Selection-specific acceptance probes and exact source/render assertions. |
| `src/lib/app-settings.ts` | 168 | 6,102 B | Typed persisted application settings with native and browser fallback boundaries. |
| `src/lib/app-shell.ts` | 79 | 2,849 B | Shared shell contracts, tab construction, and source-map selection helpers. |
| `src/lib/app-utils.ts` | 29 | 1,169 B | Cross-platform Markdown association/path helpers and safe export escaping. |
| `src/lib/asset-drop.ts` | 29 | 1,101 B | Pure planning for dropped-asset insertion and grant handling. |
| `src/lib/asset-path.ts` | 25 | 1,068 B | Asset-folder normalization and safe relative asset path helpers. |
| `src/lib/assistant-settings.ts` | 80 | 2,906 B | Assistant preference types and persisted setting helpers. |
| `src/lib/block-move.ts` | 280 | 10,429 B | Source-preserving mapped block movement and valid target calculation. |
| `src/lib/block-selection.ts` | 67 | 2,116 B | Rendered block selection and source-span selection helpers. |
| `src/lib/browser-settings.ts` | 21 | 683 B | Safe local browser-preview setting persistence. |
| `src/lib/clipboard.ts` | 8 | 335 B | Lazy clipboard conversion boundary for HTML, text, and image data. |
| `src/lib/compatibility.ts` | 47 | 1,628 B | Compatibility-target issue filtering and calm status summaries. |
| `src/lib/context-copy.ts` | 33 | 1,328 B | Context-menu copy resolution for rendered, source, and complete-document content. |
| `src/lib/details-edit.ts` | 65 | 2,431 B | Safe source patching for HTML details-summary visual edits. |
| `src/lib/document-diagnostics.ts` | 173 | 7,330 B | Idle-safe local Markdown diagnostics plus filesystem/reference issue merge helpers. |
| `src/lib/document-loading.ts` | 44 | 1,123 B | Generation-guarded loading phases and human-readable document-size formatting. |
| `src/lib/document-metrics.ts` | 29 | 760 B | Bounded document size, line, and character metrics. |
| `src/lib/document-recovery-controller.ts` | 67 | 2,114 B | Serialized, bounded-latency recovery snapshots and shutdown draining. |
| `src/lib/document-revision.ts` | 146 | 5,354 B | Source/render revision tuple, mapping-source selection, and stale-map guards. |
| `src/lib/document-tab-revision.ts` | 121 | 3,736 B | Pure tab transitions for source edits, render completion, snapshots, and visual history. |
| `src/lib/fence.ts` | 81 | 3,261 B | Fenced-code context and body extraction helpers. |
| `src/lib/find.ts` | 154 | 6,507 B | Document Find matching and source-map projection to rendered IDs. |
| `src/lib/formatting.ts` | 176 | 6,359 B | Source-range formatting actions and bounded text-edit results. |
| `src/lib/html-sub-spans.ts` | 250 | 9,736 B | Source-aware HTML sub-span extraction for mapped rendered content. |
| `src/lib/image-editor.ts` | 244 | 9,020 B | Source-preserving direct-image property parsing and safe layout serialization. |
| `src/lib/inert-media-html.ts` | 8 | 493 B | Deactivation of browser resource attributes before rendered HTML mounting. |
| `src/lib/inserts.ts` | 341 | 14,492 B | Source-preserving Markdown insertion, image, heading, and block helpers. |
| `src/lib/invoke-error.ts` | 72 | 2,248 B | Typed normalization of Tauri invoke errors and scan-depth input. |
| `src/lib/ipc.ts` | 309 | 10,561 B | Typed frontend/native command wrappers and opaque grant/document boundaries. |
| `src/lib/large-document-mount.ts` | 231 | 7,747 B | Bounded trusted-HTML fragment mounting with global source-map attachment. |
| `src/lib/latest-task-queue.ts` | 36 | 1,132 B | Single-flight latest-request queue with stale-key invalidation. |
| `src/lib/line-ending-coords.ts` | 114 | 3,639 B | CRLF/LF and UTF-16/UTF-8 coordinate conversion at the editor boundary. |
| `src/lib/link-editor.ts` | 130 | 4,401 B | Source-preserving direct, shared-reference, and constrained raw-HTML link property editing. |
| `src/lib/markdown-profile.ts` | 33 | 1,345 B | Markdown profile and diagram capability policy. |
| `src/lib/markdown-tooltip.ts` | 35 | 1,724 B | Delayed accessible tooltip state and content helpers. |
| `src/lib/markdown-view-block-controls.ts` | 539 | 22,834 B | Rendered block grip, delete, drag-preview, keyboard-move, and drop-target lifecycle. |
| `src/lib/markdown-view-block-editing.ts` | 266 | 11,275 B | Rendered block editing and source-patch adapters. |
| `src/lib/markdown-view-decoration.ts` | 85 | 3,754 B | Rendered selection, hover, and mapped DOM decoration helpers. |
| `src/lib/markdown-view-dom-commit.ts` | 258 | 12,103 B | Guarded full and incremental rendered DOM commit planning. |
| `src/lib/markdown-view-dom.ts` | 301 | 12,188 B | Rendered DOM lookup, mapping, selection, and coordinate helpers. |
| `src/lib/markdown-view-insertion.ts` | 210 | 8,686 B | Rendered insertion-zone and visual insertion behavior. |
| `src/lib/markdown-view-render.ts` | 161 | 6,326 B | Rendered view enhancement/render adapter orchestration. |
| `src/lib/markdown-view-rich-content.ts` | 215 | 9,615 B | Lazy image, diagram, math, and rich-content enhancement. |
| `src/lib/markdown-view-visual-editing.ts` | 215 | 7,502 B | Visual-edit lifecycle, caret, composition, and source-patch callbacks. |
| `src/lib/media-asset-cache.ts` | 44 | 1,869 B | Bounded media reuse with coalesced requests and retryable failures. |
| `src/lib/media-preview.ts` | 46 | 1,136 B | Display-only media preview types and bounded zoom-step helpers. |
| `src/lib/media.ts` | 145 | 5,802 B | Validated local/direct/provider media insertion, embed normalization, and source-safe reference policy. |
| `src/lib/mermaid-runtime.ts` | 8 | 263 B | Lazy Mermaid runtime facade used by the optional renderer build. |
| `src/lib/pane-scroll-sync.ts` | 93 | 3,533 B | Two-pane line/marker alignment after coalesced selection-driven scroll. |
| `src/lib/paste.ts` | 227 | 9,260 B | Semantic clipboard/import conversion and safe Markdown normalization. |
| `src/lib/performance.ts` | 116 | 3,382 B | Opt-in low-overhead counters and timing spans without source/path recording. |
| `src/lib/project-links.ts` | 9 | 352 B | Explicit HTTPS project, author, and Venmo links used by About/support actions. |
| `src/lib/recent-documents.ts` | 55 | 2,283 B | Bounded recent-path normalization, recency ordering, and safe history removal. |
| `src/lib/reference-editor.ts` | 251 | 9,621 B | Shared Markdown reference-definition discovery and bounded occurrence/definition transactions. |
| `src/lib/render-controller.ts` | 190 | 7,425 B | Render generations, latest-only coalescing, debounce, stale guards, snapshots, and recovery callbacks. |
| `src/lib/render-guard.ts` | 9 | 329 B | Pure source/generation equality guard for accepted render results. |
| `src/lib/rendered-pane-contract.ts` | 41 | 1,251 B | Rendered-pane editing and interaction contract helpers. |
| `src/lib/rendered-snapshot-cache.ts` | 99 | 3,512 B | Bounded reuse/restoration of already-produced rendered snapshots. |
| `src/lib/rich-visual-edit.ts` | 180 | 7,453 B | Rich rendered element visual-edit planning and source replacement. |
| `src/lib/safe-image.ts` | 48 | 1,813 B | Safe image source and rendered-image policy helpers. |
| `src/lib/selection-bridge.ts` | 58 | 2,105 B | Exact bidirectional rendered/source selection projection against current maps. |
| `src/lib/selection-highlight.ts` | 40 | 1,746 B | Non-mutating rendered text-range highlighting with safe fallback. |
| `src/lib/slash.ts` | 204 | 10,261 B | Slash-command availability, parsing, and source insertion helpers. |
| `src/lib/source-completions.ts` | 326 | 11,475 B | Context-aware source completion contexts for commands, anchors, references, paths, fences, HTML, and words. |
| `src/lib/source-context.ts` | 121 | 4,962 B | Source-editor context target and map lookup helpers. |
| `src/lib/source-history.ts` | 61 | 2,210 B | Bounded source undo/redo history entries and append logic. |
| `src/lib/source-map.ts` | 983 | 41,494 B | Source-map range ownership, byte/character conversion, and mapped selection resolution. |
| `src/lib/source-patch.ts` | 109 | 4,113 B | Validated source-range patch application without whole-document reserialization. |
| `src/lib/source-selection-index.ts` | 229 | 8,630 B | Indexed source-map overlap queries for repeated selection projection. |
| `src/lib/source-sync.ts` | 90 | 3,277 B | CodeMirror change-range synchronization into authoritative source text. |
| `src/lib/spellcheck.ts` | 25 | 854 B | Local WebView spell-check attributes and bounded visual-editor exclusions. |
| `src/lib/tab-history.ts` | 13 | 531 B | Pure back/forward tab-history removal and replacement. |
| `src/lib/table-edit.ts` | 328 | 13,480 B | Safe GFM table selection context and source-preserving table edits. |
| `src/lib/toc.ts` | 142 | 4,923 B | Table-of-contents heading tree construction. |
| `src/lib/types.ts` | 240 | 4,785 B | Shared frontend IPC, document, rendering, workspace, and diagnostics types. |
| `src/lib/updater.ts` | 226 | 7,649 B | Signed updater checks, retry-safe install lifecycle, readable notes, banner policy, and diagnostics. |
| `src/lib/view-mode.ts` | 61 | 1,904 B | Startup preference normalization, initial pane state, and active-mode visibility helpers. |
| `src/lib/visual-draft.ts` | 25 | 980 B | Visual draft state and bounded draft source patch helpers. |
| `src/lib/visual-edit.ts` | 75 | 3,719 B | Simple rendered block edit classification and Markdown serialization. |
| `src/lib/visual-editor-contract.ts` | 75 | 2,086 B | Shared rendered-block capability vocabulary for editing, properties, movement, deletion, and source escape hatches. |
| `src/lib/visual-structure.ts` | 365 | 15,324 B | Mapped heading/list/table structure editing patches. |
| `src/lib/visual-text-transaction.ts` | 132 | 5,013 B | Source-preserving visible-text transactions for rendered Markdown editing. |

### Native Rust core

Rust owns filesystem, security, decoding, rendering, persistence, workspace indexing, and native integration. `store.rs` reexports the split store domains.

| File | Lines | Bytes | Summary |
| --- | ---: | ---: | --- |
| `src-tauri/src/acceptance.rs` | 51 | 1,962 B | Native acceptance fixture setup and probe command boundary. |
| `src-tauri/src/asset_ops.rs` | 427 | 15,187 B | Native local/remote asset validation and filesystem operations. |
| `src-tauri/src/assistant.rs` | 940 | 31,045 B | Deferred assistant/provider boundary and local provider lifecycle types. |
| `src-tauri/src/default_app.rs` | 435 | 14,297 B | Platform default-Markdown-application detection and registration helpers. |
| `src-tauri/src/document_lint.rs` | 34 | 1,220 B | Filesystem/reference linting independent from the expensive render path. |
| `src-tauri/src/github_host_oracle.rs` | 123 | 4,201 B | GitHub README compatibility fixture/oracle implementation. |
| `src-tauri/src/lib.rs` | 257 | 10,259 B | Tauri builder, plugin order, menus, command registration, and app lifecycle. |
| `src-tauri/src/main.rs` | 6 | 190 B | Native process entry point delegating to the Tauri library. |
| `src-tauri/src/markdown.rs` | 1,674 | 62,047 B | Comrak rendering, sanitization, diagnostics, metadata, and render orchestration. |
| `src-tauri/src/markdown_incremental.rs` | 773 | 27,316 B | Incremental Markdown block-cache invalidation and partial render planning. |
| `src-tauri/src/markdown_source_map.rs` | 906 | 32,607 B | Source-map construction, byte ranges, mapped HTML metadata, and coordinate helpers. |
| `src-tauri/src/media_stream.rs` | 221 | 7,691 B | Document-owned opaque media grants and bounded native byte-range serving. |
| `src-tauri/src/model.rs` | 232 | 6,040 B | Shared native data models serialized across IPC. |
| `src-tauri/src/performance.rs` | 35 | 1,146 B | Opt-in native performance measurement commands. |
| `src-tauri/src/phase0_benchmark.rs` | 145 | 5,768 B | Native Phase 0 render/index benchmark harness. |
| `src-tauri/src/reference_validation.rs` | 119 | 4,415 B | Comrak proof of a shared reference definition before source-range editing. |
| `src-tauri/src/security.rs` | 200 | 7,502 B | Canonical path, grant, URL, asset, SVG, and capability security boundary. |
| `src-tauri/src/source_format.rs` | 262 | 8,456 B | Encoding, BOM, line-ending, final-newline, and atomic source-format preservation. |
| `src-tauri/src/store.rs` | 1,068 | 38,125 B | Save, conflict, watcher, atomic-write, lifecycle orchestration, and domain reexports. |
| `src-tauri/src/store_assets.rs` | 726 | 26,543 B | Asset resolution, staging, safe copy/link, and consolidation commands. |
| `src-tauri/src/store_documents.rs` | 695 | 22,722 B | Document open/read/render and document record/recovery helpers. |
| `src-tauri/src/store_paths.rs` | 379 | 11,970 B | Native pickers, one-use path grants, and bounded import reads. |
| `src-tauri/src/store_recovery.rs` | 276 | 9,506 B | Recovery snapshot save, list, restore, and discard lifecycle. |
| `src-tauri/src/store_types.rs` | 158 | 4,408 B | Native shared state, identifiers, errors, grants, and initialization. |
| `src-tauri/src/store_workspace.rs` | 480 | 17,908 B | Workspace open/refresh, indexing, search, scan depth, and tree commands. |
| `src-tauri/src/workspace_scan.rs` | 550 | 20,234 B | Bounded workspace traversal and Markdown descendant tree construction. |

### Maintenance, build, and acceptance scripts

Use these scripts through the package commands documented in `README.md`; they are project-scoped and should preserve dry-run/apply boundaries.

| File | Lines | Bytes | Summary |
| --- | ---: | ---: | --- |
| `scripts/accessibility_audit.mjs` | 118 | 4,346 B | Static accessibility and capability audit used by verification. |
| `scripts/align-typescript.mjs` | 14 | 971 B | Keeps supported TypeScript package lines aligned with the Svelte toolchain. |
| `scripts/app_lifecycle_browser.mjs` | 58 | 4,063 B | Runs the real browser lifecycle fixture for recovery, shutdown, preview, and save failure flows. |
| `scripts/architecture_inventory.mjs` | 413 | 32,533 B | Generates and checks this architecture file inventory from the current tree. |
| `scripts/block_drag_browser.mjs` | 111 | 5,336 B | Runs an isolated headless Chromium mouse drag against the rendered block handle. |
| `scripts/build_app.mjs` | 144 | 6,165 B | Stages platform-specific portable and installable application artifacts. |
| `scripts/build_optional_renderers.mjs` | 49 | 1,755 B | Builds Mermaid and other optional renderer assets outside the startup graph. |
| `scripts/fixtures/acceptance-video.webm.base64` | 1 | 833 B | Small checked-in media fixture used to exercise packaged local-video streaming. |
| `scripts/fixtures/app-review.html` | 3 | 276 B | Vite-served application review fixture shell for lifecycle and accessibility evidence. |
| `scripts/fixtures/app-review.ts` | 70 | 5,307 B | Simulated native bridge and real App shell fixture used by browser review gates. |
| `scripts/fixtures/block-drag-fixture.ts` | 37 | 1,297 B | Mounts a small mapped MarkdownView fixture and records the source-safe move result. |
| `scripts/fixtures/block-drag.html` | 17 | 520 B | Vite-served browser fixture page for real mouse-driven block-move verification. |
| `scripts/fixtures/mermaid-visual.html` | 86 | 2,004 B | Vite-served visual fixture page for inspecting the Mermaid Markdown rendering path. |
| `scripts/fixtures/mermaid-visual.ts` | 41 | 1,816 B | Loads the Mermaid Markdown fixture through the production rich-content renderer and asserts visible native SVG labels. |
| `scripts/full_upgrade.mjs` | 90 | 5,516 B | Runs the explicit reversible stable dependency/toolchain/CI upgrade workflow. |
| `scripts/generate_github_fixtures.mjs` | 12 | 416 B | Generates pinned GitHub README compatibility fixtures. |
| `scripts/github_host_oracle.mjs` | 29 | 1,013 B | Runs the GitHub-host fixture/oracle verification command. |
| `scripts/media_privacy_browser.mjs` | 46 | 3,127 B | Real-browser initial-load and lazy-loading remote-media privacy regression gate. |
| `scripts/native_smoke.mjs` | 111 | 6,241 B | Runs native command and packaged-runtime smoke checks. |
| `scripts/normalize-workflow-comments.mjs` | 16 | 671 B | Normalizes workflow comments used by upgrade maintenance. |
| `scripts/optional_renderer_smoke.mjs` | 107 | 3,893 B | Verifies optional renderer assets produce bounded SVG output. |
| `scripts/packaged_acceptance.mjs` | 170 | 6,354 B | Launches the release binary and exercises real WebView acceptance flows. |
| `scripts/phase0_baseline.mjs` | 80 | 2,469 B | Runs Phase 0/1 frontend and native performance baseline probes. |
| `scripts/purge_build_environment.mjs` | 199 | 7,306 B | Safely purges project build output and optionally rebuilds within existing ranges. |
| `scripts/render_commit_benchmark.mjs` | 22 | 715 B | Runs the opt-in rendered DOM commit benchmark. |
| `scripts/renderer_budget.mjs` | 89 | 3,858 B | Enforces explicit size budgets for embedded optional renderer assets and lazy chunks. |
| `scripts/report-upgrade-limits.mjs` | 13 | 1,031 B | Reports unresolved upstream upgrade constraints and dependency limits. |
| `scripts/selection_acceptance.mjs` | 54 | 1,608 B | Runs source/render selection contract acceptance suites. |
| `scripts/sync-rust-minimum.mjs` | 11 | 845 B | Synchronizes the Rust manifest minimum with the selected stable toolchain. |
| `scripts/uninstall_smoke.mjs` | 204 | 8,883 B | Verifies installer uninstall cleanup on supported package paths. |
| `scripts/update-pnpm.mjs` | 66 | 2,546 B | Updates the active pnpm installation and verifies the resolved stable command. |
| `scripts/update-wcagate.mjs` | 51 | 1,968 B | Resolves and pins the current WCAGate upstream main revision for reproducible upgrades. |
| `scripts/updater_config_audit.mjs` | 89 | 5,193 B | Audits updater metadata, signatures, URLs, and release configuration. |
| `scripts/upgrade-plan.mjs` | 67 | 3,197 B | Builds the reviewed dependency/toolchain upgrade plan. |
| `scripts/upgrade-process.mjs` | 23 | 1,150 B | Executes one resumable upgrade process step. |
| `scripts/upgrade-snapshot.mjs` | 56 | 2,714 B | Creates/restores project metadata snapshots for upgrade rollback. |
| `scripts/verify-toolchains.mjs` | 18 | 1,165 B | Checks Node, pnpm, Rust, Cargo, and required toolchain compatibility. |
| `scripts/verify_dependencies.mjs` | 43 | 1,789 B | Runs the project dependency, security, build, accessibility, and native gates. |
| `scripts/visual_acceptance.mjs` | 77 | 2,478 B | Runs curated visual-editor unit/integration acceptance suites. |
| `scripts/wcag_browser.mjs` | 23 | 1,008 B | Starts the review fixture and runs the WCAGate browser evidence gate. |
| `scripts/workflow-comments.mjs` | 5 | 235 B | Maintains stable comments and metadata in GitHub workflows. |

### Tests and benchmarks

Test filenames map directly to the production contract they exercise. Benchmark files are opt-in and do not run in the normal suite.

| File | Lines | Bytes | Summary |
| --- | ---: | ---: | --- |
| `scripts/architecture_inventory.test.mjs` | 38 | 2,276 B | Regression test for architecture inventory line-ending and local-file filtering behavior. |
| `scripts/upgrade.test.mjs` | 118 | 7,484 B | Focused regression tests for upgrade. |
| `src/App.test.ts` | 39 | 1,639 B | Focused regression tests for App. |
| `src/components/ContextMenu.test.ts` | 106 | 3,982 B | Focused regression tests for ContextMenu. |
| `src/components/DocumentLoading.test.ts` | 25 | 1,196 B | Focused regression tests for DocumentLoading. |
| `src/components/EditorRibbon.test.ts` | 172 | 7,181 B | Focused regression tests for EditorRibbon. |
| `src/components/MarkdownView.test.ts` | 2,046 | 72,990 B | Focused regression tests for MarkdownView. |
| `src/components/MediaPreview.test.ts` | 76 | 3,350 B | Focused regression tests for MediaPreview. |
| `src/components/SettingsModal.test.ts` | 48 | 1,802 B | Focused regression tests for SettingsModal. |
| `src/lib/acceptance-bridge.test.ts` | 96 | 3,622 B | Focused regression tests for acceptance bridge. |
| `src/lib/acceptance-selection.test.ts` | 53 | 2,241 B | Focused regression tests for acceptance selection. |
| `src/lib/app-settings.test.ts` | 54 | 1,870 B | Focused regression tests for app settings. |
| `src/lib/app-utils.test.ts` | 25 | 1,169 B | Focused regression tests for app utils. |
| `src/lib/asset-drop.test.ts` | 34 | 966 B | Focused regression tests for asset drop. |
| `src/lib/asset-path.test.ts` | 28 | 1,214 B | Focused regression tests for asset path. |
| `src/lib/assistant-settings.test.ts` | 22 | 776 B | Focused regression tests for assistant settings. |
| `src/lib/block-move.test.ts` | 186 | 7,309 B | Focused regression tests for block move. |
| `src/lib/block-selection.test.ts` | 30 | 1,445 B | Focused regression tests for block selection. |
| `src/lib/browser-settings.test.ts` | 27 | 910 B | Focused regression tests for browser settings. |
| `src/lib/compatibility.test.ts` | 27 | 1,442 B | Focused regression tests for compatibility. |
| `src/lib/context-copy.test.ts` | 33 | 1,076 B | Focused regression tests for context copy. |
| `src/lib/details-edit.test.ts` | 34 | 1,632 B | Focused regression tests for details edit. |
| `src/lib/document-diagnostics.test.ts` | 56 | 2,649 B | Focused regression tests for document diagnostics. |
| `src/lib/document-metrics.test.ts` | 12 | 429 B | Focused regression tests for document metrics. |
| `src/lib/document-recovery-controller.test.ts` | 36 | 1,898 B | Focused regression tests for document recovery controller. |
| `src/lib/document-revision.test.ts` | 95 | 3,107 B | Focused regression tests for document revision. |
| `src/lib/document-tab-revision.test.ts` | 129 | 4,121 B | Focused regression tests for document tab revision. |
| `src/lib/fence.test.ts` | 34 | 1,503 B | Focused regression tests for fence. |
| `src/lib/find.test.ts` | 123 | 5,202 B | Focused regression tests for find. |
| `src/lib/formatting.test.ts` | 52 | 2,514 B | Focused regression tests for formatting. |
| `src/lib/html-sub-spans.test.ts` | 129 | 5,221 B | Focused regression tests for html sub spans. |
| `src/lib/image-editor.test.ts` | 93 | 4,874 B | Focused regression tests for image editor. |
| `src/lib/inert-media-html.test.ts` | 10 | 768 B | Focused regression tests for inert media html. |
| `src/lib/inserts.test.ts` | 149 | 7,437 B | Focused regression tests for inserts. |
| `src/lib/invoke-error.test.ts` | 49 | 1,470 B | Focused regression tests for invoke error. |
| `src/lib/large-document-mount.test.ts` | 101 | 3,666 B | Focused regression tests for large document mount. |
| `src/lib/latest-task-queue.test.ts` | 46 | 1,840 B | Focused regression tests for latest task queue. |
| `src/lib/line-ending-coords.codemirror.test.ts` | 35 | 1,282 B | Focused regression tests for line ending coords.codemirror. |
| `src/lib/line-ending-coords.test.ts` | 64 | 3,111 B | Focused regression tests for line ending coords. |
| `src/lib/link-editor.test.ts` | 46 | 2,083 B | Focused regression tests for link editor. |
| `src/lib/markdown-profile.test.ts` | 19 | 1,105 B | Focused regression tests for markdown profile. |
| `src/lib/markdown-tooltip.test.ts` | 21 | 1,062 B | Focused regression tests for markdown tooltip. |
| `src/lib/markdown-view-dom-commit.benchmark.test.ts` | 72 | 2,556 B | Opt-in benchmark for markdown view dom commit. |
| `src/lib/markdown-view-dom-commit.test.ts` | 105 | 4,426 B | Focused regression tests for markdown view dom commit. |
| `src/lib/markdown-view-dom.test.ts` | 24 | 890 B | Focused regression tests for markdown view dom. |
| `src/lib/markdown-view-insertion.test.ts` | 47 | 1,964 B | Focused regression tests for markdown view insertion. |
| `src/lib/markdown-view-render.test.ts` | 73 | 3,011 B | Focused regression tests for markdown view render. |
| `src/lib/markdown-view-rich-content.test.ts` | 59 | 2,507 B | Focused regression tests for markdown view rich content. |
| `src/lib/markdown-view-visual-editing.test.ts` | 47 | 1,632 B | Focused regression tests for markdown view visual editing. |
| `src/lib/media-asset-cache.test.ts` | 30 | 1,798 B | Focused regression tests for media asset cache. |
| `src/lib/media.test.ts` | 39 | 2,067 B | Focused regression tests for media. |
| `src/lib/pane-scroll-sync.test.ts` | 30 | 1,269 B | Focused regression tests for pane scroll sync. |
| `src/lib/paste.test.ts` | 87 | 3,627 B | Focused regression tests for paste. |
| `src/lib/phase0-performance.test.ts` | 124 | 4,334 B | Focused regression tests for phase0 performance. |
| `src/lib/phase0-selection-contract.test.ts` | 105 | 4,962 B | Focused regression tests for phase0 selection contract. |
| `src/lib/project-links.test.ts` | 11 | 571 B | Focused regression tests for project links. |
| `src/lib/recent-documents.test.ts` | 45 | 1,757 B | Focused regression tests for recent documents. |
| `src/lib/reference-editor.test.ts` | 87 | 3,913 B | Focused regression tests for reference editor. |
| `src/lib/render-controller.test.ts` | 133 | 4,874 B | Focused regression tests for render controller. |
| `src/lib/render-guard.test.ts` | 10 | 425 B | Focused regression tests for render guard. |
| `src/lib/rendered-pane-contract.test.ts` | 21 | 870 B | Focused regression tests for rendered pane contract. |
| `src/lib/rendered-snapshot-cache.test.ts` | 96 | 3,715 B | Focused regression tests for rendered snapshot cache. |
| `src/lib/rich-visual-edit.test.ts` | 106 | 5,068 B | Focused regression tests for rich visual edit. |
| `src/lib/safe-image.test.ts` | 42 | 1,691 B | Focused regression tests for safe image. |
| `src/lib/selection-bridge.test.ts` | 73 | 2,354 B | Focused regression tests for selection bridge. |
| `src/lib/selection-highlight.test.ts` | 52 | 2,367 B | Focused regression tests for selection highlight. |
| `src/lib/slash.test.ts` | 65 | 3,715 B | Focused regression tests for slash. |
| `src/lib/source-completions.test.ts` | 60 | 2,746 B | Focused regression tests for source completions. |
| `src/lib/source-context.test.ts` | 57 | 2,700 B | Focused regression tests for source context. |
| `src/lib/source-history.test.ts` | 54 | 2,718 B | Focused regression tests for source history. |
| `src/lib/source-map.test.ts` | 419 | 19,041 B | Focused regression tests for source map. |
| `src/lib/source-patch.test.ts` | 67 | 2,402 B | Focused regression tests for source patch. |
| `src/lib/source-selection-index.test.ts` | 76 | 3,289 B | Focused regression tests for source selection index. |
| `src/lib/source-sync.test.ts` | 62 | 2,000 B | Focused regression tests for source sync. |
| `src/lib/spellcheck.test.ts` | 28 | 946 B | Focused regression tests for spellcheck. |
| `src/lib/tab-history.test.ts` | 20 | 789 B | Focused regression tests for tab history. |
| `src/lib/table-edit.test.ts` | 92 | 4,938 B | Focused regression tests for table edit. |
| `src/lib/toc.test.ts` | 33 | 1,646 B | Focused regression tests for toc. |
| `src/lib/types.test.ts` | 9 | 290 B | Focused regression tests for types. |
| `src/lib/updater.test.ts` | 173 | 7,375 B | Focused regression tests for updater. |
| `src/lib/view-mode.test.ts` | 72 | 2,677 B | Focused regression tests for view mode. |
| `src/lib/visual-draft.test.ts` | 31 | 784 B | Focused regression tests for visual draft. |
| `src/lib/visual-edit.test.ts` | 58 | 2,790 B | Focused regression tests for visual edit. |
| `src/lib/visual-editor-contract.test.ts` | 54 | 1,599 B | Focused regression tests for visual editor contract. |
| `src/lib/visual-structure.test.ts` | 126 | 4,219 B | Focused regression tests for visual structure. |
| `src/lib/visual-text-transaction.test.ts` | 73 | 2,256 B | Focused regression tests for visual text transaction. |

### Configuration, workflows, and project documents

These files define toolchains, dependency graphs, packaging, permissions, CI, and the human-facing project contract.

| File | Lines | Bytes | Summary |
| --- | ---: | ---: | --- |
| `.github/workflows/ci.yml` | 175 | 5,221 B | Quality, security, cross-platform build, and test automation. |
| `.github/workflows/release.yml` | 505 | 26,044 B | Signed six-family release build, publication, and post-publication verification. |
| `.gitignore` | 84 | 1,041 B | Generated output, local credentials, runtime state, and continuity-file boundaries. |
| `IMPLEMENTATION_STATUS.md` | 1,111 | 81,255 B | Current implementation checkpoint and evidence summary. |
| `LICENSE` | 21 | 1,086 B | MIT license text. |
| `README.md` | 232 | 20,369 B | Published user/developer guide for installation, usage, commands, releases, and limitations. |
| `SECURITY.md` | 102 | 6,336 B | Security model, audit findings, upstream advisories, and unresolved platform boundaries. |
| `docs/PHASE-0-PERFORMANCE.md` | 137 | 6,049 B | Phase 0 performance matrix, baseline, budgets, and evidence limits. |
| `docs/PHASE-1-PERFORMANCE.md` | 139 | 7,889 B | Phase 1 optimization results, deltas, and remaining packaged gates. |
| `mobile_todo.md` | 148 | 7,234 B | Android/mobile product contract, workstreams, non-goals, and acceptance gates. |
| `package.json` | 129 | 5,288 B | Frontend package metadata, dependency versions, and maintenance/build scripts. |
| `pnpm-lock.yaml` | 4,046 | 134,214 B | Resolved JavaScript dependency graph. |
| `pnpm-workspace.yaml` | 10 | 198 B | pnpm workspace and build-approval configuration. |
| `rust-toolchain.toml` | 6 | 235 B | Stable Rust channel and rustfmt/Clippy component selection. |
| `src-tauri/Cargo.lock` | 6,329 | 153,058 B | Resolved Rust dependency graph. |
| `src-tauri/Cargo.toml` | 57 | 2,114 B | Rust package metadata, compiler floor, Tauri dependencies, and native features. |
| `src-tauri/capabilities/default.json` | 15 | 347 B | Explicit webview permissions and command capabilities. |
| `src-tauri/tauri.conf.json` | 103 | 3,553 B | Default Tauri window, bundle, CSP, file association, and updater configuration. |
| `src-tauri/tauri.release.conf.json` | 6 | 107 B | Release-only signing and updater overlay configuration. |
| `tsconfig.json` | 18 | 502 B | TypeScript compiler configuration for Svelte and native-aligned types. |
| `vite.config.ts` | 64 | 1,986 B | Vite/Rolldown entry, lazy chunk, alias, and production build configuration. |
| `vitest.config.ts` | 21 | 631 B | Vitest environment, pooling, timeout, and test-discovery configuration. |

### Inventory maintenance

- Run `pnpm architecture:check` in verification to fail on stale metrics or missing summaries.
- Run `pnpm architecture:refresh` after adding, removing, renaming, or materially resizing a maintained file.
- Add a curated summary to `scripts/architecture_inventory.mjs` when a new maintained file is introduced; do not accept an opaque fallback summary.
<!-- END GENERATED FILE INVENTORY -->

## Current architecture checkpoint

As of 2026-09-24, the native store domains and the frontend shell contracts,
snapshot cache, selection bridge, and render controller are separated. The
remaining large frontend surface is the stateful shell orchestration itself.
The next extraction should be chosen from a callback-bounded lifecycle domain
only after preserving the packaged bidirectional-selection and render-latency
evidence. The current local packaged acceptance is Windows x64-specific and
passes all 19 checks, including offline Mermaid SVG loading, source/render
selection, visual editing, drag/delete, save/reload, and IME composition. Three
normal-package runs measured synthetic split latency at 138.8–143.4 ms against
the 150 ms budget. Incremental commit tokens are consumed by their owning DOM
revision, preventing stale patch retries on subsequent renders. The same
packaged gate is required in the Windows x64 CI and release lanes. This does
not certify target-OS input timing, accessibility, signing, or live updater
installation.
