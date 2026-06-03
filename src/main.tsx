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
  openPopoutWindow,
  startWatcher,
  syncGmailNow,
  refreshAccountPhotos,
} from "@/storage/tauri";
import { applyRemoteMutation } from "@/state/mutations";
import { useWorkspace } from "@/state/workspace";
import { startGoogleAutoSync } from "@/lib/googleSync";
import type { MutationKind } from "@/data/types";
import type { Theme, Density } from "@/design-system/tokens";

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
    await restoreDetachedWindows();
  } catch (e) {
    console.error("Failed to load vault data, falling back to fixtures:", e);
    if (isMain) await import("@/data/fixtures");
  }
}

/** Re-open the panels that were detached into their own windows last session,
 *  restoring saved geometry (clamped onto a visible monitor by the backend). */
async function restoreDetachedWindows() {
  const s = useWorkspace.getState();
  const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
  const list = ws?.detachedWindows ?? [];
  for (const d of list) {
    if (d.kind === "composer") continue; // transient — never restored
    const label = await openPopoutWindow(d.kind, {
      targetId: d.targetId ?? undefined,
      geometry: d.geometry ?? undefined,
    }).catch(() => null);
    // persist=false: dockview may not be mounted yet; don't clobber the layout.
    if (label) s.trackDetachedWindow(label, d.kind, d.targetId, d.geometry, false);
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
