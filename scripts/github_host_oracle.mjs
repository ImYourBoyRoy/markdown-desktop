#!/usr/bin/env node
// ./scripts/github_host_oracle.mjs
/**
 * Run the Rust GitHub-host fixture oracle against fixtures/github-readme.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = join(projectRoot, 'src-tauri', 'Cargo.toml');
const oracle = join(projectRoot, 'fixtures', 'github-readme', 'oracle.json');
const generate = join(projectRoot, 'scripts', 'generate_github_fixtures.mjs');

if (!existsSync(oracle)) {
  console.error(`Missing oracle: ${oracle}`);
  process.exit(1);
}

spawnSync(process.execPath, [generate], { stdio: 'inherit' });

const result = spawnSync(
  'cargo',
  ['test', '--manifest-path', manifest, 'github_host_fixture_oracle', '--', '--nocapture'],
  { cwd: projectRoot, stdio: 'inherit', shell: process.platform === 'win32' },
);

process.exit(result.status ?? 1);
