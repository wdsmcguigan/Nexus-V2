import * as React from "react";
import { RefreshCw, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/state/workspace";
import { useCalendarEvents } from "@/storage/useStore";
import { syncGoogleCalendar } from "@/storage/tauri";
import { useAccounts } from "@/storage/useStore";
import { MiniMonth } from "./MiniMonth";
import { AgendaView } from "./AgendaView";
import { WeekView } from "./WeekView";
import { MonthView } from "./MonthView";
import {
  getWeekBounds,
  getMonthBounds,
  weekMonday,
  monthStart,
  addWeeks,
  addMonths,
} from "@/lib/calendarUtils";

export function CalendarPanel() {
  const focusDate = useWorkspace((s) => s.calendarFocusDate);
  const setFocusDate = useWorkspace((s) => s.setCalendarFocusDate);
  const viewMode = useWorkspace((s) => s.calendarViewMode);
  const setViewMode = useWorkspace((s) => s.setCalendarViewMode);
  const openEventCreateModal = useWorkspace((s) => s.openEventCreateModal);
  const accounts = useAccounts();
  const [syncing, setSyncing] = React.useState(false);

  const today = new Date().toISOString().slice(0, 10);

  // Compute event range based on view mode
  const now = Date.now();
  const [weekStart, weekEnd] = getWeekBounds(focusDate);
  const [mStart, mEnd] = getMonthBounds(focusDate);
  const rangeStart = viewMode === "week" ? weekStart : viewMode === "month" ? mStart : now - 14 * 86_400_000;
  const rangeEnd = viewMode === "week" ? weekEnd : viewMode === "month" ? mEnd : now + 90 * 86_400_000;

  const events = useCalendarEvents(rangeStart, rangeEnd);

  const handleSync = React.useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const gmailAccounts = accounts.filter((a) => a.provider === "gmail");
      await Promise.all(gmailAccounts.map((a) => syncGoogleCalendar(a.id)));
    } finally {
      setSyncing(false);
    }
  }, [accounts, syncing]);

  function prevPeriod() {
    if (viewMode === "week") setFocusDate(addWeeks(focusDate, -1));
    else if (viewMode === "month") setFocusDate(addMonths(focusDate, -1));
  }

  function nextPeriod() {
    if (viewMode === "week") setFocusDate(addWeeks(focusDate, 1));
    else if (viewMode === "month") setFocusDate(addMonths(focusDate, 1));
  }

  const mondayIso = weekMonday(focusDate);
  const mStartIso = monthStart(focusDate);

  return (
    <div className="flex h-full flex-col bg-surface-1">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2 gap-2">
        <div className="flex items-center gap-1">
          {viewMode !== "agenda" && (
            <>
              <button
                type="button"
                onClick={prevPeriod}
                className="rounded-xs p-0.5 text-text-tertiary hover:bg-surface-2 hover:text-text-primary transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={nextPeriod}
                className="rounded-xs p-0.5 text-text-tertiary hover:bg-surface-2 hover:text-text-primary transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setFocusDate(today)}
            disabled={focusDate === today}
            className="rounded-xs px-2 py-0.5 font-mono text-mono-xs text-text-secondary hover:bg-surface-2 disabled:opacity-40 transition-colors"
          >
            Today
          </button>
        </div>

        {/* View mode segmented control */}
        <div className="flex items-center gap-0.5 rounded-xs border border-border-subtle bg-surface-1 p-0.5">
          {(["agenda", "week", "month"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              className={cn(
                "rounded-xs px-2 py-0.5 font-mono text-mono-xs capitalize transition-colors",
                viewMode === m
                  ? "bg-surface-3 text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary",
              )}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="rounded-xs p-1 text-text-tertiary hover:bg-surface-2 hover:text-text-primary disabled:opacity-40 transition-colors"
            title="Sync calendar"
          >
            <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={() => openEventCreateModal({ date: focusDate })}
            className="rounded-xs p-1 text-text-tertiary hover:bg-surface-2 hover:text-text-primary transition-colors"
            title="New event"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Mini month navigator — only in agenda mode */}
      {viewMode === "agenda" && (
        <>
          <MiniMonth
            focusDate={focusDate}
            events={events}
            onSelectDate={setFocusDate}
          />
          <div className="border-t border-border-subtle" />
        </>
      )}

      {/* View content */}
      {viewMode === "agenda" && <AgendaView events={events} focusDate={focusDate} />}
      {viewMode === "week" && (
        <WeekView events={events} focusDate={focusDate} mondayIso={mondayIso} />
      )}
      {viewMode === "month" && (
        <MonthView
          events={events}
          focusDate={focusDate}
          monthStartIso={mStartIso}
          onSelectDate={(iso) => { setFocusDate(iso); setViewMode("agenda"); }}
        />
      )}
    </div>
  );
}
