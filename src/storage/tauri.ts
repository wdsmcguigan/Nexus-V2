/**
 * Typed wrappers around Tauri IPC commands.
 * All functions are no-ops (or throw) when running in the browser without Tauri.
 */

// Tauri injects window.__TAURI__ (withGlobalTauri:true) and always injects
// window.__TAURI_INTERNALS__ before page scripts run. Check both so detection
// is robust even when withGlobalTauri is absent or injected asynchronously in
// some dev-mode configurations.
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  );
}

// Lazy import so the web bundle never pays the cost of resolving @tauri-apps/api
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: _invoke } = await import("@tauri-apps/api/core");
  return _invoke<T>(cmd, args);
}

async function listen(event: string, handler: (payload: unknown) => void): Promise<() => void> {
  const { listen: _listen } = await import("@tauri-apps/api/event");
  return _listen(event, (e) => handler(e.payload));
}

// ─── Vault / DB ───────────────────────────────────────────────────────────────

export interface HydratePayload {
  vault: unknown;
  accounts: unknown[];
  folders: unknown[];
  labels: unknown[];
  statuses: unknown[];
  customFieldDefs: unknown[];
  messages: unknown[];
  tagUsage: unknown[];
  mutations: unknown[];
  contacts: unknown[];
  contactGroups: unknown[];
  calendarEvents: unknown[];
  savedViews: unknown[];
  rules: unknown[];
  templates: unknown[];
}

export async function loadVaultData(vaultPath: string): Promise<HydratePayload> {
  return invoke<HydratePayload>("load_vault_data", { vaultPath });
}

export async function getMessagesForLabel(labelId: string): Promise<unknown[]> {
  return invoke<unknown[]>("get_messages_for_label", { labelId });
}

export async function getMessageSource(messageId: string): Promise<string | null> {
  return invoke<string | null>("get_message_source", { messageId });
}

export async function applyMutationIpc(
  kind: string,
  payload: unknown,
  deviceId: string,
  lamport: number,
): Promise<void> {
  return invoke<void>("apply_mutation", { kind, payload, deviceId, lamport });
}

export async function getMessageBody(bodyRef: string): Promise<string | null> {
  return invoke<string | null>("get_message_body", { bodyRef });
}

export async function repairMessageBodies(): Promise<number> {
  return invoke<number>("repair_message_bodies");
}

export async function getClientMode(): Promise<"traditional" | "local-first"> {
  return invoke<"traditional" | "local-first">("get_client_mode");
}

export async function setClientModeIpc(mode: "traditional" | "local-first"): Promise<void> {
  return invoke<void>("set_client_mode", { mode });
}

export async function setNotificationPref(enabled: boolean): Promise<void> {
  return invoke<void>("set_notification_pref", { enabled });
}

// ─── EP7 Account preferences + signature ─────────────────────────────────────

export interface AccountPreferences {
  defaultReplyAll: boolean;
  externalImages: "always" | "ask";
}

export async function getAccountPreferences(accountId: string): Promise<AccountPreferences> {
  return invoke<AccountPreferences>("get_account_preferences", { accountId });
}

export async function saveAccountPreferences(
  accountId: string,
  prefs: AccountPreferences,
): Promise<void> {
  return invoke<void>("save_account_preferences", {
    accountId,
    defaultReplyAll: prefs.defaultReplyAll,
    externalImages: prefs.externalImages,
  });
}

export async function getSignatureHtml(accountId: string): Promise<string | null> {
  return invoke<string | null>("get_signature_html", { accountId });
}

export async function saveSignatureHtml(accountId: string, html: string): Promise<void> {
  return invoke<void>("save_signature_html", { accountId, html });
}

// ─── EP7 Stage 4: Vacation Responder ─────────────────────────────────────────

export interface VacationResponder {
  id: string;
  accountId: string;
  enabled: boolean;
  subject: string;
  bodyHtml: string;
  startDate: number | null;
  endDate: number | null;
  contactsOnly: boolean;
  sentTo: string[];
  createdAt: number;
  updatedAt: number;
}

export async function getVacationResponder(accountId: string): Promise<VacationResponder | null> {
  return invoke<VacationResponder | null>("get_vacation_responder", { accountId });
}

export async function saveVacationResponder(responder: VacationResponder): Promise<void> {
  return invoke<void>("save_vacation_responder", { responder });
}

export async function deleteVacationResponder(accountId: string): Promise<void> {
  return invoke<void>("delete_vacation_responder", { accountId });
}

export async function listAccounts(): Promise<unknown[]> {
  return invoke<unknown[]>("list_accounts");
}

export async function getVaultPath(): Promise<string | null> {
  return invoke<string | null>("get_vault_path");
}

export async function setVaultPath(path: string): Promise<void> {
  return invoke<void>("set_vault_path", { path });
}

/** Forget the vault path so the app returns to onboarding on next launch.
 *  Vault data on disk is left untouched. */
export async function resetVault(): Promise<void> {
  return invoke<void>("reset_vault");
}

// ─── Gmail OAuth + sync ───────────────────────────────────────────────────────

export interface OAuthResult {
  accountId: string;
  email: string;
}

export async function startGmailOAuth(): Promise<OAuthResult> {
  return invoke<OAuthResult>("start_gmail_oauth");
}

export async function syncGmailNow(accountId: string): Promise<{ fetched: number; inserted: number; updated: number }> {
  return invoke("sync_gmail_now", { accountId });
}

export async function refreshAccountPhotos(accountId: string): Promise<void> {
  return invoke("refresh_account_photos", { accountId });
}

// ─── EP6 Multi-Provider ───────────────────────────────────────────────────────

import type { DiscoveryResult, ImapAccountInput, SyncStats } from "@/data/types";

export async function discoverImapSettings(email: string): Promise<DiscoveryResult> {
  return invoke<DiscoveryResult>("discover_imap_settings", { email });
}

export async function testImapConnection(params: {
  host: string;
  port: number;
  security: string;
  username: string;
  password: string;
}): Promise<boolean> {
  return invoke<boolean>("test_imap_connection", params);
}

export async function addImapAccount(params: ImapAccountInput): Promise<OAuthResult> {
  return invoke<OAuthResult>("add_imap_account", {
    email: params.email,
    displayName: params.displayName ?? null,
    imapHost: params.imapHost,
    imapPort: params.imapPort,
    imapSecurity: params.imapSecurity,
    imapUsername: params.imapUsername,
    imapPassword: params.imapPassword,
    smtpHost: params.smtpHost,
    smtpPort: params.smtpPort,
    smtpSecurity: params.smtpSecurity,
  });
}

export async function syncAccountNow(accountId: string): Promise<SyncStats> {
  return invoke<SyncStats>("sync_account_now", { accountId });
}

export async function startOutlookOAuth(): Promise<OAuthResult> {
  return invoke<OAuthResult>("start_outlook_oauth");
}

export async function disconnectAccount(
  accountId: string,
  dataAction: "keep" | "delete_messages" | "delete_all",
): Promise<void> {
  return invoke<void>("disconnect_account", { accountId, dataAction });
}

// ─── Watcher ──────────────────────────────────────────────────────────────────

export async function startWatcher(vaultPath: string): Promise<void> {
  return invoke<void>("start_watcher", { vaultPath });
}

// ─── Event subscriptions ──────────────────────────────────────────────────────

export async function onHydrateNeeded(cb: () => void): Promise<() => void> {
  return listen("vault:hydrate-needed", () => cb());
}

export async function onSyncProgress(
  cb: (payload: { accountId: string; fetched: number; total: number }) => void,
): Promise<() => void> {
  return listen("gmail:sync-progress", cb as (p: unknown) => void);
}

export async function onNewMessages(
  cb: (payload: { messageIds: string[] }) => void,
): Promise<() => void> {
  return listen("gmail:new-messages", cb as (p: unknown) => void);
}

// ─── EP-5 Relay ───────────────────────────────────────────────────────────────

export interface RelayStatus {
  configured: boolean;
  lastSyncAt: number | null;
  pendingCount: number;
  error: string | null;
  hostingPort: number | null;
}

export async function getRelayStatus(): Promise<RelayStatus> {
  return invoke<RelayStatus>("get_relay_status");
}

export async function setRelayUrl(url: string): Promise<void> {
  return invoke<void>("set_relay_url", { url });
}

export async function getVaultKeyHex(): Promise<string> {
  return invoke<string>("get_vault_key_hex");
}

export interface EnrollmentSession {
  code: string;
  expiresAt: number;
}

export async function startEnrollmentSession(): Promise<EnrollmentSession> {
  return invoke<EnrollmentSession>("start_enrollment_session");
}

export async function completeEnrollment(relayUrl: string, code: string): Promise<void> {
  return invoke<void>("complete_enrollment", { relayUrl, code });
}

export async function startRelayHosting(port?: number): Promise<number> {
  return invoke<number>("start_relay_hosting", { port: port ?? 3030 });
}

// ─── File system helpers ──────────────────────────────────────────────────────

export async function saveFileToDownloads(params: {
  filename: string;
  content: string;
}): Promise<string> {
  return invoke<string>("save_file_to_downloads", params);
}

// ─── Attachment download ──────────────────────────────────────────────────────

export async function downloadAttachment(params: {
  messageId: string;
  attachmentId: string;
  filename: string;
}): Promise<string> {
  return invoke<string>("download_attachment", params);
}

// ─── Send message ─────────────────────────────────────────────────────────────

/**
 * Send a composed message via Gmail.
 * Builds RFC822 from the provided fields, base64url-encodes it, and calls
 * the `send_message` IPC command. Returns the Gmail message ID.
 */
export interface AttachmentPayload {
  name: string;
  mimeType: string;
  /** Raw base64 (no data-URL prefix). */
  data: string;
}

export async function sendMessage(params: {
  accountId: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  replyToMessageId?: string;
  attachments?: AttachmentPayload[];
  icalReply?: string;
}): Promise<string> {
  const raw = buildRfc822(params);
  const b64 = btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return invoke<string>("send_message", { accountId: params.accountId, rawEml: b64 });
}

// ─── EP-7: Search, Rules, Templates, Unsubscribe ─────────────────────────────

import type { Rule, Template } from "@/data/types";

export async function searchMessages(query: string, vaultId: string, limit = 200): Promise<string[]> {
  return invoke<string[]>("search_messages", { query, vaultId, limit });
}

export async function getRules(vaultId: string): Promise<Rule[]> {
  return invoke<Rule[]>("get_rules", { vaultId });
}

export async function saveRule(vaultId: string, rule: Rule): Promise<void> {
  return invoke<void>("save_rule", { vaultId, rule });
}

export async function deleteRule(id: string, vaultId: string): Promise<void> {
  return invoke<void>("delete_rule", { id, vaultId });
}

export async function getTemplates(vaultId: string): Promise<Template[]> {
  return invoke<Template[]>("get_templates", { vaultId });
}

export async function saveTemplate(vaultId: string, template: Template): Promise<void> {
  return invoke<void>("save_template", { vaultId, template });
}

export async function deleteTemplate(id: string, vaultId: string): Promise<void> {
  return invoke<void>("delete_template", { id, vaultId });
}

/** Returns "posted" if RFC 8058 one-click POST succeeded, or a URL to open in the browser. */
export async function sendUnsubscribe(messageId: string): Promise<string> {
  return invoke<string>("send_unsubscribe", { messageId });
}

export async function syncGoogleContacts(accountId: string): Promise<number> {
  return invoke<number>("sync_google_contacts", { accountId });
}

export async function syncGoogleCalendar(accountId: string): Promise<number> {
  return invoke<number>("sync_google_calendar", { accountId });
}

function encodeRfc2047(text: string): string {
  if ([...text].every((c) => c.charCodeAt(0) < 128)) return text;
  const bytes = new TextEncoder().encode(text);
  const b64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
  return `=?UTF-8?B?${b64}?=`;
}

function buildRfc822(params: {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  replyToMessageId?: string;
  attachments?: AttachmentPayload[];
  icalReply?: string;
}): string {
  const hdrs: string[] = [];
  hdrs.push(`From: ${params.from}`);
  hdrs.push(`To: ${params.to.join(", ")}`);
  if (params.cc?.length) hdrs.push(`Cc: ${params.cc.join(", ")}`);
  if (params.bcc?.length) hdrs.push(`Bcc: ${params.bcc.join(", ")}`);
  hdrs.push(`Subject: ${encodeRfc2047(params.subject)}`);
  hdrs.push(`MIME-Version: 1.0`);
  if (params.replyToMessageId) {
    hdrs.push(`In-Reply-To: ${params.replyToMessageId}`);
    hdrs.push(`References: ${params.replyToMessageId}`);
  }

  const hasAttachments = !!params.attachments?.length;
  const hasIcal = !!params.icalReply;

  if (!hasAttachments && !hasIcal) {
    hdrs.push(`Content-Type: text/html; charset=UTF-8`);
    hdrs.push(`Content-Transfer-Encoding: 8bit`);
    hdrs.push("");
    hdrs.push(params.bodyHtml);
    return hdrs.join("\r\n");
  }

  const boundary = `nexus_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  hdrs.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  hdrs.push("");

  const parts: string[] = [];

  // HTML body part
  parts.push(`--${boundary}`);
  parts.push(`Content-Type: text/html; charset=UTF-8`);
  parts.push(`Content-Transfer-Encoding: 8bit`);
  parts.push("");
  parts.push(params.bodyHtml);
  parts.push("");

  // iTIP calendar reply part
  if (hasIcal) {
    const icalB64 = btoa(unescape(encodeURIComponent(params.icalReply!)));
    const wrapped = icalB64.replace(/(.{76})/g, "$1\r\n");
    parts.push(`--${boundary}`);
    parts.push(`Content-Type: text/calendar; method=REPLY; charset=UTF-8`);
    parts.push(`Content-Disposition: attachment; filename="reply.ics"`);
    parts.push(`Content-Transfer-Encoding: base64`);
    parts.push("");
    parts.push(wrapped);
    parts.push("");
  }

  // Attachment parts — base64 data wrapped at 76 chars per RFC 2045
  for (const att of params.attachments ?? []) {
    const mime = att.mimeType || "application/octet-stream";
    const name = att.name.replace(/"/g, "'"); // sanitise filename for header
    parts.push(`--${boundary}`);
    parts.push(`Content-Type: ${mime}; name="${name}"`);
    parts.push(`Content-Disposition: attachment; filename="${name}"`);
    parts.push(`Content-Transfer-Encoding: base64`);
    parts.push("");
    // Wrap at 76 chars (RFC 2045 §6.8)
    const wrapped = att.data.replace(/(.{76})/g, "$1\r\n");
    parts.push(wrapped);
    parts.push("");
  }

  parts.push(`--${boundary}--`);
  return [...hdrs, ...parts].join("\r\n");
}

// ─── EP11: Calendar write API + multi-calendar ────────────────────────────────

export interface CalendarListEntry {
  id: string;
  summary: string;
  backgroundColor: string;
  selected: boolean;
}

export async function createCalendarEvent(params: {
  accountId: string;
  title: string;
  startTs: number;
  endTs: number;
  allDay: boolean;
  location?: string;
  description?: string;
  attendeeEmails: string[];
}): Promise<string> {
  return invoke<string>("create_calendar_event", params);
}

export async function updateCalendarEvent(params: {
  accountId: string;
  externalId: string;
  title?: string;
  startTs?: number;
  endTs?: number;
  allDay?: boolean;
  location?: string;
  description?: string;
  attendeeEmails?: string[];
}): Promise<void> {
  return invoke<void>("update_calendar_event", params);
}

export async function getCalendarList(accountId: string): Promise<CalendarListEntry[]> {
  return invoke<CalendarListEntry[]>("get_calendar_list", { accountId });
}

export async function searchCalendarEvents(query: string, vaultId: string, limit = 50): Promise<string[]> {
  return invoke<string[]>("search_calendar_events", { query, vaultId, limit });
}
