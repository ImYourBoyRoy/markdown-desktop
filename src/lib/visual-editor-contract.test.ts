import { describe, expect, it } from 'vitest';
import {
  isImageBlockKind,
  isLinkBlockKind,
  visualBlockCapabilities,
  visualBlockLabel,
} from './visual-editor-contract';

describe('visual editor contract', () => {
  it('distinguishes safe property objects from raw HTML/source-assisted objects', () => {
    expect(isImageBlockKind('image')).toBe(true);
    expect(isImageBlockKind('html_image')).toBe(true);
    expect(isImageBlockKind('paragraph')).toBe(false);
    expect(isLinkBlockKind('link')).toBe(true);
    expect(isLinkBlockKind('html_link')).toBe(true);
  });

  it('gives root blocks stable move/delete capabilities', () => {
    expect(visualBlockCapabilities('paragraph')).toMatchObject({
      text: true,
      properties: false,
      move: true,
      delete: true,
      source: true,
    });
    expect(visualBlockCapabilities('html_block')).toMatchObject({
      text: false,
      move: false,
      delete: false,
      source: true,
    });
  });

  it('exposes safe object properties without pretending raw HTML is text-editable', () => {
    expect(visualBlockCapabilities('image')).toMatchObject({
      text: false,
      properties: true,
      move: false,
      delete: false,
      source: true,
    });
    expect(visualBlockCapabilities('html_image')).toMatchObject({
      text: false,
      properties: true,
      source: true,
    });
    expect(visualBlockCapabilities('html_link')).toMatchObject({
      text: false,
      properties: true,
      source: true,
    });
    expect(visualBlockLabel('details_summary')).toBe('details summary');
  });
});
