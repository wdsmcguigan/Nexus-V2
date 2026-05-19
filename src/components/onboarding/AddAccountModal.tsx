import { useState, useRef } from "react";
import {
  Mail, Server, Loader2, CheckCircle, AlertCircle,
  ChevronLeft, X, Shield, Eye, EyeOff,
} from "lucide-react";
import {
  startGmailOAuth,
  startOutlookOAuth,
  discoverImapSettings,
  testImapConnection,
  addImapAccount,
  onSyncProgress,
} from "@/storage/tauri";
import type { DiscoveryResult } from "@/data/types";

type Provider = "select" | "gmail" | "outlook" | "imap";
type ImapStep = "email" | "settings" | "testing" | "saving";

interface Props {
  onConnected: (accountId: string, email: string) => void;
  onClose: () => void;
}

export function AddAccountModal({ onConnected, onClose }: Props) {
  const [provider, setProvider] = useState<Provider>("select");

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl w-full max-w-lg relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-500 hover:text-neutral-300 transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {provider === "select" && (
          <ProviderSelect onSelect={setProvider} />
        )}
        {provider === "gmail" && (
          <GmailFlow onConnected={onConnected} onBack={() => setProvider("select")} />
        )}
        {provider === "outlook" && (
          <OutlookFlow onConnected={onConnected} onBack={() => setProvider("select")} />
        )}
        {provider === "imap" && (
          <ImapFlow onConnected={onConnected} onBack={() => setProvider("select")} />
        )}
      </div>
    </div>
  );
}

// ─── Provider selection screen ────────────────────────────────────────────────

function ProviderSelect({ onSelect }: { onSelect: (p: Provider) => void }) {
  return (
    <div className="p-6 flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Add an account</h2>
        <p className="text-sm text-neutral-400 mt-1">Choose how you want to connect.</p>
      </div>

      <div className="flex flex-col gap-2">
        <ProviderCard
          icon={<GmailIcon />}
          title="Gmail"
          description="Sign in with Google OAuth — no password stored."
          onClick={() => onSelect("gmail")}
        />
        <ProviderCard
          icon={<OutlookIcon />}
          title="Microsoft / Outlook"
          description="Sign in with Microsoft OAuth — works with Outlook, Hotmail, and work accounts."
          onClick={() => onSelect("outlook")}
        />
        <ProviderCard
          icon={<Server className="h-5 w-5 text-neutral-300" />}
          title="IMAP / Any provider"
          description="Fastmail, iCloud, ProtonMail Bridge, Yahoo, self-hosted, and more."
          onClick={() => onSelect("imap")}
        />
        <ProviderCard
          icon={<Server className="h-5 w-5 text-neutral-500" />}
          title="JMAP"
          description="Coming soon — Fastmail native protocol."
          disabled
          onClick={() => {}}
        />
      </div>
    </div>
  );
}

function ProviderCard({
  icon, title, description, onClick, disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-start gap-3 w-full p-4 rounded-xl border border-neutral-700 bg-neutral-800/50 hover:bg-neutral-800 hover:border-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
    >
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="text-xs text-neutral-400 mt-0.5">{description}</div>
      </div>
    </button>
  );
}

// ─── Gmail OAuth flow ─────────────────────────────────────────────────────────

function GmailFlow({ onConnected, onBack }: { onConnected: Props["onConnected"]; onBack: () => void }) {
  const [status, setStatus] = useState<"idle" | "connecting" | "syncing" | "done" | "error">("idle");
  const [progress, setProgress] = useState({ fetched: 0, total: 0 });
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleConnect() {
    setStatus("connecting");
    setErrorMsg("");
    try {
      const unlisten = await onSyncProgress(({ fetched, total }) => {
        setStatus("syncing");
        setProgress({ fetched, total });
      });
      const result = await startGmailOAuth();
      setEmail(result.email);
      setStatus("syncing");
      setTimeout(() => {
        unlisten();
        setStatus("done");
        setTimeout(() => onConnected(result.accountId, result.email), 600);
      }, 1500);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="p-6 flex flex-col gap-5">
      <FlowHeader title="Connect Gmail" onBack={onBack} />
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="rounded-full bg-blue-500/10 p-4">
          <GmailIcon size={32} />
        </div>
        <p className="text-sm text-neutral-400 text-center max-w-xs">
          Your Gmail credentials stay on this device. We only store the OAuth token.
        </p>
        {status === "idle" && (
          <button
            onClick={handleConnect}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            <Mail className="h-4 w-4" />
            Connect Gmail
          </button>
        )}
        {status === "connecting" && <StatusSpinner label="Opening Google sign-in…" />}
        {status === "syncing" && <SyncProgress fetched={progress.fetched} total={progress.total} />}
        {status === "done" && <StatusDone label={`Connected as ${email}`} />}
        {status === "error" && (
          <StatusError msg={errorMsg} onRetry={() => setStatus("idle")} />
        )}
      </div>
    </div>
  );
}

// ─── Outlook OAuth flow ───────────────────────────────────────────────────────

function OutlookFlow({ onConnected, onBack }: { onConnected: Props["onConnected"]; onBack: () => void }) {
  const [status, setStatus] = useState<"idle" | "connecting" | "done" | "error">("idle");
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleConnect() {
    setStatus("connecting");
    setErrorMsg("");
    try {
      const result = await startOutlookOAuth();
      setEmail(result.email);
      setStatus("done");
      setTimeout(() => onConnected(result.accountId, result.email), 600);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="p-6 flex flex-col gap-5">
      <FlowHeader title="Connect Microsoft / Outlook" onBack={onBack} />
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="rounded-full bg-blue-500/10 p-4">
          <OutlookIcon size={32} />
        </div>
        <p className="text-sm text-neutral-400 text-center max-w-xs">
          Works with Outlook.com, Hotmail, Live, and Microsoft 365 accounts.
        </p>
        {status === "idle" && (
          <button
            onClick={handleConnect}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            Connect Microsoft account
          </button>
        )}
        {status === "connecting" && <StatusSpinner label="Opening Microsoft sign-in…" />}
        {status === "done" && <StatusDone label={`Connected as ${email}`} />}
        {status === "error" && (
          <StatusError msg={errorMsg} onRetry={() => setStatus("idle")} />
        )}
      </div>
    </div>
  );
}

// ─── IMAP flow ────────────────────────────────────────────────────────────────

type SecurityOption = "tls" | "starttls" | "plain";

interface ImapFormState {
  email: string;
  displayName: string;
  password: string;
  imapHost: string;
  imapPort: string;
  imapSecurity: SecurityOption;
  smtpHost: string;
  smtpPort: string;
  smtpSecurity: SecurityOption;
}

function ImapFlow({ onConnected, onBack }: { onConnected: Props["onConnected"]; onBack: () => void }) {
  const [step, setStep] = useState<ImapStep>("email");
  const [form, setForm] = useState<ImapFormState>({
    email: "",
    displayName: "",
    password: "",
    imapHost: "",
    imapPort: "993",
    imapSecurity: "tls",
    smtpHost: "",
    smtpPort: "587",
    smtpSecurity: "starttls",
  });
  const [discovering, setDiscovering] = useState(false);
  const [discoveryInfo, setDiscoveryInfo] = useState<DiscoveryResult | null>(null);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showPw, setShowPw] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  function patch(fields: Partial<ImapFormState>) {
    setForm((f) => ({ ...f, ...fields }));
  }

  async function handleEmailBlur() {
    if (!form.email.includes("@")) return;
    setDiscovering(true);
    setTestStatus("idle");
    try {
      const result = await discoverImapSettings(form.email);
      setDiscoveryInfo(result);
      if (result.imap) {
        patch({
          imapHost: result.imap.host,
          imapPort: String(result.imap.port),
          imapSecurity: result.imap.security as SecurityOption,
        });
      }
      if (result.smtp) {
        patch({
          smtpHost: result.smtp.host,
          smtpPort: String(result.smtp.port),
          smtpSecurity: result.smtp.security as SecurityOption,
        });
      }
      setStep("settings");
    } catch {
      setStep("settings");
    } finally {
      setDiscovering(false);
    }
  }

  async function handleTest() {
    setTestStatus("testing");
    setTestError("");
    try {
      const ok = await testImapConnection({
        host: form.imapHost,
        port: parseInt(form.imapPort, 10) || 993,
        security: form.imapSecurity,
        username: form.email,
        password: form.password,
      });
      setTestStatus(ok ? "ok" : "fail");
      if (!ok) setTestError("Connection failed — check host, port, and password.");
    } catch (e) {
      setTestStatus("fail");
      setTestError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      const result = await addImapAccount({
        email: form.email,
        displayName: form.displayName || undefined,
        imapHost: form.imapHost,
        imapPort: parseInt(form.imapPort, 10) || 993,
        imapSecurity: form.imapSecurity,
        imapUsername: form.email,
        imapPassword: form.password,
        smtpHost: form.smtpHost,
        smtpPort: parseInt(form.smtpPort, 10) || 587,
        smtpSecurity: form.smtpSecurity,
      });
      onConnected(result.accountId, result.email);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (step === "email") {
    return (
      <div className="p-6 flex flex-col gap-5">
        <FlowHeader title="Connect IMAP account" onBack={onBack} />
        <div className="flex flex-col gap-4">
          <p className="text-sm text-neutral-400">
            Works with iCloud, Fastmail, ProtonMail Bridge, Yahoo, and any IMAP server.
          </p>
          <Field label="Email address">
            <input
              ref={emailRef}
              type="email"
              value={form.email}
              onChange={(e) => patch({ email: e.target.value })}
              onBlur={handleEmailBlur}
              onKeyDown={(e) => { if (e.key === "Enter") handleEmailBlur(); }}
              placeholder="you@example.com"
              className="input-base"
              autoFocus
            />
          </Field>
          {discovering && (
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Looking up server settings…
            </div>
          )}
          <button
            onClick={handleEmailBlur}
            disabled={!form.email.includes("@") || discovering}
            className="btn-primary"
          >
            {discovering ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-5 max-h-[85vh] overflow-y-auto">
      <FlowHeader
        title="IMAP / SMTP settings"
        onBack={() => { setStep("email"); setTestStatus("idle"); }}
      />

      {discoveryInfo && (
        <div className="flex items-center gap-2 rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-xs">
          <Shield className="h-3.5 w-3.5 text-blue-400 shrink-0" />
          <span className="text-neutral-300">
            {discoveryInfo.confidence === "known"
              ? "Settings auto-filled from known provider."
              : discoveryInfo.confidence === "discovered"
              ? "Settings discovered from server config."
              : "Settings are a best-guess — please verify."}
            {discoveryInfo.requiresAppPassword && (
              <span className="text-amber-400 ml-1">
                This provider requires an app-specific password.
              </span>
            )}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Field label="Email">
          <input
            type="email"
            value={form.email}
            onChange={(e) => patch({ email: e.target.value })}
            className="input-base"
          />
        </Field>
        <Field label="Display name (optional)">
          <input
            type="text"
            value={form.displayName}
            onChange={(e) => patch({ displayName: e.target.value })}
            placeholder="Your Name"
            className="input-base"
          />
        </Field>
        <Field label="Password">
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={form.password}
              onChange={(e) => patch({ password: e.target.value })}
              placeholder="Password or app-specific password"
              className="input-base pr-9"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
      </div>

      <div className="border-t border-neutral-700/60 pt-3">
        <div className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-3">IMAP (incoming)</div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <Field label="Host">
              <input
                type="text"
                value={form.imapHost}
                onChange={(e) => patch({ imapHost: e.target.value })}
                placeholder="imap.example.com"
                className="input-base"
              />
            </Field>
          </div>
          <Field label="Port">
            <input
              type="number"
              value={form.imapPort}
              onChange={(e) => patch({ imapPort: e.target.value })}
              className="input-base"
            />
          </Field>
        </div>
        <Field label="Security">
          <SecuritySelect
            value={form.imapSecurity}
            onChange={(v) => {
              patch({
                imapSecurity: v,
                imapPort: v === "tls" ? "993" : v === "starttls" ? "143" : "143",
              });
            }}
          />
        </Field>
      </div>

      <div className="border-t border-neutral-700/60 pt-3">
        <div className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-3">SMTP (outgoing)</div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <Field label="Host">
              <input
                type="text"
                value={form.smtpHost}
                onChange={(e) => patch({ smtpHost: e.target.value })}
                placeholder="smtp.example.com"
                className="input-base"
              />
            </Field>
          </div>
          <Field label="Port">
            <input
              type="number"
              value={form.smtpPort}
              onChange={(e) => patch({ smtpPort: e.target.value })}
              className="input-base"
            />
          </Field>
        </div>
        <Field label="Security">
          <SecuritySelect
            value={form.smtpSecurity}
            onChange={(v) => {
              patch({
                smtpSecurity: v,
                smtpPort: v === "tls" ? "465" : "587",
              });
            }}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2 pt-1">
        {testStatus === "ok" && (
          <div className="flex items-center gap-2 text-xs text-green-400">
            <CheckCircle className="h-3.5 w-3.5" />
            Connection successful
          </div>
        )}
        {testStatus === "fail" && (
          <div className="flex items-center gap-2 text-xs text-red-400">
            <AlertCircle className="h-3.5 w-3.5" />
            {testError || "Connection failed"}
          </div>
        )}
        {saveError && (
          <div className="text-xs text-red-400">{saveError}</div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleTest}
            disabled={testStatus === "testing" || !form.imapHost || !form.password}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-neutral-600 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {testStatus === "testing" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Test connection"
            )}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.imapHost || !form.password || !form.smtpHost}
            className="flex-1 btn-primary"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save account"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Small reusable bits ──────────────────────────────────────────────────────

function FlowHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onBack}
        className="text-neutral-500 hover:text-neutral-300 transition-colors"
        aria-label="Back"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <h2 className="text-base font-semibold text-white">{title}</h2>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-neutral-400">{label}</label>
      {children}
    </div>
  );
}

function SecuritySelect({
  value, onChange,
}: {
  value: SecurityOption;
  onChange: (v: SecurityOption) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SecurityOption)}
      className="input-base"
    >
      <option value="tls">TLS (port 993 / 465)</option>
      <option value="starttls">STARTTLS (port 143 / 587)</option>
      <option value="plain">None / plain (not recommended)</option>
    </select>
  );
}

function StatusSpinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-neutral-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function SyncProgress({ fetched, total }: { fetched: number; total: number }) {
  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {total > 0 ? `Syncing… ${fetched} / ${total}` : "Syncing inbox…"}
      </div>
      {total > 0 && (
        <div className="w-full h-1.5 rounded-full bg-neutral-700 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${Math.round((fetched / total) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function StatusDone({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-green-400">
      <CheckCircle className="h-4 w-4" />
      {label}
    </div>
  );
}

function StatusError({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2 text-sm text-red-400">
        <AlertCircle className="h-4 w-4" />
        Connection failed
      </div>
      {msg && <p className="text-xs text-neutral-500 text-center max-w-xs">{msg}</p>}
      <button onClick={onRetry} className="text-xs text-blue-400 hover:text-blue-300 underline">
        Try again
      </button>
    </div>
  );
}

// ─── Provider icons ───────────────────────────────────────────────────────────

function GmailIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" fill="#EA4335" />
    </svg>
  );
}

function OutlookIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#0078D4" />
      <path d="M13 6h7v12h-7V6z" fill="#fff" fillOpacity=".3" />
      <path d="M4 8.5a4.5 4.5 0 1 1 0 7 4.5 4.5 0 0 1 0-7z" fill="#fff" />
      <circle cx="4" cy="12" r="2.5" fill="#0078D4" />
      <path d="M13 9l6 3-6 3V9z" fill="#fff" />
    </svg>
  );
}
