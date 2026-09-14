import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeActionVersionComments } from './workflow-comments.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = join(root, '.github/workflows');

for (const name of readdirSync(directory).filter((entry) => /\.ya?ml$/.test(entry))) {
  const file = join(directory, name);
  const before = readFileSync(file, 'utf8');
  const after = normalizeActionVersionComments(before);
  if (after !== before) writeFileSync(file, after);
}

console.log('GitHub Action version comments normalized.');
