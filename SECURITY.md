# Security

Markdown Desktop processes documents locally and does not upload document contents to a service. Markdown is treated as untrusted input: rendered HTML is sanitized, filesystem paths are authorized in Rust, and remote assets are restricted and revalidated across redirects.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository when it is enabled. If private reporting is unavailable, open a minimal issue without publishing exploit details and ask for a private contact channel.

Do not include documents, credentials, signing keys, private paths, or other sensitive data in an issue.

## Dependency audit status

Verified 2026-09-14: the configured JavaScript high-severity audit gate passed.
`cargo audit --json` reports seven upstream maintenance/unsoundness warnings;
they remain visible and are not hidden with an advisory allowlist:

The `RUSTSEC-2026-0285` `rustls` finding observed in CI on 2026-09-14 was
resolved by updating the locked `rustls` line from `0.23.44` to `0.23.45`.
The current audit has zero vulnerabilities; the seven upstream
maintenance/unsoundness warnings listed below remain.

| Advisory | Package | Root cause | Remediation boundary |
| --- | --- | --- | --- |
| RUSTSEC-2024-0429 | `glib 0.18.5` | Tauri's Linux GTK3/WebKitGTK backend | Fixed in `glib >=0.20`; Tauri 2.11.5 still requires the 0.18 GTK stack. |
| RUSTSEC-2024-0370 | `proc-macro-error 1.0.4` | GTK3/GLib macro stack | Pulled by the same stable GTK3 dependency line; no compatible maintained replacement is available without forking upstream. |
| RUSTSEC-2025-0075 | `unic-char-range 0.9.0` | Tauri URLPattern support | `tauri-utils 2.9.3` requires `urlpattern 0.3`, which is the stable Tauri line. |
| RUSTSEC-2025-0080 | `unic-common 0.9.0` | Tauri URLPattern support | Same upstream URLPattern constraint. |
| RUSTSEC-2025-0081 | `unic-char-property 0.9.0` | Tauri URLPattern support | Same upstream URLPattern constraint. |
| RUSTSEC-2025-0098 | `unic-ucd-version 0.9.0` | Tauri URLPattern support | Same upstream URLPattern constraint. |
| RUSTSEC-2025-0100 | `unic-ucd-ident 0.9.0` | Tauri URLPattern support | Same upstream URLPattern constraint. |

The current stable Tauri release is still the required cross-platform host and
declares GTK3/WebKitGTK 4.x plus `urlpattern = "0.3"`. Removing these findings
without dropping Linux support would require a compatible upstream Tauri
migration or a maintained, reviewed fork. This project does not force an
incompatible transitive override, replace Tauri with a different desktop
architecture, or claim these upstream warnings are fixed when they are not.

Verified dependency path on 2026-09-13 (Linux targets):
`tauri 2.11.5 -> tauri-runtime-wry -> wry -> webkit2gtk -> gtk 0.18 -> glib
0.18.5`. The GTK/GLib advisory is therefore not reachable through a direct
application dependency choice. Tauri's [Linux packaging
requirements](https://v2.tauri.app/distribute/debian/) and [WebView version
matrix](https://v2.tauri.app/reference/webview-versions/) document the GTK3 /
WebKitGTK boundary. A future GTK4/WebKitGTK6 migration must be treated as a
cross-platform host migration and verified on Linux; it is not safe to emulate
one with a Cargo patch in this release line.

The same principle applies to Cargo duplicate versions: the remaining pairs
are parent-constrained GTK/Tauri, Windows target, proc-macro, or crypto lines.
`cargo update` is still run so resolvable versions move forward; the audit
does not conceal irreducible upstream duplicates.
