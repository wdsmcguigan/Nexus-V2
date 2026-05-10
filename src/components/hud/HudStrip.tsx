import { Activity, ChevronUp, ChevronDown } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";

/**
 * HUD collapsed strip — see spec §4.7.
 * Floats at the bottom-right corner above the panel layer.
 */
export function HudStrip() {
  const expanded = useWorkspace((s) => s.hudExpanded);
  const toggle = useWorkspace((s) => s.toggleHud);

  return (
    <div
      role="region"
      aria-label="Activity HUD"
      className={cn(
        "pointer-events-auto absolute bottom-2 right-2 z-30",
        "rounded-md border border-border-default bg-surface-3 shadow-l2",
        "transition-all duration-base ease-out",
        expanded ? "h-[200px] w-[320px]" : "h-8 w-[260px]",
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
          <Activity size={12} className="text-accent" />
          <span
            aria-hidden
            className="absolute -right-1 -top-1 size-1.5 rounded-full bg-accent animate-hud-pulse"
          />
        </span>
        <span className="font-sans text-caption text-text-secondary">
          Activity
        </span>
        <span className="font-mono text-mono-xs text-text-tertiary">
          · 3 running
        </span>
        <span className="ml-auto text-text-tertiary">
          {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </span>
      </button>
      {expanded && (
        <div className="space-y-1 px-3 pb-3">
          <ActivityRow label="Sync — Inbox" mono="245 / 247" progress={0.99} />
          <ActivityRow
            label="Upload — Q2-deck.pdf"
            mono="3.1 MB / 4.2 MB"
            progress={0.74}
          />
          <ActivityRow label="Indexing" mono="background" indeterminate />
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
        <span className="truncate text-small text-text-secondary">
          {label}
        </span>
        <span className="shrink-0 font-mono text-mono-xs text-text-tertiary">
          {mono}
        </span>
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
