const actionComment = /^(\s*(?:-\s+)?uses:\s+\S+@\S+)\s+#\s*v?(\d+(?:\.\d+){0,2}(?:[-+][A-Za-z0-9.-]+)?)(?:[ \t]+.*)?$/gm;

export function normalizeActionVersionComments(source) {
  return source.replace(actionComment, '$1 # v$2');
}
