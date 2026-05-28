import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { MapPin, Users, ExternalLink, Clock, Pencil, Mail, Video, Paperclip, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/data/types";
import { ContactHoverCard } from "@/components/contacts/ContactHoverCard";
import { EventEditModal } from "./EventEditModal";
import * as Mut from "@/state/mutations";
import { useWorkspace } from "@/state/workspace";
import { formatAllDayDate } from "@/lib/calendarUtils";

interface Props {
  event: CalendarEvent;
  children: React.ReactNode;
}

function formatDateRange(e: CalendarEvent): string {
  if (e.allDay) {
    // All-day events are floating — format by UTC date components so the day
    // does not shift with the viewer's timezone (EP-14 Phase 1).
    return formatAllDayDate(e.startTs);
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
  const [editOpen, setEditOpen] = React.useState(false);
  const [notes, setNotes] = React.useState(event.notes ?? "");
  const setSelectedEmail = useWorkspace((s) => s.setSelectedEmail);

  React.useEffect(() => { setNotes(event.notes ?? ""); }, [event.id, event.notes]);

  function handleNotesBlur() {
    if (notes !== (event.notes ?? "")) {
      Mut.recordMutation("UPDATE_CALENDAR_EVENT_NOTES", { id: event.id, notes: notes || undefined });
    }
  }

  const isPrivate = event.visibility === "private" || event.visibility === "confidential";

  return (
    <>
      <Popover.Root>
        <Popover.Trigger asChild>{children}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="right"
            align="start"
            sideOffset={8}
            className={cn(
              "z-50 w-80 rounded-lg border border-border-subtle bg-surface-2 shadow-xl p-3",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            )}
          >
            {/* Title row */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-1.5 font-sans text-body-strong text-text-primary leading-snug min-w-0">
                {isPrivate && <span title="Private"><Lock size={11} className="mt-0.5 shrink-0 text-text-muted" /></span>}
                <span className="truncate">{event.title}</span>
              </div>
              {event.externalId && (
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="shrink-0 rounded-xs p-0.5 text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors"
                  title="Edit event"
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>

            {/* Date/time */}
            <div className="mt-1.5 flex items-start gap-1.5 text-small text-text-secondary">
              <Clock size={12} className="mt-0.5 shrink-0 text-text-tertiary" />
              <span>{formatDateRange(event)}</span>
            </div>

            {/* Join meeting button */}
            {event.conferenceUrl && (
              <a
                href={event.conferenceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1.5 text-small font-medium text-accent hover:underline"
              >
                <Video size={12} />
                Join meeting
              </a>
            )}

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

            {/* Drive attachments */}
            {!!event.attachments?.length && (
              <div className="mt-1.5 space-y-0.5">
                {event.attachments.map((att) => (
                  <a
                    key={att.fileId ?? att.fileUrl}
                    href={att.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-caption text-text-secondary hover:text-accent transition-colors"
                  >
                    <Paperclip size={11} className="shrink-0 text-text-tertiary" />
                    <span className="truncate">{att.title}</span>
                  </a>
                ))}
              </div>
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
                      <ContactHoverCard key={a.email} email={a.email} name={a.name ?? a.email}>
                        <div className="flex items-center gap-1.5 text-caption cursor-default">
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
                      </ContactHoverCard>
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

            {/* Creator (when different from organizer) */}
            {event.creatorEmail && event.creatorEmail !== event.organizerEmail && (
              <div className="mt-1 text-caption text-text-muted">
                Created by {event.creatorEmail}
              </div>
            )}

            {/* Notes */}
            <div className="mt-2 border-t border-border-subtle pt-2">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={handleNotesBlur}
                placeholder="Add private notes…"
                rows={2}
                className="w-full resize-none rounded-xs border border-transparent bg-surface-1 px-2 py-1 text-small text-text-secondary placeholder:text-text-muted focus:border-accent focus:outline-none hover:border-border-default transition-colors"
              />
            </div>

            {/* Footer */}
            <div className="mt-2 border-t border-border-subtle pt-2 flex flex-wrap gap-x-3 gap-y-1">
              {event.htmlLink && (
                <a
                  href={event.htmlLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-accent transition-colors"
                >
                  <ExternalLink size={11} />
                  Open in Google Calendar
                </a>
              )}
              {event.sourceMessageId && (
                <button
                  type="button"
                  onClick={() => setSelectedEmail(event.sourceMessageId!)}
                  className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-accent transition-colors"
                >
                  <Mail size={11} />
                  View source email
                </button>
              )}
            </div>

            <Popover.Arrow className="fill-border-subtle" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <EventEditModal event={editOpen ? event : null} onClose={() => setEditOpen(false)} />
    </>
  );
}
