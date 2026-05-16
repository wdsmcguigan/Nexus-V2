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
  AlertCircle,
  Loader2,
  LogOut,
  Sun,
  Moon,
  Monitor,
  AlignJustify,
  SlidersHorizontal,
  LayoutList,
} from "lucide-react";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { Button } from "@/components/ui/Button";
import { useWorkspace } from "@/state/workspace";
import { useAccounts } from "@/storage/useStore";
import { isTauri, syncGmailNow, startGmailOAuth, disconnectAccount } from "@/storage/tauri";
import { CustomFieldsSettings } from "@/components/settings/CustomFieldsSettings";
import { cn } from "@/lib/utils";
import type { Density } from "@/design-system/tokens";

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

// ─── Account row ──────────────────────────────────────────────────────────────

function AccountRow({ accountId, email, syncStatus }: { accountId: string; email: string; syncStatus: string }) {
  const [syncing, setSyncing] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);

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

  async function handleDisconnect() {
    if (!isTauri()) return;
    if (!confirm(`Disconnect ${email}? This will remove all synced messages from the local vault.`)) return;
    setDisconnecting(true);
    try {
      await disconnectAccount(accountId);
    } catch (e) {
      console.warn("disconnect_account error:", e);
    } finally {
      setDisconnecting(false);
    }
  }

  const statusIcon =
    syncing || syncStatus === "syncing" ? (
      <Loader2 size={14} className="animate-spin text-accent" />
    ) : syncStatus === "error" ? (
      <AlertCircle size={14} className="text-error" />
    ) : (
      <CheckCircle2 size={14} className="text-success" />
    );

  const statusLabel =
    syncing ? "Syncing…" : syncStatus === "error" ? "Error" : syncStatus === "syncing" ? "Syncing…" : "Synced";

  return (
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
        disabled={syncing || disconnecting}
      >
        <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label="Disconnect account"
        onClick={handleDisconnect}
        disabled={syncing || disconnecting}
      >
        {disconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
      </Button>
    </div>
  );
}

// ─── Density picker ───────────────────────────────────────────────────────────

const DENSITIES: { value: Density; label: string; sublabel: string }[] = [
  { value: "compact", label: "Compact", sublabel: "28px rows, no snippet" },
  { value: "comfortable", label: "Comfortable", sublabel: "36px rows, snippet shown" },
  { value: "cozy", label: "Cozy", sublabel: "48px rows, 2-line snippet" },
];

// ─── Main panel ───────────────────────────────────────────────────────────────

export function SettingsPanel({ panelId }: { panelId: string }) {
  const accounts = useAccounts();
  const theme = useWorkspace((s) => s.theme);
  const setTheme = useWorkspace((s) => s.setTheme);
  const density = useWorkspace((s) => s.density);
  const setDensity = useWorkspace((s) => s.setDensity);
  const filteredViewBehavior = useWorkspace((s) => s.filteredViewBehavior);
  const setFilteredViewBehavior = useWorkspace((s) => s.setFilteredViewBehavior);

  const [activeSection, setActiveSection] = React.useState<"accounts" | "preferences" | "fields">("accounts");

  const navItems = [
    { id: "accounts" as const, label: "Accounts", icon: <Mail size={14} /> },
    { id: "preferences" as const, label: "Preferences", icon: <SlidersHorizontal size={14} /> },
    { id: "fields" as const, label: "Custom Fields", icon: <LayoutList size={14} /> },
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
                    <AccountRow key={acc.id} accountId={acc.id} email={acc.email} syncStatus={acc.syncStatus} />
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
        </div>
      </div>
    </Panel>
  );
}
