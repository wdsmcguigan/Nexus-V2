/**
 * INS-STAR-PALETTE — 12-icon star palette popover.
 * Click active icon = CLEAR_STAR; click other = SET_STAR.
 * Quick-star (yellow) on unstarred.
 */
import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Star,
  CheckCircle2,
  AlertOctagon,
  HelpCircle,
  ChevronRight,
  Info,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";
import type { StarStyle } from "@/data/types";

interface StarPaletteProps {
  messageId: string;
  star: StarStyle | null;
}

export interface StarEntry {
  style: StarStyle;
  icon: LucideIcon;
  color: string;
  label: string;
}

export const STAR_ENTRIES: StarEntry[] = [
  { style: "yellow", icon: Star, color: "var(--color-link-2)", label: "Yellow star" },
  { style: "red", icon: Star, color: "var(--color-link-1)", label: "Red star" },
  { style: "orange", icon: Star, color: "oklch(0.66 0.16 55)", label: "Orange star" },
  { style: "green", icon: Star, color: "var(--color-link-3)", label: "Green star" },
  { style: "blue", icon: Star, color: "var(--color-link-5)", label: "Blue star" },
  { style: "purple", icon: Star, color: "var(--color-link-6)", label: "Purple star" },
  { style: "check-green", icon: CheckCircle2, color: "var(--color-link-3)", label: "Green check" },
  { style: "bang-red", icon: AlertOctagon, color: "var(--color-link-1)", label: "Red bang" },
  { style: "question-purple", icon: HelpCircle, color: "var(--color-link-6)", label: "Purple question" },
  { style: "guillemet-orange", icon: ChevronRight, color: "oklch(0.66 0.16 55)", label: "Orange guillemet" },
  { style: "info-blue", icon: Info, color: "var(--color-link-5)", label: "Blue info" },
  { style: "bang-yellow", icon: AlertTriangle, color: "var(--color-link-2)", label: "Yellow bang" },
];

function StarIcon({ entry, active }: { entry: StarEntry; active: boolean }) {
  const Icon = entry.icon;
  return (
    <Icon
      size={16}
      fill={active ? entry.color : "none"}
      style={{ color: entry.color }}
    />
  );
}

export function StarPalette({ messageId, star }: StarPaletteProps) {
  const setStar = useWorkspace((s) => s.setStar);
  const clearStar = useWorkspace((s) => s.clearStar);
  const [open, setOpen] = React.useState(false);

  const currentEntry = STAR_ENTRIES.find((e) => e.style === star);

  function handleQuickStar(e: React.MouseEvent) {
    if (e.shiftKey || open) return;
    if (star === "yellow") {
      clearStar(messageId);
    } else {
      setStar(messageId, "yellow");
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={star ? `Starred: ${star}` : "Star"}
          onClick={handleQuickStar}
          onContextMenu={(e) => { e.preventDefault(); setOpen(true); }}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-xs",
            "transition-colors hover:bg-surface-2",
            "focus-visible:outline-none focus-visible:shadow-focus",
          )}
        >
          {currentEntry ? (
            <StarIcon entry={currentEntry} active />
          ) : (
            <Star size={16} className="text-text-tertiary" />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          className={cn(
            "z-50 overflow-hidden rounded-md border border-border-subtle bg-surface-2 p-2 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="grid grid-cols-6 gap-1">
            {STAR_ENTRIES.map((entry) => {
              const active = star === entry.style;
              return (
                <button
                  key={entry.style}
                  type="button"
                  aria-label={entry.label}
                  aria-pressed={active}
                  onClick={() => {
                    if (active) clearStar(messageId);
                    else setStar(messageId, entry.style);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-xs",
                    "transition-colors hover:bg-surface-3",
                    active && "bg-accent-soft",
                  )}
                >
                  <StarIcon entry={entry} active={active} />
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
