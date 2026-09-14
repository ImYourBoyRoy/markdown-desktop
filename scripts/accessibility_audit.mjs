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
function tagCloseIndex(value) {
  let quote = '';
  let braceDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') {
      braceDepth += 1;
      continue;
    }
    if (character === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (character === '>' && braceDepth === 0) return index;
  }
  return -1;
}

function openingTags(source, tagName) {
  const tags = [];
  let current = '';
  const startPattern = tagName ? new RegExp(`<${tagName}\\b`) : /<[A-Za-z][A-Za-z0-9:-]*\\b/;
  for (const line of source.split(/\r?\n/)) {
    let remainder = line;
    while (remainder || current) {
      if (!current) {
        const match = startPattern.exec(remainder);
        if (!match || match.index === undefined) break;
        current = remainder.slice(match.index);
      } else {
        current += `\n${remainder}`;
      }
      // Svelte event expressions contain `=>`; do not mistake that arrow for
      // the end of an HTML opening tag. A real tag close has a `>` not preceded
      // by `=`.
      const close = tagCloseIndex(current);
      if (close < 0) {
        remainder = '';
        break;
      }
      const end = close + 1;
      tags.push(current.slice(0, end));
      remainder = current.slice(end);
      current = '';
    }
  }
  if (current) tags.push(current);
  return tags;
}

for (const file of files) {
  const source = await readFile(file, 'utf8');
  const relative = file.slice(projectRoot.length + 1);
  // The project uses Svelte expressions such as `onclick={() => ...}` where
  // `=>` contains a literal `>`; line-based checks avoid treating that as the
  // end of an HTML tag while still covering the one-line interactive markup.
  for (const tag of openingTags(source, 'button')) {
    if (!/\btype\s*=/.test(tag)) failures.push(`${relative}: button is missing an explicit type`);
  }
  for (const tag of openingTags(source, 'img')) {
    if (!/\balt\s*=|aria-hidden\s*=/.test(tag)) failures.push(`${relative}: image is missing alt or aria-hidden`);
  }
  for (const tag of openingTags(source, '')) {
    if (/\brole="tab"/.test(tag) && !/aria-selected\s*=/.test(tag)) failures.push(`${relative}: tab is missing aria-selected`);
    if (/\brole="dialog"/.test(tag) && (!/aria-modal\s*=/.test(tag) || !/tabindex\s*=/.test(tag))) failures.push(`${relative}: dialog is missing modal focus metadata`);
  }
}

const app = await readFile(join(sourceRoot, 'App.svelte'), 'utf8');
const componentSource = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
const shellStyles = await readFile(join(sourceRoot, 'styles', 'app-shell.css'), 'utf8');
for (const [owner, source, required] of [
  ['App.svelte', app, '<svelte:window onkeydown={handleKeydown}'],
  ['ContextMenu.svelte', componentSource, 'onkeydown={onKeydown}'],
  ['Workspace/inspector components', componentSource, 'onkeydown={onTablistKeydown}'],
  ['DocumentSurface.svelte', componentSource, 'aria-hidden={!sourceViewVisible} inert={!sourceViewVisible}'],
  ['src/styles/app-shell.css', shellStyles, 'button:focus-visible'],
]) {
  if (!source.includes(required)) failures.push(`${owner}: missing keyboard/accessibility contract ${required}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Accessibility source audit passed: ${files.length} Svelte files checked.`);
