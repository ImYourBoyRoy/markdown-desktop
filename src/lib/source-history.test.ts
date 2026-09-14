import { describe, expect, it } from 'vitest';
import { appendSourceHistory } from './source-history';

const selection = { from: 0, to: 0 };

describe('source history grouping', () => {
  it('coalesces continuous source typing into one undo entry', () => {
    let history = appendSourceHistory([], '', 'a', selection, { from: 1, to: 1 }, 'source-typing', 1000);
    history = appendSourceHistory(history, 'a', 'ab', { from: 1, to: 1 }, { from: 2, to: 2 }, 'source-typing', 1200);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ before: '', after: 'ab', afterSelection: { from: 2, to: 2 } });
  });

  it('keeps structural actions and separated typing sessions distinct', () => {
    let history = appendSourceHistory([], '', 'a', selection, { from: 1, to: 1 }, 'source-typing', 1000);
    history = appendSourceHistory(history, 'a', '# a', { from: 1, to: 1 }, { from: 0, to: 3 }, undefined, 1100);
    history = appendSourceHistory(history, '# a', '# ab', { from: 3, to: 3 }, { from: 4, to: 4 }, 'source-typing', 1200);
    history = appendSourceHistory(history, '# ab', '# abc', { from: 4, to: 4 }, { from: 5, to: 5 }, 'source-typing', 2501);

    expect(history).toHaveLength(4);
    expect(history.map((entry) => entry.after)).toEqual(['a', '# a', '# ab', '# abc']);
  });

  it('caps history without mutating the caller array', () => {
    const original = [{ before: 'seed', after: 'seed!', beforeSelection: selection, afterSelection: selection, timestamp: 0 }];
    let history = original;
    for (let index = 0; index < 101; index += 1) {
      history = appendSourceHistory(history, String(index), String(index + 1), selection, selection, undefined, index + 1);
    }

    expect(original).toHaveLength(1);
    expect(history).toHaveLength(100);
  });

  it('coalesces visual draft keystrokes that share one block group', () => {
    let history = appendSourceHistory([], 'Body', 'Body t', selection, { from: 0, to: 5 }, 'visual:p', 1000);
    history = appendSourceHistory(history, 'Body t', 'Body typed', { from: 0, to: 5 }, { from: 0, to: 10 }, 'visual:p', 1100);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      before: 'Body',
      after: 'Body typed',
      group: 'visual:p',
    });
  });
});
