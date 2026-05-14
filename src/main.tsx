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
  startWatcher,
} from "@/storage/tauri";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing in index.html");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

async function initTauri() {
  // Check if the user already has a vault configured
  const savedPath = await getVaultPath();
  if (!savedPath) {
    // No vault yet — load fixture data so the UI isn't blank
    // The onboarding UI (VaultSetup) will handle first-run
    await import("@/data/fixtures");
    return;
  }

  // Load real data from SQLite
  try {
    const payload = await loadVaultData(savedPath);
    localStore.hydrate(payload as Parameters<typeof localStore.hydrate>[0]);

    // Rebuild FTS index from real messages
    const messages = Array.from(localStore.messages.values());
    ftsIndex.indexMessages(messages, bodyStore);

    // Start filesystem watcher
    await startWatcher(savedPath).catch((e) =>
      console.warn("Watcher failed to start:", e),
    );

    // Listen for re-hydrate signals from Rust (after sync, FS changes, etc.)
    onHydrateNeeded(async () => {
      const fresh = await loadVaultData(savedPath);
      localStore.hydrate(fresh as Parameters<typeof localStore.hydrate>[0]);
      const msgs = Array.from(localStore.messages.values());
      ftsIndex.indexMessages(msgs, bodyStore);
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
