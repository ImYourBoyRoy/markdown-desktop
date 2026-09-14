#!/usr/bin/env node
// ./scripts/generate_github_fixtures.mjs
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'fixtures', 'github-readme');
writeFileSync(
  join(root, 'readme-truncated.md'),
  `# Truncated README Simulation\n\n${'x'.repeat(500 * 1024)}`,
  'utf8',
);
