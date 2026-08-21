#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tauriRoot = join(projectRoot, 'src-tauri');
const binaryName = process.platform === 'win32' ? 'markdown-desktop.exe' : 'markdown-desktop';
const buildArgs = process.argv.slice(2);
const targetFlagIndex = buildArgs.findIndex((argument) => argument === '--target');
const targetTriple = targetFlagIndex >= 0 ? buildArgs[targetFlagIndex + 1] : buildArgs.find((argument) => argument.startsWith('--target='))?.slice('--target='.length);
const platformDirectory = targetTriple ?? `${process.platform}-${process.arch}`;
const destination = join(projectRoot, 'Apps', platformDirectory);

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

const releaseRoot = targetTriple
  ? join(tauriRoot, 'target', targetTriple, 'release')
  : join(tauriRoot, 'target', 'release');
const binary = join(releaseRoot, binaryName);
const bundle = join(releaseRoot, 'bundle');
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
  const destinationRoot = entry.name === 'macos' && process.platform === 'darwin'
    ? portable
    : entry.name === 'appimage' && process.platform === 'linux'
      ? portable
      : installers;
  const target = join(destinationRoot, entry.name);
  cpSync(source, target, { recursive: true });
  if (destinationRoot === portable) portableArtifacts.push(entry.name);
  else installerArtifacts.push(entry.name);
}

const packageJson = JSON.parse(await (await import('node:fs/promises')).readFile(join(projectRoot, 'package.json'), 'utf8'));
writeFileSync(join(destination, 'build-info.json'), `${JSON.stringify({
  product: packageJson.name,
  version: packageJson.version,
  platform: process.platform,
  arch: process.arch,
  target: targetTriple ?? null,
  binary: binaryName,
  portable: portableArtifacts,
  installers: installerArtifacts,
  generatedAt: new Date().toISOString(),
}, null, 2)}\n`);
console.log(`Portable artifacts staged in ${portable}`);
console.log(`Installers staged in ${installers}`);
