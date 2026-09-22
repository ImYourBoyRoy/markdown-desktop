import { applyFormatting, type EditResult, type TextSelection } from './formatting';
import {
  insertDiagram,
  insertMath,
  insertTable,
  markdownLineEnding,
  type InsertKind,
} from './inserts';
import type { MarkdownProfile } from './types';
import { insertTableOfContents } from './toc';

export type SlashCommand =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'inline-code'
  | 'underline'
  | 'subscript'
  | 'superscript'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'bullet-list'
  | 'numbered-list'
  | 'task-list'
  | 'table'
  | 'fence'
  | 'image'
  | 'link'
  | 'rule'
  | 'quote'
  | 'alert'
  | 'details'
  | 'mermaid'
  | 'graphviz'
  | 'math'
  | 'footnote'
  | 'table-of-contents';

export interface SlashCommandOption {
  id: SlashCommand;
  label: string;
  description: string;
  keywords: string;
}

export const slashCommands: readonly SlashCommandOption[] = [
  { id: 'heading-1', label: 'Heading 1', description: 'Start a top-level heading', keywords: 'h1 title' },
  { id: 'heading-2', label: 'Heading 2', description: 'Start a second-level heading', keywords: 'h2 title' },
  { id: 'heading-3', label: 'Heading 3', description: 'Start a third-level heading', keywords: 'h3 title' },
  { id: 'heading-4', label: 'Heading 4', description: 'Start a fourth-level heading', keywords: 'h4 title' },
  { id: 'heading-5', label: 'Heading 5', description: 'Start a fifth-level heading', keywords: 'h5 title' },
  { id: 'heading-6', label: 'Heading 6', description: 'Start a sixth-level heading', keywords: 'h6 title' },
  { id: 'bullet-list', label: 'Bulleted list', description: 'Start a Markdown bullet', keywords: 'list unordered bullets' },
  { id: 'numbered-list', label: 'Numbered list', description: 'Start a numbered list', keywords: 'list ordered numbers' },
  { id: 'task-list', label: 'Task list', description: 'Start an unchecked task', keywords: 'todo checkbox list' },
  { id: 'table', label: 'Table', description: 'Insert a two-column GFM table', keywords: 'grid cells gfm' },
  { id: 'fence', label: 'Code fence', description: 'Insert a fenced code block', keywords: 'code block language' },
  { id: 'image', label: 'Image', description: 'Insert an image with an explicit path', keywords: 'picture asset media' },
  { id: 'link', label: 'Link', description: 'Insert a safe link', keywords: 'url href' },
  { id: 'rule', label: 'Thematic rule', description: 'Insert a horizontal rule', keywords: 'divider horizontal' },
  { id: 'quote', label: 'Blockquote', description: 'Start a blockquote', keywords: 'quote callout' },
  { id: 'alert', label: 'Callout / alert', description: 'Insert a GitHub Note callout', keywords: 'callout alert note tip warning important caution' },
  { id: 'details', label: 'Collapsible details', description: 'Insert a details/summary block', keywords: 'collapse disclosure summary' },
  { id: 'mermaid', label: 'Mermaid diagram', description: 'Insert an editable Mermaid fence', keywords: 'chart flow diagram' },
  { id: 'graphviz', label: 'Graphviz diagram', description: 'Insert an editable DOT graph fence', keywords: 'dot graphviz graph diagram network' },
  { id: 'math', label: 'Math block', description: 'Insert a display math block', keywords: 'equation latex formula' },
  { id: 'footnote', label: 'Footnote', description: 'Insert a footnote marker and definition', keywords: 'reference note citation' },
  { id: 'table-of-contents', label: 'Table of contents', description: 'Insert a heading-linked table of contents', keywords: 'toc outline headings navigation' },
  { id: 'bold', label: 'Bold text', description: 'Insert editable bold text', keywords: 'strong emphasis formatting' },
  { id: 'italic', label: 'Italic text', description: 'Insert editable italic text', keywords: 'emphasis formatting' },
  { id: 'strikethrough', label: 'Strikethrough', description: 'Insert editable struck text', keywords: 'strike delete formatting' },
  { id: 'inline-code', label: 'Inline code', description: 'Insert editable inline code', keywords: 'code monospace formatting' },
  { id: 'underline', label: 'Underlined text', description: 'Insert semantic underlined text', keywords: 'ins formatting emphasis' },
  { id: 'subscript', label: 'Subscript', description: 'Insert semantic subscript text', keywords: 'sub formula formatting' },
  { id: 'superscript', label: 'Superscript', description: 'Insert semantic superscript text', keywords: 'sup exponent formula formatting' },
];

export function slashCommandAvailable(command: SlashCommand, profile: MarkdownProfile = 'github'): boolean {
  if (profile === 'commonmarkStrict') {
    return !new Set<SlashCommand>([
      'strikethrough', 'underline', 'subscript', 'superscript',
      'task-list', 'table', 'alert', 'details', 'mermaid', 'graphviz', 'math', 'footnote',
    ]).has(command);
  }
  if (command === 'graphviz') return profile === 'extended';
  if (profile === 'github') return true;
  return true;
}

export function filterSlashCommands(query: string, profile: MarkdownProfile = 'github'): SlashCommandOption[] {
  const normalized = query.trim().toLowerCase();
  const available = slashCommands.filter((command) => slashCommandAvailable(command.id, profile));
  if (!normalized) return available;
  const queryTokens = normalized.split(/\s+/).filter(Boolean);
  return available.filter((command) => {
    const searchableTokens = `${command.label} ${command.description} ${command.keywords}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    return queryTokens.every((queryToken) => searchableTokens.some((token) => token === queryToken || token.startsWith(queryToken)));
  });
}

/** Return whether a source prefix is currently inside a fenced code block. */
export function sourceTextIsInsideFence(prefix: string): boolean {
  let fenceCharacter: '`' | '~' | undefined;
  let fenceLength = 0;
  for (const line of prefix.split(/\r\n|\r|\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!marker) continue;
    const character = marker[1][0] as '`' | '~';
    if (!fenceCharacter) {
      fenceCharacter = character;
      fenceLength = marker[1].length;
    } else if (character === fenceCharacter
      && marker[1].length >= fenceLength
      && /^[ \t]*$/.test(marker[2])) {
      fenceCharacter = undefined;
      fenceLength = 0;
    }
  }
  return Boolean(fenceCharacter);
}

export function slashCommandNeedsDialog(command: SlashCommand): boolean {
  return command === 'fence' || command === 'image' || command === 'link' || command === 'math' || command === 'footnote';
}

function insertAt(source: string, selection: TextSelection, value: string, cursorOffset = value.length): EditResult {
  const next = `${source.slice(0, selection.from)}${value}${source.slice(selection.to)}`;
  const cursor = selection.from + cursorOffset;
  return { source: next, selection: { from: cursor, to: cursor } };
}

/** Apply only commands that have safe, deterministic defaults without a dialog. */
export function insertSlashCommand(source: string, selection: TextSelection, command: SlashCommand): EditResult | null {
  switch (command) {
    case 'bold': return applyFormatting(source, selection, 'bold');
    case 'italic': return applyFormatting(source, selection, 'italic');
    case 'strikethrough': return applyFormatting(source, selection, 'strike');
    case 'inline-code': return applyFormatting(source, selection, 'code');
    case 'underline': return applyFormatting(source, selection, 'underline');
    case 'subscript': return applyFormatting(source, selection, 'subscript');
    case 'superscript': return applyFormatting(source, selection, 'superscript');
    case 'heading-1': case 'heading-2': case 'heading-3':
    case 'heading-4': case 'heading-5': case 'heading-6': {
      const level = Number(command.slice(-1));
      return insertAt(source, selection, `${'#'.repeat(level)} `);
    }
    case 'bullet-list': return insertAt(source, selection, '- ');
    case 'numbered-list': return insertAt(source, selection, '1. ');
    case 'task-list': return insertAt(source, selection, '- [ ] ');
    case 'quote': return insertAt(source, selection, '> ');
    case 'rule': return insertAt(source, selection, '---');
    case 'alert': {
      const lineEnding = markdownLineEnding(source);
      return insertAt(source, selection, `> [!NOTE]${lineEnding}> `);
    }
    case 'details': {
      const lineEnding = markdownLineEnding(source);
      const bodyStart = `<details>${lineEnding}<summary>Details</summary>${lineEnding}${lineEnding}`;
      const block = `${bodyStart}${lineEnding}</details>`;
      return insertAt(source, selection, block, bodyStart.length);
    }
    case 'table': return insertTable(source, selection, 2, 2);
    case 'mermaid': return insertDiagram(source, selection, 'mermaid');
    case 'graphviz': return insertDiagram(source, selection, 'dot');
    case 'math': return insertMath(source, selection, '', true);
    case 'table-of-contents': return insertTableOfContents(source, selection);
    case 'fence': case 'image': case 'link': case 'footnote':
      return null;
  }
}

export function slashCommandInsertKind(command: SlashCommand): InsertKind | null {
  switch (command) {
    case 'fence': return 'fence';
    case 'image': return 'image';
    case 'link': return 'link';
    case 'math': return 'math';
    case 'footnote': return 'footnote';
    default: return null;
  }
}
