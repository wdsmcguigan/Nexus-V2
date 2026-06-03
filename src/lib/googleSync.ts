/**
 * Background Google sync driver (desktop only).
 *
 * Calendar and contacts sync only run when triggered — there is no Rust-side
 * poll loop for them. The per-account enable flags live in localStorage
 * (AppPreferences), so we drive auto-sync from the frontend: an initial sweep
 * on startup, a periodic sweep, and an immediate sweep whenever a new Gmail
 * account appears in the store (e.g. just connected from Settings).
 *
 * Each sync IPC emits `vault:hydrate-needed`, which the global listener in
 * main.tsx handles to refresh the store — so we never trigger from that event.
 */
import { localStore } from "@/storage/local";
import { getAppPreferences } from "@/lib/appPreferences";
import { syncGoogleCalendar, syncGoogleContacts } from "@/storage/tauri";

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function syncEnabledAccounts(): void {
  const prefs = getAppPreferences();
  for (const account of localStore.accounts.values()) {
    if (account.provider !== "gmail") continue;
    if (prefs.calendarSyncEnabled[account.id] ?? true) {
      syncGoogleCalendar(account.id).catch((e) =>
        console.warn(`Auto calendar sync failed for ${account.id}:`, e),
      );
    }
    if (prefs.contactsSyncEnabled[account.id] ?? true) {
      syncGoogleContacts(account.id).catch((e) =>
        console.warn(`Auto contacts sync failed for ${account.id}:`, e),
      );
    }
  }
}

/**
 * Start the auto-sync loop. Safe to call once at startup. Runs an initial
 * sweep, then repeats on an interval, and syncs any newly-connected Gmail
 * account as soon as it lands in the store.
 */
export function startGoogleAutoSync(): void {
  const seen = new Set(localStore.accounts.keys());
  syncEnabledAccounts();

  setInterval(syncEnabledAccounts, INTERVAL_MS);

  localStore.subscribe(() => {
    const prefs = getAppPreferences();
    for (const account of localStore.accounts.values()) {
      if (seen.has(account.id)) continue;
      seen.add(account.id);
      if (account.provider !== "gmail") continue;
      if (prefs.calendarSyncEnabled[account.id] ?? true) {
        syncGoogleCalendar(account.id).catch((e) =>
          console.warn(`Initial calendar sync failed for ${account.id}:`, e),
        );
      }
      if (prefs.contactsSyncEnabled[account.id] ?? true) {
        syncGoogleContacts(account.id).catch((e) =>
          console.warn(`Initial contacts sync failed for ${account.id}:`, e),
        );
      }
    }
  });
}
