import * as React from "react";
import {
  RefreshCw,
  Search,
  Sun,
  Moon,
  Command as CommandIcon,
  Settings,
  Loader2,
  WifiOff,
} from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { Kbd } from "@/components/ui/Kbd";
import { WorkspaceSwitcher } from "@/components/chrome/WorkspaceSwitcher";
import { isTauri } from "@/storage/tauri";
import { cn } from "@/lib/utils";

// ─── Sync status indicator ─────────────────────────────────────────────────────

function formatSyncAge(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin === 1) return "1m ago";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr === 1) return "1h ago";
  return `${diffHr}h ago`;
}

function SyncIndicator() {
  const lastSyncedAt = useWorkspace((s) => s.lastSyncedAt);
  const isSyncing = useWorkspace((s) => s.isSyncing);
  // Tick every 30s so "2m ago" stays fresh
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!isTauri()) {
    return (
      <Tooltip label="Web mode — connect Gmail in the desktop app">
        <div className="flex items-center gap-1.5 text-caption text-text-muted">
          <WifiOff size={10} />
          <span>Web mode</span>
        </div>
      </Tooltip>
    );
  }

  if (isSyncing) {
    return (
      <div className="flex items-center gap-1.5 text-caption text-text-tertiary">
        <Loader2 size={10} className="animate-spin text-accent" />
        <span>Syncing…</span>
      </div>
    );
  }

  if (!lastSyncedAt) {
    return (
      <div className="flex items-center gap-1.5 text-caption text-text-muted">
        <span className="relative inline-flex size-1.5 rounded-full bg-text-muted" />
        <span>Not synced</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-caption text-text-tertiary">
      <span className="relative flex size-2 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-40" />
        <span className="relative inline-flex size-1.5 rounded-full bg-success" />
      </span>
      <span>{formatSyncAge(lastSyncedAt)}</span>
    </div>
  );
}

// ─── Chrome ────────────────────────────────────────────────────────────────────

export function WorkspaceChrome() {
  const theme = useWorkspace((s) => s.theme);
  const toggleTheme = useWorkspace((s) => s.toggleTheme);
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);
  const openSettingsPanel = useWorkspace((s) => s.openSettingsPanel);

  return (
    <header
      role="banner"
      className={cn(
        "flex h-10 shrink-0 items-center gap-3 border-b border-border-default bg-surface-1 px-3",
      )}
      data-tauri-drag-region
    >
      {/* App identity */}
      <div className="flex items-center gap-2">
        <div className="flex size-5 items-center justify-center rounded-xs bg-accent text-text-on-accent font-mono text-mono-xs font-bold">
          N
        </div>
        <span className="font-sans text-caption font-semibold uppercase tracking-[0.06em] text-text-secondary">
          NEXUS
        </span>
      </div>

      {/* Workspace switcher */}
      <WorkspaceSwitcher />

      {/* Live sync indicator */}
      <SyncIndicator />

      {/* Search */}
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className={cn(
          "ml-auto flex h-7 w-[320px] items-center gap-2 rounded-sm bg-surface-2 px-2",
          "text-caption text-text-tertiary",
          "border border-border-subtle hover:border-border-default hover:bg-surface-3",
          "transition-colors duration-fast",
        )}
      >
        <Search size={12} />
        <span className="flex-1 text-left">Search emails, contacts, files…</span>
        <Kbd size="xs">⌘K</Kbd>
      </button>

      {/* Right cluster */}
      <Tooltip label="Run command" shortcut="⌘K">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Command palette"
          onClick={() => setPaletteOpen(true)}
        >
          <CommandIcon />
        </Button>
      </Tooltip>
      <Tooltip label="Settings" shortcut="⌘,">
        <Button variant="ghost" size="sm" iconOnly aria-label="Settings" onClick={openSettingsPanel}>
          <Settings />
        </Button>
      </Tooltip>
      <Tooltip label="Refresh" shortcut="⌘R">
        <Button variant="ghost" size="sm" iconOnly aria-label="Refresh">
          <RefreshCw />
        </Button>
      </Tooltip>
      <Tooltip label={`${theme === "dark" ? "Light" : "Dark"} theme`}>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Toggle theme"
          onClick={toggleTheme}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
      </Tooltip>
    </header>
  );
}
