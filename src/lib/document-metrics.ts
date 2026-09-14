export interface DocumentMetrics {
  lines: number;
  characters: number;
}

/**
 * Measure the source once for the status bar. Characters are Unicode code
 * points rather than UTF-16 code units, and CRLF is counted as one line break.
 */
export function documentMetrics(source: string): DocumentMetrics {
  let lines = 1;
  let characters = 0;
  let previousWasCarriageReturn = false;

  for (const character of source) {
    characters += 1;
    if (character === '\r') {
      lines += 1;
      previousWasCarriageReturn = true;
    } else if (character === '\n') {
      if (!previousWasCarriageReturn) lines += 1;
      previousWasCarriageReturn = false;
    } else {
      previousWasCarriageReturn = false;
    }
  }

  return { lines, characters };
}
