export interface RecoveryDocument {
  id: string;
  source: string;
  savedSource: string;
  revision: string;
}

/** Serializes recovery writes/clears and bounds the crash-loss window even
 * during continuous typing. Reads the current source when the timer fires. */
export class DocumentRecoveryController {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private writes = new Map<string, Promise<void>>();
  constructor(private options: {
    read: (id: string) => RecoveryDocument | undefined;
    save: (document: RecoveryDocument) => Promise<void>;
    clear: (id: string) => Promise<void>;
    onError: (error: unknown) => void;
    delay?: number;
  }) {}

  schedule(id: string): void {
    if (this.timers.has(id)) return;
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      void this.persist(id).catch(this.options.onError);
    }, this.options.delay ?? 750));
  }

  private enqueue(id: string, action: () => Promise<void>): Promise<void> {
    const previous = this.writes.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.writes.set(id, next);
    void next.finally(() => {
      if (this.writes.get(id) === next) this.writes.delete(id);
    }).catch(() => {});
    return next;
  }

  persist(id: string): Promise<void> {
    this.cancelTimer(id);
    return this.enqueue(id, async () => {
      const document = this.options.read(id);
      if (!document) return;
      if (document.source === document.savedSource) await this.options.clear(id);
      else await this.options.save({ ...document });
    });
  }

  clear(id: string): Promise<void> {
    this.cancelTimer(id);
    return this.enqueue(id, () => this.options.clear(id));
  }

  cancelTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
  }

  async drain(ids: readonly string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.persist(id)));
  }

  dispose(): void {
    for (const id of this.timers.keys()) this.cancelTimer(id);
  }
}
