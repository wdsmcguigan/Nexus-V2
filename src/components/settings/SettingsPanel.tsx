/**
 * SET — Settings panel: Account management + Preferences.
 * Two-section sidebar: Accounts (connected Gmail + sync status) and Preferences
 * (density, theme). Registered as dockview "settings" component.
 */
import * as React from "react";
import {
  Mail,
  RefreshCw,
  CheckCircle2,
  Loader2,
  LogOut,
  Sun,
  Moon,
  Monitor,
  AlignJustify,
  SlidersHorizontal,
  LayoutList,
  Server,
  Wifi,
  WifiOff,
  Copy,
  Link,
  ExternalLink,
  Shield,
  HardDrive,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { Button } from "@/components/ui/Button";
import { useWorkspace } from "@/state/workspace";
import { useAccounts } from "@/storage/useStore";
import {
  isTauri,
  syncGmailNow,
  startGmailOAuth,
  disconnectAccount,
  getRelayStatus,
  setRelayUrl,
  getVaultKeyHex,
  startEnrollmentSession,
  startRelayHosting,
  resetVault,
  type RelayStatus,
} from "@/storage/tauri";
import { CustomFieldsSettings } from "@/components/settings/CustomFieldsSettings";
import { cn } from "@/lib/utils";
import type { Density } from "@/design-system/tokens";
import { loadSignature, saveSignature } from "@/lib/signature";

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1.5 pt-4">
      <span className="text-overline uppercase tracking-wider text-text-tertiary">
        {children}
      </span>
    </div>
  );
}

// ─── Disconnect modal ─────────────────────────────────────────────────────────

type DataAction = "keep" | "delete_messages" | "delete_all";

const DATA_ACTION_OPTIONS: {
  value: DataAction;
  label: string;
  description: string;
  icon: React.ElementType;
  destructive: boolean;
}[] = [
  {
    value: "delete_messages",
    label: "Remove messages",
    description:
      "Emails are deleted from Nexus. Label structure is kept so reconnecting this account will re-populate your inbox.",
    icon: Trash2,
    destructive: true,
  },
  {
    value: "keep",
    label: "Keep local copy",
    description:
      "Messages stay in Nexus for offline reading. New mail won't sync until you reconnect.",
    icon: HardDrive,
    destructive: false,
  },
  {
    value: "delete_all",
    label: "Delete everything",
    description:
      "Messages, message content, and all Gmail-synced labels are permanently removed from this vault.",
    icon: AlertTriangle,
    destructive: true,
  },
];

function DisconnectModal({
  open,
  email,
  onClose,
  onConfirm,
}: {
  open: boolean;
  email: string;
  onClose: () => void;
  onConfirm: (action: DataAction) => void;
}) {
  const [selected, setSelected] = React.useState<DataAction>("delete_messages");

  const chosen = DATA_ACTION_OPTIONS.find((o) => o.value === selected)!;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface-2 shadow-l4 focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          <div className="px-5 pb-5 pt-4">
            <Dialog.Title className="text-body-strong text-text-primary">
              Disconnect account
            </Dialog.Title>
            <Dialog.Description className="mt-0.5 text-small text-text-tertiary">
              {email}
            </Dialog.Description>

            <p className="mt-4 text-small font-medium text-text-secondary">
              What should happen to your local data?
            </p>

            <div className="mt-2 space-y-2">
              {DATA_ACTION_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = selected === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                      isSelected
                        ? "border-accent bg-accent-soft"
                        : "border-border-subtle bg-surface-1 hover:border-border-default hover:bg-surface-2",
                    )}
                  >
                    <input
                      type="radio"
                      name="data-action"
                      value={opt.value}
                      checked={isSelected}
                      onChange={() => setSelected(opt.value)}
                      className="sr-only"
                    />
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                        isSelected ? "border-accent bg-accent" : "border-border-default bg-transparent",
                      )}
                    >
                      {isSelected && <span className="size-1.5 rounded-full bg-white" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Icon
                          size={13}
                          className={cn(isSelected ? "text-accent" : "text-text-tertiary")}
                        />
                        <span className="text-small font-medium text-text-primary">
                          {opt.label}
                        </span>
                      </div>
                      <p className="mt-0.5 text-small text-text-tertiary leading-snug">
                        {opt.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm">Cancel</Button>
              </Dialog.Close>
              <Button
                variant={chosen.destructive ? "destructive" : "secondary"}
                size="sm"
                onClick={() => onConfirm(selected)}
              >
                {selected === "keep" ? "Disconnect" : "Disconnect & delete"}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Account row ──────────────────────────────────────────────────────────────

function AccountRow({ accountId, email }: { accountId: string; email: string }) {
  const [syncing, setSyncing] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  const syncProgress = useWorkspace((s) => s.syncProgress);
  const isSyncingNow = syncing || (syncProgress?.accountId === accountId && (syncProgress?.total ?? 0) > 0);

  async function handleSync() {
    if (!isTauri()) return;
    setSyncing(true);
    try {
      await syncGmailNow(accountId);
    } catch (e) {
      console.warn("sync_gmail_now error:", e);
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnectConfirm(action: DataAction) {
    setModalOpen(false);
    setDisconnecting(true);
    try {
      await disconnectAccount(accountId, action);
    } catch (e) {
      console.warn("disconnect_account error:", e);
    } finally {
      setDisconnecting(false);
    }
  }

  const statusIcon = isSyncingNow ? (
    <Loader2 size={14} className="animate-spin text-accent" />
  ) : (
    <CheckCircle2 size={14} className="text-success" />
  );

  const statusLabel = isSyncingNow
    ? (syncProgress?.accountId === accountId && (syncProgress?.total ?? 0) > 0
        ? `Syncing ${syncProgress!.fetched}/${syncProgress!.total}`
        : "Syncing…")
    : "Synced";

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft">
          <Mail size={14} className="text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-body text-text-primary">{email}</div>
          <div className="mt-0.5 flex items-center gap-1 text-small text-text-tertiary">
            {statusIcon}
            <span>{statusLabel}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Sync now"
          onClick={handleSync}
          disabled={isSyncingNow || disconnecting}
        >
          <RefreshCw size={12} className={isSyncingNow ? "animate-spin" : ""} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Disconnect account"
          onClick={() => setModalOpen(true)}
          disabled={syncing || disconnecting}
        >
          {disconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
        </Button>
      </div>

      <DisconnectModal
        open={modalOpen}
        email={email}
        onClose={() => setModalOpen(false)}
        onConfirm={handleDisconnectConfirm}
      />
    </>
  );
}

// ─── Density picker ───────────────────────────────────────────────────────────

const DENSITIES: { value: Density; label: string; sublabel: string }[] = [
  { value: "compact", label: "Compact", sublabel: "28px rows, no snippet" },
  { value: "comfortable", label: "Comfortable", sublabel: "36px rows, snippet shown" },
  { value: "cozy", label: "Cozy", sublabel: "48px rows, 2-line snippet" },
];

// ─── Relay section ────────────────────────────────────────────────────────────

function RelaySection() {
  const [mode, setMode] = React.useState<"self-hosted">("self-hosted");
  const [relayUrl, setRelayUrlLocal] = React.useState("");
  const [savingUrl, setSavingUrl] = React.useState(false);
  const [status, setStatus] = React.useState<RelayStatus | null>(null);
  const [hosting, setHosting] = React.useState(false);
  const [enrollCode, setEnrollCode] = React.useState<string | null>(null);
  const [enrollExpiry, setEnrollExpiry] = React.useState<number | null>(null);
  const [generatingCode, setGeneratingCode] = React.useState(false);
  const [vaultKey, setVaultKey] = React.useState<string | null>(null);
  const [showVaultKey, setShowVaultKey] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    async function poll() {
      try {
        const s = await getRelayStatus();
        if (!cancelled) setStatus(s);
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  React.useEffect(() => {
    if (enrollExpiry === null) return;
    const tick = setInterval(() => {
      const left = Math.max(0, Math.round((enrollExpiry - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) { setEnrollCode(null); setEnrollExpiry(null); }
    }, 1000);
    return () => clearInterval(tick);
  }, [enrollExpiry]);

  async function handleSaveUrl() {
    if (!isTauri() || !relayUrl.trim()) return;
    setSavingUrl(true);
    try { await setRelayUrl(relayUrl.trim()); } catch { /* ignore */ } finally { setSavingUrl(false); }
  }

  async function handleHostHere() {
    if (!isTauri()) return;
    setHosting(true);
    try {
      const port = await startRelayHosting(3030);
      const s = await getRelayStatus();
      setStatus(s);
      setRelayUrlLocal(`http://localhost:${port}`);
    } catch { /* ignore */ } finally { setHosting(false); }
  }

  async function handleGenerateCode() {
    if (!isTauri()) return;
    setGeneratingCode(true);
    try {
      const session = await startEnrollmentSession();
      setEnrollCode(session.code);
      setEnrollExpiry(session.expiresAt);
      setSecondsLeft(Math.round((session.expiresAt - Date.now()) / 1000));
    } catch { /* ignore */ } finally { setGeneratingCode(false); }
  }

  async function handleShowVaultKey() {
    if (!isTauri()) return;
    if (vaultKey) { setShowVaultKey((v) => !v); return; }
    try {
      const key = await getVaultKeyHex();
      setVaultKey(key);
      setShowVaultKey(true);
    } catch { /* ignore */ }
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const lastSyncAgo = status?.lastSyncAt
    ? Math.round((Date.now() - status.lastSyncAt) / 1000)
    : null;

  const statusDot =
    !status?.configured ? null :
    status.error ? "red" :
    lastSyncAgo !== null && lastSyncAgo < 60 ? "green" : "yellow";

  return (
    <div className="space-y-0">
      {/* Mode picker */}
      <SectionHeader>Relay mode</SectionHeader>
      <div className="flex gap-2 px-4 pb-4">
        {/* Nexus Relay — coming soon */}
        <div
          className="flex flex-1 flex-col gap-1 rounded-sm border border-border-subtle bg-surface-2 px-3 py-3 opacity-50 cursor-not-allowed"
          title="Coming soon"
        >
          <div className="flex items-center gap-2">
            <Server size={14} className="text-text-tertiary" />
            <span className="text-body text-text-secondary">Nexus Relay</span>
            <span className="ml-auto rounded-full bg-surface-3 px-1.5 py-0.5 text-mono-xs text-text-muted">
              coming soon
            </span>
          </div>
          <p className="text-small text-text-muted">
            Nexus-hosted zero-knowledge relay. No setup required.
          </p>
        </div>

        {/* Self-Hosted */}
        <button
          type="button"
          onClick={() => setMode("self-hosted")}
          className={cn(
            "flex flex-1 flex-col gap-1 rounded-sm border px-3 py-3 text-left transition-colors",
            mode === "self-hosted"
              ? "border-accent bg-accent-soft"
              : "border-border-subtle bg-surface-2 hover:border-border-default",
          )}
        >
          <div className="flex items-center gap-2">
            <Server size={14} className={mode === "self-hosted" ? "text-accent" : "text-text-tertiary"} />
            <span className={cn("text-body", mode === "self-hosted" ? "text-text-primary" : "text-text-secondary")}>
              Self-Hosted
            </span>
            {mode === "self-hosted" && <CheckCircle2 size={12} className="ml-auto text-accent" />}
          </div>
          <p className="text-small text-text-muted">
            Run your own relay server. Full control, zero lock-in.
          </p>
        </button>
      </div>

      {/* Self-hosted setup docs */}
      {mode === "self-hosted" && (
        <>
          <SectionHeader>Setup</SectionHeader>
          <div className="mx-4 mb-4 rounded-sm border border-border-subtle bg-surface-2 p-3 space-y-2">
            <p className="text-body text-text-primary font-medium">Run nexus-relay on a reachable machine</p>
            <p className="text-small text-text-secondary">
              Download the <code className="font-mono text-mono-xs bg-surface-3 px-1 rounded">nexus-relay</code> binary
              and run it on any always-on machine. Three common approaches:
            </p>
            <ul className="text-small text-text-secondary space-y-1.5 ml-3 list-disc list-outside">
              <li>
                <span className="text-text-primary">Tailscale (recommended for personal use)</span> — install Tailscale
                on each device and on the relay host. All devices share a private IP without any port forwarding.
                Run: <code className="font-mono text-mono-xs bg-surface-3 px-1 rounded">RELAY_PORT=3030 nexus-relay</code>
              </li>
              <li>
                <span className="text-text-primary">VPS / home server</span> — open port 3030 (or any port) in your
                firewall, then point your domain or public IP at the relay.
              </li>
              <li>
                <span className="text-text-primary">Same Mac</span> — click "Host relay on this device" below.
                Works for syncing between apps on the same machine or over a LAN.
              </li>
            </ul>
            <a
              href="#"
              className="inline-flex items-center gap-1 text-small text-accent hover:underline"
              onClick={(e) => e.preventDefault()}
              title="docs/relay.md"
            >
              <ExternalLink size={12} />
              Full setup guide (docs/relay.md)
            </a>
          </div>

          {/* Host on this device */}
          <div className="px-4 pb-4">
            <Button
              variant="secondary"
              size="md"
              onClick={handleHostHere}
              disabled={hosting || !isTauri()}
            >
              {hosting ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />}
              {status?.hostingPort ? `Hosting on port ${status.hostingPort}` : "Host relay on this device"}
            </Button>
            <p className="mt-1.5 text-small text-text-muted">
              Starts the relay inside the app on port 3030. Other devices on the same network can reach it at{" "}
              <span className="font-mono text-mono-xs">your-ip:3030</span>.
            </p>
          </div>

          {/* Relay URL */}
          <SectionHeader>Relay URL</SectionHeader>
          <div className="flex gap-2 px-4 pb-4">
            <input
              type="url"
              value={relayUrl}
              onChange={(e) => setRelayUrlLocal(e.target.value)}
              placeholder="http://my-server.com:3030"
              className="min-w-0 flex-1 rounded-sm border border-border-subtle bg-surface-2 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
            <Button
              variant="primary"
              size="md"
              onClick={handleSaveUrl}
              disabled={savingUrl || !relayUrl.trim()}
            >
              {savingUrl ? <Loader2 size={14} className="animate-spin" /> : "Save"}
            </Button>
          </div>

          {/* Status */}
          {status && (
            <div className="mx-4 mb-4 flex items-center gap-2 rounded-sm border border-border-subtle bg-surface-2 px-3 py-2">
              {statusDot === "green" && <Wifi size={14} className="text-success" />}
              {statusDot === "yellow" && <Wifi size={14} className="text-warning" />}
              {statusDot === "red" && <WifiOff size={14} className="text-error" />}
              {!statusDot && <WifiOff size={14} className="text-text-muted" />}
              <span className="text-body text-text-secondary">
                {!status.configured
                  ? "Not configured"
                  : status.error
                  ? `Error: ${status.error}`
                  : lastSyncAgo !== null
                  ? `Last synced ${lastSyncAgo < 5 ? "just now" : `${lastSyncAgo}s ago`}`
                  : "Configured — not yet synced"}
              </span>
              {status.pendingCount > 0 && (
                <span className="ml-auto text-small text-text-muted">{status.pendingCount} pending</span>
              )}
            </div>
          )}

          {/* Link new device */}
          <SectionHeader>Device enrollment</SectionHeader>
          <div className="px-4 pb-2">
            <p className="mb-3 text-small text-text-secondary">
              Generate a 6-digit code on this device. Enter it on the new device along with the relay URL to securely
              transfer the vault key.
            </p>
            {enrollCode ? (
              <div className="rounded-sm border border-accent bg-accent-soft px-4 py-3 text-center">
                <p className="mb-1 text-small text-text-secondary">Link code</p>
                <p className="font-mono text-[2rem] tracking-[0.25em] text-text-primary">{enrollCode}</p>
                {secondsLeft !== null && (
                  <p className="mt-1 text-small text-text-muted">
                    Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
                  </p>
                )}
              </div>
            ) : (
              <Button
                variant="secondary"
                size="md"
                onClick={handleGenerateCode}
                disabled={generatingCode || !isTauri()}
              >
                {generatingCode ? <Loader2 size={14} className="animate-spin" /> : <Link size={14} />}
                Generate link code
              </Button>
            )}
          </div>

          {/* Vault key export */}
          <SectionHeader>Vault key</SectionHeader>
          <div className="px-4 pb-4">
            <p className="mb-3 text-small text-text-secondary">
              Your 32-byte vault encryption key. Store this in a safe place as a backup — it&apos;s the only way to
              recover your data if you lose all enrolled devices.
            </p>
            {showVaultKey && vaultKey ? (
              <div className="rounded-sm border border-border-subtle bg-surface-2 px-3 py-2">
                <p className="break-all font-mono text-mono-xs text-text-secondary">{vaultKey}</p>
                <button
                  type="button"
                  onClick={() => handleCopy(vaultKey)}
                  className="mt-2 flex items-center gap-1 text-small text-accent hover:underline"
                >
                  <Copy size={12} />
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="md"
                onClick={handleShowVaultKey}
                disabled={!isTauri()}
              >
                <Shield size={14} />
                {showVaultKey ? "Hide vault key" : "Show vault key"}
              </Button>
            )}
          </div>

          {/* Privacy note */}
          <div className="mx-4 mb-6 flex gap-2 rounded-sm border border-border-subtle bg-surface-2 px-3 py-2.5">
            <Shield size={14} className="mt-0.5 shrink-0 text-success" />
            <p className="text-small text-text-secondary">
              <span className="text-text-primary">Zero-knowledge E2EE.</span> All mutations are encrypted with
              XChaCha20-Poly1305 before leaving this device. The relay server stores only opaque ciphertext and
              never has access to your vault key or any message content.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Signature editor ─────────────────────────────────────────────────────────

function SignatureEditor({ accountId, email }: { accountId: string; email: string }) {
  const [value, setValue] = React.useState(() => loadSignature(accountId));

  function handleBlur() {
    saveSignature(accountId, value.trim());
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-small text-text-secondary">{email}</label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        rows={4}
        placeholder="Type your signature here…"
        className={cn(
          "w-full resize-y rounded-sm border border-border-default bg-surface-1 px-3 py-2",
          "font-mono text-mono-sm text-text-primary outline-none placeholder:text-text-muted",
          "focus:border-accent",
        )}
      />
      <p className="text-caption text-text-muted">
        Plain text. Appended to new messages and replies automatically.
      </p>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function SettingsPanel({ panelId }: { panelId: string }) {
  const accounts = useAccounts();
  const theme = useWorkspace((s) => s.theme);
  const setTheme = useWorkspace((s) => s.setTheme);
  const density = useWorkspace((s) => s.density);
  const setDensity = useWorkspace((s) => s.setDensity);
  const filteredViewBehavior = useWorkspace((s) => s.filteredViewBehavior);
  const setFilteredViewBehavior = useWorkspace((s) => s.setFilteredViewBehavior);
  const clientMode = useWorkspace((s) => s.clientMode);

  const [activeSection, setActiveSection] = React.useState<"accounts" | "preferences" | "fields" | "relay">("accounts");

  React.useEffect(() => {
    if (clientMode !== "local-first" && activeSection === "relay") {
      setActiveSection("accounts");
    }
  }, [clientMode, activeSection]);

  const navItems = [
    { id: "accounts" as const, label: "Accounts", icon: <Mail size={14} /> },
    { id: "preferences" as const, label: "Preferences", icon: <SlidersHorizontal size={14} /> },
    { id: "fields" as const, label: "Custom Fields", icon: <LayoutList size={14} /> },
    ...(clientMode === "local-first"
      ? [{ id: "relay" as const, label: "Relay", icon: <Server size={14} /> }]
      : []),
  ];

  return (
    <Panel
      panelId={panelId}
      type="stage"
      header={<PanelHeader title="Settings" />}
    >
      <div className="flex h-full">
        {/* Left nav */}
        <div className="flex w-40 shrink-0 flex-col border-r border-border-subtle bg-surface-1 py-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 text-left text-body transition-colors",
                activeSection === item.id
                  ? "bg-accent-soft text-text-primary"
                  : "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
              )}
            >
              <span className={activeSection === item.id ? "text-accent" : "text-text-tertiary"}>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>

        {/* Right content */}
        <div className="min-w-0 flex-1 overflow-auto">
          {activeSection === "accounts" && (
            <div>
              <SectionHeader>Connected accounts</SectionHeader>
              {accounts.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
                  <Mail size={32} className="text-text-muted" />
                  <p className="text-body text-text-tertiary">No accounts connected yet.</p>
                  {isTauri() && (
                    <Button variant="primary" size="md" onClick={() => startGmailOAuth()}>
                      Connect Gmail
                    </Button>
                  )}
                  {!isTauri() && (
                    <p className="text-small text-text-muted">
                      Run the desktop app to connect a Gmail account.
                    </p>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-border-subtle">
                  {accounts.map((acc) => (
                    <AccountRow key={acc.id} accountId={acc.id} email={acc.email} />
                  ))}
                </div>
              )}

              {accounts.length > 0 && isTauri() && (
                <div className="px-4 py-3">
                  <Button variant="secondary" size="md" onClick={() => startGmailOAuth()}>
                    <Mail size={14} />
                    Add account
                  </Button>
                </div>
              )}

              {accounts.length > 0 && (
                <>
                  <SectionHeader>Signatures</SectionHeader>
                  <div className="flex flex-col gap-4 px-4 pb-4">
                    {accounts.map((acc) => (
                      <SignatureEditor key={acc.id} accountId={acc.id} email={acc.email} />
                    ))}
                  </div>
                </>
              )}

              {isTauri() && (
                <>
                  <SectionHeader>Vault</SectionHeader>
                  <div className="px-4 pb-4">
                    <p className="mb-3 text-small text-text-tertiary">
                      Forget the vault location to return to onboarding. Your vault data on disk is not deleted.
                    </p>
                    <Button
                      variant="destructive"
                      size="md"
                      onClick={async () => {
                        if (!window.confirm("Forget vault location and return to onboarding? Your vault data on disk will not be deleted.")) return;
                        localStorage.removeItem("nexus-onboarding-step");
                        await resetVault();
                        window.location.reload();
                      }}
                    >
                      Forget vault &amp; return to onboarding
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeSection === "preferences" && (
            <div>
              {/* Theme */}
              <SectionHeader>Theme</SectionHeader>
              <div className="flex gap-2 px-4 pb-4">
                {(
                  [
                    { value: "light" as const, label: "Light", icon: <Sun size={16} /> },
                    { value: "dark" as const, label: "Dark", icon: <Moon size={16} /> },
                    { value: "system" as const, label: "System", icon: <Monitor size={16} /> },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => {
                      if (t.value === "system") {
                        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                        setTheme(prefersDark ? "dark" : "light");
                      } else {
                        setTheme(t.value);
                      }
                    }}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-1.5 rounded-sm border py-3 text-caption transition-colors",
                      (t.value === "system" ? false : theme === t.value)
                        ? "border-accent bg-accent-soft text-text-primary"
                        : "border-border-subtle bg-surface-2 text-text-tertiary hover:border-border-default hover:text-text-secondary",
                    )}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Density */}
              <SectionHeader>List density</SectionHeader>
              <div className="flex flex-col gap-1 px-4 pb-4">
                {DENSITIES.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDensity(d.value)}
                    className={cn(
                      "flex items-center gap-3 rounded-sm border px-3 py-2.5 text-left transition-colors",
                      density === d.value
                        ? "border-accent bg-accent-soft"
                        : "border-border-subtle bg-surface-2 hover:border-border-default",
                    )}
                  >
                    <AlignJustify
                      size={16}
                      className={density === d.value ? "text-accent" : "text-text-tertiary"}
                    />
                    <div>
                      <div
                        className={cn(
                          "text-body",
                          density === d.value ? "text-text-primary" : "text-text-secondary",
                        )}
                      >
                        {d.label}
                      </div>
                      <div className="text-small text-text-tertiary">{d.sublabel}</div>
                    </div>
                    {density === d.value && (
                      <CheckCircle2 size={14} className="ml-auto shrink-0 text-accent" />
                    )}
                  </button>
                ))}
              </div>

              {/* Open filtered views */}
              <SectionHeader>Open filtered views</SectionHeader>
              <div className="flex flex-col gap-1 px-4 pb-1">
                {(
                  [
                    {
                      value: "replace" as const,
                      label: "In current panel",
                      sublabel: "Navigates the existing email list",
                    },
                    {
                      value: "new-panel" as const,
                      label: "In new panel",
                      sublabel: "Opens a separate list alongside",
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFilteredViewBehavior(opt.value)}
                    className={cn(
                      "flex items-center gap-3 rounded-sm border px-3 py-2.5 text-left transition-colors",
                      filteredViewBehavior === opt.value
                        ? "border-accent bg-accent-soft"
                        : "border-border-subtle bg-surface-2 hover:border-border-default",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "text-body",
                          filteredViewBehavior === opt.value ? "text-text-primary" : "text-text-secondary",
                        )}
                      >
                        {opt.label}
                      </div>
                      <div className="text-small text-text-tertiary">{opt.sublabel}</div>
                    </div>
                    {filteredViewBehavior === opt.value && (
                      <CheckCircle2 size={14} className="ml-auto shrink-0 text-accent" />
                    )}
                  </button>
                ))}
              </div>
              <p className="px-4 pb-4 font-mono text-mono-xs text-text-muted">
                ⌘/Ctrl+click always does the opposite of this setting.
              </p>
            </div>
          )}

          {activeSection === "fields" && (
            <div className="p-4">
              <CustomFieldsSettings />
            </div>
          )}

          {activeSection === "relay" && <RelaySection />}
        </div>
      </div>
    </Panel>
  );
}
