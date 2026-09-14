# Android / Mobile TODO

Status: planning only. No Android project, mobile capability file, or mobile
native implementation exists yet.

## Product contract

Markdown Desktop should become a focused Android companion to the desktop app,
not a compressed desktop workspace.

- Portrait phones show exactly one document surface at a time: Rendered or
  Source.
- Rendered is the default phone surface; Source is entered through an explicit
  mode control.
- Split mode is available only when the device has landscape-sized space. A
  return to portrait collapses Split without discarding the document,
  selection, draft, or unsaved edits.
- The Markdown source remains authoritative. Rendering, selection mapping,
  undo/redo, encoding, and recovery must retain the desktop source-preserving
  contracts.
- Android v1 prioritizes opening/importing one Markdown document, editing it,
  saving/exporting it, and reading local or remote assets. Workspace folders,
  desktop menus, drag/drop, and desktop window behavior are not phone
  requirements.

## Current baseline

- The reusable core is the existing Svelte 5/Vite frontend and Rust/Tauri
  document, rendering, source-map, security, and recovery layer.
- The current shell is desktop-first: `src/styles/app-shell.css` has an
  `860px` minimum document width and `src-tauri/tauri.conf.json` declares a
  `920px` minimum desktop window width.
- The current native store is path-oriented and uses Rust filesystem paths,
  canonicalization, workspace scanning, and filesystem watchers. Android file
  pickers return content URIs, and folder picking is not supported by the
  Tauri dialog plugin.
- `src-tauri/gen/android/`, `src-tauri/tauri.android.conf.json`, and
  `src-tauri/capabilities/mobile.json` do not currently exist.
- Tauri's current mobile prerequisites and Android distribution guidance are
  documented in the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
  and [Google Play](https://v2.tauri.app/distribute/google-play/) guides.

## Workstreams

### P0 — Android foundation

- Run `tauri android init` only when implementation is authorized.
- Add a platform-specific Android configuration and mobile capability file;
  keep desktop capabilities and plugins scoped to desktop targets.
- Add Android CI/build prerequisites, app signing configuration, version-code
  policy, and a repeatable emulator/device smoke path.
- Gate or replace desktop-only behavior such as menus, window state, default
  app registration, single-instance behavior, and desktop updater actions.

### P1 — Mobile shell and orientation policy

- Extract a small layout-policy module from `App.svelte` that distinguishes
  desktop, phone portrait, and phone landscape without changing document
  state ownership.
- Remove the desktop minimum-width assumption on Android and use dynamic
  viewport and safe-area sizing.
- Replace the desktop ribbon/sidebar density with a compact mobile toolbar,
  bottom-sheet or drawer navigation, and touch-sized controls.
- Define orientation behavior from available layout space, not only a raw
  device flag, so tablets and foldables remain usable.
- Preserve an explicit user choice of Rendered, Source, or Split where the
  current orientation allows it.

### P2 — Android document and asset access

- Choose the v1 storage model:
  1. persistent Storage Access Framework content-URI editing, or
  2. import to app-private storage followed by explicit Save/Export.
- Add a native storage adapter instead of passing Android content URIs through
  desktop `PathBuf`/canonical-path assumptions.
- Define behavior for Save, Save As, conflict checks, recovery, recent files,
  external edits, and process suspension/resume.
- Make local Markdown images and pasted images work through Android-safe
  grants or app-managed assets.
- Make workspace-only actions unavailable or clearly explain why they are not
  offered on Android v1.

### P3 — Touch editing and selection

- Test CodeMirror with the Android keyboard, IME composition, selection handles,
  long press, autocorrect, back button, and viewport resize when the keyboard
  opens.
- Test Rendered-to-Source and Source-to-Rendered selection projection with
  Unicode, CRLF, inline marks, links, editable blocks, and cross-block ranges.
- Replace or disable desktop block-drag affordances where touch scrolling and
  long-press selection would conflict.
- Keep source-map freshness and revision guards identical across desktop and
  Android.

### P4 — Mobile lifecycle and capability hardening

- Handle Android activity recreation, background suspension, low-memory
  recovery, orientation changes, and interrupted saves.
- Add mobile-scoped capabilities with the minimum permissions needed for file
  selection, storage, sharing, and external links.
- Keep remote-image and link validation in the Rust security boundary.
- Use Play Store distribution/update behavior for Android; the desktop signed
  Tauri updater is not the Android update mechanism.

### P5 — Verification and release

- Add emulator and physical-device acceptance for portrait, landscape, small
  phones, large phones, tablets, and at least one keyboard/IME configuration.
- Verify first launch, file import, save/export, recovery, rotation during an
  edit, process restart, local images, remote-image policy, and accessibility.
- Verify release AAB signing, version codes, Play internal testing, rollback,
  and privacy/data-scope behavior before public release.
- Keep Android evidence separate from the existing Windows packaged evidence
  and desktop release evidence.

## Explicit Android v1 non-goals

- Full workspace folder browsing and recursive indexing.
- Desktop-style multi-pane sidebars, native menus, drag/drop, and window-state
  restoration.
- The desktop Tauri updater endpoint and self-relaunch flow.
- Automatic synchronization, cloud storage, or a document conversion layer.
- A second Markdown rendering or source-mapping implementation.

## Acceptance gates

The Android version is not ready to ship until all of these are true:

1. Portrait never renders two active editing panes at once.
2. Landscape Split mode is opt-in or policy-consistent and rotation never loses
   source, selection, draft, history, or recovery state.
3. A picked Markdown document can be read, edited, saved/exported, reopened,
   and recovered after activity recreation.
4. Rendered and Source selections identify the same exact source interval,
   including Unicode and line-ending cases.
5. Local assets cannot escape their authorized document/import scope.
6. Android-specific capabilities, signing, device evidence, and Play internal
   testing are recorded separately from desktop CI evidence.

## Open decisions before implementation

- Persistent content-URI editing versus import/export as the v1 storage model.
- Whether Android v1 supports multiple open documents or one active document.
- Whether landscape Split is automatic, user-selected, or an explicit “Rotate
  for Split” affordance.
- Minimum Android API level and first supported device matrix.
- Whether mobile work remains in this repository as a platform target or gets
  a separately published Android application identity.
