/** Cheap clipboard operations and a lazy boundary for rich conversion. */
export function plainTextPaste(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export async function htmlToMarkdown(...args: Parameters<typeof import('./paste').htmlToMarkdown>) {
  return (await import('./paste')).htmlToMarkdown(...args);
}
