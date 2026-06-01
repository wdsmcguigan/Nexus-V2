import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createCalendarEvent } from "@/storage/tauri";
import * as Mut from "@/state/mutations";
import { localStore } from "@/storage/local";
import { useEventTemplates, useCalendars } from "@/storage/useStore";
import { toast } from "sonner";
import type { EventTemplate } from "@/data/types";
import { resolveSyncTarget, defaultWritableCalendar } from "@/lib/calendars";
import { getAppPreferences, saveAppPreferences } from "@/lib/appPreferences";
import { EventFormFields, type EventFormState } from "./event-form/EventFormFields";

interface Props {
  open: boolean;
  onClose: () => void;
  prefillDate?: string;
  prefillAttendees?: string[];
  prefillTitle?: string;
}

function toLocalDatetimeValue(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDatetimeToTs(value: string): number {
  return new Date(value).getTime();
}

function initialState(
  prefillDate: string | undefined,
  prefillAttendees: string[] | undefined,
  prefillTitle: string | undefined,
  calendarLocalId: string,
): EventFormState {
  const ts = prefillDate
    ? new Date(prefillDate + "T09:00").getTime()
    : Math.ceil(Date.now() / 3_600_000) * 3_600_000;
  const today = prefillDate ?? new Date().toISOString().slice(0, 10);
  return {
    title: prefillTitle ?? "",
    allDay: false,
    startVal: toLocalDatetimeValue(ts),
    endVal: toLocalDatetimeValue(ts + 3_600_000),
    startDate: today,
    endDate: today,
    calendarLocalId,
    location: "",
    description: "",
    attendees: prefillAttendees ?? [],
    notes: "",
    conferenceUrl: "",
    colorId: undefined,
    visibility: "default",
    transparency: "opaque",
    reminders: [],
  };
}

function formReducer(s: EventFormState, patch: Partial<EventFormState>): EventFormState {
  return { ...s, ...patch };
}

export function EventCreateModal({ open, onClose, prefillDate, prefillAttendees, prefillTitle }: Props) {
  const templates = useEventTemplates();
  const calendars = useCalendars();

  const initialCalId = React.useMemo(() => {
    if (calendars.length === 0) return "local-default";
    return defaultWritableCalendar(calendars, getAppPreferences().lastUsedCalendarLocalId).id;
  // The default needs to be recomputed whenever the modal opens, but the
  // calendar list itself rarely changes — list identity is the trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendars]);

  const [state, dispatch] = React.useReducer(
    formReducer,
    null,
    () => initialState(prefillDate, prefillAttendees, prefillTitle, initialCalId),
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = React.useState(false);

  // Reset on (re-)open: this is intentional — clicking "New event" twice
  // should not preserve half-typed state from a closed modal.
  React.useEffect(() => {
    if (!open) return;
    const cid = calendars.length === 0
      ? "local-default"
      : defaultWritableCalendar(calendars, getAppPreferences().lastUsedCalendarLocalId).id;
    dispatch(initialState(prefillDate, prefillAttendees, prefillTitle, cid));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillTitle, prefillAttendees, prefillDate]);

  function applyTemplate(tmpl: EventTemplate) {
    const currentStart = localDatetimeToTs(state.startVal);
    dispatch({
      title: tmpl.title,
      description: tmpl.description ?? "",
      location: tmpl.location ?? "",
      endVal: toLocalDatetimeValue(currentStart + tmpl.durationMinutes * 60_000),
      attendees: tmpl.defaultAttendees.length > 0 ? tmpl.defaultAttendees : state.attendees,
    });
    setTemplateMenuOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!state.title.trim()) { toast.error("Title is required"); return; }

    const startTs = state.allDay
      ? new Date(state.startDate + "T00:00:00").getTime()
      : localDatetimeToTs(state.startVal);
    const endTs = state.allDay
      ? new Date(state.endDate + "T00:00:00").getTime()
      : localDatetimeToTs(state.endVal);
    // Sync routing is driven by the target calendar's provider (EP-14): the modal
    // pushes to Google only when the user chose a Google-backed calendar.
    const selectedCalendar = calendars.find((c) => c.id === state.calendarLocalId);
    const target = resolveSyncTarget(selectedCalendar);
    const vaultId = selectedCalendar?.vaultId ?? localStore.vault?.id ?? "local";
    const tzid = state.allDay ? undefined : Intl.DateTimeFormat().resolvedOptions().timeZone;

    setSubmitting(true);
    try {
      // Google branch: try the push; preserve the graceful-fallback from
      // commit e088ea3 so 403 / offline / API errors still produce the local
      // event with a warning toast.
      let eventId: string;
      let externalId: string | undefined;
      let syncWarning: string | undefined;
      if (target.kind === "google") {
        try {
          eventId = await createCalendarEvent({
            accountId: target.accountId,
            title: state.title.trim(),
            startTs,
            endTs,
            allDay: state.allDay,
            location: state.location.trim() || undefined,
            description: state.description.trim() || undefined,
            attendeeEmails: state.attendees,
            timeZone: tzid,
          });
          externalId = eventId;
        } catch (err) {
          eventId = crypto.randomUUID();
          const msg = err instanceof Error ? err.message : String(err);
          syncWarning = msg.includes("403")
            ? "Saved locally — reconnect Gmail to enable Google Calendar sync"
            : `Saved locally — Google sync failed: ${msg}`;
        }
      } else {
        eventId = crypto.randomUUID();
      }
      Mut.recordMutation("UPSERT_CALENDAR_EVENT", {
        event: {
          id: eventId,
          vaultId,
          accountId: selectedCalendar?.accountId ?? "local",
          calendarId: target.kind === "google" ? target.externalCalendarId : "primary",
          calendarLocalId: state.calendarLocalId,
          externalId,
          title: state.title.trim(),
          startTs,
          endTs,
          allDay: state.allDay,
          startTzid: tzid,
          endTzid: tzid,
          location: state.location.trim() || undefined,
          description: state.description.trim() || undefined,
          notes: state.notes.trim() || undefined,
          conferenceUrl: state.conferenceUrl.trim() || undefined,
          colorId: state.colorId,
          visibility: state.visibility === "default" ? undefined : state.visibility,
          transparency: state.transparency === "opaque" ? undefined : state.transparency,
          reminders: state.reminders.length > 0 ? state.reminders : undefined,
          status: "confirmed",
          attendees: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      saveAppPreferences({ lastUsedCalendarLocalId: state.calendarLocalId });
      if (syncWarning) {
        toast.warning(syncWarning);
      } else {
        toast.success("Event created");
      }
      onClose();
    } catch (err) {
      toast.error(`Failed to create event: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[560px] max-h-[85vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface-2 shadow-l4 focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <form onSubmit={handleSubmit}>
            <div className="px-5 pb-5 pt-4">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="text-body-strong text-text-primary">New event</Dialog.Title>
                <Dialog.Close asChild>
                  <Button variant="ghost" size="sm" iconOnly aria-label="Close">
                    <X size={14} />
                  </Button>
                </Dialog.Close>
              </div>

              {templates.length > 0 && (
                <div className="relative mb-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setTemplateMenuOpen((v) => !v)}
                  >
                    Use template
                    <ChevronDown size={12} />
                  </Button>
                  {templateMenuOpen && (
                    <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-sm border border-border-default bg-surface-2 shadow-l2 py-1">
                      {templates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className="w-full px-3 py-2 text-left text-small text-text-primary hover:bg-surface-3"
                          onClick={() => applyTemplate(t)}
                        >
                          <div className="truncate font-medium">{t.name}</div>
                          <div className="truncate text-caption text-text-tertiary">
                            {t.title || "(no title)"} · {t.durationMinutes} min
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

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
                  {submitting ? "Creating…" : "Create event"}
                </Button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
