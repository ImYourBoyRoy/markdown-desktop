# Security

Markdown Desktop processes documents locally and does not upload document contents to a service. Markdown is treated as untrusted input: rendered HTML is sanitized, filesystem paths are authorized in Rust, and remote assets are restricted and revalidated across redirects. Video files are bounded before entering the webview, and provider iframes are restricted to an HTTPS allowlist.

## Local spell-check boundary

The optional spell-check setting uses the platform WebView's local dictionary
through standard editing attributes. Markdown Desktop does not send document
text to a spelling provider or remote service, and `pre`/`code` surfaces are
excluded from the hint. WebView and operating-system dictionary behavior is
platform-dependent; users handling sensitive text should disable spell check
when their platform's dictionary policy is not acceptable.

## Local authoring diagnostics

The source editor marks and Issues panel use bounded, local diagnostics against the
current source/render revision. They do not upload document text. A diagnostic
fix is applied only when its source hash and expected range still match, then
enters the same source-preserving undo history as ordinary editing. Filesystem,
path, and remote-asset findings remain native Rust authority; the local layer
cannot grant access or bypass those checks.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository when it is enabled. If private reporting is unavailable, open a minimal issue without publishing exploit details and ask for a private contact channel.

Do not include documents, credentials, signing keys, private paths, or other sensitive data in an issue.

## Dependency audit status

Verified 2026-10-16: `pnpm audit --audit-level high` reports no known
JavaScript vulnerabilities. DOMPurify 3.4.17, Mammoth 1.13.0, the compatible
Mermaid/KaTeX overrides, and Mammoth's Argparse 2 override remain in the
reviewed graph. The yanked `yoke-derive 0.8.3` entry is replaced by 0.8.4. The
current Cargo lock resolves `rustls 0.23.46`, above the previously observed
vulnerable 0.23.44 release.
WCAGate is refreshed to the latest upstream `main` revision during every
`full:upgrade`, then pinned to that immutable commit for reproducible installs.
The current reviewed revision is
`30be59d61db6f1cc3c5e80701fb28a0346588ca7` (WCAGate 2.3.1).

`cargo audit` reports zero vulnerabilities and two visible upstream
maintenance/unsoundness warnings; they remain visible and are not hidden with
an advisory allowlist. The `RUSTSEC-2026-0285` `rustls` finding observed in
CI on 2026-09-14 remains resolved; the current lock resolves `rustls 0.23.46`.

| Advisory | Package | Root cause | Remediation boundary |
| --- | --- | --- | --- |
| RUSTSEC-2024-0429 | `glib 0.18.5` | Tauri's Linux GTK3/WebKitGTK backend | Fixed in `glib >=0.20`; the current Tauri 2.12.4 host still requires the 0.18 GTK stack. |
| RUSTSEC-2024-0370 | `proc-macro-error 1.0.4` | GTK3/GLib macro stack | Pulled by the same stable GTK3 dependency line; no compatible maintained replacement is available without forking upstream. |

The current stable Tauri 2.12.4 release remains the required cross-platform
host and retains the GTK3/WebKitGTK boundary on Linux. The all-target Cargo
tree resolves `glib 0.18.5` through `gtk 0.18.2` and `muda` into Tauri.
Removing these findings without dropping Linux support would require a
compatible upstream Tauri migration or a maintained, reviewed fork. This
project does not force an incompatible transitive override, replace Tauri with
a different desktop architecture, or claim these upstream warnings are fixed
when they are not.

Tauri's [Linux packaging
requirements](https://v2.tauri.app/distribute/debian/) and [WebView version
matrix](https://v2.tauri.app/reference/webview-versions/) document the GTK3 /
WebKitGTK boundary. A future GTK4/WebKitGTK6 migration must be treated as a
cross-platform host migration and verified on Linux; it is not safe to emulate
one with a Cargo patch in this release line.

The same principle applies to Cargo duplicate versions: the remaining pairs
are parent-constrained GTK/Tauri, Windows target, proc-macro, or crypto lines.
`cargo update` is still run so resolvable versions move forward; the audit
does not conceal irreducible upstream duplicates.

## Media boundary

The Media ribbon and `/media`/`/video`/`/embed` commands do not expose a generic
HTML or browser-network escape hatch. Local video paths are re-resolved against
the open document/workspace in Rust and capped at 2 GiB. Document-owned opaque
grants expose GET/HEAD and bounded 8 MiB byte ranges; each request revalidates
canonical containment, and closing the document revokes its grants. Large
plain GETs are rejected instead of buffering a whole file. Direct remote video is
fetched by the native host with public-host validation, one pinned DNS result,
redirect refusal, a timeout, and the same 32 MB cap. Provider embeds are limited
to HTTPS YouTube, Vimeo, and Google Drive preview origins; arbitrary `<iframe>`
markup is removed before sanitized HTML reaches the webview. Remote media is
lazy and follows the user's remote-asset setting. Resource-bearing attributes
are made inert before sanitized HTML enters a live DOM, including provider
iframes. Queued loads recheck the current privacy setting and render lifetime;
at most four media loads run per view. Local URL resolution percent-decodes
once, supports workspace-root references only with an authorized workspace,
and rejects traversal, malformed escapes, drive paths, and network shares.

## Persistence and recovery

UTF-8 BOM and UTF-16 inputs are decoded strictly. Malformed byte pairs or
surrogates produce an error rather than replacement characters that could be
saved over the original. UTF-16 writes use actual UTF-16 code units. Atomic
replacement uses Windows ReplaceFileW or same-directory rename on Unix; the
original remains at its path if replacement fails. Recovery writes and clears
are serialized per document and drained before quit or a confirmed updater
restart. Restoring a snapshot retains its original disk revision so subsequent
external writes still trigger a conflict. Shared-reference property edits must
also pass a native Comrak proof of the exact occurrence/definition pair.
