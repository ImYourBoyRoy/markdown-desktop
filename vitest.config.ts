import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    env: {
      MARKDOWN_DESKTOP_BENCHMARK: process.env.MARKDOWN_DESKTOP_BENCHMARK ?? '',
      MARKDOWN_DESKTOP_PHASE0: process.env.MARKDOWN_DESKTOP_PHASE0 ?? '',
    },
    pool: 'forks',
    fileParallelism: false,
    isolate: true,
    hookTimeout: 20_000,
    testTimeout: 20_000,
    teardownTimeout: 20_000,
  },
});
