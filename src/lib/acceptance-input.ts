/** Synthetic WebView event probes, explicitly not OS keyboard/IME evidence. */
import { dispatchImeSequence, waitForProbeParagraph } from './acceptance-runner';
import type { Tab } from './acceptance-runner-types';

interface InputProbeDeps {
  getActiveTab(): Tab | undefined;
  commitVisualDraft(): void;
  getRenderedPane(): HTMLElement | null;
}

async function waitForCommittedPreview(deps: InputProbeDeps, text: string): Promise<boolean> {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const tab = deps.getActiveTab();
    if (tab?.source.includes(text) && tab.renderedSource === tab.source
      && deps.getRenderedPane()?.textContent?.includes(text)) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

export async function probeComposition(deps: InputProbeDeps, probe: string, text: string): Promise<boolean> {
  const element = await waitForProbeParagraph(probe);
  dispatchImeSequence(element, text);
  // Only real application event handlers may apply the edit. No direct patch
  // fallback can turn a broken composition handler into a passing result.
  deps.commitVisualDraft();
  return waitForCommittedPreview(deps, text);
}

export async function probeSplitInputLatency(deps: InputProbeDeps, probe: string, count: number): Promise<number> {
  if (count < 1) return Infinity;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const element = await waitForProbeParagraph(probe);
    element.focus();
    const text = `${element.textContent ?? ''}x`;
    const start = performance.now();
    const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'x' });
    if (!element.dispatchEvent(before)) return Infinity;
    // Synthetic events have no browser default insertion; model that mutation,
    // then exercise the app's actual input listener and await its rendered result.
    element.textContent = text;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
    deps.commitVisualDraft();
    if (!await waitForCommittedPreview(deps, text)) return Infinity;
    total += performance.now() - start;
  }
  return total / count;
}
