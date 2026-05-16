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
  ftsIndex.indexMessages(Array.from(localStore.messages.values()), bodyStore);
}

async function initTauri() {
  // Register the hydrate listener unconditionally so the first-run
  // onboarding→main transition works even when we fall through to fixtures below.
  onHydrateNeeded(async () => {
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

    // Start filesystem watcher
    await startWatcher(savedPath).catch((e) =>
      console.warn("Watcher failed to start:", e),
    );

    onSyncProgress(() => {
      useWorkspace.getState().setSyncStatus(true);
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
