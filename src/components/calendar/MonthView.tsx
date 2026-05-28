import * as React from "react";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/data/types";
import { eventColor } from "@/lib/calendarColors";
import { EventDetailPopover } from "./EventDetailPopover";
import { generateMonthCells } from "@/lib/calendarUtils";
import { localStore } from "@/storage/local";
import { rescheduleCalendarEvent } from "@/state/mutations";
import { isTauri, updateCalendarEvent } from "@/storage/tauri";
import { toast } from "sonner";

interface Props {
  events: CalendarEvent[];
  focusDate: string;
  monthStartIso: string;
  onSelectDate: (iso: string) => void;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_VISIBLE = 3;

export function MonthView({ events, focusDate, monthStartIso, onSelectDate }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const cells = React.useMemo(() => generateMonthCells(monthStartIso), [monthStartIso]);
  const currentMonth = monthStartIso.slice(0, 7);
  const [dragOverDay, setDragOverDay] = React.useState<string | null>(null);

  // Group events by date
  const eventsByDate = React.useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (e.status === "cancelled") continue;
      const iso = new Date(e.startTs).toISOString().slice(0, 10);
      if (!map.has(iso)) map.set(iso, []);
      map.get(iso)!.push(e);
    }
    return map;
  }, [events]);

  function handleDrop(e: React.DragEvent, dayIso: string) {
    e.preventDefault();
    setDragOverDay(null);
    const eventId = e.dataTransfer.getData("eventId");
    const evt = localStore.calendarEvents.get(eventId);
    if (!evt) return;

    const duration = evt.endTs - evt.startTs;
    const origDate = new Date(evt.startTs).toISOString().slice(0, 10);
    if (origDate === dayIso) return;

    const newStart = new Date(dayIso + "T00:00:00");
    if (!evt.allDay) {
      const origHour = new Date(evt.startTs).getHours();
      const origMin = new Date(evt.startTs).getMinutes();
      newStart.setHours(origHour, origMin, 0, 0);
    }
    const newStartTs = newStart.getTime();
    const newEndTs = newStartTs + duration;

    rescheduleCalendarEvent(localStore, eventId, newStartTs, newEndTs);

    if (isTauri() && evt.externalId) {
      updateCalendarEvent({
        accountId: evt.accountId,
        externalId: evt.externalId,
        startTs: newStartTs,
        endTs: newEndTs,
        allDay: evt.allDay,
      }).catch((err) => {
        toast.error(`Failed to reschedule: ${err}`);
        rescheduleCalendarEvent(localStore, eventId, evt.startTs, evt.endTs);
      });
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Weekday header */}
      <div className="grid grid-cols-7 shrink-0 border-b border-border-subtle">
        {DAY_LABELS.map((d) => (
          <div key={d} className="py-1 text-center font-mono text-mono-xs text-text-muted uppercase">
            {d}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 flex-1 overflow-y-auto">
        {cells.map((iso) => {
          const dayEvents = eventsByDate.get(iso) ?? [];
          const overflow = dayEvents.length - MAX_VISIBLE;
          const isToday = iso === today;
          const isFocus = iso === focusDate;
          const inMonth = iso.slice(0, 7) === currentMonth;

          return (
            <div
              key={iso}
              className={cn(
                "min-h-[80px] border-b border-r border-border-subtle p-1 transition-colors",
                dragOverDay === iso && "bg-accent/5",
                !inMonth && "opacity-40",
              )}
              onDragOver={(e) => { e.preventDefault(); setDragOverDay(iso); }}
              onDragLeave={() => setDragOverDay(null)}
              onDrop={(e) => handleDrop(e, iso)}
            >
              {/* Day number */}
              <button
                type="button"
                onClick={() => onSelectDate(iso)}
                className={cn(
                  "ml-auto flex h-5 w-5 items-center justify-center rounded-full font-mono text-mono-xs transition-colors",
                  isToday ? "bg-accent text-white" : isFocus ? "ring-1 ring-accent text-accent" : "text-text-secondary hover:bg-surface-2",
                )}
              >
                {parseInt(iso.slice(8), 10)}
              </button>

              {/* Event pills */}
              <div className="mt-0.5 space-y-0.5">
                {dayEvents.slice(0, MAX_VISIBLE).map((evt) => (
                  <EventDetailPopover key={evt.id} event={evt}>
                    <div
                      draggable={!evt.recurringEventId}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("eventId", evt.id);
                        e.dataTransfer.setData("offsetMin", "0");
                      }}
                      className="rounded-xs px-1 text-caption text-white truncate cursor-pointer hover:brightness-110"
                      style={{ backgroundColor: eventColor(evt.colorId) }}
                    >
                      {evt.allDay ? (
                        evt.title
                      ) : (
                        <>
                          <span className="opacity-75">
                            {new Date(evt.startTs).toLocaleTimeString("default", { hour: "numeric", minute: "2-digit" })}
                          </span>{" "}
                          {evt.title}
                        </>
                      )}
                    </div>
                  </EventDetailPopover>
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    className="w-full text-left px-1 text-caption text-text-muted hover:text-accent transition-colors"
                    onClick={() => onSelectDate(iso)}
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
