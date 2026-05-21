import { useState, useEffect } from "react";
import { FolderOpen, ArrowRight, Loader2, Cloud, HardDrive, PlusCircle } from "lucide-react";
import { setVaultPath, loadVaultData, isTauri, setClientMode as setClientModeIpc } from "@/storage/tauri";
import { localStore } from "@/storage/local";
import { ftsIndex } from "@/storage/fts";
import { bodyStore } from "@/storage/bodyStore";
import { useWorkspace } from "@/state/workspace";
import type { ClientMode } from "@/lib/clientMode";
import { seedDefaultCustomFields } from "@/lib/defaultCustomFields";
import { AddAccountModal } from "./AddAccountModal";

type Step = "vault" | "mode" | "accounts" | "done";

const STEP_KEY = "nexus-onboarding-step";

interface Props {
  onComplete: () => void;
}

export function VaultSetup({ onComplete }: Props) {
  const [step, setStep] = useState<Step>(() => {
    const saved = localStorage.getItem(STEP_KEY);
    if (saved === "mode") return "mode";
    if (saved === "accounts" || saved === "gmail") return "accounts";
    return "vault";
  });
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [vaultPath, setVaultPathState] = useState(defaultVaultPath());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);
  const setClientMode = useWorkspace((s) => s.setClientMode);

  useEffect(() => {
    setVisible(false);
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [step]);

  function advanceTo(s: Step) {
    if (s === "done") {
      localStorage.removeItem(STEP_KEY);
    } else {
      localStorage.setItem(STEP_KEY, s);
    }
    setStep(s);
  }

  async function handleVaultContinue() {
    setLoading(true);
    setError("");
    try {
      await setVaultPath(vaultPath);
      const payload = await loadVaultData(vaultPath);
      localStore.hydrate(payload as Parameters<typeof localStore.hydrate>[0]);
      ftsIndex.indexMessages(Array.from(localStore.messages.values()), bodyStore);

      // Redirect selectedFolderId to the real inbox label (vault-scoped ID).
      // Without this, the Workspace would show an empty list because the
      // default "inbox" folder ID doesn't match the real vault label ID.
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

      seedDefaultCustomFields();
      advanceTo("mode");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleModeSelect(mode: ClientMode) {
    setClientMode(mode);
    setClientModeIpc(mode).catch(() => {});
    advanceTo("accounts");
  }

  function handleAccountConnected(_accountId: string, _email: string) {
    setShowAddAccount(false);
    advanceTo("done");
    setTimeout(onComplete, 800);
  }

  function handleSkipAccounts() {
    advanceTo("done");
    setTimeout(onComplete, 0);
  }

  if (!isTauri()) return null;

  const fadeClass = `transition-opacity duration-150 ${visible ? "opacity-100" : "opacity-0"}`;

  if (step === "vault") {
    return (
      <div className={`flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-white ${fadeClass}`}>
        <div className="flex flex-col items-center gap-6 p-8 max-w-sm w-full">
          <div className="rounded-full bg-neutral-800 p-4">
            <FolderOpen className="h-8 w-8 text-neutral-300" />
          </div>

          <div className="text-center">
            <h1 className="text-xl font-semibold mb-1">Welcome to Nexus</h1>
            <p className="text-sm text-neutral-400">
              Choose where to store your vault. All mail, metadata, and
              attachments will live here.
            </p>
          </div>

          <div className="w-full flex flex-col gap-2">
            <label className="text-xs font-medium text-neutral-400 uppercase tracking-wide">
              Vault path
            </label>
            <input
              type="text"
              value={vaultPath}
              onChange={(e) => setVaultPathState(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="~/Mail"
            />
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
          </div>

          <button
            onClick={handleVaultContinue}
            disabled={loading || !vaultPath}
            className="flex items-center gap-2 w-full justify-center px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Continue
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  if (step === "mode") {
    return (
      <div className={`flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-white ${fadeClass}`}>
        <div className="flex flex-col items-center gap-6 p-8 max-w-xl w-full">
          <div className="text-center">
            <h1 className="text-xl font-semibold mb-1">How do you want to use Nexus?</h1>
            <p className="text-sm text-neutral-400">
              You can change this later in Settings.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 w-full">
            {/* Traditional */}
            <button
              onClick={() => handleModeSelect("traditional")}
              className="group flex flex-col gap-3 rounded-xl border border-neutral-700 bg-neutral-900 p-5 text-left hover:border-neutral-500 hover:bg-neutral-800 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <div className="rounded-lg bg-neutral-800 p-3 w-fit group-hover:bg-neutral-700 transition-colors">
                <Cloud className="h-6 w-6 text-neutral-300" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white mb-1">Traditional Client</div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Use Nexus as a fast Gmail interface. Your mail syncs from Google's servers.
                  Cross-device relay sync is not available.
                </p>
              </div>
            </button>

            {/* Local-first */}
            <button
              onClick={() => handleModeSelect("local-first")}
              className="group flex flex-col gap-3 rounded-xl border border-blue-600 bg-blue-950/40 p-5 text-left hover:border-blue-500 hover:bg-blue-950/60 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-900/60 p-3 group-hover:bg-blue-900 transition-colors">
                  <HardDrive className="h-6 w-6 text-blue-300" />
                </div>
                <span className="text-xs font-medium text-blue-400 bg-blue-900/60 px-2 py-0.5 rounded-full">
                  Recommended
                </span>
              </div>
              <div>
                <div className="text-sm font-semibold text-white mb-1">Local-first &amp; Private</div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Your mail lives fully on this device, end-to-end encrypted. An optional relay
                  server lets you sync privately across your own devices.
                </p>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "accounts") {
    return (
      <div className={`flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-white ${fadeClass}`}>
        <div className="flex flex-col items-center gap-6 p-8 max-w-sm w-full">
          <div className="text-center">
            <h1 className="text-xl font-semibold mb-1">Connect an account</h1>
            <p className="text-sm text-neutral-400">
              Sync Gmail, Outlook, iCloud, Fastmail, or any IMAP account.
            </p>
          </div>

          <button
            onClick={() => setShowAddAccount(true)}
            className="flex items-center gap-2 w-full justify-center px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            <PlusCircle className="h-4 w-4" />
            Connect an account
          </button>

          <button
            onClick={handleSkipAccounts}
            className="text-xs text-neutral-500 hover:text-neutral-400 underline"
          >
            Skip for now
          </button>
        </div>

        {showAddAccount && (
          <AddAccountModal
            onConnected={handleAccountConnected}
            onClose={() => setShowAddAccount(false)}
          />
        )}
      </div>
    );
  }

  // step === "done"
  return (
    <div className={`flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-white ${fadeClass}`}>
      <div className="text-sm text-neutral-400">Loading your inbox…</div>
    </div>
  );
}

function defaultVaultPath(): string {
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return "~/Mail";
  }
  return "~/Mail";
}
