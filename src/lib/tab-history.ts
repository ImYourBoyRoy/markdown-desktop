/** Remove a closed tab from navigation history without changing ordering. */
export function removeTabFromHistory(history: readonly string[], tabId: string): string[] {
  return history.filter((candidate) => candidate !== tabId);
}

/** Preserve navigation history when a tab changes its native document ID. */
export function replaceTabInHistory(
  history: readonly string[],
  previousTabId: string,
  nextTabId: string,
): string[] {
  return history.map((candidate) => candidate === previousTabId ? nextTabId : candidate);
}
