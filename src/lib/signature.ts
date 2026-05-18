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
