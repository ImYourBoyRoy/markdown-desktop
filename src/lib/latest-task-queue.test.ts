import { describe, expect, it } from 'vitest';
import { createLatestTaskQueue } from './latest-task-queue';

describe('latest task queue', () => {
  it('coalesces requests and invalidates active completions', async () => {
    const started: number[] = [];
    const published: number[] = [];
    const releases: (() => void)[] = [];
    const queue = createLatestTaskQueue<string, number>(async (_, value, current) => {
      started.push(value);
      await new Promise<void>((resolve) => releases.push(resolve));
      if (current()) published.push(value);
    }, () => { throw new Error('unexpected failure'); });
    queue.enqueue('doc', 1);
    queue.enqueue('doc', 2);
    queue.enqueue('doc', 3);
    releases.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([1, 3]);
    expect(published).toEqual([]);
    releases.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(published).toEqual([3]);
  });

  it('invalidates closed keys and continues after a failed task', async () => {
    let release!: () => void;
    const published: number[] = [];
    const errors: unknown[] = [];
    const queue = createLatestTaskQueue<string, number>(async (_, value, current) => {
      if (value === 1) await new Promise<void>((resolve) => { release = resolve; });
      if (value === 2) throw new Error('failure');
      if (current()) published.push(value);
    }, (error) => errors.push(error));
    queue.enqueue('doc', 1);
    queue.delete('doc');
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(published).toEqual([]);
    queue.enqueue('doc', 2);
    queue.enqueue('doc', 3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toHaveLength(1);
    expect(published).toEqual([3]);
  });
});
