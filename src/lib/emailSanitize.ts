/**
 * Pure helpers for the email body remote-image privacy layer.
 *
 * These operate on already-sanitized HTML strings (DOMPurify runs first in
 * EmailViewerPanel) and contain no DOM dependencies, so they are unit-testable
 * in a plain node environment.
 */

/**
 * Blanks out remote image URLs rather than removing the element, which
 * preserves layout while preventing tracking pixels and resource loads.
 * Applied AFTER DOMPurify so attribute structure is already clean.
 */
export function stripRemoteImages(html: string): string {
  return html
    .replace(/(<[^>]+\s)src=(["'])https?:\/\/[^"']*\2/gi, '$1src=""')
    .replace(/(<[^>]+\s)srcset=(["'])[^"']*\2/gi, '$1srcset=""')
    .replace(
      /background-image\s*:\s*url\s*\(\s*["']?https?:\/\/[^)"']*["']?\s*\)/gi,
      "background-image:none"
    );
}

/** True when the HTML references at least one remote (http/https) image src. */
export function hasRemoteImages(html: string): boolean {
  return /src=["']https?:\/\//i.test(html);
}
