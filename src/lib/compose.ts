/**
 * Pure helpers for the email composer. Extracted from EmailComposerPanel so the
 * reply/forward field derivation and send-gating logic — the parts most prone
 * to subtle regressions — can be unit-tested without rendering the component.
 */

import { isValidEmail } from "@/lib/email";
import type { ComposerMode } from "@/state/workspace";

export type AttachmentKind = "pdf" | "image" | "doc" | "archive" | "calendar" | "other";

/** Strip HTML to a plain-text snippet, collapse whitespace, truncate to `max` chars. */
export function htmlToSnippet(html: string, max = 200): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Classify an attachment for icon selection, by MIME type first then extension. */
export function classifyAttachment(name: string, type: string): AttachmentKind {
  const t = type.toLowerCase();
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (t.startsWith("image/")) return "image";
  if (t === "application/pdf" || ext === "pdf") return "pdf";
  if (t === "text/calendar" || ext === "ics") return "calendar";
  if (
    t.startsWith("application/vnd.openxmlformats-officedocument") ||
    t === "application/msword" ||
    t === "application/vnd.ms-excel" ||
    t === "application/vnd.ms-powerpoint" ||
    ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "txt", "md", "rtf"].includes(ext)
  ) return "doc";
  if (
    t === "application/zip" ||
    t === "application/x-zip-compressed" ||
    t === "application/x-tar" ||
    t === "application/x-rar-compressed" ||
    ["zip", "tar", "gz", "rar", "7z"].includes(ext)
  ) return "archive";
  return "other";
}

/**
 * Subject line for a reply/forward. `Fwd:` always prefixes a forward; otherwise
 * `Re:` is prepended unless already present (idempotent). A null mode (reply
 * context with no explicit mode) is treated as a reply, matching the original.
 */
export function deriveReplySubject(mode: ComposerMode | null, replySubject: string): string {
  if (mode === "forward") return `Fwd: ${replySubject}`;
  return replySubject.startsWith("Re:") ? replySubject : `Re: ${replySubject}`;
}

interface ReplySourceMessage {
  fromAddr: { email: string };
  toAddrs: { email: string }[];
  ccAddrs: { email: string }[];
}

/**
 * Initial To recipients for a reply/forward:
 * - forward:    [] (chosen manually)
 * - reply:      [original sender]
 * - reply-all / unspecified: [sender, ...original To excluding self]
 */
export function deriveReplyTo(mode: ComposerMode | null, msg: ReplySourceMessage, self: string): string[] {
  if (mode === "forward") return [];
  if (mode === "reply") return [msg.fromAddr.email];
  return [msg.fromAddr.email, ...msg.toAddrs.map((t) => t.email).filter((e) => e !== self)];
}

/** Initial Cc recipients: the original Cc list only on reply-all, else empty. */
export function deriveReplyCc(mode: ComposerMode | null, msg: ReplySourceMessage): string[] {
  return mode === "reply-all" ? msg.ccAddrs.map((t) => t.email) : [];
}

export type SendGate = { ok: true; reason: "" } | { ok: false; reason: string };

/**
 * Whether the composer can send. Pending (uncommitted) draft inputs count
 * because send implicitly commits them. Empty → prompt for a recipient; any
 * invalid address (committed or pending) → prompt to fix.
 */
export function evaluateSendGate(committed: string[], pendingDrafts: string[]): SendGate {
  const drafts = pendingDrafts.map((d) => d.trim()).filter(Boolean);
  const allEffective = [...committed, ...drafts];
  if (allEffective.length === 0) return { ok: false, reason: "Add at least one recipient" };
  if (allEffective.some((addr) => !isValidEmail(addr))) {
    return { ok: false, reason: "Fix invalid recipient(s) first" };
  }
  return { ok: true, reason: "" };
}
