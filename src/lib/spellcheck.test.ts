// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyVisualSpellcheck, defaultSpellcheckLocale, spellcheckContentAttributes } from './spellcheck';

describe('spellcheck preferences', () => {
  it('provides native WebView attributes without a network provider', () => {
    expect(spellcheckContentAttributes(true, 'en-US')).toEqual({
      spellcheck: 'true',
      autocorrect: 'on',
      autocapitalize: 'sentences',
      lang: 'en-US',
    });
  });

  it('never enables spellcheck on code surfaces', () => {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    pre.append(code);
    document.body.append(pre);
    applyVisualSpellcheck(code, true, 'en-US');
    expect(code.getAttribute('spellcheck')).toBe('false');
    pre.remove();
  });

  it('always has a usable locale fallback', () => {
    expect(defaultSpellcheckLocale()).toBeTruthy();
  });
});
