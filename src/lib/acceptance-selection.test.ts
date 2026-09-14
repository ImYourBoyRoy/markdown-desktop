import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_HTML_BADGE_PROBE,
  htmlImageProbeElement,
  selectRenderedTextProbe,
  sourceSelectionContainsProbe,
  sourceSelectionCoversProbe,
} from './acceptance-selection';

describe('acceptance selection helpers', () => {
  it('detects when a source selection covers an HTML image probe', () => {
    const source = `<p><img src="${ACCEPTANCE_HTML_BADGE_PROBE}.png" alt="Badge" /></p>`;
    const start = source.indexOf('<img');
    const end = source.indexOf('>', start) + 1;
    expect(sourceSelectionCoversProbe(source, { from: start, to: end })).toBe(true);
    expect(sourceSelectionCoversProbe(source, { from: 0, to: source.length })).toBe(false);
  });

  it('finds probe images by data-source after asset resolution', () => {
    const pane = document.createElement('div');
    pane.innerHTML = `<p><img data-source="${ACCEPTANCE_HTML_BADGE_PROBE}.png" src="data:image/png;base64,abc" alt="Badge" /></p>`;
    const image = htmlImageProbeElement(pane);
    expect(image?.dataset.source).toContain(ACCEPTANCE_HTML_BADGE_PROBE);
  });

  it('creates a native backwards text range for rendered-to-source probes', async () => {
    const pane = document.createElement('div');
    pane.innerHTML = '<p data-map-id="paragraph-1">Rendered selection probe text.</p>';
    document.body.append(pane);

    expect(await selectRenderedTextProbe(pane, 'selection probe', true)).toBe(true);
    const selection = window.getSelection();
    expect(selection?.toString()).toBe('selection probe');
    expect(sourceSelectionContainsProbe(
      'A rendered selection probe text source.',
      { from: 11, to: 26 },
      'selection probe',
    )).toBe(true);
    expect(sourceSelectionContainsProbe(
      String.raw`PACKAGED\_VISUAL\_PROBE edited`,
      { from: 0, to: 23 },
      'PACKAGED_VISUAL_PROBE',
    )).toBe(true);
    expect(sourceSelectionContainsProbe('Prefix selection probe suffix', { from: 0, to: 29 }, 'selection probe')).toBe(false);
    expect(sourceSelectionContainsProbe(
      String.raw`PACKAGED\_VISUAL\_PROBE edited`,
      { from: 1, to: 23 },
      'PACKAGED_VISUAL_PROBE',
    )).toBe(false);
    pane.remove();
    selection?.removeAllRanges();
  });
});
