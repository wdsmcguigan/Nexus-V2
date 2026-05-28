import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/data/types";
import { eventColor } from "@/lib/calendarColors";

interface Props {
  focusDate: string;
  events: CalendarEvent[];
  onSelectDate: (d: string) => void;
}

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDate(iso: string): { y: number; m: number; d: number } {
  const parts = iso.split("-").map(Number);
  return { y: parts[0] ?? 0, m: (parts[1] ?? 1) - 1, d: parts[2] ?? 1 };
}

export function MiniMonth({ focusDate, events, onSelectDate }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const { y: fy, m: fm } = parseDate(focusDate);

  const [displayYear, setDisplayYear] = React.useState(fy);
  const [displayMonth, setDisplayMonth] = React.useState(fm);

  // Keep display in sync if focusDate jumps to a different month
  React.useEffect(() => {
    setDisplayYear(fy);
    setDisplayMonth(fm);
  }, [fy, fm]);

  // Build event date map: date -> first event's colorId for dot coloring
  const eventDates = React.useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const e of events) {
      if (e.status === "cancelled") continue;
      const d = new Date(e.startTs).toISOString().slice(0, 10);
      const dm = new Date(d + "T00:00:00").getMonth();
      if (dm === displayMonth && !map.has(d)) map.set(d, e.colorId);
    }
    return map;
  }, [events, displayMonth]);

  // First weekday of this month (0=Mon … 6=Sun ISO week)
  const firstDay = new Date(displayYear, displayMonth, 1).getDay();
  const offset = (firstDay + 6) % 7; // Monday-anchored
  const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();

  const cells: Array<{ iso: string | null; d: number }> = [];
  for (let i = 0; i < offset; i++) cells.push({ iso: null, d: 0 });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ iso: isoDate(displayYear, displayMonth, d), d });
  }

  const prevMonth = () => {
    if (displayMonth === 0) { setDisplayYear(y => y - 1); setDisplayMonth(11); }
    else setDisplayMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (displayMonth === 11) { setDisplayYear(y => y + 1); setDisplayMonth(0); }
    else setDisplayMonth(m => m + 1);
  };

  const monthLabel = new Date(displayYear, displayMonth, 1)
    .toLocaleString("default", { month: "long", year: "numeric" });

  return (
    <div className="select-none px-3 py-2">
      {/* Month header */}
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          className="rounded-xs p-0.5 text-text-tertiary hover:bg-surface-2 hover:text-text-primary transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="font-sans text-small font-medium text-text-primary">{monthLabel}</span>
        <button
          type="button"
          onClick={nextMonth}
          className="rounded-xs p-0.5 text-text-tertiary hover:bg-surface-2 hover:text-text-primary transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Weekday labels */}
      <div className="mb-1 grid grid-cols-7">
        {DAYS.map((d) => (
          <div key={d} className="text-center font-mono text-mono-xs text-text-muted">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((cell, i) => {
          if (!cell.iso) return <div key={`e-${i}`} />;
          const isToday = cell.iso === today;
          const isFocus = cell.iso === focusDate;
          const hasEvent = eventDates.has(cell.iso);
          const dotColorId = eventDates.get(cell.iso);
          return (
            <button
              key={cell.iso}
              type="button"
              onClick={() => onSelectDate(cell.iso!)}
              className={cn(
                "relative flex flex-col items-center rounded-xs py-0.5 font-mono text-mono-xs transition-colors",
                isFocus
                  ? "bg-accent text-white"
                  : isToday
                  ? "ring-1 ring-accent text-accent font-semibold"
                  : "text-text-secondary hover:bg-surface-2",
              )}
            >
              {cell.d}
              {hasEvent && !isFocus && (
                <span
                  className="absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full opacity-60"
                  style={{ backgroundColor: eventColor(dotColorId) }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
