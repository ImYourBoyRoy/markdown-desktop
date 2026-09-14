import { describe, expect, it } from 'vitest';
import { fencedCodeBody, fencedCodeLayout, markdownForFencedCodeBlock, visibleFencedCodeText } from './fence';

describe('fenced Markdown clipboard extraction', () => {
  it('copies only the body and preserves intentional blank lines', () => {
    expect(fencedCodeBody('```ts\nconst value = 1;\n\n```')).toBe('const value = 1;\n');
  });

  it('supports tilde fences, indentation, and a longer closing fence', () => {
    expect(fencedCodeBody('  ~~~python\r\nprint(1)\r\n~~~~\r\n')).toBe('print(1)');
  });

  it('rejects an unclosed or mismatched fence', () => {
    expect(fencedCodeBody('```ts\nconst value = 1;\n')).toBeNull();
    expect(fencedCodeBody('```ts\nconst value = 1;\n~~~\n')).toBeNull();
  });

  it('preserves the fence and CRLF style while replacing only the code body', () => {
    const source = '  ```ts\r\nconst value = 1;\r\n```\r\n';
    expect(fencedCodeLayout(source)).toMatchObject({
      openingRun: '```',
      lineEnding: '\r\n',
      body: 'const value = 1;\r\n',
      bodyHasClosingSeparator: true,
    });
    expect(visibleFencedCodeText(source, 'const value = 2;\n')).toBe('const value = 2;');
    expect(markdownForFencedCodeBlock(source, 'const value = 2;\n'))
      .toBe('  ```ts\r\nconst value = 2;\r\n```\r\n');
  });

  it('rejects a visual edit that would inject a matching closing fence', () => {
    expect(markdownForFencedCodeBlock('~~~python\nprint(1)\n~~~', 'print(2)\n~~~\n')).toBeNull();
  });
});
