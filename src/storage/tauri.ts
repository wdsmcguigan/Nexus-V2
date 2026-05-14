/**
 * Typed wrappers around Tauri IPC commands.
 * All functions are no-ops (or throw) when running in the browser without Tauri.
 */

// Tauri injects window.__TAURI__ when running inside the desktop shell.
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
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
}

export async function loadVaultData(vaultPath: string): Promise<HydratePayload> {
  return invoke<HydratePayload>("load_vault_data", { vaultPath });
}

export async function applyMutationIpc(kind: string, payload: unknown): Promise<void> {
  return invoke<void>("apply_mutation", { kind, payload });
}

export async function getMessageBody(bodyRef: string): Promise<string | null> {
  return invoke<string | null>("get_message_body", { bodyRef });
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
