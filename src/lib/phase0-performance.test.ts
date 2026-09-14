/**
 * Opt-in frontend Phase 0 benchmark.
 *
 * The test is skipped during ordinary `pnpm test`. `pnpm phase0:baseline`
 * enables it and combines its machine-readable result with the native probe.
 */
import { describe, expect, it } from 'vitest';
import { attachSourceMapIds } from './source-map';
import {
  buildSourceSelectionIndex,
  querySourceIntervalEntries,
} from './source-selection-index';
import { measureRenderCommitStrategies } from './markdown-view-dom-commit';
import type { SourceMap } from './types';

const enabled = import.meta.env.MARKDOWN_DESKTOP_PHASE0 === '1';
const SAMPLE_COUNT = 7;

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index] ?? 0;
}

function median(samples: number[]): number {
  return percentile(samples, 0.5);
}

function sample(operation: () => void): { medianMs: number; p95Ms: number } {
  operation();
  const samples: number[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const started = performance.now();
    operation();
    samples.push(performance.now() - started);
  }
  return { medianMs: median(samples), p95Ms: percentile(samples, 0.95) };
}

function buildBenchmarkDocument(blockCount: number): {
  source: string;
  html: string;
  sourceMap: SourceMap;
} {
  const lines: string[] = [];
  const spans: SourceMap['spans'] = [];
  let byteOffset = 0;
  for (let index = 0; index < blockCount; index += 1) {
    const text = `Paragraph ${index} with enough text to exercise mapped selection and DOM replacement.`;
    lines.push(text, '');
    spans.push({
      mapId: `p-${index}`,
      kind: 'paragraph',
      sourceByteStart: byteOffset,
      sourceByteEnd: byteOffset + text.length,
      attrs: {},
    });
    byteOffset += text.length + 2;
  }
  const source = `${lines.join('\n')}\n`;
  const html = spans.map((span, index) => {
    const text = `Paragraph ${index} with enough text to exercise mapped selection and DOM replacement.`;
    const line = index * 2 + 1;
    return `<p data-sourcepos="${line}:1-${line}:${text.length}">${text}</p>`;
  }).join('');
  return {
    source,
    html,
    sourceMap: { version: 1, sourceHash: 'sha256:phase0-benchmark', spans },
  };
}

(enabled ? describe : describe.skip)('Phase 0 frontend performance baseline', () => {
  it('measures map build, selection queries, DOM mapping, and commit cost', () => {
    const blockCount = 320;
    const { source, html, sourceMap } = buildBenchmarkDocument(blockCount);
    let index = buildSourceSelectionIndex(source, sourceMap, sourceMap.sourceHash);
    const indexTiming = sample(() => {
      index = buildSourceSelectionIndex(source, sourceMap, sourceMap.sourceHash);
    });
    const queryTiming = sample(() => {
      for (let query = 0; query < 2_000; query += 1) {
        const selection = index.entries[query % index.entries.length]?.selection;
        if (selection) querySourceIntervalEntries(index.visualIntervalIndex, selection);
      }
    });
    const attachmentTiming = sample(() => {
      const host = document.createElement('article');
      host.innerHTML = html;
      expect(attachSourceMapIds(host, source, sourceMap)).toBe(blockCount);
    });
    const [full, incremental] = measureRenderCommitStrategies(
      html,
      'p-0',
      source,
      sourceMap,
      attachSourceMapIds,
      SAMPLE_COUNT,
    );

    expect(index.entries).toHaveLength(blockCount);
    expect(querySourceIntervalEntries(index.visualIntervalIndex, { from: 0, to: 12 })).not.toHaveLength(0);
    expect(full.blockCount).toBe(blockCount);
    expect(incremental.blockCount).toBe(blockCount);

    console.error(`PHASE0_FRONTEND_BENCHMARK=${JSON.stringify({
      blockCount,
      sourceBytes: source.length,
      htmlBytes: html.length,
      mappedSpans: sourceMap.spans.length,
      index: indexTiming,
      selectionQueries: { ...queryTiming, operations: 2_000 },
      mapAttachment: attachmentTiming,
      domCommit: {
        fullMedianMs: full.durationMs,
        incrementalMedianMs: incremental.durationMs,
        speedup: full.durationMs / Math.max(incremental.durationMs, 0.001),
      },
    })}`);
  });
});
