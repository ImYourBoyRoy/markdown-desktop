import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MIN_PNPM, versionAtLeast } from './upgrade-plan.mjs';
import { commandSpec } from './upgrade-process.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const minimumRust = cargo.match(/^rust-version\s*=\s*"([^"]+)"/m)?.[1];
if (!minimumRust) throw new Error('Missing rust-version in Cargo.toml');
if (Number(process.versions.node.split('.')[0]) !== 26) throw new Error('Node 26.x is required; update Node with your OS/version manager.');
for (const [tool, minimum] of [['pnpm', MIN_PNPM], ['rustc', minimumRust], ['cargo', minimumRust]]) {
  const [command, args] = commandSpec(tool, ['--version']);
  const output = execFileSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const version = output.match(/\b\d+\.\d+\.\d+(?:-[\w.]+)?/)?.[0];
  if (!version || !versionAtLeast(version, minimum)) throw new Error(`${tool} requires >=${minimum}; found ${output}`);
  console.log(output);
}
