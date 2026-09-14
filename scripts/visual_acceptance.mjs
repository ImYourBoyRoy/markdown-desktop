#!/usr/bin/env node
// ./scripts/visual_acceptance.mjs
/**
 * Curated visual-editor acceptance gate for CI and local handoff.
 *
 * Runs the unit suites that prove revision ownership, visual draft history,
 * rendered-pane contract behavior, and MarkdownView interaction paths. This
 * does not replace packaged pointer/IME/latency probes on a built binary.
 *
 * Usage:
 *   node scripts/visual_acceptance.mjs
 *   pnpm smoke:visual
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vitestBin = join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');

const acceptanceSuites = [
  'src/lib/document-revision.test.ts',
  'src/lib/document-tab-revision.test.ts',
  'src/lib/source-history.test.ts',
  'src/lib/source-sync.test.ts',
  'src/lib/html-sub-spans.test.ts',
  'src/lib/pane-scroll-sync.test.ts',
  'src/lib/rendered-pane-contract.test.ts',
  'src/lib/markdown-view-visual-editing.test.ts',
  'src/lib/markdown-view-render.test.ts',
  'src/lib/visual-structure.test.ts',
  'src/lib/rich-visual-edit.test.ts',
  'src/components/MarkdownView.test.ts',
];

const requiredModules = [
  'src/lib/document-tab-revision.ts',
  'src/lib/document-revision.ts',
  'src/lib/html-sub-spans.ts',
  'src/lib/pane-scroll-sync.ts',
  'src/lib/rendered-pane-contract.ts',
  'src/lib/markdown-view-visual-editing.ts',
];

const failures = [];

for (const modulePath of requiredModules) {
  const absolute = resolve(projectRoot, modulePath);
  if (!existsSync(absolute)) failures.push(`missing acceptance module: ${modulePath}`);
}

const vitest = spawnSync(
  process.execPath,
  [vitestBin, 'run', ...acceptanceSuites],
  { cwd: projectRoot, stdio: 'inherit' },
);

if (vitest.status !== 0) {
  failures.push('one or more visual acceptance Vitest suites failed');
}

const packagedBoundary = [
  'Packaged binary probe run (`pnpm smoke:packaged` after `pnpm build:app`)',
  'Target-OS WCAGate on the built application',
];

if (failures.length) {
  console.error('\nVisual acceptance gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('\nVisual acceptance gate passed (unit/integration suites).');
console.log('Remaining packaged-only boundary:');
for (const item of packagedBoundary) console.log(`- ${item}`);
