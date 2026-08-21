# Security

Markdown Desktop processes documents locally and does not upload document contents to a service. Markdown is treated as untrusted input: rendered HTML is sanitized, filesystem paths are authorized in Rust, and remote assets are restricted and revalidated across redirects.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository when it is enabled. If private reporting is unavailable, open a minimal issue without publishing exploit details and ask for a private contact channel.

Do not include documents, credentials, signing keys, private paths, or other sensitive data in an issue.

## Dependency audit status

The current stable dependency graph has no known vulnerability findings in `cargo audit` or the configured JavaScript audit gate. `cargo audit` does report upstream maintenance and unsoundness advisories that are not suppressed:

- The GTK3/GLib advisories come from Tauri 2.11.5's Linux Wry backend.
- The `unic-*` advisories come from Tauri 2.11.5's `tauri-utils` URLPattern dependency.
- The remaining `proc-macro-error` advisory is pulled by the GTK3 macro stack.

The current stable Tauri release still declares GTK3/WebKitGTK 4.x and `urlpattern = "0.3"`. Removing these findings requires a stable upstream Tauri migration; this project does not replace those crates with unreleased forks or hide the findings with an advisory allowlist.
