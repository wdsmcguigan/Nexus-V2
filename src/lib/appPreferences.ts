/**
 * App-global preferences — settings that apply across all workspaces.
 * Stored in a separate localStorage key so they survive workspace switches.
 */

export interface AppPreferences {
  /** Whether OS-level desktop notifications fire on new mail. */
  notificationsEnabled: boolean;
  /** Seconds before an outbound message is actually sent (0 = instant). */
  undoSendSeconds: 0 | 5 | 10 | 20 | 30;
  /** Milliseconds after opening a message before it is marked read. -1 = never. */
  markReadAfterMs: -1 | 0 | 1000 | 3000 | 10000;
  /** Whether toolbar buttons show icon-only or icon + text label. */
  buttonLabels: "icons" | "text";
  /** Google Cloud Translate API key for the message Translate action. */
  translateApiKey: string;
  /** Per-account toggle for Google Contacts sync. Key is account ID. */
  contactsSyncEnabled: Record<string, boolean>;
}

const DEFAULTS: AppPreferences = {
  notificationsEnabled: true,
  undoSendSeconds: 5,
  markReadAfterMs: 1000,
  buttonLabels: "icons",
  translateApiKey: "",
  contactsSyncEnabled: {},
};

const STORAGE_KEY = "nexus_app_prefs_v1";

let _cache: AppPreferences | null = null;

export function getAppPreferences(): AppPreferences {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      _cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppPreferences>) };
      return _cache;
    }
  } catch {
    // ignore parse errors
  }
  _cache = { ...DEFAULTS };
  return _cache;
}

export function saveAppPreferences(updates: Partial<AppPreferences>): void {
  const current = getAppPreferences();
  _cache = { ...current, ...updates };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache));
  } catch {
    // quota exceeded — silently ignore
  }
}

/** Invalidate the in-memory cache (useful after external storage changes). */
export function reloadAppPreferences(): void {
  _cache = null;
}
