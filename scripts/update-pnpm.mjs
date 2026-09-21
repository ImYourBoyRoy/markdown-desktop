#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MIN_PNPM, versionAtLeast } from './upgrade-plan.mjs';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function run(command, args) {
  const throughCmd = process.platform === 'win32' && ['npm.cmd', 'pnpm.cmd'].includes(command);
  const executable = throughCmd ? 'cmd.exe' : command;
  const argv = throughCmd ? ['/d', '/s', '/c', [command, ...args].join(' ')] : args;
  return execFileSync(executable, argv, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function resolvedPnpm() {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const output = run(locator, ['pnpm']);
  const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!first) throw new Error('Could not resolve the active pnpm executable');
  return first;
}

function isNpmGlobalShim(executable) {
  const globalRoot = run(npmCommand, ['root', '--global']);
  const packageManifest = join(globalRoot, 'pnpm', 'package.json');
  if (!existsSync(packageManifest)) return false;
  const executableDirectory = dirname(executable);
  const globalBinDirectories = new Set([
    dirname(globalRoot),
    join(dirname(dirname(globalRoot)), 'bin'),
  ]);
  if (!globalBinDirectories.has(executableDirectory)) return false;
  try {
    const manifest = JSON.parse(readFileSync(packageManifest, 'utf8'));
    return manifest.name === 'pnpm';
  } catch {
    return false;
  }
}

const before = run(pnpmCommand, ['--version']);
const executable = resolvedPnpm();

if (isNpmGlobalShim(executable)) {
  // npm owns this shim, so pnpm self-update would leave the command resolved by
  // the shell unchanged. Update the owner directly and verify it afterward.
  console.log(`Updating npm-managed pnpm at ${executable}`);
  run(npmCommand, ['install', '--global', 'pnpm@latest']);
} else {
  console.log(`Updating pnpm through its self-update channel (${executable})`);
  run(pnpmCommand, ['self-update', '--latest']);
}

const after = run(pnpmCommand, ['--version']);
if (!/^\d+\.\d+\.\d+$/.test(after) || !versionAtLeast(after, MIN_PNPM)) {
  throw new Error(`pnpm update did not produce a stable ${MIN_PNPM}+ command; before=${before}, after=${after}`);
}

console.log(`pnpm ${before} -> ${after} (${resolvedPnpm()})`);
