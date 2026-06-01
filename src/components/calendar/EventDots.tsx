import type { CalendarEvent } from "@/data/types";
import { eventColor } from "@/lib/calendarColors";

interface Props {
  events: CalendarEvent[];
  /** Maximum dots before we collapse the tail into a `+N` chip. Default 6. */
  max?: number;
}

/**
 * Small horizontal strip of colored dots, one per event. Used by AgendaView
 * to give each date header a quick at-a-glance density indicator that matches
 * the MiniMonth sidebar style.
 */
export function EventDots({ events, max = 6 }: Props) {
  if (events.length === 0) return null;
  const visible = events.slice(0, max);
  const overflow = events.length - visible.length;
  return (
    <span className="ml-2 inline-flex items-center gap-0.5 align-middle">
      {visible.map((e) => (
        <span
          key={e.id}
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: eventColor(e.colorId) }}
          title={e.title}
        />
      ))}
      {overflow > 0 && (
        <span className="ml-0.5 text-caption text-text-muted">+{overflow}</span>
      )}
    </span>
  );
}
