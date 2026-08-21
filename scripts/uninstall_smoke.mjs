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

const installerDir = resolve('Apps/win32-x64/installers');
const nsisInstaller = readdirSync(join(installerDir, 'nsis')).find((name) => name.endsWith('-setup.exe'));
const msiInstaller = readdirSync(join(installerDir, 'msi')).find((name) => name.endsWith('.msi'));
if (!nsisInstaller || !msiInstaller) throw new Error('Windows installer smoke requires both NSIS and MSI outputs.');

const smokeRoot = mkdtempSync(join(tmpdir(), 'markdown-desktop-uninstall-'));
const installDir = join(smokeRoot, 'installed');
const appDataDir = join(process.env.APPDATA, 'com.markdownnative.desktop');
const localDataDir = join(process.env.LOCALAPPDATA, 'com.markdownnative.desktop');

function run(file, args) {
  const result = spawnSync(file, args, { stdio: 'inherit', windowsHide: true });
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

try {
  run(join(installerDir, 'nsis', nsisInstaller), ['/S', `/D=${installDir}`]);
  if (!existsSync(join(installDir, 'uninstall.exe'))) throw new Error('NSIS installer did not create uninstall.exe.');
  for (const dataDir of [appDataDir, localDataDir]) {
    const sentinel = join(dataDir, 'uninstall-smoke', 'nested');
    mkdirSync(sentinel, { recursive: true });
  }
  run(join(installDir, 'uninstall.exe'), ['/S']);
  await assertAbsent('NSIS uninstall', [installDir, appDataDir, localDataDir]);

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
  rmSync(smokeRoot, { recursive: true, force: true });
  for (const dataDir of [appDataDir, localDataDir]) rmSync(dataDir, { recursive: true, force: true });
}
