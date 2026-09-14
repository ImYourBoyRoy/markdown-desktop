#!/usr/bin/env node
/**
 * Run the explicit Phase 0 frontend and native timing probes.
 *
 * The command is intentionally reproducible and does not write a report.
 * Each probe emits one `PHASE0_*` JSON record; the combined object printed at
 * the end can be redirected into a local, ignored report by the operator.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vitestBin = join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');
const records = {};
const failures = [];

function run(name, command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // Pass executable paths directly. `shell: true` routes a Program Files
    // path through cmd.exe and can truncate it at the first space on Windows.
    shell: false,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(`\n--- ${name} ---\n${output}`);
  const marker = output.split(/\r?\n/).find((line) => line.startsWith('PHASE0_'));
  if (marker) {
    const separator = marker.indexOf('=');
    try {
      records[name] = JSON.parse(marker.slice(separator + 1));
    } catch {
      failures.push(`${name} emitted malformed JSON`);
    }
  } else {
    failures.push(`${name} did not emit a PHASE0 JSON record`);
  }
  if (result.status !== 0) failures.push(`${name} exited with ${result.status ?? 'no status'}`);
}

if (!existsSync(vitestBin)) {
  failures.push(`missing Vitest executable: ${vitestBin}`);
} else {
  run(
    'frontend',
    process.execPath,
    [vitestBin, 'run', 'src/lib/phase0-performance.test.ts', '--pool=forks', '--maxWorkers=1', '--silent=false', '--disableConsoleIntercept'],
    { MARKDOWN_DESKTOP_PHASE0: '1' },
  );
}

run(
  'native',
  'cargo',
  [
    'test',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    'phase0_native_benchmark',
    '--',
    '--ignored',
    '--nocapture',
  ],
);

console.log('\nPHASE0_BASELINE=' + JSON.stringify({
  generatedAt: new Date().toISOString(),
  records,
  failures,
}, null, 2));

if (failures.length) {
  console.error('\nPhase 0 baseline failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
