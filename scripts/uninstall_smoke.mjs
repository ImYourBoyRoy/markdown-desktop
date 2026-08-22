import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

if (process.platform !== 'win32') {
  console.log('Windows uninstall smoke skipped: this check runs on windows-latest.');
  process.exit(0);
}

if (process.env.CI !== 'true') {
  console.log('Windows uninstall smoke skipped outside CI to avoid mutating a developer profile.');
  process.exit(0);
}

const windowsArchitecture = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch;
const installerDir = resolve(`Apps/win32-${windowsArchitecture}/installers`);
const nsisInstaller = readdirSync(join(installerDir, 'nsis')).find((name) => name.endsWith('-setup.exe'));
const msiInstaller = readdirSync(join(installerDir, 'msi')).find((name) => name.endsWith('.msi'));
if (!nsisInstaller || !msiInstaller) throw new Error('Windows installer smoke requires both NSIS and MSI outputs.');

// CI-only uninstall smoke. Tauri's multi-user NSIS template resets $INSTDIR
// after parsing /D=, so use the documented /CurrentUser mode and its clean
// runner default (%LOCALAPPDATA%\Programs\Markdown Desktop). A clean CI
// runner makes this deterministic without touching Program Files.
const smokeRoot = mkdtempSync(join(tmpdir(), 'markdown-desktop-uninstall-'));
const installDir = join(process.env.LOCALAPPDATA, 'Programs', 'Markdown Desktop');
const nsisLogPath = join(smokeRoot, 'nsis-install.log');
const appDataDir = join(process.env.APPDATA, 'com.markdownnative.desktop');
const localDataDir = join(process.env.LOCALAPPDATA, 'com.markdownnative.desktop');
const startMenuRoots = [
  join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
];
const beforeStartMenuLinks = new Set(startMenuRoots.flatMap((root) => findFiles(
  root,
  (name) => /^Markdown Desktop.*\.lnk$/i.test(name),
)));
let nsisInstalled = false;
if (existsSync(installDir)) {
  throw new Error(`NSIS smoke install path already exists on the clean runner: ${installDir}`);
}

function run(file, args) {
  const isWindowsExecutable = process.platform === 'win32' && file.toLowerCase().endsWith('.exe');
  const result = isWindowsExecutable
    ? spawnSync('pwsh.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$arguments = [string[]]($env:MARKDOWN_SMOKE_ARGS | ConvertFrom-Json); $process = Start-Process -FilePath $env:MARKDOWN_SMOKE_FILE -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden; exit $process.ExitCode',
      ], {
      env: {
        ...process.env,
        MARKDOWN_SMOKE_FILE: file,
        MARKDOWN_SMOKE_ARGS: JSON.stringify(args),
      },
      stdio: 'inherit',
      windowsHide: true,
    })
    : spawnSync(file, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const logPath = args.includes('/l*v') ? args[args.indexOf('/l*v') + 1] : undefined;
    const logTail = logPath && existsSync(logPath)
      ? (() => {
        const log = readFileSync(logPath, 'utf16le');
        const marker = log.lastIndexOf('Return value 3');
        return `\nMSI log excerpt:\n${log.slice(Math.max(0, marker >= 0 ? marker - 4000 : log.length - 4000))}`;
      })()
      : '';
    throw new Error(`${file} exited with code ${result.status}${logTail}`);
  }
}

async function assertAbsent(label, paths) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const remaining = paths.filter((path) => existsSync(path));
    if (remaining.length === 0) return;
    await sleep(250);
  }
  const remaining = paths.filter((path) => existsSync(path));
  if (remaining.length > 0) {
    throw new Error(`${label} left these paths behind: ${remaining.join('; ')}`);
  }
}

async function waitForPath(label, path, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await sleep(250);
  }
  throw new Error(`${label} did not create ${path} within ${timeoutMs}ms.`);
}

async function waitForMatches(label, finder, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matches = finder();
    if (matches.length > 0) return matches;
    await sleep(250);
  }
  throw new Error(`${label} did not appear within ${timeoutMs}ms.`);
}

function findFiles(root, predicate) {
  if (!existsSync(root)) return [];
  const matches = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) matches.push(...findFiles(path, predicate));
    else if (predicate(entry.name, path)) matches.push(path);
  }
  return matches;
}

function readUninstallEntries() {
  const roots = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const entries = [];
  for (const root of roots) {
    const result = spawnSync('reg.exe', ['query', root, '/s'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout) continue;
    let current;
    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('HKEY_')) {
        if (current) entries.push(current);
        current = { key: trimmed };
        continue;
      }
      const value = line.match(/^\s{4}([^\s]+)\s+REG_[^\s]+\s+(.*)$/);
      if (current && value) current[value[1]] = value[2].trim();
    }
    if (current) entries.push(current);
  }
  return entries.filter((entry) => /^Markdown Desktop/i.test(entry.DisplayName ?? ''));
}

try {
  run(join(installerDir, 'nsis', nsisInstaller), ['/S', '/CurrentUser', `/LOG=${nsisLogPath}`]);
  nsisInstalled = true;
  try {
    await waitForPath('NSIS installer', join(installDir, 'uninstall.exe'));
  } catch (error) {
    const log = existsSync(nsisLogPath) ? readFileSync(nsisLogPath, 'utf8') : 'NSIS log was not created.';
    throw new Error(`${error.message}\n${log.slice(-8000)}`);
  }
  const createdStartMenuLinks = await waitForMatches(
    'NSIS Start menu shortcut',
    () => startMenuRoots.flatMap((root) => findFiles(
      root,
      (name, path) => /^Markdown Desktop.*\.lnk$/i.test(name) && !beforeStartMenuLinks.has(path),
    )),
  );
  const uninstallEntries = readUninstallEntries();
  if (!uninstallEntries.some((entry) => entry.Publisher === 'Roy Dawson IV')) {
    throw new Error(`Windows uninstall publisher was not Roy Dawson IV: ${JSON.stringify(uninstallEntries)}`);
  }
  for (const dataDir of [appDataDir, localDataDir]) {
    const sentinel = join(dataDir, 'uninstall-smoke', 'nested');
    mkdirSync(sentinel, { recursive: true });
  }
  run(join(installDir, 'uninstall.exe'), ['/S']);
  nsisInstalled = false;
  const createdStartMenuLinksAfterUninstall = startMenuRoots.flatMap((root) => findFiles(
    root,
    (name, path) => /^Markdown Desktop.*\.lnk$/i.test(name) && !beforeStartMenuLinks.has(path),
  ));
  await assertAbsent('NSIS uninstall', [installDir, appDataDir, localDataDir, ...createdStartMenuLinksAfterUninstall]);

  if (process.env.GITHUB_ACTIONS !== 'true') {
    console.log('MSI uninstall smoke skipped outside GitHub Actions: the Tauri MSI is a per-machine installer and requires elevation.');
  } else {
    const msiPath = join(installerDir, 'msi', msiInstaller);
    const msiInstallLog = join(smokeRoot, 'msi-install.log');
    const msiUninstallLog = join(smokeRoot, 'msi-uninstall.log');
    run('msiexec.exe', ['/i', msiPath, '/qn', '/norestart', '/l*v', msiInstallLog]);
    for (const dataDir of [appDataDir, localDataDir]) {
      const sentinel = join(dataDir, 'uninstall-smoke', 'nested');
      mkdirSync(sentinel, { recursive: true });
    }
    run('msiexec.exe', ['/x', msiPath, '/qn', '/norestart', '/l*v', msiUninstallLog]);
    await assertAbsent('MSI uninstall', [appDataDir, localDataDir]);
    console.log('Windows NSIS and MSI uninstall smoke passed: install files and app data were removed.');
  }
} finally {
  if (nsisInstalled && existsSync(join(installDir, 'uninstall.exe'))) {
    const cleanup = spawnSync(join(installDir, 'uninstall.exe'), ['/S'], { stdio: 'ignore', windowsHide: true });
    if (cleanup.error || cleanup.status !== 0) {
      console.error(`NSIS cleanup uninstall failed with exit code ${cleanup.status ?? 'unknown'}.`);
    }
  }
  rmSync(smokeRoot, { recursive: true, force: true });
  for (const dataDir of [appDataDir, localDataDir]) rmSync(dataDir, { recursive: true, force: true });
}
