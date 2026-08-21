#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceRoot = join(projectRoot, 'src');
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.name.endsWith('.svelte')) files.push(full);
  }
}
await walk(sourceRoot);

const failures = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const relative = file.slice(projectRoot.length + 1);
  // The project uses Svelte expressions such as `onclick={() => ...}` where
  // `=>` contains a literal `>`; line-based checks avoid treating that as the
  // end of an HTML tag while still covering the one-line interactive markup.
  for (const line of source.split(/\r?\n/)) {
    if (line.includes('<button') && !/\btype\s*=/.test(line)) failures.push(`${relative}: button is missing an explicit type`);
    if (line.includes('<img') && !/\balt\s*=|aria-hidden\s*=/.test(line)) failures.push(`${relative}: image is missing alt or aria-hidden`);
    const markup = line.trimStart().startsWith('<');
    if (markup && line.includes('role="tab"') && !/aria-selected\s*=/.test(line)) failures.push(`${relative}: tab is missing aria-selected`);
    if (markup && line.includes('role="dialog"') && (!/aria-modal\s*=/.test(line) || !/tabindex\s*=/.test(line))) failures.push(`${relative}: dialog is missing modal focus metadata`);
  }
}

const app = await readFile(join(sourceRoot, 'App.svelte'), 'utf8');
for (const required of [
  '<svelte:window onkeydown={handleKeydown}',
  'onkeydown={handleContextMenuKeydown}',
  'onkeydown={handleTablistKeydown}',
  ':global(button:focus-visible)',
]) {
  if (!app.includes(required)) failures.push(`App.svelte: missing keyboard/accessibility contract ${required}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Accessibility source audit passed: ${files.length} Svelte files checked.`);
