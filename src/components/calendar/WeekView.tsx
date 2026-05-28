import * as React from "react";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/data/types";
import { eventColor } from "@/lib/calendarColors";
import { EventDetailPopover } from "./EventDetailPopover";
import { generateWeekDays, minutesFromMidnight } from "@/lib/calendarUtils";
import { localStore } from "@/storage/local";
import { rescheduleCalendarEvent } from "@/state/mutations";
import { isTauri, updateCalendarEvent } from "@/storage/tauri";
import { toast } from "sonner";

interface Props {
  events: CalendarEvent[];
  focusDate: string;
  mondayIso: string;
}

const HOUR_HEIGHT = 56; // px per hour
const TOTAL_HEIGHT = HOUR_HEIGHT * 24;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface LayoutEvent extends CalendarEvent {
  col: number;
  cols: number;
}

function layoutDayEvents(events: CalendarEvent[]): LayoutEvent[] {
  const sorted = [...events].sort((a, b) => a.startTs - b.startTs);
  const colEnds: number[] = [];
  const withCols = sorted.map((evt) => {
    const ci = colEnds.findIndex((end) => end <= evt.startTs);
    const col = ci === -1 ? colEnds.length : ci;
    colEnds[col] = evt.endTs;
    return { ...evt, col, cols: 1 };
  });
  // second pass: compute cols = max simultaneous
  return withCols.map((evt) => {
    const concurrent = withCols.filter(
      (e) => e.startTs < evt.endTs && e.endTs > evt.startTs,
    );
    return { ...evt, cols: Math.max(...concurrent.map((e) => e.col + 1)) };
  });
}

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

export function WeekView({ events, focusDate, mondayIso }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const days = generateWeekDays(mondayIso);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [dragOverSlot, setDragOverSlot] = React.useState<{ day: string; hour: number } | null>(null);

  // Scroll to 8am on mount
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 8 * HOUR_HEIGHT - 16;
    }
  }, [mondayIso]);

  // Group events by day, separating all-day
  const allDayByDay = React.useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (!e.allDay) continue;
      const iso = new Date(e.startTs).toISOString().slice(0, 10);
      if (!map.has(iso)) map.set(iso, []);
      map.get(iso)!.push(e);
    }
    return map;
  }, [events]);

  const timedByDay = React.useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const iso of days) map.set(iso, []);
    for (const e of events) {
      if (e.allDay) continue;
      const iso = new Date(e.startTs).toISOString().slice(0, 10);
      if (map.has(iso)) map.get(iso)!.push(e);
    }
    const result = new Map<string, LayoutEvent[]>();
    for (const [iso, evts] of map) {
      result.set(iso, layoutDayEvents(evts));
    }
    return result;
  }, [events, days]);

  function handleDrop(e: React.DragEvent, dayIso: string, slotHour: number) {
    e.preventDefault();
    setDragOverSlot(null);
    const eventId = e.dataTransfer.getData("eventId");
    const offsetMin = parseInt(e.dataTransfer.getData("offsetMin"), 10) || 0;
    const evt = localStore.calendarEvents.get(eventId);
    if (!evt) return;

    const duration = evt.endTs - evt.startTs;
    const newStart = new Date(dayIso + "T00:00:00");
    newStart.setHours(slotHour, 0, 0, 0);
    newStart.setMinutes(newStart.getMinutes() - offsetMin);
    const newStartTs = newStart.getTime();
    const newEndTs = newStartTs + duration;

    rescheduleCalendarEvent(localStore, eventId, newStartTs, newEndTs);

    if (isTauri() && evt.externalId) {
      updateCalendarEvent({
        accountId: evt.accountId,
        externalId: evt.externalId,
        startTs: newStartTs,
        endTs: newEndTs,
        allDay: false,
      }).catch((err) => {
        toast.error(`Failed to reschedule: ${err}`);
        rescheduleCalendarEvent(localStore, eventId, evt.startTs, evt.endTs);
      });
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Day header */}
      <div className="flex shrink-0 border-b border-border-subtle">
        <div className="w-10 shrink-0" />
        {days.map((iso, i) => {
          const d = new Date(iso + "T00:00:00");
          const dayNum = d.getDate();
          const isToday = iso === today;
          const isFocus = iso === focusDate;
          return (
            <div key={iso} className="flex-1 border-l border-border-subtle py-1 text-center">
              <div className="font-mono text-mono-xs text-text-muted uppercase">{DAY_LABELS[i]}</div>
              <div className={cn(
                "mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full font-mono text-mono-sm",
                isToday ? "bg-accent text-white" : isFocus ? "ring-1 ring-accent text-accent" : "text-text-secondary",
              )}>
                {dayNum}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day row */}
      {days.some((iso) => (allDayByDay.get(iso)?.length ?? 0) > 0) && (
        <div className="flex shrink-0 border-b border-border-subtle min-h-[28px]">
          <div className="w-10 shrink-0 flex items-center justify-end pr-1">
            <span className="font-mono text-mono-xs text-text-muted">all day</span>
          </div>
          {days.map((iso) => {
            const dayEvents = allDayByDay.get(iso) ?? [];
            return (
              <div key={iso} className="flex-1 border-l border-border-subtle px-0.5 py-0.5 space-y-0.5">
                {dayEvents.map((e) => (
                  <EventDetailPopover key={e.id} event={e}>
                    <div
                      className="rounded-xs px-1 text-caption text-white truncate cursor-pointer"
                      style={{ backgroundColor: eventColor(e.colorId) }}
                    >
                      {e.title}
                    </div>
                  </EventDetailPopover>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex flex-1 overflow-y-auto">
        {/* Time gutter */}
        <div className="w-10 shrink-0 relative" style={{ height: TOTAL_HEIGHT }}>
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute right-1 font-mono text-mono-xs text-text-muted"
              style={{ top: h * HOUR_HEIGHT - 7, lineHeight: "14px" }}
            >
              {h > 0 && formatHour(h)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((iso) => {
          const dayEvents = timedByDay.get(iso) ?? [];
          return (
            <div
              key={iso}
              className="flex-1 relative border-l border-border-subtle"
              style={{ height: TOTAL_HEIGHT }}
            >
              {/* Hour grid lines + drop zones */}
              {HOURS.map((h) => (
                <div
                  key={h}
                  className={cn(
                    "absolute left-0 right-0 border-t border-border-subtle",
                    dragOverSlot?.day === iso && dragOverSlot.hour === h && "bg-accent/10",
                  )}
                  style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverSlot({ day: iso, hour: h }); }}
                  onDragLeave={() => setDragOverSlot(null)}
                  onDrop={(e) => handleDrop(e, iso, h)}
                />
              ))}

              {/* Current time indicator */}
              {iso === today && (() => {
                const now = new Date();
                const minNow = now.getHours() * 60 + now.getMinutes();
                const top = (minNow / (24 * 60)) * TOTAL_HEIGHT;
                return (
                  <div
                    className="absolute left-0 right-0 z-10 border-t-2 border-accent"
                    style={{ top }}
                  >
                    <div className="absolute -left-1 -top-1.5 h-3 w-3 rounded-full bg-accent" />
                  </div>
                );
              })()}

              {/* Event chips */}
              {dayEvents.map((evt) => {
                const startMin = minutesFromMidnight(evt.startTs, iso);
                const durationMin = Math.max((evt.endTs - evt.startTs) / 60_000, 15);
                const top = (startMin / (24 * 60)) * TOTAL_HEIGHT;
                const height = Math.max((durationMin / 60) * HOUR_HEIGHT, 18);
                const leftPct = (evt.col / evt.cols) * 100;
                const widthPct = (1 / evt.cols) * 100;
                const isCancelled = evt.status === "cancelled";

                return (
                  <EventDetailPopover key={evt.id} event={evt}>
                    <div
                      draggable={!evt.recurringEventId}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("eventId", evt.id);
                        e.dataTransfer.setData("offsetMin", String(startMin % 60));
                      }}
                      className={cn(
                        "absolute z-20 rounded-xs px-1 py-0.5 cursor-pointer overflow-hidden",
                        isCancelled ? "opacity-40" : "hover:brightness-110",
                      )}
                      style={{
                        top,
                        height,
                        left: `${leftPct}%`,
                        width: `calc(${widthPct}% - 2px)`,
                        backgroundColor: eventColor(evt.colorId),
                        color: "#fff",
                      }}
                    >
                      <div className="font-sans text-caption font-semibold leading-tight truncate">
                        {evt.title}
                      </div>
                      {height > 32 && evt.location && (
                        <div className="font-sans text-caption opacity-80 truncate">{evt.location}</div>
                      )}
                    </div>
                  </EventDetailPopover>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
