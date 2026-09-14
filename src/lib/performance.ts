/**
 * Low-overhead application performance instrumentation.
 *
 * Instrumentation is disabled unless the build/runtime flag is enabled:
 * `VITE_MARKDOWN_DESKTOP_PERF=1` or `window.__MARKDOWN_DESKTOP_PERF_ENABLED__ = true`.
 * When enabled, measures are available from `window.__MARKDOWN_DESKTOP_PERF__`.
 * The default application path only performs one boolean check at each probe.
 */

export interface PerformanceMeasure {
  name: string;
  durationMs: number;
  at: number;
  detail?: Record<string, string | number | boolean | null>;
}

export interface PerformanceSnapshot {
  enabled: boolean;
  counts: Record<string, number>;
  measures: PerformanceMeasure[];
}

export interface PerformanceController {
  snapshot(): PerformanceSnapshot;
  reset(): void;
}

declare global {
  interface Window {
    __MARKDOWN_DESKTOP_PERF_ENABLED__?: boolean;
    __MARKDOWN_DESKTOP_PERF__?: PerformanceController;
  }
}

type PerfEnv = {
  VITE_MARKDOWN_DESKTOP_PERF?: string;
  MARKDOWN_DESKTOP_PERF?: string;
};

const env = (import.meta as ImportMeta & { env?: PerfEnv }).env;
const envEnabled = env?.VITE_MARKDOWN_DESKTOP_PERF === '1'
  || env?.MARKDOWN_DESKTOP_PERF === '1';
const counts = new Map<string, number>();
const measures: PerformanceMeasure[] = [];
const MAX_MEASURES = 2_000;

export function performanceEnabled(): boolean {
  return envEnabled
    || (typeof window !== 'undefined' && window.__MARKDOWN_DESKTOP_PERF_ENABLED__ === true);
}

function snapshot(): PerformanceSnapshot {
  return {
    enabled: performanceEnabled(),
    counts: Object.fromEntries(counts),
    measures: measures.slice(),
  };
}

function reset(): void {
  counts.clear();
  measures.length = 0;
}

export function performanceController(): PerformanceController {
  return { snapshot, reset };
}

function exposeControllerIfEnabled(): void {
  if (typeof window !== 'undefined' && performanceEnabled() && !window.__MARKDOWN_DESKTOP_PERF__) {
    window.__MARKDOWN_DESKTOP_PERF__ = performanceController();
  }
}

exposeControllerIfEnabled();

export function performanceCount(name: string, amount = 1): void {
  if (!performanceEnabled()) return;
  exposeControllerIfEnabled();
  counts.set(name, (counts.get(name) ?? 0) + amount);
}

export function performanceMeasure(
  name: string,
  startedAt: number,
  detail?: Record<string, string | number | boolean | null>,
): number | undefined {
  if (!performanceEnabled()) return undefined;
  exposeControllerIfEnabled();
  const durationMs = performance.now() - startedAt;
  if (measures.length < MAX_MEASURES) {
    measures.push({ name, durationMs, at: Date.now(), detail });
  }
  try {
    performance.measure(name, { start: startedAt });
  } catch {
    // The browser Performance API may reject an old/foreign start mark. The
    // in-memory sample remains valid and is the source used by the harness.
  }
  return durationMs;
}

/** Start a span and return its no-op-or-recording completion callback. */
export function performanceSpan(
  name: string,
  detail?: Record<string, string | number | boolean | null>,
): () => number | undefined {
  if (!performanceEnabled()) return () => undefined;
  exposeControllerIfEnabled();
  performanceCount(`${name}.started`);
  const startedAt = performance.now();
  return () => {
    performanceCount(`${name}.completed`);
    return performanceMeasure(name, startedAt, detail);
  };
}
