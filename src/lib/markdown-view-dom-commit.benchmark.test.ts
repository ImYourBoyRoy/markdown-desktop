// ./src/lib/markdown-view-dom-commit.benchmark.test.ts
/**
 * Optional DOM commit benchmark (full innerHTML vs incremental block replace).
 *
 * Run: pnpm benchmark:render-commit
 */
import { describe, expect, it } from 'vitest';
import { attachSourceMapIds } from './source-map';
import { measureRenderCommitStrategies } from './markdown-view-dom-commit';
import type { SourceMap } from './types';

const runBenchmark = import.meta.env.MARKDOWN_DESKTOP_BENCHMARK === '1';

function buildLargeDocument(blockCount: number) {
  const lines: string[] = [];
  const spans: SourceMap['spans'] = [];
  let byteOffset = 0;
  for (let index = 0; index < blockCount; index += 1) {
    const text = `Paragraph ${index} with enough text to resemble a README section.`;
    const line = index === 0 ? 1 : index * 2 + 1;
    const columnEnd = text.length + 1;
    const sourcepos = `${line}:1-${line}:${columnEnd}`;
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
    const text = `Paragraph ${index} with enough text to resemble a README section.`;
    const line = index === 0 ? 1 : index * 2 + 1;
    const columnEnd = text.length + 1;
    return `<p data-sourcepos="${line}:1-${line}:${columnEnd}">${text}</p>`;
  }).join('');
  const sourceMap: SourceMap = {
    version: 1,
    sourceHash: `sha256:benchmark-${blockCount}`,
    spans,
  };
  return { source, html, sourceMap, targetMapId: 'p-0' };
}

(runBenchmark ? describe : describe.skip)('markdown view dom commit benchmark', () => {
  it('reports full vs incremental commit cost on a large document', () => {
    const blockCount = 240;
    const { source, html, sourceMap, targetMapId } = buildLargeDocument(blockCount);
    const [full, incremental] = measureRenderCommitStrategies(
      html,
      targetMapId,
      source,
      sourceMap,
      attachSourceMapIds,
      8,
    );

    console.log(JSON.stringify({
      blockCount,
      fullMs: Number(full.durationMs.toFixed(2)),
      incrementalMs: Number(incremental.durationMs.toFixed(2)),
      speedup: Number((full.durationMs / incremental.durationMs).toFixed(2)),
    }, null, 2));

    expect(full.blockCount).toBe(blockCount);
    expect(incremental.blockCount).toBe(blockCount);
    expect(incremental.durationMs).toBeLessThan(full.durationMs);
  });
});
