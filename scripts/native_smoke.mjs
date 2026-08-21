#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tauriRoot = join(projectRoot, 'src-tauri');
const buildArgs = process.argv.slice(2);
const targetFlagIndex = buildArgs.findIndex((argument) => argument === '--target');
const targetTriple = targetFlagIndex >= 0
  ? buildArgs[targetFlagIndex + 1]
  : buildArgs.find((argument) => argument.startsWith('--target='))?.slice('--target='.length);
const binaryName = process.platform === 'win32' ? 'markdown-desktop.exe' : 'markdown-desktop';
const releaseRoot = targetTriple
  ? join(tauriRoot, 'target', targetTriple, 'release')
  : join(tauriRoot, 'target', 'release');
const platformDirectory = targetTriple ?? `${process.platform}-${process.arch}`;
const binary = join(releaseRoot, binaryName);
const stagedRoot = join(projectRoot, 'Apps', platformDirectory);
const portableRoot = join(stagedRoot, 'portable');
const installersRoot = join(stagedRoot, 'installers');
const config = JSON.parse(readFileSync(join(tauriRoot, 'tauri.conf.json'), 'utf8'));

const failures = [];
if (!existsSync(binary)) failures.push(`missing release binary: ${binary}`);
else if (statSync(binary).size < 100_000) failures.push(`release binary is unexpectedly small: ${binary}`);
if (config.productName !== 'Markdown Desktop Viewer-Editor') failures.push('unexpected Tauri productName');
if (!Array.isArray(config.bundle?.icon) || config.bundle.icon.length === 0) failures.push('no bundle icons configured');
for (const icon of config.bundle?.icon ?? []) {
  if (!existsSync(join(tauriRoot, icon))) failures.push(`missing configured icon: ${icon}`);
}
if (!existsSync(join(portableRoot, binaryName))) failures.push(`missing staged portable artifact: ${join(portableRoot, binaryName)}`);
if (!existsSync(installersRoot)) failures.push(`missing staged installers directory: ${installersRoot}`);
else {
  const installerEntries = readdirSync(installersRoot);
  if (installerEntries.length === 0) failures.push(`staged installers directory is empty: ${installersRoot}`);
}

const buildInfoPath = join(stagedRoot, 'build-info.json');
if (!existsSync(buildInfoPath)) failures.push(`missing staged build metadata: ${buildInfoPath}`);
else {
  const buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
  if ((buildInfo.target ?? null) !== (targetTriple ?? null)) {
    failures.push(`staged build target does not match smoke target: expected ${targetTriple ?? 'host'}, got ${buildInfo.target ?? 'host'}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Native smoke passed for ${platformDirectory}: ${binaryName}`);
