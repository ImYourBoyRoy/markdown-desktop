import type { MarkdownProfile } from './types';

export type DiagramInsertKind = 'mermaid' | 'dot' | 'math';

/**
 * Return whether the editor may insert a diagram as that profile's claimed
 * representation. Existing source is still rendered when possible; this gate
 * prevents the UI from presenting a local-only format as portable Markdown.
 */
export function diagramInsertAvailable(
  kind: DiagramInsertKind,
  profile: MarkdownProfile,
): boolean {
  if (kind === 'dot') return profile === 'extended';
  if (kind === 'math') return profile !== 'commonmarkStrict';
  return profile !== 'commonmarkStrict';
}

export function diagramInsertUnavailableMessage(
  kind: DiagramInsertKind,
  profile: MarkdownProfile,
): string {
  if (kind === 'dot') {
    return profile === 'commonmarkStrict'
      ? 'Graphviz is an Extended-profile local preview; CommonMark Strict does not claim diagram support'
      : 'Graphviz is an Extended-profile local preview; GitHub README compatibility is not claimed';
  }
  if (kind === 'math') return 'Math is unavailable in the CommonMark Strict profile';
  if (kind === 'mermaid' && profile === 'commonmarkStrict') {
    return 'Mermaid diagrams are unavailable in CommonMark Strict; the fenced source remains ordinary code';
  }
  return 'This diagram is unavailable in the selected Markdown profile';
}
