// Used only by the explicit full upgrade, after its manifest snapshot.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { versionAtLeast } from './upgrade-plan.mjs';
const file = new URL('../src-tauri/Cargo.toml', import.meta.url);
const source = readFileSync(file, 'utf8');
const current = source.match(/^rust-version\s*=\s*"([^"]+)"/m)?.[1];
const compiler = execFileSync('rustc', ['+stable', '--version'], { encoding: 'utf8' }).match(/^rustc (\d+\.\d+\.\d+) /)?.[1];
if (!current || !compiler || !versionAtLeast(compiler, current)) throw new Error('Stable Rust does not meet the existing compiler floor');
writeFileSync(file, source.replace(/^(rust-version\s*=\s*)"[^"]+"/m, `$1"${compiler}"`));
console.log(`Rust compatibility floor now matches updated stable: ${compiler}`);
