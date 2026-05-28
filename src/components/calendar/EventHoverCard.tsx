import * as React from "react";
import * as HoverCard from "@radix-ui/react-hover-card";
import { Clock, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/data/types";

interface Props {
  event: CalendarEvent;
  children: React.ReactNode;
}

function formatTime(e: CalendarEvent): string {
  if (e.allDay) return "All day";
  const start = new Date(e.startTs).toLocaleTimeString("default", { hour: "numeric", minute: "2-digit" });
  const end = new Date(e.endTs).toLocaleTimeString("default", { hour: "numeric", minute: "2-digit" });
  return `${start} – ${end}`;
}

const RSVP_LABEL: Record<string, { label: string; cls: string }> = {
  accepted:    { label: "You accepted",      cls: "text-success" },
  declined:    { label: "You declined",      cls: "text-danger" },
  tentative:   { label: "Tentative",         cls: "text-amber-500" },
  needsAction: { label: "Awaiting response", cls: "text-text-muted" },
};

export function EventHoverCard({ event, children }: Props) {
  const selfAttendee = event.attendees.find((a) => a.self);
  const rsvp = selfAttendee ? (RSVP_LABEL[selfAttendee.responseStatus] ?? null) : null;

  return (
    <HoverCard.Root openDelay={400} closeDelay={200}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="right"
          align="start"
          sideOffset={8}
          className={cn(
            "z-50 w-64 rounded-lg border border-border-subtle bg-surface-2 shadow-xl p-3",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          <div className="font-sans text-body-strong text-text-primary leading-snug line-clamp-2">
            {event.title}
          </div>

          <div className="mt-1.5 flex items-center gap-1.5 text-small text-text-secondary">
            <Clock size={11} className="shrink-0 text-text-tertiary" />
            <span>{formatTime(event)}</span>
          </div>

          {event.location && (
            <div className="mt-0.5 flex items-center gap-1.5 text-small text-text-secondary">
              <MapPin size={11} className="shrink-0 text-text-tertiary" />
              <span className="truncate">{event.location}</span>
            </div>
          )}

          {rsvp && (
            <div className={cn("mt-2 text-caption", rsvp.cls)}>
              {rsvp.label}
            </div>
          )}

          {event.attendees.length > 0 && (
            <div className="mt-1 text-caption text-text-muted">
              {event.attendees.length} attendee{event.attendees.length !== 1 ? "s" : ""}
            </div>
          )}

          <HoverCard.Arrow className="fill-border-subtle" />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
