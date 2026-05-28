import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { MapPin, Users, ExternalLink, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/data/types";

interface Props {
  event: CalendarEvent;
  children: React.ReactNode;
}

function formatDateRange(e: CalendarEvent): string {
  if (e.allDay) {
    return new Date(e.startTs).toLocaleDateString("default", {
      weekday: "short", month: "short", day: "numeric",
    });
  }
  const start = new Date(e.startTs);
  const end = new Date(e.endTs);
  const date = start.toLocaleDateString("default", { weekday: "short", month: "short", day: "numeric" });
  const startTime = start.toLocaleTimeString("default", { hour: "numeric", minute: "2-digit" });
  const endTime = end.toLocaleTimeString("default", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${startTime} – ${endTime}`;
}

const RSVP_ICONS: Record<string, { icon: string; cls: string }> = {
  accepted:    { icon: "✓", cls: "text-success" },
  declined:    { icon: "✗", cls: "text-danger" },
  tentative:   { icon: "?", cls: "text-amber-500" },
  needsAction: { icon: "⏳", cls: "text-text-muted" },
};

export function EventDetailPopover({ event, children }: Props) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={8}
          className={cn(
            "z-50 w-72 rounded-lg border border-border-subtle bg-surface-2 shadow-xl p-3",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          {/* Title */}
          <div className="font-sans text-body-strong text-text-primary leading-snug">
            {event.title}
          </div>

          {/* Date/time */}
          <div className="mt-1.5 flex items-start gap-1.5 text-small text-text-secondary">
            <Clock size={12} className="mt-0.5 shrink-0 text-text-tertiary" />
            <span>{formatDateRange(event)}</span>
          </div>

          {/* Location */}
          {event.location && (
            <div className="mt-1 flex items-start gap-1.5 text-small text-text-secondary">
              <MapPin size={12} className="mt-0.5 shrink-0 text-text-tertiary" />
              <span className="line-clamp-2">{event.location}</span>
            </div>
          )}

          {/* Description */}
          {event.description && (
            <p className="mt-1.5 text-small text-text-tertiary line-clamp-3">
              {event.description}
            </p>
          )}

          {/* Attendees */}
          {event.attendees.length > 0 && (
            <div className="mt-2 border-t border-border-subtle pt-2">
              <div className="mb-1 flex items-center gap-1 text-caption text-text-tertiary">
                <Users size={11} />
                <span>{event.attendees.length} attendee{event.attendees.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="space-y-0.5">
                {event.attendees.slice(0, 5).map((a) => {
                  const rsvp = RSVP_ICONS[a.responseStatus] ?? RSVP_ICONS["needsAction"]!;
                  return (
                    <div key={a.email} className="flex items-center gap-1.5 text-caption">
                      <span className={cn("w-3 shrink-0 text-center font-mono text-mono-xs", rsvp.cls)}>
                        {rsvp.icon}
                      </span>
                      <span className="truncate text-text-secondary">
                        {a.name ?? a.email}
                      </span>
                      {a.organizer && (
                        <span className="shrink-0 text-text-muted">(organizer)</span>
                      )}
                    </div>
                  );
                })}
                {event.attendees.length > 5 && (
                  <div className="text-caption text-text-muted">
                    +{event.attendees.length - 5} more
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          {event.htmlLink && (
            <div className="mt-2 border-t border-border-subtle pt-2">
              <a
                href={event.htmlLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-accent transition-colors"
              >
                <ExternalLink size={11} />
                Open in Google Calendar
              </a>
            </div>
          )}
          <Popover.Arrow className="fill-border-subtle" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
