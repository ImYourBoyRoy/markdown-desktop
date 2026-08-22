#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const commands = [
  ['pnpm', ['check']],
  ['pnpm', ['test']],
  ['pnpm', ['build']],
  ['pnpm', ['accessibility:audit']],
  ['pnpm', ['audit:updater']],
  ['pnpm', ['audit', '--audit-level', 'high']],
  ['cargo', ['fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--check']],
  ['cargo', ['check', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--all-targets', '--all-features']],
  ['cargo', ['clippy', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--all-targets', '--all-features', '--', '-D', 'warnings']],
  ['cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--all-features']],
  ['cargo', ['audit']],
  ['cargo', ['deny', 'check']],
];

function spawnCommand(command, args, options) {
  if (process.platform === 'win32' && command === 'pnpm') {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', `pnpm ${args.join(' ')}`], options);
  }
  return spawnSync(command, args, options);
}

for (const [command, args] of commands) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const cargoAuditCommand = command === 'cargo' && (args[0] === 'audit' || args[0] === 'deny');
  const result = spawnCommand(command, args, { stdio: 'inherit', cwd: cargoAuditCommand ? 'src-tauri' : '.', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
