export interface FencedCodeLayout {
  openingRun: string;
  lineEnding: string;
  bodyStart: number;
  bodyEnd: number;
  body: string;
  bodyHasClosingSeparator: boolean;
}

/** Locate one complete fenced Markdown block without parsing arbitrary HTML. */
export function fencedCodeLayout(source: string): FencedCodeLayout | null {
  const opening = /^[ \t]*(`{3,}|~{3,})[^\r\n]*(\r\n|\r|\n)/.exec(source);
  if (!opening) return null;

  const openingRun = opening[1];
  const bodyStart = opening[0].length;
  let cursor = bodyStart;
  while (cursor <= source.length) {
    let lineEnd = cursor;
    while (lineEnd < source.length && source[lineEnd] !== '\r' && source[lineEnd] !== '\n') lineEnd += 1;
    const line = source.slice(cursor, lineEnd);
    const closing = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line);
    if (closing
      && closing[1][0] === openingRun[0]
      && closing[1].length >= openingRun.length) {
      const body = source.slice(bodyStart, cursor);
      return {
        openingRun,
        lineEnding: opening[2],
        bodyStart,
        bodyEnd: cursor,
        body,
        bodyHasClosingSeparator: /(\r\n|\r|\n)$/.test(body),
      };
    }
    if (lineEnd === source.length) break;
    cursor = lineEnd + (source[lineEnd] === '\r' && source[lineEnd + 1] === '\n' ? 2 : 1);
  }
  return null;
}

/**
 * Extract the authored body of one fenced Markdown block for clipboard copy.
 * The fence markers and info string are intentionally excluded. This parser is
 * conservative: an unclosed fence or a closing fence with the wrong marker
 * family/length is not treated as safely extractable.
 */
export function fencedCodeBody(source: string): string | null {
  const layout = fencedCodeLayout(source);
  if (!layout) return null;
  return layout.body.replace(/\r\n|\r|\n$/, '');
}

/** Remove the renderer's one structural newline before a fenced closing mark. */
export function visibleFencedCodeText(source: string, renderedText: string): string | null {
  const layout = fencedCodeLayout(source);
  if (!layout) return null;
  const normalized = renderedText.replace(/\r\n?/g, '\n');
  return layout.bodyHasClosingSeparator && normalized.endsWith('\n')
    ? normalized.slice(0, -1)
    : normalized;
}

/**
 * Replace only the authored body of a fenced block. The opening marker,
 * info-string, closing marker, and document line-ending style are preserved.
 * A body line that could close the fence is rejected rather than changing the
 * meaning of the surrounding Markdown.
 */
export function markdownForFencedCodeBlock(source: string, visualText: string): string | null {
  const layout = fencedCodeLayout(source);
  if (!layout) return null;
  const visibleText = visibleFencedCodeText(source, visualText);
  if (visibleText === null) return null;
  const marker = layout.openingRun[0] === '`' ? '`' : '~';
  const closingPattern = new RegExp(`^[ \\t]*${marker}{${layout.openingRun.length},}[ \\t]*$`);
  if (visibleText.split('\n').some((line) => closingPattern.test(line))) return null;
  const authoredBody = visibleText.replace(/\n/g, layout.lineEnding)
    + (layout.bodyHasClosingSeparator ? layout.lineEnding : '');
  return `${source.slice(0, layout.bodyStart)}${authoredBody}${source.slice(layout.bodyEnd)}`;
}
