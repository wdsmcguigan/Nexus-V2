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
  getCurrentWindowLabel,
  onHydrateNeeded,
  onSyncProgress,
  onNewMessages,
  onMutationApplied,
  onUiPrefChanged,
  onPopoutClosed,
  onPopoutGeometry,
  startWatcher,
  syncGmailNow,
  refreshAccountPhotos,
} from "@/storage/tauri";
import { applyRemoteMutation, replayRegisteredModules } from "@/state/mutations";
import { useWorkspace } from "@/state/workspace";
import { startGoogleAutoSync } from "@/lib/googleSync";
import { bootstrapModules } from "@/modules/bootstrap";
import { startTimekitTicker } from "@/modules/timekit/ticker";
import type { MutationKind } from "@/data/types";
import type { Theme, Density } from "@/design-system/tokens";

// Register core modules before first render so dockview can resolve module
// panel components during initial layout restore.
bootstrapModules();

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
  replayRegisteredModules(localStore);
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

/** Apply a theme/density preference broadcast from another window without
 *  re-broadcasting (sets state + DOM class directly, bypassing setTheme). */
function applyRemoteUiPref(p: { theme?: Theme; density?: Density }) {
  if (p.theme) {
    document.documentElement.classList.toggle("dark", p.theme === "dark");
    useWorkspace.setState({ theme: p.theme });
  }
  if (p.density) {
    useWorkspace.setState({ density: p.density });
  }
}

async function initTauri() {
  // Every window (main + pop-outs) shares one Rust backend but an isolated JS
  // store. Listeners that keep the store consistent run in all windows; the
  // heavy background workers run only in the main window.
  const label = await getCurrentWindowLabel();
  const isMain = label === null || label === "main";

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

  // Incremental cross-window data sync: apply mutations committed by sibling
  // windows. Ignore our own echo — we already applied it optimistically.
  await onMutationApplied((e) => {
    if (e.originWindow === label) return;
    applyRemoteMutation(e.kind as MutationKind, e.payload, e.lamport, localStore);
  });

  // Shared UI preferences (theme/density) follow across windows.
  await onUiPrefChanged((p) => applyRemoteUiPref(p));

  const savedPath = await getVaultPath();
  if (!savedPath) {
    // No vault yet — only the main window seeds fixtures (a pop-out cannot be
    // spawned before a vault exists, so this branch is main-only in practice).
    if (isMain) await import("@/data/fixtures");
    return;
  }

  // Load real data from SQLite (every window needs its own hydrated store).
  try {
    await hydrateFromVault(savedPath);

    // Background workers run only in the main window to avoid N watchers /
    // N pollers / duplicate sync storms across pop-outs.
    if (!isMain) return;

    // If the vault has accounts but no labels the initial Gmail sync
    // has not yet committed to the DB (or ran without saving historyId).
    // Force a sync now so labels + messages arrive before the 60s poller fires.
    if (localStore.accounts.size > 0 && localStore.labels.size === 0) {
      const firstAccount = Array.from(localStore.accounts.values())[0]!;
      syncGmailNow(firstAccount.id).catch((e) =>
        console.warn("Auto-sync failed:", e),
      );
    }

    // Backfill profile photo + contact photos for any Gmail account missing them.
    // Fire-and-forget — emits vault:hydrate-needed when done so the UI updates.
    for (const account of localStore.accounts.values()) {
      if (account.provider === "gmail" && !account.photoUrl) {
        refreshAccountPhotos(account.id).catch((e) =>
          console.warn("Photo refresh failed:", e),
        );
      }
    }

    // Start filesystem watcher
    await startWatcher(savedPath).catch((e) =>
      console.warn("Watcher failed to start:", e),
    );

    // Keep Google calendars + contacts fresh for accounts with sync enabled.
    startGoogleAutoSync();
    startTimekitTicker(localStore);

    onSyncProgress((payload) => {
      const ws = useWorkspace.getState();
      ws.setSyncStatus(true);
      ws.setSyncProgress(payload);
    });
    onNewMessages(() => {
      useWorkspace.getState().setSyncStatus(false, Date.now());
    });

    // De-docked window lifecycle (main window owns the registry).
    await onPopoutGeometry(({ label, geometry }) => {
      useWorkspace.getState().setDetachedWindowGeometry(label, geometry);
    });
    await onPopoutClosed(({ label }) => {
      useWorkspace.getState().untrackDetachedWindow(label);
    });
    // persist=false: dockview may not be mounted yet; don't clobber the layout.
    await useWorkspace.getState().restoreDetachedWindows(false);
  } catch (e) {
    console.error("Failed to load vault data, falling back to fixtures:", e);
    if (isMain) await import("@/data/fixtures");
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
  // Rebuild module projections from any logged mutations. On a fresh visit
  // (OPFS empty) fixtures seed core entities directly and carry no module
  // mutations, so this is a no-op; when OPFS rehydrated the log, it populates
  // module projections (e.g. tasks).
  replayRegisteredModules(localStore);
  // Main-window-only background workers that are also valid in web mode
  // (web mode is inherently single-window). See plan Concern A.
  startTimekitTicker(localStore);
}

if (isTauri()) {
  initTauri();
} else {
  initWeb();
}
