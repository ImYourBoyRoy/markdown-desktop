#!/usr/bin/env node
// ./scripts/render_commit_benchmark.mjs
/**
 * Measure full innerHTML vs incremental block commit on a large synthetic document.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const result = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'vitest', 'run', 'src/lib/markdown-view-dom-commit.benchmark.test.ts'],
  {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, MARKDOWN_DESKTOP_BENCHMARK: '1' },
    shell: process.platform === 'win32',
  },
);

process.exit(result.status ?? 1);
