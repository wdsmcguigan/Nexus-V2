import type { Message } from "@/data/types";
import { formatAbsoluteTime } from "@/lib/utils";

function formatAddress(addr: { name: string; email: string }): string {
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email;
}

function messageBlock(msg: Message, bodyHtml: string): string {
  const from = formatAddress(msg.fromAddr);
  const to = msg.toAddrs.map(formatAddress).join(", ");
  const cc = msg.ccAddrs.length > 0 ? msg.ccAddrs.map(formatAddress).join(", ") : null;
  const date = formatAbsoluteTime(new Date(msg.receivedAt));

  return `
<div class="message">
  <div class="meta">
    <div class="subject">${escapeHtml(msg.subject)}</div>
    <div><strong>From:</strong> ${escapeHtml(from)}</div>
    <div><strong>To:</strong> ${escapeHtml(to)}</div>
    ${cc ? `<div><strong>Cc:</strong> ${escapeHtml(cc)}</div>` : ""}
    <div><strong>Date:</strong> ${escapeHtml(date)}</div>
  </div>
  <div class="body">${bodyHtml}</div>
</div>`;
}

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 14px;
    line-height: 1.6;
    color: #111;
    max-width: 740px;
    margin: 32px auto;
    padding: 0 24px;
  }
  .message + .message {
    margin-top: 48px;
    padding-top: 48px;
    border-top: 2px solid #ddd;
  }
  .meta {
    margin-bottom: 24px;
    font-size: 13px;
    color: #444;
    line-height: 1.9;
  }
  .meta .subject {
    font-size: 20px;
    font-weight: bold;
    color: #111;
    margin-bottom: 8px;
    line-height: 1.3;
  }
  .meta strong { color: #111; }
  .body { font-family: system-ui, sans-serif; font-size: 14px; }
  .body a { color: #1a56db; }
  @media print {
    body { margin: 0; }
    .message + .message {
      page-break-before: always;
      border: none;
      padding-top: 0;
      margin-top: 0;
    }
  }
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Open a print window with one or more messages.
 * bodies is a Map<bodyRef, html>.
 */
export function printMessages(
  messages: Message[],
  bodies: Map<string, string>,
): void {
  const blocks = messages
    .map((msg) => messageBlock(msg, bodies.get(msg.bodyRef) ?? `<p>${msg.snippet}</p>`))
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Print</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>${blocks}</body>
</html>`;

  const w = window.open("", "_blank", "width=900,height=700,menubar=1,toolbar=1");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  // Small delay so the new window renders before the dialog appears
  w.setTimeout(() => { w.focus(); w.print(); }, 200);
}
