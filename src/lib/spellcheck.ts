export const SPELLCHECK_SETTING_KEY = 'markdown-native-spellcheck';

export function defaultSpellcheckLocale(): string {
  try {
    return globalThis.navigator?.language || 'en-US';
  } catch {
    return 'en-US';
  }
}

export function spellcheckContentAttributes(enabled: boolean, locale: string): Record<string, string> {
  return {
    spellcheck: String(enabled),
    autocorrect: enabled ? 'on' : 'off',
    autocapitalize: enabled ? 'sentences' : 'off',
    lang: locale || 'en-US',
  };
}

/** Apply the platform WebView dictionary to bounded visual text surfaces. */
export function applyVisualSpellcheck(element: HTMLElement, enabled: boolean, locale: string): void {
  const isCode = Boolean(element.closest('pre, code'));
  element.setAttribute('spellcheck', String(enabled && !isCode));
  element.setAttribute('lang', locale || 'en-US');
}
