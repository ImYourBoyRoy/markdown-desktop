#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const WCAGATE_REPOSITORY = 'https://github.com/imyourboyroy/WCAGate.git';
export const WCAGATE_PACKAGE = '@imyourboyroy/wcagate';
export const WCAGATE_SPEC_PREFIX = 'github:imyourboyroy/WCAGate#';

export function parseHeadRevision(output) {
  const revision = output.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/i.test(revision)) {
    throw new Error(`WCAGate returned an invalid main revision: ${revision || '(empty)'}`);
  }
  return revision.toLowerCase();
}

export function updateManifest(manifest, revision) {
  const current = manifest.devDependencies?.[WCAGATE_PACKAGE];
  if (typeof current !== 'string') throw new Error(`Missing ${WCAGATE_PACKAGE} devDependency`);
  manifest.devDependencies[WCAGATE_PACKAGE] = `${WCAGATE_SPEC_PREFIX}${revision}`;
  return current;
}

function latestRevision(root) {
  const output = execFileSync(
    'git',
    ['ls-remote', WCAGATE_REPOSITORY, 'refs/heads/main'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return parseHeadRevision(output);
}

function run() {
  const root = dirname(fileURLToPath(import.meta.url));
  const projectRoot = join(root, '..');
  const manifestPath = join(projectRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const revision = latestRevision(projectRoot);
  const previous = updateManifest(manifest, revision);
  const next = `${WCAGATE_SPEC_PREFIX}${revision}`;
  if (previous === next) {
    console.log(`WCAGate is already at ${revision}.`);
    return;
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Updated ${WCAGATE_PACKAGE}: ${previous} -> ${next}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
