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
const targetPlatform = targetTriple
  ? targetTriple.includes('windows')
    ? 'win32'
    : targetTriple.includes('apple-darwin')
      ? 'darwin'
      : targetTriple.includes('linux')
        ? 'linux'
        : undefined
  : process.platform;
const targetArchitecture = targetTriple
  ? targetTriple.startsWith('aarch64-')
    ? 'arm64'
    : targetTriple.startsWith('x86_64-')
      ? 'x64'
      : targetTriple.startsWith('i686-')
        ? 'ia32'
        : process.arch
  : process.arch;
if (!targetPlatform || !['win32', 'darwin', 'linux'].includes(targetPlatform)) {
  throw new Error(`Unsupported Tauri smoke target: ${targetTriple ?? process.platform}`);
}
const binaryName = targetPlatform === 'win32' ? 'markdown-desktop.exe' : 'markdown-desktop';
const releaseRoot = targetTriple
  ? join(tauriRoot, 'target', targetTriple, 'release')
  : join(tauriRoot, 'target', 'release');
const platformDirectory = `${targetPlatform}-${targetArchitecture}`;
const binary = join(releaseRoot, binaryName);
const stagedRoot = join(projectRoot, 'Apps', platformDirectory);
const portableRoot = join(stagedRoot, 'portable');
const installersRoot = join(stagedRoot, 'installers');
const config = JSON.parse(readFileSync(join(tauriRoot, 'tauri.conf.json'), 'utf8'));

const failures = [];
function findEntries(root, predicate, directories = false) {
  if (!existsSync(root)) return [];
  const matches = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (directories && predicate(entry.name, path)) matches.push(path);
      matches.push(...findEntries(path, predicate, directories));
    } else if (!directories && predicate(entry.name, path)) {
      matches.push(path);
    }
  }
  return matches;
}

if (!existsSync(binary)) failures.push(`missing release binary: ${binary}`);
else if (statSync(binary).size < 100_000) failures.push(`release binary is unexpectedly small: ${binary}`);
if (config.productName !== 'Markdown Desktop') failures.push('unexpected Tauri productName');
if (config.bundle?.publisher !== 'Roy Dawson IV') failures.push('bundle publisher must be Roy Dawson IV');
if (config.bundle?.category !== 'Productivity') failures.push('bundle category must be Productivity');
if (config.bundle?.homepage !== 'https://github.com/ImYourBoyRoy/markdown-desktop') failures.push('bundle homepage must point to the public Markdown Desktop repository');
if (config.bundle?.windows?.nsis?.installMode !== 'both') failures.push('Windows NSIS installer must support per-user and per-machine installation');
if (!Array.isArray(config.bundle?.icon) || config.bundle.icon.length === 0) failures.push('no bundle icons configured');
const associatedExtensions = new Set((config.bundle?.fileAssociations ?? []).flatMap((association) => association.ext ?? []));
for (const extension of ['md', 'markdown', 'mdown', 'mkdown']) {
  if (!associatedExtensions.has(extension)) failures.push(`missing Markdown file association: .${extension}`);
}
for (const icon of config.bundle?.icon ?? []) {
  if (!existsSync(join(tauriRoot, icon))) failures.push(`missing configured icon: ${icon}`);
}
if (!existsSync(join(portableRoot, binaryName))) failures.push(`missing staged portable artifact: ${join(portableRoot, binaryName)}`);
if (!existsSync(installersRoot)) failures.push(`missing staged installers directory: ${installersRoot}`);
else {
  const installerEntries = readdirSync(installersRoot);
  if (installerEntries.length === 0) failures.push(`staged installers directory is empty: ${installersRoot}`);
}
const stagedFiles = findEntries(stagedRoot, (name) => !name.endsWith('build-info.json'));
if (targetPlatform === 'win32') {
  if (!stagedFiles.some((path) => path.toLowerCase().endsWith('.msi'))) failures.push('Windows MSI installer is missing');
  if (!stagedFiles.some((path) => path.toLowerCase().endsWith('-setup.exe'))) failures.push('Windows NSIS installer is missing');
} else if (targetPlatform === 'darwin') {
  if (!stagedFiles.some((path) => path.toLowerCase().endsWith('.dmg'))) failures.push('macOS DMG installer is missing');
  if (findEntries(portableRoot, (name) => name.toLowerCase().endsWith('.app'), true).length === 0) failures.push('macOS application bundle is missing');
} else if (targetPlatform === 'linux') {
  if (!stagedFiles.some((path) => path.toLowerCase().endsWith('.appimage'))) failures.push('Linux AppImage is missing');
  if (!stagedFiles.some((path) => path.toLowerCase().endsWith('.deb'))) failures.push('Linux DEB package is missing');
  if (!stagedFiles.some((path) => path.toLowerCase().endsWith('.rpm'))) failures.push('Linux RPM package is missing');
}

const buildInfoPath = join(stagedRoot, 'build-info.json');
if (!existsSync(buildInfoPath)) failures.push(`missing staged build metadata: ${buildInfoPath}`);
else {
  const buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
  if ((buildInfo.target ?? null) !== (targetTriple ?? null)) {
    failures.push(`staged build target does not match smoke target: expected ${targetTriple ?? 'host'}, got ${buildInfo.target ?? 'host'}`);
  }
  if (buildInfo.platform !== targetPlatform) failures.push(`staged build platform does not match smoke target: expected ${targetPlatform}, got ${buildInfo.platform}`);
  if (buildInfo.arch !== targetArchitecture) failures.push(`staged build architecture does not match smoke target: expected ${targetArchitecture}, got ${buildInfo.arch}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Native smoke passed for ${platformDirectory}: ${binaryName}`);
