/** Declarative, testable full-upgrade contract. No I/O on import. */
export const MIN_PNPM = '12.3.4';

export function highestCaretMajor(range) {
  if (typeof range !== 'string') throw new Error('Missing TypeScript peer contract');
  const majors = range.split('||').map((part) => {
    const match = part.trim().match(/^\^(\d+)\.\d+\.\d+$/);
    if (!match) throw new Error(`Unsupported TypeScript peer contract: ${range}; review required`);
    return Number(match[1]);
  });
  return Math.max(...majors);
}

export function assertMermaidCompatibility(range) {
  if (typeof range !== 'string') throw new Error('Missing Mermaid dependency range');
  const match = range.trim().match(/^\^(\d+)\.\d+\.\d+$/);
  if (!match) throw new Error(`Unsupported Mermaid dependency range: ${range}; review required`);
  const major = Number(match[1]);
  if (major >= 12) {
    throw new Error(
      'Mermaid 12 is not an automatic upgrade for this desktop target: it raises the browser '
      + 'floor and changes diagram defaults. Complete a target-OS/macOS compatibility review '
      + 'before moving off the Mermaid 11 line.',
    );
  }
}

export function versionAtLeast(actual, minimum) {
  const parse = (value) => {
    if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`Expected stable version, got ${value}`);
    return value.split('.').map(Number);
  };
  const a = parse(actual), b = parse(minimum);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

export function parseUpgradeArgs(args) {
  if (args.length === 2 && args[0] === '--restore' && /^run-[a-zA-Z0-9-]+$/.test(args[1])) return { restore: args[1] };
  if (args.length === 0) return { apply: true };
  if (args.length === 1 && ['--help', '--dry-run'].includes(args[0])) return { [args[0].slice(2)]: true };
  throw new Error('Use full:upgrade [--dry-run | --help | --restore run-ID]');
}

export function upgradePlan(platform = process.platform) {
  return [
    ['pnpm', ['self-update']],
    ['rustup', ['update', 'stable']],
    ['rustup', ['component', 'add', 'rustfmt', 'clippy', '--toolchain', 'stable']],
    ['node', ['scripts/verify-toolchains.mjs']],
    ['node', ['scripts/sync-rust-minimum.mjs']],
    ['cargo', ['+stable', 'install', 'cargo-edit', '--locked']],
    ['cargo', ['+stable', 'install', 'cargo-audit', '--locked']],
    ['cargo', ['+stable', 'install', 'cargo-deny', '--locked']],
    ['pnpm', ['update', '--latest', '--include-github-actions']],
    ['node', ['scripts/normalize-workflow-comments.mjs']],
    ['node', ['scripts/align-typescript.mjs']],
    ['cargo', ['+stable', 'upgrade', '--manifest-path', 'src-tauri/Cargo.toml', '--incompatible', 'allow', '--pinned', 'allow']],
    ['cargo', ['+stable', 'update', '--manifest-path', 'src-tauri/Cargo.toml']],
    ['pnpm', ['install', '--frozen-lockfile']],
    ['node', ['scripts/report-upgrade-limits.mjs']],
    ['pnpm', ['verify:dependencies']],
    ['pnpm', ['tauri', 'build']],
    ['node', ['scripts/packaged_acceptance.mjs', '--binary', `src-tauri/target/release/markdown-desktop${platform === 'win32' ? '.exe' : ''}`, '--require-binary']],
  ];
}
