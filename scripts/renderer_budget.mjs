import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

// These are budgets for the optional, offline renderer assets—not startup
// bundle budgets. They are checked after every production build so a
// dependency update cannot silently turn an on-demand feature into a large or
// blocking application payload.
export const RENDERER_BUDGETS = Object.freeze({
  graphvizBytes: 1_350_000,
  mermaidEntryBytes: 64_000,
  mermaidTotalBytes: 6_000_000,
  mermaidLargestChunkBytes: 1_600_000,
});

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function rendererBudgetReport(root = projectRoot) {
  const vendorRoot = join(root, 'dist', 'vendor');
  const graphvizPath = join(vendorRoot, 'graphviz.js');
  const mermaidPath = join(vendorRoot, 'mermaid.js');
  const mermaidChunksDirectory = join(vendorRoot, 'mermaid');

  const graphvizBytes = statSync(graphvizPath).size;
  const mermaidEntryBytes = statSync(mermaidPath).size;
  const mermaidFiles = collectFiles(mermaidChunksDirectory);
  const mermaidChunkBytes = mermaidFiles.map((path) => statSync(path).size);
  const mermaidTotalBytes = mermaidEntryBytes + mermaidChunkBytes.reduce((sum, bytes) => sum + bytes, 0);
  const mermaidLargestChunkBytes = Math.max(0, ...mermaidChunkBytes);

  return {
    graphvizBytes,
    mermaidEntryBytes,
    mermaidTotalBytes,
    mermaidLargestChunkBytes,
    mermaidChunkCount: mermaidFiles.length,
    budgets: RENDERER_BUDGETS,
  };
}

export function assertRendererBudgets(root = projectRoot) {
  const report = rendererBudgetReport(root);
  const failures = [];
  if (report.graphvizBytes > report.budgets.graphvizBytes) {
    failures.push(`Graphviz is ${formatBytes(report.graphvizBytes)} (budget ${formatBytes(report.budgets.graphvizBytes)})`);
  }
  if (report.mermaidEntryBytes > report.budgets.mermaidEntryBytes) {
    failures.push(`Mermaid entry is ${formatBytes(report.mermaidEntryBytes)} (budget ${formatBytes(report.budgets.mermaidEntryBytes)})`);
  }
  if (report.mermaidTotalBytes > report.budgets.mermaidTotalBytes) {
    failures.push(`Mermaid assets total ${formatBytes(report.mermaidTotalBytes)} (budget ${formatBytes(report.budgets.mermaidTotalBytes)})`);
  }
  if (report.mermaidLargestChunkBytes > report.budgets.mermaidLargestChunkBytes) {
    failures.push(`Largest Mermaid chunk is ${formatBytes(report.mermaidLargestChunkBytes)} (budget ${formatBytes(report.budgets.mermaidLargestChunkBytes)})`);
  }

  console.log([
    `Renderer budgets: Graphviz ${formatBytes(report.graphvizBytes)}/${formatBytes(report.budgets.graphvizBytes)}`,
    `Mermaid entry ${formatBytes(report.mermaidEntryBytes)}/${formatBytes(report.budgets.mermaidEntryBytes)}`,
    `Mermaid total ${formatBytes(report.mermaidTotalBytes)}/${formatBytes(report.budgets.mermaidTotalBytes)}`,
    `largest chunk ${formatBytes(report.mermaidLargestChunkBytes)}/${formatBytes(report.budgets.mermaidLargestChunkBytes)}`,
    `(${report.mermaidChunkCount} lazy chunks)`,
  ].join(' · '));

  if (failures.length > 0) {
    throw new Error(`Optional renderer budget exceeded:\n- ${failures.join('\n- ')}`);
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  assertRendererBudgets();
}
