import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { localStore } from "@/storage/local";
import { bodyStore } from "@/storage/bodyStore";
import { ftsIndex } from "@/storage/fts";
import App from "./App";
import {
  isTauri,
  loadVaultData,
  getVaultPath,
  onHydrateNeeded,
  onSyncProgress,
  onNewMessages,
  startWatcher,
  syncGmailNow,
} from "@/storage/tauri";
import { useWorkspace } from "@/state/workspace";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing in index.html");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

async function hydrateFromVault(path: string) {
  const payload = await loadVaultData(path);
  localStore.hydrate(payload as Parameters<typeof localStore.hydrate>[0]);
  ftsIndex.reindex(Array.from(localStore.messages.values()), bodyStore);

  // After hydrating real data the inbox label ID is vault-scoped (e.g. "{vaultId}-inbox"),
  // not the fixture default "inbox". If the current folder no longer exists in the loaded
  // store (e.g. on first load with default "inbox" id), redirect to the real inbox label.
  const { selectedFolderId } = useWorkspace.getState();
  const folderExists =
    localStore.labels.has(selectedFolderId) ||
    localStore.folders.has(selectedFolderId);
  if (!folderExists) {
    const inboxLabel = Array.from(localStore.labels.values()).find(
      (l) => l.systemKind === "inbox",
    );
    if (inboxLabel) {
      useWorkspace.getState().setSelectedFolder(inboxLabel.id);
    }
  }
}

async function initTauri() {
  // Register the hydrate listener before any IPC calls so we never miss an
  // event that fires during startup (e.g. the one emitted by init_vault in
  // lib.rs::setup).  Must be awaited — the registration is itself async
  // (dynamic import of @tauri-apps/api/event).
  await onHydrateNeeded(async () => {
    const path = await getVaultPath();
    if (!path) return;
    await hydrateFromVault(path).catch((e) =>
      console.error("Re-hydrate failed:", e),
    );
    useWorkspace.getState().setSyncStatus(false, Date.now());
  });

  const savedPath = await getVaultPath();
  if (!savedPath) {
    // No vault yet — load fixture data so the UI isn't blank.
    // When onboarding completes, Rust emits vault:hydrate-needed and the
    // listener above will replace fixtures with real data automatically.
    await import("@/data/fixtures");
    return;
  }

  // Load real data from SQLite
  try {
    await hydrateFromVault(savedPath);

    // If the vault has accounts but no labels the initial Gmail sync
    // has not yet committed to the DB (or ran without saving historyId).
    // Force a sync now so labels + messages arrive before the 60s poller fires.
    if (localStore.accounts.size > 0 && localStore.labels.size === 0) {
      const firstAccount = Array.from(localStore.accounts.values())[0]!;
      syncGmailNow(firstAccount.id).catch((e) =>
        console.warn("Auto-sync failed:", e),
      );
    }

    // Start filesystem watcher
    await startWatcher(savedPath).catch((e) =>
      console.warn("Watcher failed to start:", e),
    );

    onSyncProgress((payload) => {
      const ws = useWorkspace.getState();
      ws.setSyncStatus(true);
      ws.setSyncProgress(payload);
    });
    onNewMessages(() => {
      useWorkspace.getState().setSyncStatus(false, Date.now());
    });
  } catch (e) {
    console.error("Failed to load vault data, falling back to fixtures:", e);
    await import("@/data/fixtures");
  }
}

async function initWeb() {
  // Web mode: seed with fixture data + OPFS persistence
  await import("@/data/fixtures");
  const loadedFromOpfs = await localStore.initOpfs();
  if (loadedFromOpfs) {
    const messages = Array.from(localStore.messages.values());
    ftsIndex.indexMessages(messages, bodyStore);
  }
}

if (isTauri()) {
  initTauri();
} else {
  initWeb();
}
