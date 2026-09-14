/** A render result is usable only for the request and source it represents. */
export function isCurrentRender(
  requestedSource: string,
  currentSource: string,
  requestedGeneration: number,
  currentGeneration: number,
): boolean {
  return requestedSource === currentSource && requestedGeneration === currentGeneration;
}
