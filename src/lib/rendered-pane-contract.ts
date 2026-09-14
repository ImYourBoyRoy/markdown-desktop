// ./src/lib/rendered-pane-contract.ts
/**
 * Ordinary-GFM rendered-pane interaction contract.
 *
 * Edit mode stays explicit (viewer-first). Once enabled, the rendered surface
 * must behave like a document: click-to-caret, Enter/Backspace/Tab on ordinary
 * blocks, insertion without switching to source, and no unexpected blur when
 * an action cannot be represented. Advanced or ambiguous constructs remain
 * source-assisted and must explain why.
 *
 * Assistant/Ollama is out of scope until this contract is proven packaged.
 */
export const ORDINARY_GFM_VISUAL_KINDS = [
  'heading',
  'paragraph',
  'list_item',
  'task_item',
  'link',
  'image',
  'table',
  'table_cell',
  'code_block',
] as const;

export type OrdinaryGfmVisualKind = (typeof ORDINARY_GFM_VISUAL_KINDS)[number];

export const SOURCE_ASSISTED_VISUAL_KINDS = [
  'blockquote',
  'details',
  'html_block',
  'math',
  'diagram',
] as const;

export function isOrdinaryGfmVisualKind(kind: string): kind is OrdinaryGfmVisualKind {
  return (ORDINARY_GFM_VISUAL_KINDS as readonly string[]).includes(kind);
}

export function rejectedVisualActionMessage(action: string): string {
  return `${action} cannot be represented safely in Markdown; the caret stayed in the block`;
}
