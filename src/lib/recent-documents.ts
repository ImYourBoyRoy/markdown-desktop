export const MAX_RECENT_DOCUMENTS = 5;

/** Keep recent-document settings bounded, string-only, and free of duplicates. */
export function normalizeRecentDocumentPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const path = item.trim();
    if (!path) continue;
    const normalized = path.replaceAll('\\', '/');
    // Windows drive and UNC paths are case-insensitive; preserve case for
    // POSIX paths where `/Docs/README.md` and `/docs/README.md` may differ.
    const key = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
      ? normalized.toLowerCase()
      : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(path);
    if (paths.length >= MAX_RECENT_DOCUMENTS) break;
  }
  return paths;
}

/** Move an opened document to the front while preserving the five-item cap. */
export function rememberRecentDocument(paths: readonly string[], path: string): string[] {
  return normalizeRecentDocumentPaths([path, ...paths]);
}

export function recentDocumentName(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  return normalized.split('/').at(-1) || path;
}

export function recentDocumentDirectory(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  const lastSeparator = normalized.lastIndexOf('/');
  return lastSeparator > 0 ? normalized.slice(0, lastSeparator) : normalized;
}
