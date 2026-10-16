/** Actual application UI with simulated IPC. Never a native filesystem test. */
import { mount } from 'svelte';
import '../../src/styles.css';
import type { OpenedDocument, RenderedSource } from '../../src/lib/types';

const callbacks = new Map<number, (value: unknown) => void>();
const events = new Map<string, number>();
let callbackId = 0;
const fixture = {
  source: '# Review fixture\n\nEditable review paragraph.\n\nSecond paragraph for navigation.',
  saved: '', recovery: '', calls: [] as string[], failRecovery: false,
  delaySave: 0, exited: false, failRender: false,
  emit(name: string, payload: unknown = null) {
    const handler = events.get(name);
    if (handler) callbacks.get(handler)?.({ event: name, id: handler, payload });
  },
};
fixture.saved = fixture.source;
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
async function render(source: string): Promise<RenderedSource> {
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const spans = [];
  const html = [];
  for (const match of source.matchAll(/[^\n]+/g)) {
    const text = match[0]; const from = match.index;
    const heading = text.startsWith('# '); const mapId = `fixture-${from}`;
    const line = source.slice(0, from).split('\n').length;
    spans.push({ mapId, kind: heading ? 'heading' : 'paragraph', sourceByteStart: new TextEncoder().encode(source.slice(0, from)).length, sourceByteEnd: new TextEncoder().encode(source.slice(0, from + text.length)).length, attrs: heading ? { level: 1 } : {} });
    html.push(`<${heading ? 'h1' : 'p'} data-sourcepos="${line}:1-${line}:${text.length}">${escape(heading ? text.slice(2) : text)}</${heading ? 'h1' : 'p'}>`);
  }
  return { html: html.join(''), headings: [{ level: 1, text: 'Review fixture', slug: 'review-fixture' }], links: [], issues: [], sourceMap: { version: 1, sourceHash: `sha256:${hash}`, spans } };
}
async function opened(source = fixture.source): Promise<OpenedDocument> {
  return { id: 'review-doc', title: 'Review fixture', source, revision: 'baseline', meta: { path: '/simulated/review.md', fileName: 'review.md', bytes: source.length, encoding: 'utf-8', lineEnding: 'LF', finalNewline: false, profile: 'github' }, ...await render(source) };
}
Object.assign(window, {
  reviewFixture: fixture,
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: (callback: (value: unknown) => void) => { callbacks.set(++callbackId, callback); return callbackId; },
    unregisterCallback: (id: number) => callbacks.delete(id),
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      fixture.calls.push(command);
      if (command === 'plugin:event|listen') { events.set(args.event as string, args.handler as number); return args.handler; }
      if (command === 'plugin:event|unlisten') { events.delete(args.event as string); return; }
      if (command === 'plugin:store|load') return 1;
      if (command === 'plugin:store|get') return [null, false];
      if (command === 'plugin:store|set') return;
      if (command === 'plugin:app|version') return '1.1.2';
      if (command === 'startup_paths') return [{ token: 'review-token', kind: 'document' }];
      if (command === 'open_document_grant' || command === 'read_document') return opened(fixture.saved);
      if (command === 'acceptance_context') return { enabled: false };
      if (command === 'list_recovery') return new URLSearchParams(location.search).has('recovery') ? [{ documentId: 'snapshot-doc', originalPath: '/simulated/review.md', savedAt: 1, preview: 'Recovered paragraph', sourceChars: 19 }] : [];
      if (command === 'render_source') { if (fixture.failRender) throw 'Render worker unavailable'; fixture.source = args.source as string; return render(fixture.source); }
      if (command === 'lint_document_references' || command === 'validate_recent_document_paths') return [];
      if (command === 'save_recovery') { if (fixture.failRecovery) throw 'Simulated full disk'; fixture.recovery = args.source as string; return; }
      if (command === 'clear_recovery' || command === 'discard_recovery') { fixture.recovery = ''; return; }
      if (command === 'save_document') { await new Promise((resolve) => setTimeout(resolve, fixture.delaySave)); fixture.saved = args.source as string; const doc = await opened(fixture.saved); return { revision: 'saved', meta: doc.meta }; }
      if (command === 'complete_shutdown') { fixture.exited = true; return; }
      if (command === 'inspect_document') return { diskSource: fixture.saved, currentRevision: 'baseline', diskMeta: (await opened()).meta };
      if (command === 'pick_save_path') return null;
      if (command === 'close_document' || command === 'set_update_shutdown_approval') return;
      if (command === 'plugin:updater|check') return null;
      throw new Error(`Unimplemented simulated IPC: ${command}`);
    },
  },
});
const { default: App } = await import('../../src/App.svelte');
mount(App, { target: document.querySelector<HTMLElement>('#app')! });
