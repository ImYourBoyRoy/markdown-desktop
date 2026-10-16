import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentRecoveryController, type RecoveryDocument } from './document-recovery-controller';

afterEach(() => vi.useRealTimers());
describe('document recovery durability', () => {
  it('protects continuous typing without waiting for rendering or idle', async () => {
    vi.useFakeTimers();
    const document: RecoveryDocument = { id: 'doc', source: 'a', savedSource: '', revision: 'base' };
    const save = vi.fn().mockResolvedValue(undefined);
    const controller = new DocumentRecoveryController({ read: () => document, save, clear: vi.fn(), onError: vi.fn() });
    controller.schedule('doc');
    await vi.advanceTimersByTimeAsync(500);
    document.source = 'ab';
    controller.schedule('doc');
    await vi.advanceTimersByTimeAsync(250);
    expect(save).toHaveBeenCalledWith({ ...document });
    controller.dispose();
  });

  it('drains pending writes before clearing and propagates failures at shutdown', async () => {
    let finish!: () => void;
    const events: string[] = [];
    const document = { id: 'doc', source: 'edit', savedSource: '', revision: 'base' };
    const controller = new DocumentRecoveryController({ read: () => document,
      save: async () => { events.push('save'); await new Promise<void>((resolve) => { finish = resolve; }); },
      clear: async () => { events.push('clear'); }, onError: vi.fn() });
    const write = controller.persist('doc');
    await Promise.resolve(); await Promise.resolve();
    const clear = controller.clear('doc');
    finish();
    await Promise.all([write, clear]);
    expect(events).toEqual(['save', 'clear']);
    const failing = new DocumentRecoveryController({ read: () => document, save: async () => { throw Error('disk full'); }, clear: vi.fn(), onError: vi.fn() });
    await expect(failing.drain(['doc'])).rejects.toThrow('disk full');
  });
});
