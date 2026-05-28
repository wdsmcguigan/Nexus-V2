import * as React from "react";
import { RefreshCw, Plus } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { useCalendarEvents } from "@/storage/useStore";
import { syncGoogleCalendar } from "@/storage/tauri";
import { useAccounts } from "@/storage/useStore";
import { MiniMonth } from "./MiniMonth";
import { AgendaView } from "./AgendaView";

const NOW = Date.now();
const START_TS = NOW - 14 * 86_400_000;
const END_TS = NOW + 90 * 86_400_000;

export function CalendarPanel() {
  const focusDate = useWorkspace((s) => s.calendarFocusDate);
  const setFocusDate = useWorkspace((s) => s.setCalendarFocusDate);
  const openEventCreateModal = useWorkspace((s) => s.openEventCreateModal);
  const events = useCalendarEvents(START_TS, END_TS);
  const accounts = useAccounts();
  const [syncing, setSyncing] = React.useState(false);

  const today = new Date().toISOString().slice(0, 10);

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

  return (
    <div className="flex h-full flex-col bg-surface-1">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <span className="font-mono text-mono-xs font-semibold uppercase tracking-widest text-text-muted">
          Calendar
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFocusDate(today)}
            disabled={focusDate === today}
            className="rounded-xs px-2 py-0.5 font-mono text-mono-xs text-text-secondary hover:bg-surface-2 disabled:opacity-40 transition-colors"
          >
            Today
          </button>
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

      {/* Mini month navigator */}
      <MiniMonth
        focusDate={focusDate}
        events={events}
        onSelectDate={setFocusDate}
      />

      {/* Divider */}
      <div className="border-t border-border-subtle" />

      {/* Agenda */}
      <AgendaView events={events} focusDate={focusDate} />
    </div>
  );
}
