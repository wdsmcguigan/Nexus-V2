import type { Message } from "@/data/types";
import { isTauri, saveFileToDownloads } from "@/storage/tauri";

// ─── RFC 2822 date formatting ─────────────────────────────────────────────────

function toRfc2822(unixMs: number): string {
  return new Date(unixMs).toUTCString();
}

function sanitizeFilename(s: string): string {
  return s
    .replace(/[^a-z0-9_\-. ]/gi, "_")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

// ─── Single EML builder ───────────────────────────────────────────────────────

function buildEml(msg: Message, bodyHtml: string): string {
  const lines: string[] = [];
  lines.push(`From: ${fmtAddr(msg.fromAddr)}`);
  lines.push(`To: ${msg.toAddrs.map(fmtAddr).join(", ")}`);
  if (msg.ccAddrs.length > 0) lines.push(`Cc: ${msg.ccAddrs.map(fmtAddr).join(", ")}`);
  lines.push(`Subject: ${msg.subject}`);
  lines.push(`Date: ${toRfc2822(msg.receivedAt)}`);
  const msgId = msg.providerIds.messageId ?? `<${msg.id}@nexus.local>`;
  lines.push(`Message-ID: ${msgId}`);
  lines.push(`MIME-Version: 1.0`);
  lines.push(`Content-Type: text/html; charset=UTF-8`);
  lines.push(`X-Nexus-ID: ${msg.id}`);
  lines.push("");
  lines.push(bodyHtml);
  return lines.join("\r\n");
}

function fmtAddr(a: { name: string; email: string }): string {
  return a.name ? `"${a.name.replace(/"/g, '\\"')}" <${a.email}>` : a.email;
}

// ─── MBOX builder (for thread/bulk) ──────────────────────────────────────────

function buildMbox(messages: Message[], bodies: Map<string, string>): string {
  return messages.map((msg) => {
    const eml = buildEml(msg, bodies.get(msg.bodyRef) ?? `<p>${msg.snippet}</p>`);
    const fromLine = `From ${msg.fromAddr.email} ${toRfc2822(msg.receivedAt)}`;
    return `${fromLine}\r\n${eml}\r\n\r\n`;
  }).join("");
}

// ─── Download helpers ─────────────────────────────────────────────────────────

async function saveOrDownload(filename: string, content: string, mimeType: string): Promise<void> {
  if (isTauri()) {
    await saveFileToDownloads({ filename, content });
  } else {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Export a single message as an EML file. */
export async function exportMessageEml(msg: Message, bodyHtml: string): Promise<void> {
  const filename = `${sanitizeFilename(msg.subject) || "email"}.eml`;
  await saveOrDownload(filename, buildEml(msg, bodyHtml), "message/rfc822");
}

/** Export multiple messages as a single MBOX file. */
export async function exportMessagesAsMbox(
  messages: Message[],
  bodies: Map<string, string>,
  filenameHint = "nexus_export",
): Promise<void> {
  const filename = `${sanitizeFilename(filenameHint)}.mbox`;
  await saveOrDownload(filename, buildMbox(messages, bodies), "application/mbox");
}
