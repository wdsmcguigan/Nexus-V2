const SIG_KEY = (accountId: string) => `nexus-sig-${accountId}`;

export function loadSignature(accountId: string): string {
  try { return localStorage.getItem(SIG_KEY(accountId)) ?? ""; } catch { return ""; }
}

export function saveSignature(accountId: string, html: string): void {
  try {
    if (html.trim()) localStorage.setItem(SIG_KEY(accountId), html);
    else localStorage.removeItem(SIG_KEY(accountId));
  } catch { /* ignore quota */ }
}

/**
 * Render plain text as safe HTML: escape the HTML-special characters and turn
 * newlines into `<br/>`. Used to migrate a plain-text signature into the
 * rich-text editor / signature HTML.
 */
export function escapeHtmlWithBreaks(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
}
