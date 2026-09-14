#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, openSync, closeSync, unlinkSync, renameSync, lstatSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUpgradeArgs, upgradePlan } from './upgrade-plan.mjs';
import { runCommand } from './upgrade-process.mjs';
import { captureSnapshot, restoreSnapshot, writeJson } from './upgrade-snapshot.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const backupRoot = join(root, '.upgrade-backups');
const workflowDirectory = join(root, '.github/workflows');
const workflows = existsSync(workflowDirectory)
  ? readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/.test(name)).map((name) => `.github/workflows/${name}`)
  : [];
const files = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'rust-toolchain.toml', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', ...workflows];
let snapshot;
let ownsLock = false;
const lock = join(backupRoot, 'upgrade.lock');
const report = { version: 1, startedAt: new Date().toISOString(), completed: [], status: 'running' };

function saveReport() {
  if (snapshot) writeJson(join(snapshot, 'report.json'), report);
}

try {
  const options = parseUpgradeArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: pnpm full:upgrade [--dry-run | --help | --restore run-ID]\nUpdates pnpm, stable Rust/Cargo, Cargo audit/edit tools, JS/Rust dependencies and CI actions.\nPreserves project caches. Takes a manifest/lockfile snapshot before upgrades.\nRuns security, tests, accessibility and native packaging; failures exit nonzero.\nNode stays on the project-required 26.x line and must be installed separately.\nRestore affects project metadata only; global tools/build outputs are not rolled back.');
  } else if (options.restore) {
    if (existsSync(lock)) throw new Error('An upgrade is already running; wait for it to finish before restoring a snapshot.');
    if (!existsSync(backupRoot)) throw new Error(`No upgrade snapshots found under ${backupRoot}`);
    const directory = realpathSync(join(backupRoot, options.restore));
    if (!directory.startsWith(`${realpathSync(backupRoot)}${sep}`)) throw new Error('Snapshot escapes backup directory');
    restoreSnapshot(root, directory, files);
    console.log('Restored pre-upgrade project metadata. Run pnpm install --frozen-lockfile. Global tool versions were not restored.');
  } else if (options['dry-run']) {
    console.log('No commands run and no files changed. Snapshot first, then:');
    for (const [command, args] of upgradePlan()) console.log(`${command} ${args.join(' ')}`);
  } else {
    if (Number(process.versions.node.split('.')[0]) !== 26) throw new Error('Install Node 26.x before upgrading.');
    // This repository has Git-sourced packages, not Git submodules. Refuse a
    // newly introduced checkout boundary instead of resetting nested worktrees.
    if (existsSync(join(root, '.gitmodules'))) throw new Error('Git submodules detected: update/review their revisions separately before using this workflow. Git-sourced pnpm dependencies are supported.');
    for (const command of ['pnpm', 'rustup', 'git']) runCommand(command, ['--version'], root, true);
    if (process.platform === 'win32') {
      const processes = runCommand('tasklist.exe', ['/FI', 'IMAGENAME eq markdown-desktop.exe', '/FO', 'CSV', '/NH'], root, true);
      if (/markdown-desktop\.exe/i.test(processes)) throw new Error('Save and close Markdown Desktop before upgrading.');
    }
    mkdirSync(backupRoot, { recursive: true });
    if (!realpathSync(backupRoot).startsWith(`${realpathSync(root)}${sep}`)) throw new Error('Backup directory must remain inside the project');
    closeSync(openSync(lock, 'wx'));
    ownsLock = true;
    snapshot = mkdtempSync(join(backupRoot, 'run-'));
    captureSnapshot(root, snapshot, files);
    console.log(`Pre-upgrade snapshot: ${snapshot}`);
    saveReport();
    for (const [command, args] of upgradePlan()) {
      console.log(`\n> ${command} ${args.join(' ')}`);
      report.currentStep = [command, ...args];
      saveReport();
      if (command === 'pnpm' && args[0] === 'update') {
        const modules = join(root, 'node_modules');
        // pnpm major versions can use different store/link layouts. Retain the
        // old tree with an atomic same-volume rename, never a recursive delete.
        if (existsSync(modules)) {
          if (lstatSync(modules).isSymbolicLink()
            || !realpathSync(modules).startsWith(`${realpathSync(root)}${sep}`)) throw new Error('Refusing to move an external node_modules tree');
          renameSync(modules, join(snapshot, 'node_modules'));
          console.log('Previous node_modules retained in the upgrade snapshot. Shared caches are unchanged.');
        }
      }
      runCommand(command, args, root);
      report.completed.push([command, ...args]);
      saveReport();
    }
    report.status = 'passed';
    report.currentStep = null;
    saveReport();
    console.log('Full upgrade and local verification passed. Review the dependency diff before committing.');
  }
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  saveReport();
  console.error(error.message);
  if (snapshot) console.error(`Changes retained for inspection. Restore with: pnpm full:upgrade --restore ${snapshot.split(sep).at(-1)}`);
  process.exitCode = 1;
} finally {
  if (ownsLock && existsSync(lock)) unlinkSync(lock);
}
