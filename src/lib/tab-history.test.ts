import { describe, expect, it } from 'vitest';
import { removeTabFromHistory, replaceTabInHistory } from './tab-history';

describe('removeTabFromHistory', () => {
  it('removes every stale occurrence while preserving the remaining order', () => {
    expect(removeTabFromHistory(['a', 'closed', 'b', 'closed', 'c'], 'closed'))
      .toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the caller-owned history array', () => {
    const history = ['a', 'b'];
    expect(removeTabFromHistory(history, 'missing')).toEqual(history);
    expect(history).toEqual(['a', 'b']);
  });

  it('repoints navigation history when Save As changes the native tab ID', () => {
    expect(replaceTabInHistory(['a', 'old', 'b', 'old'], 'old', 'new'))
      .toEqual(['a', 'new', 'b', 'new']);
  });
});
