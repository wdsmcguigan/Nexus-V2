import * as React from "react";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/data/types";
import { eventColor } from "@/lib/calendarColors";
import { EventHoverCard } from "./EventHoverCard";
import { EventDetailPopover } from "./EventDetailPopover";

interface Props {
  events: CalendarEvent[];
  focusDate: string;
}

function formatDayLabel(iso: string, today: string): string {
  if (iso === today) return "Today";
  const todayDate = new Date(today + "T00:00:00");
  const d = new Date(iso + "T00:00:00");
  const diff = Math.round((d.getTime() - todayDate.getTime()) / 86_400_000);
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString("default", { weekday: "short", month: "short", day: "numeric" });
}

function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) return "All day";
  return new Date(event.startTs).toLocaleTimeString("default", { hour: "numeric", minute: "2-digit" });
}

function eventIsoDate(event: CalendarEvent): string {
  return new Date(event.startTs).toISOString().slice(0, 10);
}

interface EventRowProps {
  event: CalendarEvent;
}

function EventRow({ event }: EventRowProps) {
  const isCancelled = event.status === "cancelled";

  return (
    <EventDetailPopover event={event}>
      <EventHoverCard event={event}>
        <button
          type="button"
          className={cn(
            "w-full flex items-start gap-2 rounded-xs px-2 py-1 text-left transition-colors",
            isCancelled
              ? "opacity-40"
              : "hover:bg-surface-2",
          )}
        >
          <span
            className="mt-0.5 shrink-0 text-caption text-text-muted"
            style={event.allDay ? undefined : { color: eventColor(event.colorId) }}
          >
            {event.allDay ? "○" : "●"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className={cn(
                "font-mono text-mono-xs text-text-tertiary shrink-0 w-12",
              )}>
                {formatEventTime(event)}
              </span>
              <span className={cn(
                "font-sans text-small text-text-primary truncate",
                isCancelled && "line-through",
              )}>
                {event.title}
              </span>
            </div>
            {event.location && (
              <p className="mt-0.5 ml-14 font-sans text-caption text-text-muted truncate">
                {event.location}
              </p>
            )}
          </div>
        </button>
      </EventHoverCard>
    </EventDetailPopover>
  );
}

export function AgendaView({ events, focusDate }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const focusRef = React.useRef<HTMLDivElement>(null);

  // Group events by ISO date, skipping cancelled ones that have no remaining info
  const groups = React.useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const iso = eventIsoDate(e);
      if (!map.has(iso)) map.set(iso, []);
      map.get(iso)!.push(e);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([, evts]) => evts.some(e => e.status !== "cancelled") || evts.length > 0);
  }, [events]);

  // Scroll to focus date section when focusDate changes
  React.useEffect(() => {
    focusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusDate]);

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted">
        <p className="font-sans text-small">No upcoming events</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1 px-2 py-1">
      {groups.map(([iso, dayEvents]) => {
        const isFocusDay = iso === focusDate;
        return (
          <div key={iso} ref={isFocusDay ? focusRef : undefined} className="mb-3">
            <div className={cn(
              "mb-1 px-2 font-sans text-caption font-semibold uppercase tracking-wide",
              iso === today ? "text-accent" : "text-text-muted",
            )}>
              {formatDayLabel(iso, today)}
            </div>
            <div className="space-y-0.5">
              {dayEvents.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
