import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { updateCalendarEvent } from "@/storage/tauri";
import * as Mut from "@/state/mutations";
import { useCalendars } from "@/storage/useStore";
import type { CalendarEvent } from "@/data/types";
import { toast } from "sonner";
import { resolveSyncTarget } from "@/lib/calendars";
import { EventFormFields, type EventFormState } from "./event-form/EventFormFields";

interface Props {
  event: CalendarEvent | null;
  onClose: () => void;
}

function toLocalDatetimeValue(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalDateValue(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function localDatetimeToTs(value: string): number {
  return new Date(value).getTime();
}

function stateFromEvent(event: CalendarEvent): EventFormState {
  return {
    title: event.title,
    allDay: event.allDay,
    startVal: toLocalDatetimeValue(event.startTs),
    endVal: toLocalDatetimeValue(event.endTs),
    startDate: toLocalDateValue(event.startTs),
    endDate: toLocalDateValue(event.endTs),
    calendarLocalId: event.calendarLocalId ?? "local-default",
    location: event.location ?? "",
    description: event.description ?? "",
    attendees: event.attendees.map((a) => a.email),
    notes: event.notes ?? "",
    conferenceUrl: event.conferenceUrl ?? "",
    colorId: event.colorId,
    visibility: event.visibility ?? "default",
    transparency: event.transparency ?? "opaque",
    reminders: event.reminders ?? [],
  };
}

function formReducer(s: EventFormState, patch: Partial<EventFormState>): EventFormState {
  return { ...s, ...patch };
}

function emptyState(): EventFormState {
  return {
    title: "",
    allDay: false,
    startVal: "",
    endVal: "",
    startDate: "",
    endDate: "",
    calendarLocalId: "local-default",
    location: "",
    description: "",
    attendees: [],
    notes: "",
    conferenceUrl: "",
    colorId: undefined,
    visibility: "default",
    transparency: "opaque",
    reminders: [],
  };
}

export function EventEditModal({ event, onClose }: Props) {
  const calendars = useCalendars();
  const [state, dispatch] = React.useReducer(
    formReducer,
    null,
    () => (event ? stateFromEvent(event) : emptyState()),
  );
  const [submitting, setSubmitting] = React.useState(false);

  // Re-derive state when the user opens the modal on a different event.
  React.useEffect(() => {
    if (event) dispatch(stateFromEvent(event));
  }, [event?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!event) return;
    if (!state.title.trim()) { toast.error("Title is required"); return; }

    const startTs = state.allDay
      ? new Date(state.startDate + "T00:00:00").getTime()
      : localDatetimeToTs(state.startVal);
    const endTs = state.allDay
      ? new Date(state.endDate + "T00:00:00").getTime()
      : localDatetimeToTs(state.endVal);
    const tzid = state.allDay ? undefined : Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Provider-driven sync (EP-14): push the update to Google only when the
    // event currently has an externalId AND the selected calendar is Google.
    // Cross-provider moves don't push to Google in this PR.
    const selectedCalendar = calendars.find((c) => c.id === state.calendarLocalId);
    const target = resolveSyncTarget(selectedCalendar);

    setSubmitting(true);
    let syncWarning: string | undefined;
    try {
      if (target.kind === "google" && event.externalId) {
        try {
          await updateCalendarEvent({
            accountId: target.accountId,
            externalId: event.externalId,
            title: state.title.trim(),
            startTs,
            endTs,
            allDay: state.allDay,
            location: state.location.trim() || undefined,
            description: state.description.trim() || undefined,
            attendeeEmails: state.attendees,
            timeZone: tzid,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          syncWarning = msg.includes("403")
            ? "Saved locally — reconnect Gmail to enable Google Calendar sync"
            : `Saved locally — Google sync failed: ${msg}`;
        }
      }
      Mut.recordMutation("UPSERT_CALENDAR_EVENT", {
        event: {
          ...event,
          title: state.title.trim(),
          startTs,
          endTs,
          allDay: state.allDay,
          startTzid: tzid,
          endTzid: tzid,
          calendarLocalId: state.calendarLocalId,
          location: state.location.trim() || undefined,
          description: state.description.trim() || undefined,
          notes: state.notes.trim() || undefined,
          conferenceUrl: state.conferenceUrl.trim() || undefined,
          colorId: state.colorId,
          visibility: state.visibility === "default" ? undefined : state.visibility,
          transparency: state.transparency === "opaque" ? undefined : state.transparency,
          reminders: state.reminders.length > 0 ? state.reminders : undefined,
          updatedAt: Date.now(),
        },
      });
      if (syncWarning) {
        toast.warning(syncWarning);
      } else {
        toast.success("Event updated");
      }
      onClose();
    } catch (err) {
      toast.error(`Failed to update event: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={!!event} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[560px] max-h-[85vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface-2 shadow-l4 focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <form onSubmit={handleSubmit}>
            <div className="px-5 pb-5 pt-4">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="text-body-strong text-text-primary">Edit event</Dialog.Title>
                <Dialog.Close asChild>
                  <Button variant="ghost" size="sm" iconOnly aria-label="Close">
                    <X size={14} />
                  </Button>
                </Dialog.Close>
              </div>

              <EventFormFields
                value={state}
                onChange={(patch) => dispatch(patch)}
                calendars={calendars}
              />

              <div className="mt-5 flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button variant="secondary" size="sm">Cancel</Button>
                </Dialog.Close>
                <Button type="submit" variant="primary" size="sm" disabled={submitting}>
                  {submitting ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
