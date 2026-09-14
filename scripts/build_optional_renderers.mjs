#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputDirectory = join(projectRoot, 'dist', 'vendor');
const mermaidOutput = join(outputDirectory, 'mermaid.js');
const mermaidChunksDirectory = join(outputDirectory, 'mermaid');

mkdirSync(outputDirectory, { recursive: true });
rmSync(mermaidOutput, { force: true });
rmSync(mermaidChunksDirectory, { recursive: true, force: true });

await build({
  configFile: false,
  root: projectRoot,
  logLevel: 'info',
  build: {
    outDir: outputDirectory,
    emptyOutDir: false,
    copyPublicDir: false,
    // This is a deliberately lazy, optional renderer asset. It is not part of
    // the startup bundle, so keep its size policy separate from the app shell.
    chunkSizeWarningLimit: 2048,
    rolldownOptions: {
      input: join(projectRoot, 'src', 'lib', 'mermaid-runtime.ts'),
      preserveEntrySignatures: 'strict',
      output: {
        // Keep Mermaid diagrams split by the renderer's own lazy modules;
        // this build is loaded only when a diagram is actually rendered.
        codeSplitting: true,
        entryFileNames: 'mermaid.js',
        chunkFileNames: 'mermaid/[name]-[hash].js',
        assetFileNames: 'mermaid/[name]-[hash][extname]',
      },
    },
  },
});

if (!existsSync(mermaidOutput)) {
  throw new Error(`Mermaid renderer asset was not produced: ${mermaidOutput}`);
}

console.log(`Optional Mermaid renderer staged at ${mermaidOutput}`);
