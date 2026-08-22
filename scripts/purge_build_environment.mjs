#!/usr/bin/env node

/*
 * Project-local clean/update workflow for Markdown Desktop.
 *
 * This intentionally removes only project-owned trees. It never deletes the
 * shared pnpm store, Cargo registry, or another repository's files.
 *
 *   pnpm purge                 remove project caches, keep lockfiles
 *   pnpm purge:rebuild         purge, reinstall, and run a build proof
 *   pnpm purge:fresh           purge, regenerate both lockfiles, and prove build
 *   pnpm update:dependencies   regenerate both lockfiles without cache purge
 *   node scripts/purge_build_environment.mjs --dry-run --fresh
 */

import {
  existsSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tauriRoot = join(projectRoot, 'src-tauri');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const fresh = args.has('--fresh');
const locksOnly = args.has('--locks-only');
const rebuild = args.has('--rebuild');
const includeApps = args.has('--include-app');
const json = args.has('--json');

const knownOptions = new Set([
  '--dry-run', '--fresh', '--locks-only', '--rebuild', '--include-app', '--json', '--help', '-h',
]);
const unknown = [...args].filter((arg) => !knownOptions.has(arg));
if (unknown.length) fail(`Unknown option(s): ${unknown.join(', ')}`);
if (fresh && locksOnly) fail('Use either --fresh or --locks-only, not both.');

/** @type {{ action: string, path?: string, status: string, detail?: string }[]} */
const actions = [];

function log(message) {
  if (!json) console.log(message);
}

function record(action, path, status, detail) {
  actions.push({ action, path, status, detail });
  if (!json) log(`${status.padEnd(8)} ${action.padEnd(10)} ${path}${detail ? ` (${detail})` : ''}`);
}

function fail(message) {
  throw new Error(message);
}

function projectPath(relativePath) {
  const absolute = resolve(projectRoot, relativePath);
  const rootWithSeparator = `${projectRoot}${sep}`;
  if (absolute !== projectRoot && !absolute.startsWith(rootWithSeparator)) {
    fail(`Refusing to access a path outside the project root: ${relativePath}`);
  }
  return absolute;
}

function removeProjectPath(relativePath, optional = true) {
  const absolute = projectPath(relativePath);
  if (!existsSync(absolute)) {
    record('remove', relativePath, optional ? 'skip' : 'missing');
    return;
  }
  if (dryRun) {
    record('remove', relativePath, 'dry-run');
    return;
  }
  rmSync(absolute, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  record('remove', relativePath, 'ok');
}

function run(command, commandArgs, cwd = projectRoot) {
  const display = `${command} ${commandArgs.join(' ')}`;
  if (dryRun) {
    record('run', display, 'dry-run');
    return;
  }
  log(`\n> ${display}`);
  const spawnCommand = process.platform === 'win32' && command === 'pnpm' ? 'cmd.exe' : command;
  const spawnArgs = process.platform === 'win32' && command === 'pnpm'
    ? ['/d', '/s', '/c', `pnpm ${commandArgs.join(' ')}`]
    : commandArgs;
  const result = spawnSync(spawnCommand, spawnArgs, {
    cwd,
    stdio: json ? 'pipe' : 'inherit',
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) fail(`${display}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || `exit ${result.status}`;
    fail(`${display}: ${detail}`);
  }
  record('run', display, 'ok');
}

function assertAppClosed() {
  if (dryRun || process.platform !== 'win32') return;
  const result = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq markdown-desktop.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status === 0 && result.stdout?.includes('markdown-desktop.exe')) {
    fail('Close Markdown Desktop before purging target or Apps output; Windows has the binary open.');
  }
}

function purgeCaches() {
  assertAppClosed();
  log('\nPurging project-owned build caches and install trees...');
  for (const path of [
    'node_modules',
    'dist',
    '.svelte-check',
    '.vite',
    'node_modules/.vite',
    '.wcag-audit-results',
    'src-tauri/gen',
    'src-tauri/target',
  ]) removeProjectPath(path);
  if (includeApps) removeProjectPath('Apps');
  else record('keep', 'Apps', 'skip', 'release staging; use --include-app to remove');
  record('keep', 'src', 'skip', 'application source');
  record('keep', 'src-tauri/src', 'skip', 'Rust application source');
}

function refreshLocks() {
  log('\nRegenerating pnpm-lock.yaml and Cargo.lock from manifest ranges...');
  removeProjectPath('pnpm-lock.yaml');
  removeProjectPath('src-tauri/Cargo.lock');
  run('pnpm', ['install', '--lockfile-only', '--no-frozen-lockfile', '--ignore-scripts']);
  run('cargo', ['generate-lockfile', '--manifest-path', 'Cargo.toml'], tauriRoot);
}

function rebuildProof() {
  log('\nReinstalling and running a clean-tree proof...');
  run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts']);
  run('pnpm', ['check']);
  run('pnpm', ['test']);
  run('cargo', ['fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--check']);
  run('cargo', ['check', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--all-targets', '--all-features']);
  run('cargo', ['clippy', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--all-targets', '--all-features', '--', '-D', 'warnings']);
  run('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--all-features']);
  run('pnpm', ['build']);
  run('pnpm', ['accessibility:audit']);
}

function printHelp() {
  console.log(`Usage: node scripts/purge_build_environment.mjs [options]

Project-local clean/update workflow. Shared pnpm and Cargo caches are preserved.

  --dry-run       show actions without deleting or running commands
  --fresh         purge project caches, delete and regenerate both lockfiles
  --locks-only    regenerate both lockfiles without purging caches
  --rebuild       reinstall and run the clean-tree proof after the operation
  --include-app   also remove the generated Apps/ release staging directory
  --json          emit a machine-readable action summary
`);
}

if (args.has('--help') || args.has('-h')) {
  printHelp();
} else {
  try {
    if (!locksOnly) purgeCaches();
    if (fresh || locksOnly) refreshLocks();
    if (rebuild) rebuildProof();
    const summary = {
      ok: true,
      dryRun,
      fresh,
      locksOnly,
      rebuild,
      includeApps,
      projectRoot: relative(process.cwd(), projectRoot) || '.',
      actions,
      note: 'Shared pnpm/Cargo caches were intentionally preserved.',
    };
    if (json) console.log(JSON.stringify(summary, null, 2));
    else log('\nDone.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ ok: false, error: message, actions }, null, 2));
    else console.error(`\nPurge failed: ${message}`);
    process.exitCode = 1;
  }
}
