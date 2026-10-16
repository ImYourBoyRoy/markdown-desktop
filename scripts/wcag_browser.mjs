#!/usr/bin/env node
/** Start the audited UI, then run WCAGate doctor and its fail-closed gate. */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = resolve(root, 'node_modules/@imyourboyroy/wcagate/bin/wcagate.mjs');
function run(command) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cli, command], { cwd: root, stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', (code) => resolveRun(code ?? 1));
  });
}
let server;
try {
  if (await run('doctor') !== 0) process.exitCode = 1;
  else {
    server = await createServer({ root, logLevel: 'error', server: { host: 'localhost', port: 1420, strictPort: true, open: false } });
    await server.listen();
    process.exitCode = await run('run');
  }
} finally { await server?.close(); }
