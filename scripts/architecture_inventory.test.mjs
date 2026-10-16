import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));

test('a clean source copy verifies with either line-ending convention and no local continuity files', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-architecture-'));
  try {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
    const textFiles = [];
    for (const name of files) {
      if (!/^(src\/|scripts\/|src-tauri\/src\/|\.github\/workflows\/)/.test(name)
        && !/\.(md|json|yaml|toml|lock|ts|mjs)$/.test(name)) continue;
      const source = path.join(root, name);
      if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
      const destination = path.join(temp, name); fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, fs.readFileSync(source, 'utf8').replace(/\r\n|\r/g, '\n'));
      textFiles.push(destination);
    }
    const inventory = path.join(root, 'scripts/architecture_inventory.mjs');
    execFileSync(process.execPath, [inventory, `--root=${temp}`]);
    execFileSync(process.execPath, [inventory, `--root=${temp}`, '--check']);
    for (const file of textFiles) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r\n|\r/g, '\n').replaceAll('\n', '\r\n'));
    fs.writeFileSync(path.join(temp, 'AGENTS.md'), 'Local instructions do not affect the published inventory.');
    fs.writeFileSync(path.join(temp, 'MEMORY.md'), 'Local memory does not affect the published inventory.');
    execFileSync(process.execPath, [inventory, `--root=${temp}`, '--check']);
    assert.ok(!fs.readFileSync(path.join(temp, 'ARCHITECTURE.md'), 'utf8').includes('| `MEMORY.md` |'));
  } finally {
    const resolved = path.resolve(temp);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('markdown-architecture-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
