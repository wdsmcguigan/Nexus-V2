import { Activity, ChevronUp, ChevronDown, CheckCircle } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";

/**
 * HUD collapsed strip — see spec §4.7.
 * Floats at the bottom-right corner above the panel layer.
 * Shows real sync progress from gmail:sync-progress Tauri events.
 */
export function HudStrip() {
  const expanded = useWorkspace((s) => s.hudExpanded);
  const toggle = useWorkspace((s) => s.toggleHud);
  const isSyncing = useWorkspace((s) => s.isSyncing);
  const syncProgress = useWorkspace((s) => s.syncProgress);
  const lastSyncedAt = useWorkspace((s) => s.lastSyncedAt);

  const runningCount = isSyncing ? 1 : 0;

  return (
    <div
      role="region"
      aria-label="Activity HUD"
      className={cn(
        "pointer-events-auto absolute bottom-2 right-2 z-30",
        "rounded-md border border-border-default bg-surface-3 shadow-l2",
        "transition-all duration-base ease-out",
        expanded ? "h-auto w-[300px]" : "h-8 w-[260px]",
      )}
    >
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex h-8 w-full items-center gap-2 px-2 text-left",
          "rounded-md focus-visible:shadow-focus focus-visible:outline-none",
        )}
      >
        <span className="relative inline-flex items-center justify-center">
          {isSyncing ? (
            <>
              <Activity size={12} className="text-accent" />
              <span
                aria-hidden
                className="absolute -right-1 -top-1 size-1.5 rounded-full bg-accent animate-hud-pulse"
              />
            </>
          ) : (
            <Activity size={12} className="text-text-tertiary" />
          )}
        </span>
        <span className="font-sans text-caption text-text-secondary">
          Activity
        </span>
        <span className="font-mono text-mono-xs text-text-tertiary">
          · {runningCount} running
        </span>
        <span className="ml-auto text-text-tertiary">
          {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 px-3 pb-3">
          {isSyncing && syncProgress ? (
            <ActivityRow
              label="Gmail sync"
              mono={
                syncProgress.total > 0
                  ? `${syncProgress.fetched.toLocaleString()} / ${syncProgress.total.toLocaleString()}`
                  : "Starting…"
              }
              progress={
                syncProgress.total > 0
                  ? syncProgress.fetched / syncProgress.total
                  : undefined
              }
              indeterminate={syncProgress.total === 0}
            />
          ) : isSyncing ? (
            <ActivityRow label="Gmail sync" mono="Starting…" indeterminate />
          ) : lastSyncedAt ? (
            <div className="flex items-center gap-1.5 text-small text-text-tertiary">
              <CheckCircle size={11} className="shrink-0 text-success" />
              <span>Synced {formatRelativeTime(lastSyncedAt)}</span>
            </div>
          ) : (
            <p className="text-small text-text-muted">No sync activity</p>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityRow({
  label,
  mono,
  progress,
  indeterminate,
}: {
  label: string;
  mono: string;
  progress?: number;
  indeterminate?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-small text-text-secondary">{label}</span>
        <span className="shrink-0 font-mono text-mono-xs text-text-tertiary">{mono}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-xs bg-surface-inset">
        {indeterminate ? (
          <div
            className="h-full w-1/3 animate-panel-progress"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--color-accent), transparent)",
            }}
          />
        ) : (
          <div
            className="h-full bg-accent transition-[width] duration-base ease-out"
            style={{ width: `${(progress ?? 0) * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

function formatRelativeTime(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
