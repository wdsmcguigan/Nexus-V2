import { useState } from "react";
import { Mail, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { startGmailOAuth, onSyncProgress } from "@/storage/tauri";

interface Props {
  onConnected: (accountId: string, email: string) => void;
}

export function GmailConnect({ onConnected }: Props) {
  const [status, setStatus] = useState<"idle" | "connecting" | "syncing" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [progress, setProgress] = useState({ fetched: 0, total: 0 });
  const [email, setEmail] = useState("");

  async function handleConnect() {
    setStatus("connecting");
    setErrorMsg("");

    try {
      // Listen for sync progress events before starting OAuth
      const unlisten = await onSyncProgress(({ fetched, total }) => {
        setStatus("syncing");
        setProgress({ fetched, total });
      });

      const result = await startGmailOAuth();
      setEmail(result.email);
      setStatus("syncing");
      setProgress({ fetched: 0, total: 0 });

      // Simulate transition to done after a brief delay
      // (the actual done signal comes via vault:hydrate-needed)
      setTimeout(() => {
        unlisten();
        setStatus("done");
        onConnected(result.accountId, result.email);
      }, 1500);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 p-8 max-w-sm">
      <div className="rounded-full bg-blue-500/10 p-4">
        <Mail className="h-8 w-8 text-blue-400" />
      </div>

      <div className="text-center">
        <h2 className="text-lg font-semibold text-white mb-1">Connect Gmail</h2>
        <p className="text-sm text-neutral-400">
          Sign in with Google to sync your inbox. Your credentials stay on your
          device.
        </p>
      </div>

      {status === "idle" && (
        <button
          onClick={handleConnect}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          <Mail className="h-4 w-4" />
          Connect Gmail
        </button>
      )}

      {status === "connecting" && (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening Google sign-in…
        </div>
      )}

      {status === "syncing" && (
        <div className="w-full flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {progress.total > 0
              ? `Syncing… ${progress.fetched} / ${progress.total}`
              : "Syncing inbox…"}
          </div>
          {progress.total > 0 && (
            <div className="w-full h-1.5 rounded-full bg-neutral-700 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{
                  width: `${Math.round((progress.fetched / progress.total) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {status === "done" && (
        <div className="flex items-center gap-2 text-sm text-green-400">
          <CheckCircle className="h-4 w-4" />
          Connected as {email}
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="h-4 w-4" />
            Connection failed
          </div>
          <p className="text-xs text-neutral-500 text-center">{errorMsg}</p>
          <button
            onClick={() => setStatus("idle")}
            className="text-xs text-blue-400 hover:text-blue-300 underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
