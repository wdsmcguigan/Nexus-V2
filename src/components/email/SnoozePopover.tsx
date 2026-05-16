import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { AlarmClock, Clock, Sun, Calendar, CalendarDays, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { localStore } from "@/storage/local";
import { snoozeMessage } from "@/state/mutations";
import { cn } from "@/lib/utils";

// ─── Quick-pick options ───────────────────────────────────────────────────────

function snoozeTargets(): { label: string; sublabel: string; ts: number; icon: React.ReactNode }[] {
  const now = new Date();
  const hour = now.getHours();

  // "Later today" = +3h, capped at 18:00
  const laterToday = new Date(now);
  laterToday.setHours(Math.min(hour + 3, 18), 0, 0, 0);

  // Tomorrow morning = next day at 08:00
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);

  // Next week = next Monday at 08:00
  const nextWeek = new Date(now);
  const daysUntilMonday = (8 - nextWeek.getDay()) % 7 || 7;
  nextWeek.setDate(nextWeek.getDate() + daysUntilMonday);
  nextWeek.setHours(8, 0, 0, 0);

  // Next weekend = Saturday at 10:00
  const weekend = new Date(now);
  const daysUntilSat = (6 - weekend.getDay() + 7) % 7 || 7;
  weekend.setDate(weekend.getDate() + daysUntilSat);
  weekend.setHours(10, 0, 0, 0);

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const results = [];

  if (laterToday.getTime() > now.getTime()) {
    results.push({
      label: "Later today",
      sublabel: fmt(laterToday),
      ts: laterToday.getTime(),
      icon: <Clock size={14} />,
    });
  }

  results.push(
    {
      label: "Tomorrow",
      sublabel: fmt(tomorrow),
      ts: tomorrow.getTime(),
      icon: <Sun size={14} />,
    },
    {
      label: "This weekend",
      sublabel: fmt(weekend),
      ts: weekend.getTime(),
      icon: <Calendar size={14} />,
    },
    {
      label: "Next week",
      sublabel: fmt(nextWeek),
      ts: nextWeek.getTime(),
      icon: <CalendarDays size={14} />,
    },
  );

  return results;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SnoozePopoverProps {
  messageId: string;
  /** Render the trigger as a ghost icon button (default) or inline button */
  variant?: "icon" | "inline";
  onSnoozed?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SnoozePopover({ messageId, variant = "icon", onSnoozed }: SnoozePopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [customDate, setCustomDate] = React.useState("");
  const [customTime, setCustomTime] = React.useState("08:00");
  const targets = React.useMemo(() => snoozeTargets(), [open]); // recalc when opened

  function handleSnooze(ts: number) {
    snoozeMessage(localStore, messageId, ts);
    setOpen(false);
    onSnoozed?.();
  }

  function handleCustom() {
    if (!customDate) return;
    const [year, month, day] = customDate.split("-").map(Number);
    const [hh, mm] = customTime.split(":").map(Number);
    const d = new Date(year!, month! - 1, day!, hh!, mm!, 0, 0);
    if (isNaN(d.getTime()) || d.getTime() <= Date.now()) return;
    handleSnooze(d.getTime());
  }

  const trigger =
    variant === "icon" ? (
      <Tooltip label="Snooze" shortcut="H">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Snooze"
          className={open ? "text-accent" : ""}
        >
          <AlarmClock />
        </Button>
      </Tooltip>
    ) : (
      <Button variant="ghost" size="sm" aria-label="Snooze">
        <AlarmClock size={14} />
        Snooze
      </Button>
    );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className={cn(
            "z-50 w-72 overflow-hidden rounded-md border border-border-subtle bg-surface-2 shadow-l3",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
            <span className="font-sans text-body-strong text-text-primary">Snooze until…</span>
            <Popover.Close asChild>
              <button
                type="button"
                className="rounded-xs p-0.5 text-text-tertiary hover:text-text-primary"
                aria-label="Close"
              >
                <X size={12} />
              </button>
            </Popover.Close>
          </div>

          {/* Quick picks */}
          <div className="p-1">
            {targets.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => handleSnooze(t.ts)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xs px-3 py-2 text-left",
                  "text-text-secondary hover:bg-surface-3 hover:text-text-primary",
                  "transition-colors duration-fast",
                )}
              >
                <span className="shrink-0 text-text-tertiary">{t.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-body text-text-primary">{t.label}</div>
                  <div className="font-mono text-mono-xs text-text-tertiary">{t.sublabel}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Custom date/time */}
          <div className="border-t border-border-subtle p-3">
            <p className="mb-2 text-caption text-text-tertiary">Custom date &amp; time</p>
            <div className="flex gap-2">
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className={cn(
                  "h-7 flex-1 rounded-xs border border-border-subtle bg-surface-3 px-2",
                  "font-mono text-mono-sm text-text-primary outline-none",
                  "focus:border-accent",
                )}
              />
              <input
                type="time"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                className={cn(
                  "h-7 w-20 shrink-0 rounded-xs border border-border-subtle bg-surface-3 px-2",
                  "font-mono text-mono-sm text-text-primary outline-none",
                  "focus:border-accent",
                )}
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              className="mt-2 w-full"
              onClick={handleCustom}
              disabled={!customDate}
            >
              Set snooze
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
