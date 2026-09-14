#!/usr/bin/env node
// ./scripts/selection_acceptance.mjs
/**
 * Selection-mapping acceptance gate for dual-pane HTML/badge sync.
 *
 * Usage:
 *   node scripts/selection_acceptance.mjs
 *   pnpm smoke:selection
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vitestBin = join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');

const suites = [
  'src/lib/html-sub-spans.test.ts',
  'src/lib/pane-scroll-sync.test.ts',
  'src/lib/acceptance-selection.test.ts',
  'src/lib/acceptance-bridge.test.ts',
  'src/lib/find.test.ts',
  'src/lib/source-map.test.ts',
  'src/lib/source-selection-index.test.ts',
  'src/lib/source-context.test.ts',
];

const requiredModules = [
  'src/lib/html-sub-spans.ts',
  'src/lib/pane-scroll-sync.ts',
  'fixtures/github-readme/badge-row.md',
];

const failures = [];
for (const modulePath of requiredModules) {
  if (!existsSync(resolve(projectRoot, modulePath))) failures.push(`missing selection module: ${modulePath}`);
}

const vitest = spawnSync(process.execPath, [vitestBin, 'run', ...suites], {
  cwd: projectRoot,
  stdio: 'inherit',
});

if (vitest.status !== 0) failures.push('one or more selection acceptance Vitest suites failed');

if (failures.length) {
  console.error('\nSelection acceptance gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('\nSelection acceptance gate passed.');
