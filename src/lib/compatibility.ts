import type { CompatibilityTarget, Issue } from './types';

export const compatibilityTargetLabel = 'GitHub README';

/**
 * Keep the compatibility lens separate from profile diagnostics. General
 * safety/lint findings remain useful in the target view; editor-profile
 * notices belong only to the unfiltered Issues view.
 */
export function issuesForCompatibilityTarget(
  issues: Issue[],
  target: CompatibilityTarget,
): Issue[] {
  return target === 'none'
    ? issues.filter((issue) => issue.scope !== 'compatibility')
    : issues.filter((issue) => issue.scope !== 'profile');
}

export function compatibilityStatus(
  issues: Issue[],
  target: CompatibilityTarget,
): { label: string; detail: string; errors: number; warnings: number; info: number } {
  if (target === 'none') {
    return {
      label: `${compatibilityTargetLabel} · Off`,
      detail: 'Compatibility advisories are disabled in Settings. Saving remains available.',
      errors: 0,
      warnings: 0,
      info: 0,
    };
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const info = issues.filter((issue) => issue.severity === 'info').length;
  const total = errors + warnings + info;
  const count = total === 0
    ? 'No advisories'
    : `${total} ${total === 1 ? 'advisory' : 'advisories'}`;
  return {
    label: `${compatibilityTargetLabel} · ${count}`,
    detail: 'Advisory checks for this document only; repository-wide checks are not included. Saving is never blocked.',
    errors,
    warnings,
    info,
  };
}
