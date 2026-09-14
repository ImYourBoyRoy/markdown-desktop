// Svelte's compiler integration can require an older JS TypeScript API while
// using the current native compiler via @typescript/native. Follow its actual
// installed peer contract; do not hard-code a TypeScript major forever.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCommand } from './upgrade-process.mjs';
import { highestCaretMajor } from './upgrade-plan.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../node_modules/svelte-check/package.json', import.meta.url), 'utf8'));
const range = manifest.peerDependencies?.typescript;
const major = highestCaretMajor(range);
console.log(`Following svelte-check ${manifest.version} TypeScript peer contract: ${range}; selecting newest ${major}.x (native alias remains independently current).`);
runCommand('pnpm', ['update', `typescript@${major}`], root);
runCommand('pnpm', ['peers', 'check'], root);
