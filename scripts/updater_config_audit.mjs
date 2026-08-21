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

for (const permission of ['process:default', 'updater:default']) {
  if (!capability.permissions?.includes(permission)) failures.push(`missing updater capability permission: ${permission}`);
}
for (const marker of ['TAURI_SIGNING_PRIVATE_KEY', 'includeUpdaterJson: true', 'assetNamePattern:', 'updaterJsonPreferNsis: true', 'tauri.release.conf.json', 'gh release upload']) {
  if (!releaseWorkflow.includes(marker)) failures.push(`release workflow is missing updater marker: ${marker}`);
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

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Updater configuration audit passed: signed Tauri updater is configured for release-only artifact generation.');
