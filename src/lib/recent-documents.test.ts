import { describe, expect, it } from 'vitest';
import {
  MAX_RECENT_DOCUMENTS,
  normalizeRecentDocumentPaths,
  recentDocumentDirectory,
  recentDocumentName,
  rememberRecentDocument,
} from './recent-documents';

describe('recent Markdown documents', () => {
  it('keeps only valid, unique paths in most-recent-first order', () => {
    expect(normalizeRecentDocumentPaths([
      ' C:\\Docs\\README.md ',
      'c:/docs/readme.md',
      42,
      '',
      'D:/notes/one.md',
    ])).toEqual(['C:\\Docs\\README.md', 'D:/notes/one.md']);
  });

  it('moves an opened path to the front and caps the history', () => {
    const paths = Array.from({ length: MAX_RECENT_DOCUMENTS }, (_, index) => `C:/docs/${index}.md`);
    expect(rememberRecentDocument(paths, paths[3])).toEqual([
      paths[3], paths[0], paths[1], paths[2], paths[4],
    ]);
    expect(rememberRecentDocument(paths, 'C:/docs/new.md')).toHaveLength(MAX_RECENT_DOCUMENTS);
  });

  it('derives a readable name and directory for both Windows and POSIX paths', () => {
    expect(recentDocumentName('C:\\Docs\\README.md')).toBe('README.md');
    expect(recentDocumentDirectory('C:\\Docs\\README.md')).toBe('C:/Docs');
    expect(recentDocumentName('/home/roy/README.md')).toBe('README.md');
    expect(recentDocumentDirectory('/home/roy/README.md')).toBe('/home/roy');
  });
});
