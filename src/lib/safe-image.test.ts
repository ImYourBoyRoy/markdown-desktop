import { describe, expect, it } from 'vitest';
import { sanitizeImageAsset } from './safe-image';
import type { AssetResult } from './types';

function svgAsset(source: string): AssetResult {
  const bytes = new TextEncoder().encode(source);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    assetId: 'test-svg',
    mime: 'image/svg+xml',
    dataUri: `data:image/svg+xml;base64,${btoa(binary)}`,
  };
}

describe('sanitizeImageAsset', () => {
  it('keeps safe SVG artwork while removing executable and external-reference content', () => {
    const result = sanitizeImageAsset(svgAsset(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">'
        + '<script>alert(1)</script><style>.safe{fill:red}</style>'
        + '<image href="https://tracker.invalid/pixel" /><rect class="safe" style="fill:red" width="10" height="10" />'
        + '</svg>',
    ));
    const decoded = atob(result.dataUri.split(',', 2)[1] ?? '');
    expect(decoded).toContain('<svg');
    expect(decoded).toContain('<rect');
    expect(decoded).not.toContain('script');
    expect(decoded).not.toContain('onload');
    expect(decoded).not.toContain('tracker.invalid');
    expect(decoded).not.toContain('<style');
    expect(decoded).not.toContain('style=');
  });

  it('returns raster assets unchanged', () => {
    const asset: AssetResult = { assetId: 'png', mime: 'image/png', dataUri: 'data:image/png;base64,AA==' };
    expect(sanitizeImageAsset(asset)).toBe(asset);
  });

  it('rejects malformed or non-SVG-root image payloads', () => {
    expect(() => sanitizeImageAsset(svgAsset('<div>not an SVG</div>'))).toThrow(/safe root/i);
  });
});
