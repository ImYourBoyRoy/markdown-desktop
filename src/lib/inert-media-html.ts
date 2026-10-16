/** Native HTML is sanitized, but mounting a src can initiate a browser request
 * before enhancement. Deactivate resource attributes without parsing into a
 * live document; the media controller alone restores authorized URLs. */
export function inertMediaHtml(html: string): string {
  return html.replace(/<(?:img|video|source|iframe)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) =>
    tag.replace(/(\s)(src|srcset|poster)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi,
      '$1data-media-$2$3$4'));
}
