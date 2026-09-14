import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureSnapshot, restoreSnapshot } from './upgrade-snapshot.mjs';
import { parseUpgradeArgs, upgradePlan, versionAtLeast, highestCaretMajor, assertMermaidCompatibility } from './upgrade-plan.mjs';
import { commandSpec } from './upgrade-process.mjs';
import { normalizeActionVersionComments } from './workflow-comments.mjs';

test('stable minimum version comparison rejects prereleases and stale versions', () => {
  assert.equal(versionAtLeast('12.3.4', '12.3.4'), true);
  assert.equal(versionAtLeast('13.0.0', '12.3.4'), true);
  assert.equal(versionAtLeast('12.3.3', '12.3.4'), false);
  assert.throws(() => versionAtLeast('13.0.0-beta.1', '12.3.4'));
});
test('TypeScript compatibility follows the current Svelte peer contract', () => {
  assert.equal(highestCaretMajor('^5.0.0 || ^6.0.0'), 6);
  assert.equal(highestCaretMajor('^6.0.0 || ^7.0.0'), 7);
  assert.throws(() => highestCaretMajor('*'));
  assert.throws(() => highestCaretMajor(undefined));
});
test('renderer upgrades stay within the verified cross-platform browser floor', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => assertMermaidCompatibility(manifest.dependencies?.mermaid));
  assert.doesNotThrow(() => assertMermaidCompatibility('^11.17.2'));
  assert.throws(() => assertMermaidCompatibility('^12.0.0'), /target-OS\/macOS compatibility review/);
  assert.throws(() => assertMermaidCompatibility('*'), /Unsupported Mermaid dependency range/);
});
test('arguments reject unknown flags, combinations and traversal', () => {
  assert.deepEqual(parseUpgradeArgs([]), { apply: true });
  assert.deepEqual(parseUpgradeArgs(['--dry-run']), { 'dry-run': true });
  assert.deepEqual(parseUpgradeArgs(['--restore', 'run-ABC123']), { restore: 'run-ABC123' });
  for (const args of [['--force'], ['--restore', '../package.json'], ['--dry-run', '--restore', 'run-ABC']]) assert.throws(() => parseUpgradeArgs(args));
});
test('updates manifest ranges before lockfile resolution and runs full gates', () => {
  const plan = upgradePlan().map(([command, args]) => `${command} ${args.join(' ')}`);
  assert.ok(plan.indexOf('cargo +stable upgrade --manifest-path src-tauri/Cargo.toml --incompatible allow --pinned allow') < plan.indexOf('cargo +stable update --manifest-path src-tauri/Cargo.toml'));
  assert.ok(plan.includes('pnpm update --latest --include-github-actions'));
  assert.ok(plan.includes('node scripts/normalize-workflow-comments.mjs'));
  assert.ok(plan.includes('pnpm verify:dependencies'));
  assert.ok(plan.includes('pnpm tauri build'));
  assert.match(plan.at(-1), /packaged_acceptance.*--require-binary$/);
  assert.equal(plan.some((step) => /purge|--force|reset --hard/.test(step)), false);
});
test('workflow action comments keep only the current version after an update', () => {
  const source = '- uses: actions/checkout@abc #v7.0.1  v6\n- uses: dtolnay/rust-toolchain@def # Rust stable\n';
  assert.equal(
    normalizeActionVersionComments(source),
    '- uses: actions/checkout@abc # v7.0.1\n- uses: dtolnay/rust-toolchain@def # Rust stable\n',
  );
});
test('Windows plan arguments are shell safe; raw path arguments remain arrays', () => {
  assert.equal(commandSpec('pnpm', ['update', '--latest'], 'win32')[0], 'cmd.exe');
  assert.throws(() => commandSpec('pnpm', ['update', 'x&whoami'], 'win32'));
  assert.throws(() => commandSpec('pnpm', ['update', 'x>file'], 'win32'));
  assert.deepEqual(commandSpec('cargo', ['--manifest-path', 'C:/A B/日本/Cargo.toml'], 'win32'), ['cargo', ['--manifest-path', 'C:/A B/日本/Cargo.toml']]);
});
test('help and dry-run do not mutate manifests or create snapshots', () => {
  const before = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const hadBackups = existsSync(new URL('../.upgrade-backups', import.meta.url));
  for (const flag of ['--help', '--dry-run']) {
    const output = execFileSync(process.execPath, ['scripts/full_upgrade.mjs', flag], { encoding: 'utf8' });
    assert.match(output, /upgrade/i);
  }
  assert.equal(readFileSync(new URL('../package.json', import.meta.url), 'utf8'), before);
  assert.equal(existsSync(new URL('../.upgrade-backups', import.meta.url)), hadBackups);
  const invalid = spawnSync(process.execPath, ['scripts/full_upgrade.mjs', '--bad-flag']);
  assert.equal(invalid.status, 1);
});

test('restore refuses to race an active upgrade lock', () => {
  const backupRoot = new URL('../.upgrade-backups/', import.meta.url);
  mkdirSync(backupRoot, { recursive: true });
  const lock = new URL('../.upgrade-backups/upgrade.lock', import.meta.url);
  assert.equal(existsSync(lock), false);
  writeFileSync(lock, 'test lock');
  try {
    const result = spawnSync(process.execPath, ['scripts/full_upgrade.mjs', '--restore', 'run-does-not-exist'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /already running/);
  } finally {
    unlinkSync(lock);
  }
});

test('snapshot restores dirty metadata, removes only newly created metadata, preserves other files', () => {
  const root = mkdtempSync(join(tmpdir(), 'upgrade-restore-'));
  const backup = join(root, 'snapshot');
  mkdirSync(backup);
  try {
    writeFileSync(join(root, '日本 package.json'), 'user uncommitted content');
    captureSnapshot(root, backup, ['日本 package.json', 'lock.yaml']);
    writeFileSync(join(root, '日本 package.json'), 'upgraded');
    writeFileSync(join(root, 'lock.yaml'), 'new lock');
    writeFileSync(join(root, 'user.txt'), 'keep');
    restoreSnapshot(root, backup, ['日本 package.json', 'lock.yaml']);
    assert.equal(readFileSync(join(root, '日本 package.json'), 'utf8'), 'user uncommitted content');
    assert.equal(existsSync(join(root, 'lock.yaml')), false);
    assert.equal(readFileSync(join(root, 'user.txt'), 'utf8'), 'keep');
    writeFileSync(join(backup, '日本 package.json'), 'corrupted');
    assert.throws(() => restoreSnapshot(root, backup, ['日本 package.json', 'lock.yaml']), /integrity/);
    assert.equal(readFileSync(join(root, '日本 package.json'), 'utf8'), 'user uncommitted content');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
