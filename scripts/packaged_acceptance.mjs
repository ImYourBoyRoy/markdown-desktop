#!/usr/bin/env node
// ./scripts/packaged_acceptance.mjs
/**
 * Launch the packaged Markdown Desktop binary in acceptance mode.
 *
 * Writes a temporary fixture, sets MARKDOWN_DESKTOP_ACCEPTANCE=1, opens the
 * fixture through argv startup grants, waits for the webview bridge to write
 * JSON results, and validates every probe step passed.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const platformDirectory = `${process.platform}-${process.arch}`;
const defaultBinary = join(projectRoot, 'Apps', platformDirectory, 'portable', process.platform === 'win32' ? 'markdown-desktop.exe' : 'markdown-desktop');

const args = process.argv.slice(2);
const requireBinary = args.includes('--require-binary');
const binaryFlagIndex = args.findIndex((argument) => argument === '--binary');
const binary = binaryFlagIndex >= 0 ? args[binaryFlagIndex + 1] : defaultBinary;

if (!existsSync(binary)) {
  const message = `Packaged binary not found: ${binary}`;
  if (requireBinary) {
    console.error(message);
    process.exit(1);
  }
  console.log(`${message}\nSkipping packaged acceptance (build with pnpm build:app first, or pass --require-binary).`);
  process.exit(0);
}

function assertNoExistingInstances() {
  if (process.platform === 'win32') {
    const result = spawnSync('tasklist', ['/FI', 'IMAGENAME eq markdown-desktop.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    if (result.status !== 0 || /markdown-desktop\.exe/i.test(result.stdout)) {
      throw new Error('Close Markdown Desktop after saving your work, then retry acceptance. Existing instances are never terminated.');
    }
  } else {
    const result = spawnSync('pgrep', ['-x', 'markdown-desktop'], { encoding: 'utf8' });
    if (result.status !== 1) throw new Error('Cannot establish an isolated acceptance instance. Save and close Markdown Desktop first.');
  }
}

assertNoExistingInstances();

const workDir = mkdtempSync(join(tmpdir(), 'markdown-desktop-acceptance-'));
const fixturePath = join(workDir, 'acceptance-fixture.md');
const resultPath = join(workDir, 'acceptance-result.json');
const scrollFixture = Array.from({ length: 32 }, (_, index) => `Scroll synchronization fixture line ${index + 1}.`).join('\n\n');
const fixture = `# Acceptance Fixture

${'PACKAGED_VISUAL_PROBE'} paragraph for packaged acceptance.

<p align="center"><a href="https://example.com"><img src="${'PACKAGED_BADGE_PROBE'}.png" alt="Badge" /></a></p>

${'RUNTIME_FIND_TOKEN'} is searchable in this document.

${scrollFixture}
`;

writeFileSync(fixturePath, fixture, 'utf8');

const child = spawn(binary, [fixturePath], {
  env: {
    ...process.env,
    MARKDOWN_DESKTOP_ACCEPTANCE: '1',
    MARKDOWN_DESKTOP_ACCEPTANCE_OUT: resultPath,
  },
  stdio: 'ignore',
  detached: false,
});

const timeoutMs = 120_000;
const started = Date.now();
let exitCode = null;

child.on('exit', (code) => {
  exitCode = code;
  if (!existsSync(resultPath)) {
    clearInterval(poll);
    console.error(`Packaged binary exited with code ${code ?? 'unknown'} before writing acceptance results.`);
    console.error('If another Markdown Desktop instance was already running, terminate it and retry.');
    cleanup(1);
  }
});

const poll = setInterval(() => {
  if (existsSync(resultPath)) {
    clearInterval(poll);
    finish();
    return;
  }
  if (Date.now() - started > timeoutMs) {
    clearInterval(poll);
    child.kill();
    console.error(`Timed out waiting for acceptance results after ${timeoutMs}ms`);
    cleanup(1);
  }
}, 250);

function finish() {
  try {
    const report = JSON.parse(readFileSync(resultPath, 'utf8'));
    const failures = (report.steps ?? []).filter((step) => !step.pass);
    console.log(`Packaged acceptance ${report.pass ? 'passed' : 'failed'} (${report.steps?.length ?? 0} steps)`);
    for (const step of report.steps ?? []) {
      console.log(`${step.pass ? 'PASS' : 'FAIL'} ${step.name}: ${step.detail}`);
    }
    cleanup(report.pass ? 0 : 1, failures.length ? undefined : null);
  } catch (error) {
    console.error(`Could not parse acceptance report: ${error instanceof Error ? error.message : error}`);
    cleanup(1);
  }
}

function cleanup(code, _) {
  try {
    if (!child.killed) child.kill();
  } catch {
    // Best-effort shutdown after the bridge writes its report.
  }
  if (code === 0) rmSync(workDir, { recursive: true, force: true });
  else console.error(`Acceptance failure evidence retained at ${workDir}`);
  if (exitCode !== null && exitCode !== 0 && code === 0) process.exit(exitCode);
  process.exit(code);
}
