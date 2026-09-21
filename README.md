# <img src="./src-tauri/icons/icon.png" alt="" width="40" /> Markdown Desktop

A focused desktop viewer and editor for ordinary Markdown files.

<p align="center">
  <a href="https://github.com/ImYourBoyRoy/markdown-desktop/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ImYourBoyRoy/markdown-desktop/actions/workflows/ci.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/ImYourBoyRoy/markdown-desktop/releases/latest"><img alt="Latest GitHub release" src="https://img.shields.io/github/v/release/ImYourBoyRoy/markdown-desktop?color=b7833f&style=flat-square" /></a>
  <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-6b6158?style=flat-square" /></a>
</p>

<p align="center">
  <a href="https://github.com/ImYourBoyRoy/markdown-desktop/releases"><img alt="Windows x64 and ARM64" src="https://img.shields.io/badge/Windows-x64%20%2B%20ARM64-5f6f64?style=flat-square" /></a>
  <a href="https://github.com/ImYourBoyRoy/markdown-desktop/releases"><img alt="macOS Intel and Apple Silicon" src="https://img.shields.io/badge/macOS-Intel%20%2B%20Apple%20Silicon-5f6f64?style=flat-square" /></a>
  <a href="https://github.com/ImYourBoyRoy/markdown-desktop/releases"><img alt="Linux x64 and ARM64" src="https://img.shields.io/badge/Linux-x64%20%2B%20ARM64-5f6f64?style=flat-square" /></a>
</p>

<p align="center">
  <a href="https://github.com/ImYourBoyRoy/markdown-desktop/releases">Download</a>
  ·
  <a href="https://github.com/ImYourBoyRoy/markdown-desktop/issues">Issues</a>
  ·
  <a href="./LICENSE">MIT license</a>
</p>

Open a file or folder, read the rendered document, edit supported Markdown directly in the visual surface or source drawer, and save back to the same path on disk. There is no proprietary library, sync service, or document conversion step — the Markdown you already keep is the source of truth.

<p align="center">
  <img src="./docs/media/workspace-dark.png" alt="Markdown Desktop in the dark theme with the Files and Inspect sidebars visible" width="1600" height="903" />
</p>

## Features

- **Rendered, Source, and Split** views, with a configurable startup layout that remembers the last-used view or always opens in a chosen mode; Edit mode can collapse the source drawer without leaving visual editing
- Reader focus mode fills the window with the rendered Markdown, keeps optional Files and Inspect sidebars available, and restores the previous view on exit with **F11** or **Esc**
- Source-authoritative visual editing for safe headings, paragraphs, list items, simple table cells, and supported inline marks/links, plus plain-text details summaries, with source-range undo/redo
- Visual edits support plain-text and sanitized rich-HTML paste, including Word-style list cleanup, multiline paragraph hard breaks, and IME composition guards so Save, Undo, navigation, and leaving Edit cannot discard an unfinished composition or an unblurred block edit
- Source-map hover and selection synchronization between the visual and CodeMirror panes, including mapped fences, tables, images, links, and diagrams
- Rendered text drags preserve the exact UTF-16 source interval across mapped blocks, while block-handle pointer drags reorder only safe source ranges and retain keyboard movement as a fallback
- App-owned in-document **Ctrl+F / Cmd+F** with synchronized source and visual highlights; workspace search remains a separate file/content search
- Tabbed editing ribbon, slash-command insertion (including a source-preserving heading-linked `/toc`), contextual block properties, fence-language editing and code copy, table row/column tools, sequential block movement, secure reveal of local image assets, native image replacement, keyboard- or pointer-open context menus, modifier-click link opening in both panes, and context-menu copying that respects rendered selection, source selection, or the complete active source
- Workspace file tree, full-text search, tabs, outline, link/issue panels, and compatibility-profile selection (`github`, `commonmarkStrict`, or `extended`)
- Atomic saves that keep the file’s encoding, BOM, line endings, and final newline
- Recovery snapshots and conflict handling when a file changes outside the app
- Sanitized Markdown rendering with constrained local and remote assets, safe SVG preview sanitization for image references, keyboard-accessible image and diagram previews with bounded zoom, profile-aware semantic HTML marks/details, drag/drop image import, editable document-relative asset folders, safe image destinations/titles, and image consolidation
- Bounded native reads for image/import handling and workspace indexing, with clear local limits that protect responsiveness without replacing GitHub compatibility diagnostics
- GitHub-oriented Issues with source-mapped lint findings, Graphviz portability advisories, missing local-reference checks, unsafe-path checks, and calm README/object-size warnings with official guidance links; a separate GitHub README indicator keeps this check advisory and non-blocking
- Native menus, file associations, keyboard shortcuts, and light/dark themes
- Assistant integration is intentionally parked for a later milestone; the current minimum editor ships without an Assistant panel or provider calls

<table>
  <tr>
    <td align="center"><strong>Light</strong><br /><img src="./docs/media/light-theme.webp" alt="Welcome screen in the light theme" width="720" height="450" /></td>
    <td align="center"><strong>Dark</strong><br /><img src="./docs/media/dark-theme.webp" alt="Welcome screen in the dark theme" width="720" height="450" /></td>
  </tr>
</table>

<p align="center">
  <img src="./docs/media/interface-tour.webp" alt="Animated tour of the welcome screen, Files sidebar, and Inspect sidebar" width="1600" height="1000" />
</p>

## Editing workflow

Markdown remains the authoritative document format. In **Edit** mode, click a
mapped heading, paragraph, list item, or simple table cell to edit it in place;
the app patches only that source range and rerenders the document. In supported
paragraphs and list items, **Enter** splits at the source-aware caret,
**Backspace** joins compatible adjacent blocks, and **Tab** / **Shift+Tab**
adjusts list indentation through the same bounded source transaction. Blocks
whose syntax cannot be safely serialized through a bounded edit remain
read-only in the visual pane and offer **Edit in source**.

Use **Ctrl+F** (or **Cmd+F** on macOS) for the current document. The Find bar
searches raw Markdown and highlights the corresponding source and visual owners.
It can also replace the current match or all matches through bounded source
patches, with the operation included in the shared undo history. The
left-sidebar workspace search remains dedicated to finding files and
content across a workspace. The ribbon is available in visual editing and
contains Home, Insert, Layout, Block, and Review tabs; a compact Tabs disclosure
keeps every ribbon tab reachable when the window is narrow. The source drawer can be
shown or hidden from Layout or with **Ctrl+Alt+S**. The themed context menu can
be opened with the standard **ContextMenu** key or **Shift+F10** when a mapped
visual block or source selection has focus.

Use **Focus reader** in the document header, **F11**, or **Focus Reader** from
the command palette to temporarily hide the application chrome and read the
active rendered document at full height. The focus bar keeps independent
controls for showing or hiding the Files and Inspect sidebars and restores the
previous Rendered, Source, or Split arrangement when closed. Images open with a
click (or Enter/Space when standalone) in a safe zoomable preview; rendered
Mermaid and Graphviz diagrams expose the same **Open preview** control. The
preview closes with its close button, an outside click, or **Esc**, and these
display-only interactions never modify Markdown source.

Hold **Ctrl** (or **Cmd** on macOS) and click a mapped hyperlink in either the
rendered pane or source editor to open it. Right-clicking a mapped link exposes
Open link and Copy link URL actions. External URLs use the system's default
browser; relative Markdown links remain document navigation. **Reload from
Disk** is available from File and asks for confirmation before discarding
unsaved edits. **Save As** refuses to replace a file already open in another
tab and preserves newer edits if the native file operation races with typing;
same-path saves update the disk baseline without duplicating the tab.

Use **File → Open Recent…** or choose **Open Recent** from the command palette
to reopen up to five recently opened Markdown files. The list shows each
file's full path, is validated natively against the current filesystem when
opened, and removes entries that no longer exist or are no longer Markdown
files. Recent history is local app settings; it does not copy or upload the
documents.

Choose **Settings → Startup view** to restore **Remember last used** (the
default) or always launch in **Rendered**, **Source**, or **Split**. This setting
controls the layout at app launch; the view switcher remains available during
each session.

The default `github` editor profile favors GitHub-healthy Markdown: relative
asset paths, GFM tables, documented marks, footnotes, dollar-delimited math,
and GitHub alert syntax. Settings also has a separate **Check against** lens,
which defaults to **GitHub README (advisory)**. The document header shows one
quiet status chip for that lens; selecting it opens the Issues pane filtered to
the current document's GitHub-relevant findings. The lens never changes the
rendered preview, source map, editing affordances, or save behavior. Choose
**None** when you do not want the compatibility lens; general safety and
editor-profile diagnostics remain available in the unfiltered Issues view.

Source typing updates the in-memory Markdown immediately. The rendered preview
and source map refresh after a short pause in typing, so the visual surface does
not rebuild on every keystroke; the last valid preview remains visible while
that refresh is in progress. When a source-range formatting or structure edit
does require a new render, the active visual selection is captured and restored
against the new map whenever the mapping remains exact. Source and rendered
selection also reveal the corresponding location in the other pane; history
actions restore a bounded previously rendered revision immediately when one is
available, then confirm it with the guarded native render.
Rendered text selection is pointer-aware: the post-drag click cannot replace a
precise cross-block range with a whole-block selection, and releasing outside
the rendered pane still completes the gesture. Block handles use the same
pointer path with visible before/after drop feedback; dropping in nearby
whitespace targets the nearest block. Pointer capture and WebView hit-testing
fallbacks keep the gesture attached to its source handle. Reordering still uses
a bounded source transaction and refuses moves that would displace opaque,
unmapped Markdown; **Alt+↑ / Alt+↓** remains available as a keyboard fallback.
Selecting text in the source editor paints the matching visible text in the
rendered pane, including editable paragraphs and inline formatting. Browser
range highlights preserve the editable HTML and caret; older webviews without
that API retain block outlines for editable content. Markdown delimiters and
non-text objects remain represented by their mapped owner.
Opening a disk document reads, decodes, renders, and builds its source map in a
native blocking worker. Workspace filesystem-reference lint is deferred until
the first idle window, so the document can become interactive before the slower
project-wide checks finish. Rendering and source-map construction keep the Tauri
command/UI path responsive. Optional math enhancement continues in the
background, and resolved images use a bounded per-view cache so a redraw does
not repeatedly fetch the same asset. Raw HTML anchors and images are also
associated with their source block for hover, selection, Issues, and Links
navigation. The left Files panel also shows the five most recent Markdown paths
when no workspace is open, and action feedback settles back to Ready after a
short quiet period. The bottom status bar reports source lines and Unicode
character count for the active document.
Mermaid fences are supported by the GitHub profile; Graphviz/DOT remains an
explicit Extended-profile local preview and is warned as non-portable in the
GitHub and CommonMark profiles. Existing source is preserved, but GitHub may
show that fence as ordinary code rather than rendering a diagram.
The Mermaid and Graphviz runtimes stay out of the startup JavaScript graph:
they are staged as on-demand renderer assets, and `pnpm smoke:renderers`
verifies both packaged-style assets produce SVG output.
Mermaid 12 is the supported renderer line. The renderer explicitly uses native
SVG text, the classic look, theme-aware colors, and Dagre spacing so sanitized
output retains readable node labels instead of relying on removable
`foreignObject` HTML labels. Mermaid 12 targets ES2024 and documents Safari
17.4+ as its supported WebKit floor; the macOS bundle therefore declares
macOS 14.4 as its minimum system version. Windows WebView2 and Linux
WebKitGTK remain native platform dependencies and are exercised by the release
matrix. `full:upgrade` fails closed for Mermaid majors after 12 until their
browser floor and diagram defaults are reviewed. See Mermaid's
[configuration](https://mermaid.js.org/config/configuration) and
[flowchart](https://mermaid.js.org/syntax/flowchart.html) documentation.
For a repeatable visual check of the real `.md` fence path, start `pnpm dev`
and open `/scripts/fixtures/mermaid-visual.html`; that fixture loads
`fixtures/mermaid/visual.md` through the production rich-content renderer and
asserts visible native SVG labels.
The 500 KiB rendering advisory is shown for README-named files only; general
Markdown files still receive applicable Git object-size guidance. GitHub
rendering guidance and repository object limits are based on GitHub's
published documentation: [README limits](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes),
[repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits),
and [large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github).

Pasting formatted content in either the source editor or a supported visual
block converts semantic HTML to Markdown. Word-style list paragraphs and
literal clipboard bullet lists are normalized; CSS, event handlers, embedded
documents, and unsafe link/image destinations are removed. Ambiguous visual
positions remain source-only rather than risking an incorrect source patch.

Side-by-side persisted block layouts remain disabled pending compatibility
fixtures. Assistant integration is parked until the visual-editor acceptance
gate is complete; the current minimum editor makes no provider calls. The
isolated later design covers Ollama discovery, explicit bounded context, and
read-only feedback first, with generic HTTPS providers, proposed source
patches, model pull/delete, app-scoped tools, and context compression deferred.

The durable local implementation checkpoint is [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md).
The stable ownership and data-flow map is [ARCHITECTURE.md](./ARCHITECTURE.md).
The detailed execution work order is intentionally kept in the ignored local
`Tasks/` folder.

## Performance validation

Phase 0 has a repeatable correctness and performance baseline. Run
`pnpm phase0:selection` for the source/render selection contract probes and
`pnpm phase0:baseline` for the frontend/jsdom and native Markdown/workspace
timing probes. The detailed fixture matrix, captured baseline, proposed
budgets, and local-versus-packaged evidence boundary are in
[docs/PHASE-0-PERFORMANCE.md](./docs/PHASE-0-PERFORMANCE.md). The baseline
command does not write a report or mutate project documents, and does not claim
target-OS or packaged latency; those require a release-like desktop run.
Phase 1 uses the same deterministic harness through `pnpm phase1:baseline`;
its optimization deltas and remaining packaged-WebView gates are recorded in
[docs/PHASE-1-PERFORMANCE.md](./docs/PHASE-1-PERFORMANCE.md).

Cached blocks are reused only when resolved Markdown semantics and source
coordinates match. Raw HTML, footnotes, and generated heading-ID state use
whole-document rendering. Partial DOM commits require evidence that all other
blocks are unchanged; ambiguous edits fall back to a full refresh. Filesystem
diagnostics run separately from rendering, and rich clipboard conversion loads
on demand rather than during startup.

## Download

Installers and portable builds are on the [Releases](https://github.com/ImYourBoyRoy/markdown-desktop/releases) page. Every downloadable build follows the same pattern: `Markdown-Desktop-<version>-<platform>-<architecture>...`.

The checked-in release workflow targets all six platform families in the table below. The [latest published release](https://github.com/ImYourBoyRoy/markdown-desktop/releases/latest) contains the verified six-family asset set and signed updater metadata. The macOS packages are intentionally unsigned because Apple Developer signing/notarization is not configured and may show an unidentified-developer warning. The release workflow verifies all platform assets and signed updater metadata before publishing, then confirms the published release is latest. This does not substitute for target-OS desktop-session integration, Gatekeeper approval, or live-updater relaunch evidence.

| Platform | Installer | Other packages |
| --- | --- | --- |
| Windows x64 | `Markdown-Desktop-<version>-Windows-x64-setup.exe` | `...-Windows-x64.msi`, `...-Windows-x64-Portable.exe` |
| Windows ARM64 | `Markdown-Desktop-<version>-Windows-ARM64-setup.exe` | `...-Windows-ARM64.msi`, `...-Windows-ARM64-Portable.exe` |
| macOS Apple Silicon | `...-macOS-Apple-Silicon.dmg` | `...-macOS-Apple-Silicon.app.tar.gz` |
| macOS Intel | `...-macOS-Intel.dmg` | `...-macOS-Intel.app.tar.gz` |
| Linux x64 | `...-Linux-x64.AppImage` | `...-Linux-x64.deb`, `...-Linux-x64.rpm` |
| Linux ARM64 | `...-Linux-ARM64.AppImage` | `...-Linux-ARM64.deb`, `...-Linux-ARM64.rpm` |

Files ending in `.sig` are signed companions used to verify updates on a signed release. `latest.json` is the machine-readable manifest used by the in-app updater; users normally do not download it. GitHub adds the two `Source code` archives automatically for anyone who wants the tagged source tree.

## Install

### Windows

Run the x64 or ARM64 `-setup.exe` that matches your Windows device, or use the matching `.msi` when your environment expects Windows Installer. The NSIS installer embeds the WebView2 bootstrapper for machines that need it. The installed app is registered as **Markdown Desktop**, adds a Start menu entry, and can be launched from Windows Search. The matching `-Portable.exe` runs without installing an uninstaller or Start menu entry.

### macOS

For a signed and notarized build, open the corresponding `.dmg` from a verified release, then drag **Markdown Desktop** into Applications. For a release whose macOS packages are intentionally unsigned, open only a trusted release asset: macOS may report an unidentified developer, so use the Finder context menu → **Open** after verifying the download. macOS then exposes the app through Finder and Launchpad like any other installed app. Apple signing, notarization, stapling, and Gatekeeper approval are not claimed until Apple Developer credentials are provisioned and the corresponding release checks pass.

### Linux

```bash
chmod +x ./Markdown-Desktop-*-Linux-x64.AppImage
./Markdown-Desktop-*-Linux-x64.AppImage
# ARM64 users: use the matching *-Linux-ARM64.AppImage name instead. AppImage is portable; use the `.deb` or `.rpm` package below when you want the app registered in the desktop application menu.
```

Or install the `.deb` / `.rpm` with your package manager:

```bash
sudo apt install ./Markdown-Desktop-*-Linux-x64.deb
# or
sudo dnf install ./Markdown-Desktop-*-Linux-x64.rpm
# ARM64 users: use the matching *-Linux-ARM64.deb or *-Linux-ARM64.rpm name instead.
```

## Uninstall

Uninstall removes the application and, with the steps below, its settings, recovery data, search index, logs, and webview cache. Your Markdown files are not deleted.

**Windows:** Settings → Apps → Markdown Desktop → Uninstall. The installers also clear `%APPDATA%\com.markdownnative.desktop` and `%LOCALAPPDATA%\com.markdownnative.desktop`.

**macOS:**

```bash
rm -rf -- \
  "/Applications/Markdown Desktop.app" \
  "$HOME/Library/Application Support/com.markdownnative.desktop" \
  "$HOME/Library/Caches/com.markdownnative.desktop" \
  "$HOME/Library/Logs/com.markdownnative.desktop" \
  "$HOME/Library/Preferences/com.markdownnative.desktop"
```

**Linux:**

```bash
sudo apt remove markdown-desktop   # or: sudo dnf remove markdown-desktop
rm -rf -- \
  "$HOME/.config/com.markdownnative.desktop" \
  "$HOME/.local/share/com.markdownnative.desktop" \
  "$HOME/.local/state/com.markdownnative.desktop" \
  "$HOME/.cache/com.markdownnative.desktop"
```

## Development

Requires Node.js 26.x, pnpm 12.3.4 or newer, Rust stable meeting the manifest minimum, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install --frozen-lockfile
pnpm tauri dev
```

```bash
pnpm check
pnpm test
pnpm smoke:visual
pnpm smoke:block-drag
pnpm smoke:renderers
pnpm architecture:check
pnpm verify:dependencies
pnpm tauri build
```

`pnpm smoke:visual` runs the curated visual-editor acceptance suites (revision ownership, visual draft history, rendered-pane contract, and MarkdownView interaction paths). `pnpm smoke:block-drag` starts an isolated Vite fixture and performs a real mouse gesture in headless Chromium, checking grip hit-testing, cursor affordance, and the resulting source reorder. It is browser evidence, not a physical packaged-WebView test. `pnpm smoke:packaged` launches the built desktop binary with `MARKDOWN_DESKTOP_ACCEPTANCE=1` to exercise synthetic DOM input, undo/redo, Save/reload, Find, exact rendered text and cross-block selection, pointer block dragging, composition handlers, and split-mode latency. Save and close existing application instances first: the harness refuses to terminate them. Composition must reach source and preview; the five-edit split probe waits for rendering and animation frames, with a 150 ms average budget. These synthetic checks are not physical keyboard, pointer, OS IME, screen-reader, or compositor-presentation evidence. `pnpm oracle:github-readme` validates the GitHub-host fixture oracle in Rust.
`pnpm architecture:check` verifies that `ARCHITECTURE.md` contains current
file sizes, line counts, and curated summaries. Run `pnpm architecture:refresh`
after adding, removing, renaming, or materially resizing a maintained file.

`pnpm build:app` stages unsigned portable and installable outputs under `Apps/`. Signed release builds need `TAURI_SIGNING_PRIVATE_KEY` (or `TAURI_SIGNING_PRIVATE_KEY_PATH`) and `pnpm build:release`.

## Privacy and updates

### Upgrade the development stack

```text
pnpm full:upgrade --dry-run
pnpm full:upgrade
```

`full:upgrade` is the explicit major-upgrade operation, separate from
`purge:fresh`. It updates pnpm, stable Rust/Cargo and rustfmt/Clippy, the
Cargo edit/audit/deny tools, direct JavaScript and Rust dependency ranges,
resolvable transitive dependencies, Git-sourced JavaScript dependencies, and
GitHub Actions (retaining immutable action hashes). It raises the Rust
manifest minimum to the updated stable compiler before resolving crates.
Thus a direct dependency such as Comrak can move beyond an old `0.x` range.
On Windows it repairs an npm-managed pnpm shim through npm before verifying the
active command, so the upgrade is not satisfied by changing an unused pnpm
installation.

The project requires **pnpm >=12.3.4**, with no exact package-manager pin;
CI installs `latest` and checks the minimum. Node remains on the supported
26.x line; Node installers, OS SDKs and system packages are not changed.
There are no Git submodules in this repository. If introduced later, nested
checkouts require separate review; the command refuses to overwrite them.

Save and close Markdown Desktop first. Before mutation, the command snapshots
the current manifests, lockfiles and workflows—including uncommitted edits—to
ignored `.upgrade-backups/run-ID/`. It retains the previous `node_modules` tree
in the snapshot, preserves shared/build caches, and runs the
security, test, accessibility, native packaging and synthetic packaged-input
gates. A failure exits nonzero, retaining the candidate changes and a step
report for inspection; it does **not** mean the upgrade is release-ready.
Restore only the saved project metadata with:

```text
pnpm full:upgrade --restore run-ID
pnpm install --frozen-lockfile
```

Replace `run-ID` with the printed snapshot name. Global tools and generated
build outputs are not rolled back. Do not edit upgrade-owned files while the
command runs. An interrupted process may leave `.upgrade-backups/upgrade.lock`;
remove that single lock only after confirming no upgrade is running.

Some transitive versions remain constrained by upstream parents. The command
prints remaining Rust duplicate dependency paths and direct-upgrade availability;
it never forces incompatible transitive overrides or enables prereleases.
Review any necessary source/API migrations before committing. Dry-run shows
the command plan without network, installation, or deletion.

The JavaScript TypeScript package follows the installed `svelte-check` peer
contract; the native TypeScript alias can independently track its newest
version. This prevents a blanket major update from breaking Svelte's compiler
API integration. Unknown peer-range syntax fails for review rather than being
guessed. Peer-dependency checks are part of the verification gate.

`purge:fresh` still refreshes only within existing manifest ranges and checks
toolchain compatibility **before** deleting caches or lockfiles. It is not a
replacement for `full:upgrade`.

### Linux GTK/GLib compatibility boundary

The remaining GLib advisory is upstream of the application. Tauri's current
Linux host uses GTK3 and WebKitGTK; its Debian package and prerequisite
documentation describe that stack. The [RustSec advisory](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
records the affected `glib`
`VariantStrIter` unsoundness and identifies `glib >=0.20` as the patched line.
This project cannot safely force that crate version because the GTK3 Rust
bindings and FFI graph are coupled to the older GLib API/ABI. The verified
dependency path is `tauri` -> `wry`/`webkit2gtk` -> `gtk` -> `glib` on Linux.

Forcing a transitive override, replacing Tauri with a different desktop
backend, or adopting a prerelease Tauri major would trade one visible advisory
for an unverified build/runtime defect. The safe resolution is a reviewed
stable Tauri/Wry migration to the GTK4/WebKitGTK6 stack when that upstream
support is released, followed by native Linux runtime testing. Until then the
warning remains documented in [SECURITY.md](./SECURITY.md), visible in
`cargo audit`, and is not mislabeled as fixed. See the [Tauri Linux packaging
requirements](https://v2.tauri.app/distribute/debian/) and [WebView version
matrix](https://v2.tauri.app/reference/webview-versions/) for the platform
boundary.

Documents stay on your machine in the current minimum editor; no provider call
is made by opening the app. The later Assistant milestone will require an
explicit provider and explicit bounded context before any Markdown leaves the
machine. Rendered Markdown is sanitized, and filesystem and remote asset
access are restricted in the Rust host.

**Help → Check for Updates** (or **About**) checks a signed update manifest from GitHub Releases. A quiet check may run after launch to notify you in the status bar; updates are never downloaded or installed until you confirm. The signing private key is a maintainer secret and is not stored in this repository.

Upstream dependency advisories that remain in the stable Tauri Linux stack are documented in [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
