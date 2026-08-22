#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tauriRoot = join(projectRoot, 'src-tauri');
const buildArgs = process.argv.slice(2);
const targetFlagIndex = buildArgs.findIndex((argument) => argument === '--target');
const targetTriple = targetFlagIndex >= 0 ? buildArgs[targetFlagIndex + 1] : buildArgs.find((argument) => argument.startsWith('--target='))?.slice('--target='.length);
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
  throw new Error(`Unsupported Tauri target platform: ${targetTriple ?? process.platform}`);
}
const binaryName = targetPlatform === 'win32' ? 'markdown-desktop.exe' : 'markdown-desktop';
const platformDirectory = `${targetPlatform}-${targetArchitecture}`;
const destination = join(projectRoot, 'Apps', platformDirectory);
const releaseRoot = targetTriple
  ? join(tauriRoot, 'target', targetTriple, 'release')
  : join(tauriRoot, 'target', 'release');
const bundle = join(releaseRoot, 'bundle');
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const artifactPlatform = targetPlatform === 'win32'
  ? 'Windows'
  : targetPlatform === 'darwin'
    ? 'macOS'
    : 'Linux';
const artifactArchitecture = targetPlatform === 'darwin'
  ? targetArchitecture === 'arm64' ? 'Apple-Silicon' : 'Intel'
  : targetArchitecture === 'arm64' ? 'ARM64' : targetArchitecture === 'x64' ? 'x64' : targetArchitecture;
const artifactPrefix = `Markdown-Desktop-${packageJson.version}-${artifactPlatform}-${artifactArchitecture}`;

// Tauri does not remove artifacts from an earlier version before writing a
// new bundle. Clear only this generated bundle directory so local staging
// cannot publish stale product names or signatures alongside the new build.
rmSync(bundle, { recursive: true, force: true });

const pnpmArgs = ['tauri', 'build', ...buildArgs];
const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
const commandArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', `pnpm ${pnpmArgs.join(' ')}`]
  : pnpmArgs;
const result = spawnSync(command, commandArgs, {
  cwd: projectRoot,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const binary = join(releaseRoot, binaryName);
if (!existsSync(binary)) throw new Error(`Native build succeeded but ${binary} was not produced.`);
if (!existsSync(bundle)) throw new Error(`Native bundle was not produced at ${bundle}. Run a bundled release build.`);

rmSync(destination, { recursive: true, force: true });
const portable = join(destination, 'portable');
const installers = join(destination, 'installers');
mkdirSync(portable, { recursive: true });
mkdirSync(installers, { recursive: true });
cpSync(binary, join(portable, binaryName));

const portableArtifacts = [binaryName];
const installerArtifacts = [];
const bundleEntries = readdirSync(bundle, { withFileTypes: true });
for (const entry of bundleEntries) {
  const source = join(bundle, entry.name);
  const destinationRoot = entry.name === 'macos' && targetPlatform === 'darwin'
    ? portable
    : entry.name === 'appimage' && targetPlatform === 'linux'
      ? portable
      : installers;
  const target = join(destinationRoot, entry.name);
  cpSync(source, target, { recursive: true });
  if (destinationRoot === portable) portableArtifacts.push(entry.name);
  else installerArtifacts.push(entry.name);
}

function normalizeArtifactName(name) {
  const signature = name.endsWith('.sig') ? '.sig' : '';
  const base = signature ? name.slice(0, -signature.length) : name;
  if (targetPlatform === 'win32') {
    if (base.toLowerCase().endsWith('.msi')) return `${artifactPrefix}.msi${signature}`;
    if (base.toLowerCase().endsWith('-setup.exe')) return `${artifactPrefix}-setup.exe${signature}`;
  }
  if (targetPlatform === 'darwin') {
    if (base.toLowerCase().endsWith('.dmg')) return `${artifactPrefix}.dmg${signature}`;
    if (base.toLowerCase().endsWith('.app.tar.gz')) return `${artifactPrefix}.app.tar.gz${signature}`;
  }
  if (targetPlatform === 'linux') {
    if (base.toLowerCase().endsWith('.appimage')) return `${artifactPrefix}.AppImage${signature}`;
    if (base.toLowerCase().endsWith('.deb')) return `${artifactPrefix}.deb${signature}`;
    if (base.toLowerCase().endsWith('.rpm')) return `${artifactPrefix}.rpm${signature}`;
  }
  return name;
}

function normalizeStagedFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const current = join(directory, entry.name);
    if (entry.isDirectory()) {
      normalizeStagedFiles(current);
      continue;
    }
    const normalized = normalizeArtifactName(entry.name);
    if (normalized !== entry.name) renameSync(current, join(directory, normalized));
  }
}

normalizeStagedFiles(destination);

writeFileSync(join(destination, 'build-info.json'), `${JSON.stringify({
  product: packageJson.name,
  version: packageJson.version,
  platform: targetPlatform,
  arch: targetArchitecture,
  hostPlatform: process.platform,
  hostArch: process.arch,
  target: targetTriple ?? null,
  binary: binaryName,
  portable: portableArtifacts,
  installers: installerArtifacts,
  generatedAt: new Date().toISOString(),
}, null, 2)}\n`);
console.log(`Portable artifacts staged in ${portable}`);
console.log(`Installers staged in ${installers}`);
