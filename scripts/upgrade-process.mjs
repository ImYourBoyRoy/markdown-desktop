import { spawnSync } from 'node:child_process';

// Only fixed plan tokens enter cmd.exe; never interpolate filenames or user
// values into a shell command. Unicode/spaced project roots travel via cwd.
export function commandSpec(command, args, platform = process.platform) {
  if (platform === 'win32' && ['pnpm', 'npm'].includes(command)) {
    if ([command, ...args].some((arg) => !/^[a-zA-Z0-9@_+./:=<>-]+$/.test(arg) || /[<>]/.test(arg))) {
      throw new Error('Unsafe Windows command token');
    }
    return ['cmd.exe', ['/d', '/s', '/c', `${command} ${args.join(' ')}`]];
  }
  return [command, args];
}

export function runCommand(command, args, cwd, capture = false) {
  const [executable, argv] = commandSpec(command, args);
  const result = spawnSync(executable, argv, {
    cwd, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', windowsHide: true,
    env: { ...process.env, RUSTUP_TOOLCHAIN: 'stable' },
  });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`}`);
  return result.stdout?.trim() ?? '';
}
