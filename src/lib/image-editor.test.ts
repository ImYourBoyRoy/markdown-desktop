import { describe, expect, it } from 'vitest';
import {
  convertReferenceImageToHtml,
  imageLayoutIsAvailable,
  parseImageObject,
  updateImageObject,
} from './image-editor';

describe('image editor', () => {
  it('round-trips ordinary Markdown image properties without changing representation', () => {
    const source = 'Before ![Old](assets/old.png "old title") after';
    const selection = { from: 7, to: 41 };
    const parsed = parseImageObject(source, selection, { kind: 'image' });
    expect(parsed).toMatchObject({ alt: 'Old', url: 'assets/old.png', title: 'old title', align: 'inline' });

    const result = updateImageObject(source, selection, {
      alt: 'New', url: 'assets/new.png', title: 'new title', width: '', height: '', align: 'inline',
    }, { kind: 'image' });
    expect(result.source).toBe('Before ![New](assets/new.png "new title") after');
  });

  it('uses explicit safe HTML attributes for chosen presentation settings', () => {
    const source = '![Diagram](diagram.png)';
    const result = updateImageObject(source, { from: 0, to: source.length }, {
      alt: 'Diagram', url: 'diagram.png', title: '', width: '640', height: '', align: 'center',
    }, { kind: 'image' });
    expect(result.source).toBe('<img src="diagram.png" alt="Diagram" width="640" align="center" />');
    expect(parseImageObject(result.source, result.selection, { kind: 'html_image' })).toMatchObject({
      width: '640', align: 'center',
    });
  });

  it('preserves authored raw HTML image attributes while updating safe properties', () => {
    const source = '<img class="keep" src="old.png" alt="Old" data-id="7" />';
    const result = updateImageObject(source, { from: 0, to: source.length }, {
      alt: 'New', url: 'new.png', title: 'Preview', width: '640', height: '', align: 'center',
    }, { kind: 'html_image' });
    expect(result.source).toBe('<img class="keep" src="new.png" alt="New" data-id="7" title="Preview" width="640" align="center" />');
    expect(parseImageObject(result.source, result.selection, { kind: 'html_image' })).toMatchObject({
      mode: 'html', width: '640', align: 'center',
    });
  });

  it('updates reference image properties through the shared definition', () => {
    const source = '![Diagram][diagram]\n\n[diagram]: old.svg "Old"';
    const selection = { from: 0, to: '![Diagram][diagram]'.length };
    expect(parseImageObject(source, selection, { kind: 'image' })).toMatchObject({
      alt: 'Diagram', url: 'old.svg', title: 'Old', mode: 'reference',
    });
    expect(updateImageObject(source, selection, {
      alt: 'Architecture', url: 'new.svg', title: 'New', width: '', height: '', align: 'inline',
    }, { kind: 'image' }).source).toBe('![Architecture][diagram]\n\n[diagram]: new.svg "New"');
  });

  it('does not detach a shared reference when layout is requested', () => {
    const source = '![Diagram][diagram]\n\n[diagram]: diagram.svg';
    const result = updateImageObject(source, { from: 0, to: 20 }, {
      alt: 'Diagram', url: 'diagram.svg', title: '', width: '640', height: '', align: 'center',
    }, { kind: 'image' });
    expect(result.source).toBe(source);
  });

  it('offers an explicit conversion for layout on one shared-reference occurrence', () => {
    const source = '![Diagram][diagram]\n\n![Other][diagram]\n\n[diagram]: diagram.svg';
    const occurrence = '![Diagram][diagram]';
    const result = convertReferenceImageToHtml(source, { from: 0, to: occurrence.length }, {
      alt: 'Diagram', url: 'diagram.svg', title: '', width: '640', height: '', align: 'center',
    }, { kind: 'image' });
    expect(result.source).toBe('<img src="diagram.svg" alt="Diagram" width="640" align="center" />\n\n![Other][diagram]\n\n[diagram]: diagram.svg');
    expect(parseImageObject(result.source, result.selection, { kind: 'html_image' })).toMatchObject({
      mode: 'html', width: '640', align: 'center',
    });
  });

  it('rejects unsafe destinations and dimensions outside the bounded editor range', () => {
    const source = '![Image](image.png)';
    const unsafe = updateImageObject(source, { from: 0, to: source.length }, {
      alt: 'Image', url: 'javascript:alert(1)', title: '', width: '5000', height: '0', align: 'right',
    }, { kind: 'image' });
    expect(unsafe.source).toBe(source);
    const safe = updateImageObject(source, { from: 0, to: source.length }, {
      alt: 'Image', url: 'image.png', title: '', width: '5000', height: '12', align: 'right',
    }, { kind: 'image' });
    expect(safe.source).toContain('height="12"');
    expect(safe.source).not.toContain('width=');
  });

  it('keeps layout controls out of strict CommonMark mode', () => {
    expect(imageLayoutIsAvailable('github')).toBe(true);
    expect(imageLayoutIsAvailable('extended')).toBe(true);
    expect(imageLayoutIsAvailable('commonmarkStrict')).toBe(false);
  });
});
