/** Synthetic WebView event probes, explicitly not OS keyboard/IME evidence. */
import { dispatchImeSequence, waitForProbeParagraph } from './acceptance-runner';
import type { Tab } from './acceptance-runner-types';

interface InputProbeDeps {
  getActiveTab(): Tab | undefined;
  commitVisualDraft(): void;
  getRenderedPane(): HTMLElement | null;
  getStatusMessage?(): string;
}

async function waitForCommittedPreview(
  deps: InputProbeDeps,
  text: string,
  animationFrames = 2,
): Promise<boolean> {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const tab = deps.getActiveTab();
    if (tab?.source.includes(text) && tab.renderedSource === tab.source
      && tab.sourceMap.version === 1 && tab.sourceMap.sourceHash
      && deps.getRenderedPane()?.textContent?.includes(text)) {
      if (animationFrames > 0) {
        await new Promise<void>((resolve) => {
          const settle = (remaining: number) => {
            if (remaining <= 0) {
              resolve();
              return;
            }
            requestAnimationFrame(() => settle(remaining - 1));
          };
          settle(animationFrames);
        });
      }
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

export async function probeComposition(deps: InputProbeDeps, probe: string, text: string): Promise<boolean> {
  const element = await waitForProbeParagraph(probe);
  const initialMapId = element.dataset.mapId ?? 'none';
  const initialText = element.textContent ?? '';
  const sourceBefore = deps.getActiveTab()?.source ?? '';
  await dispatchImeSequence(element, text);
  const sourceAfterDispatch = deps.getActiveTab()?.source ?? '';
  // Only real application event handlers may apply the edit. No direct patch
  // fallback can turn a broken composition handler into a passing result.
  deps.commitVisualDraft();
  const committed = await waitForCommittedPreview(deps, text);
  if (!committed) {
    const tab = deps.getActiveTab();
    const element = [...document.querySelectorAll<HTMLElement>('[data-visual-editable="true"]')]
      .find((candidate) => (candidate.textContent ?? '').includes(text));
    throw new Error(`IME preview did not settle: sourceChanged=${sourceBefore !== sourceAfterDispatch} sourceHasText=${Boolean(tab?.source.includes(text))} renderedSourceMatches=${tab?.renderedSource === tab?.source} renderedHasText=${Boolean(deps.getRenderedPane()?.textContent?.includes(text))} element=${Boolean(element)} mapChanged=${initialMapId !== (element?.dataset.mapId ?? 'none')} status=${JSON.stringify(deps.getStatusMessage?.() ?? '')}`);
  }
  return true;
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
    if (!await waitForCommittedPreview(deps, text, 1)) {
      throw new Error(`Split edit ${i + 1} did not settle`);
    }
    total += performance.now() - start;
  }
  return total / count;
}
