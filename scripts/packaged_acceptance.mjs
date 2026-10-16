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
const largeMountFixture = Array.from(
  { length: 96 },
  (_, index) => `Large DOM mount paragraph ${index + 1}: ${'This paragraph exercises bounded rendered mounting in the packaged WebView. '.repeat(18)}`,
).join('\n\n');
const fixture = `# Acceptance Fixture

${'PACKAGED_VISUAL_PROBE'} paragraph for packaged acceptance.

PACKAGED_DRAG_TARGET_PROBE is the adjacent paragraph used by the packaged move probe.

<p align="center"><a href="https://example.com"><img src="${'PACKAGED_BADGE_PROBE'}.png" alt="Badge" /></a></p>

\`\`\`mermaid
flowchart TD
  A[Async rich block] --> B[Control refresh]
\`\`\`

${'PACKAGED_DELETE_TARGET_PROBE'} should be deleted by its rendered block control.

${'PACKAGED_DELETE_SENTINEL_PROBE'} must remain after that deletion.

${'RUNTIME_FIND_TOKEN'} is searchable in this document.

${largeMountFixture}

${scrollFixture}
`;

writeFileSync(fixturePath, fixture, 'utf8');
// Locally generated VP8 canvas clip; no downloaded or third-party media.
writeFileSync(join(workDir, 'acceptance-video.webm'), Buffer.from(readFileSync(join(projectRoot, 'scripts', 'fixtures', 'acceptance-video.webm.base64'), 'utf8').trim(), 'base64'));

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
    if (report.performance?.measures?.length) {
      const totals = new Map();
      for (const measure of report.performance.measures) {
        const current = totals.get(measure.name) ?? { count: 0, total: 0, max: 0 };
        current.count += 1;
        current.total += measure.durationMs;
        current.max = Math.max(current.max, measure.durationMs);
        totals.set(measure.name, current);
      }
      const summary = [...totals.entries()]
        .sort((left, right) => right[1].total - left[1].total)
        .slice(0, 12)
        .map(([name, value]) => `${name}=${value.total.toFixed(1)}ms/${value.count}`)
        .join(' | ');
      console.log(`Perf spans: ${summary}`);
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
