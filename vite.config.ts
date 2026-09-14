import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const host = process.env.TAURI_DEV_HOST;

const projectRoot = process.cwd();
const graphvizAsset = resolve(projectRoot, 'node_modules/@viz-js/viz/dist/viz.js');

function assertFile(path: string, label: string): void {
  if (!statSync(path, { throwIfNoEntry: false })) {
    throw new Error(`Missing ${label} required for the optional renderer bundle: ${path}`);
  }
}

function optionalRendererAssets(): Plugin {
  return {
    name: 'markdown-desktop-optional-renderer-assets',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/vendor/graphviz.js', (_request, response) => {
        assertFile(graphvizAsset, 'Graphviz module');
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(readFileSync(graphvizAsset));
      });

    },
    generateBundle() {
      assertFile(graphvizAsset, 'Graphviz module');
      this.emitFile({
        type: 'asset',
        fileName: 'vendor/graphviz.js',
        source: readFileSync(graphvizAsset),
      });
    },
  };
}

export default defineConfig(() => ({
  plugins: [svelte(), optionalRendererAssets()],
  // Keep the repository's curated static asset folder as Vite's public root.
  // This ensures the supplied logo is copied into dist and into Tauri bundles.
  publicDir: 'static',

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
}));
