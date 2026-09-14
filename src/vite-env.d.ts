/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MARKDOWN_DESKTOP_BENCHMARK?: string;
  readonly MARKDOWN_DESKTOP_PHASE0?: string;
  readonly VITE_MARKDOWN_DESKTOP_PERF?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
