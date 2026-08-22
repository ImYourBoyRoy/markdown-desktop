#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');
const parseJson = (relativePath) => JSON.parse(read(relativePath));
const failures = [];

const packageJson = parseJson('package.json');
const cargoToml = read('src-tauri/Cargo.toml');
const tauriConfig = parseJson('src-tauri/tauri.conf.json');
const releaseConfig = parseJson('src-tauri/tauri.release.conf.json');
const capability = parseJson('src-tauri/capabilities/default.json');
const releaseWorkflow = read('.github/workflows/release.yml');

for (const dependency of ['@tauri-apps/plugin-process', '@tauri-apps/plugin-updater']) {
  if (!packageJson.dependencies?.[dependency]) failures.push(`missing frontend updater dependency: ${dependency}`);
}
for (const dependency of ['tauri-plugin-process', 'tauri-plugin-updater']) {
  if (!new RegExp(`^${dependency.replaceAll('-', '\\-')}\\s*=`, 'm').test(cargoToml)) {
    failures.push(`missing Rust updater dependency: ${dependency}`);
  }
}

const updater = tauriConfig.plugins?.updater;
if (!updater || typeof updater.pubkey !== 'string' || updater.pubkey.length < 80) {
  failures.push('Tauri updater public key is missing or still a placeholder');
}
if (!Array.isArray(updater?.endpoints) || updater.endpoints.length !== 1 || !updater.endpoints[0].startsWith('https://')) {
  failures.push('Tauri updater must have exactly one HTTPS endpoint');
}
if (tauriConfig.bundle?.createUpdaterArtifacts !== false) failures.push('base Tauri config must not require signing secrets');
if (releaseConfig.bundle?.createUpdaterArtifacts !== true) failures.push('release Tauri config must enable updater artifacts');

for (const permission of ['process:allow-restart', 'updater:default']) {
  if (!capability.permissions?.includes(permission)) failures.push(`missing updater capability permission: ${permission}`);
}
for (const forbidden of ['process:default', 'opener:default', 'opener:allow-reveal-item-in-dir']) {
  if (capability.permissions?.includes(forbidden)) failures.push(`capability is broader than required: ${forbidden}`);
}
if (!capability.permissions?.includes('opener:allow-open-url')) {
  failures.push('missing narrowly scoped opener permission: opener:allow-open-url');
}
for (const marker of ['TAURI_SIGNING_PRIVATE_KEY', 'includeUpdaterJson: true', 'assetNamePattern:', 'updaterJsonPreferNsis: true', 'tauri.release.conf.json', 'gh release upload']) {
  if (!releaseWorkflow.includes(marker)) failures.push(`release workflow is missing updater marker: ${marker}`);
}
const prePublishVerification = releaseWorkflow.indexOf('name: Verify release assets before publication');
const publishRelease = releaseWorkflow.indexOf('name: Publish release');
if (prePublishVerification < 0 || publishRelease < 0 || prePublishVerification > publishRelease) {
  failures.push('release assets must be verified before publication');
}
if (!releaseWorkflow.includes('releaseTag = if') || !releaseWorkflow.includes('!inputs.verify_only')) {
  failures.push('manual release dispatch and verify-only behavior must use the versioned tag safely');
}
for (const marker of ['windows-11-vs2026-arm', 'ubuntu-22.04-arm', 'aarch64-pc-windows-msvc', 'aarch64-unknown-linux-gnu', 'Windows-ARM64', 'Linux-ARM64', 'windows-aarch64', 'linux-aarch64']) {
  if (!releaseWorkflow.includes(marker)) failures.push(`release workflow is missing ARM updater marker: ${marker}`);
}
for (const obsoleteMarker of ['uploadUpdaterJson:', 'releaseAssetNamePattern:']) {
  if (releaseWorkflow.includes(obsoleteMarker)) failures.push(`release workflow still uses obsolete Tauri Action input: ${obsoleteMarker}`);
}
if (!/max-parallel:\s*1/.test(releaseWorkflow)) {
  failures.push('release workflow must serialize shared draft-release/latest.json uploads');
}
if (!releaseWorkflow.includes('Release tag must match package.json version')) {
  failures.push('release workflow must reject tags that do not match package.json version');
}

if (read('src-tauri/src/lib.rs').includes('check_for_updates') || read('src/lib/ipc.ts').includes('check_for_updates')) {
  failures.push('legacy unauthenticated custom update command remains wired');
}
if (!read('src-tauri/src/lib.rs').includes('check-for-updates')) {
  failures.push('Help menu must expose check-for-updates');
}
if (!read('src/lib/updater.ts').includes('checkForAppUpdate') || !read('src/lib/updater.ts').includes('installAppUpdate')) {
  failures.push('frontend updater module must expose checkForAppUpdate and installAppUpdate');
}
if (/api\.github\.com\/repos\/.*\/releases\/latest/.test(read('src/App.svelte')) || /api\.github\.com\/repos\/.*\/releases\/latest/.test(read('src/lib/updater.ts'))) {
  failures.push('webview must not fetch GitHub Releases directly; use the signed Tauri updater');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Updater configuration audit passed: signed Tauri updater is configured for release-only artifact generation.');
