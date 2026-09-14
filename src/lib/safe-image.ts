import DOMPurify from 'dompurify';
import type { AssetResult } from './types';

const SVG_MIME = 'image/svg+xml';

function decodeDataUri(dataUri: string): string {
  const comma = dataUri.indexOf(',');
  const match = comma >= 0 ? [dataUri, dataUri.slice(comma + 1)] : null;
  if (!match) throw new Error('Image data is not a valid data URI');
  const payload = match[1] ?? '';
  if (/;base64$/i.test(dataUri.slice(0, comma))) {
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return decodeURIComponent(payload);
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * Make a native-fetched SVG inert before it is used as an image source.
 * Raster assets are already byte-bounded and are returned unchanged.
 */
export function sanitizeImageAsset(asset: AssetResult): AssetResult {
  if (asset.mime.toLowerCase() !== SVG_MIME) return asset;

  const source = decodeDataUri(asset.dataUri);
  const sanitized = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: false },
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'use', 'image', 'style'],
    FORBID_ATTR: ['href', 'xlink:href', 'src', 'style', 'xlink:actuate', 'xlink:show', 'xlink:type'],
  }).trim();
  if (!/^<svg(?:\s|>)/i.test(sanitized)) throw new Error('SVG image did not contain a safe root element');

  return {
    ...asset,
    dataUri: `data:${SVG_MIME};base64,${encodeUtf8Base64(sanitized)}`,
  };
}
