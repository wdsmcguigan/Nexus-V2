import { useState } from "react";
import { FolderOpen, ArrowRight, Loader2 } from "lucide-react";
import { setVaultPath, loadVaultData, isTauri } from "@/storage/tauri";
import { localStore } from "@/storage/local";
import { GmailConnect } from "./GmailConnect";

type Step = "vault" | "gmail" | "done";

interface Props {
  onComplete: () => void;
}

export function VaultSetup({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("vault");
  const [vaultPath, setVaultPathState] = useState(defaultVaultPath());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleVaultContinue() {
    setLoading(true);
    setError("");
    try {
      await setVaultPath(vaultPath);
      const payload = await loadVaultData(vaultPath);
      localStore.hydrate(payload as Parameters<typeof localStore.hydrate>[0]);
      setStep("gmail");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleGmailConnected(_accountId: string, _email: string) {
    setStep("done");
    setTimeout(onComplete, 800);
  }

  function handleSkipGmail() {
    setStep("done");
    setTimeout(onComplete, 0);
  }

  if (!isTauri()) return null;

  if (step === "vault") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-white">
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

  if (step === "gmail") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-white">
        <GmailConnect onConnected={handleGmailConnected} />
        <button
          onClick={handleSkipGmail}
          className="mt-2 text-xs text-neutral-500 hover:text-neutral-400 underline"
        >
          Skip for now
        </button>
      </div>
    );
  }

  // step === "done"
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-white">
      <div className="text-sm text-neutral-400">Loading your inbox…</div>
    </div>
  );
}

function defaultVaultPath(): string {
  // Best guess at the user's home directory — only works in Tauri where
  // the shell exposes environment variables. Falls back gracefully.
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    // Tauri 2: we don't have direct access to HOME at this point,
    // so show a friendly default that the user can edit.
    return "~/Mail";
  }
  return "~/Mail";
}
