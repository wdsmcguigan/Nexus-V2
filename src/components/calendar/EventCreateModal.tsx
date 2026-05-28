import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createCalendarEvent } from "@/storage/tauri";
import * as Mut from "@/state/mutations";
import { localStore } from "@/storage/local";
import { toast } from "sonner";

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

export function EventCreateModal({ open, onClose, prefillDate, prefillAttendees, prefillTitle }: Props) {
  const now = Date.now();
  const defaultStart = prefillDate
    ? new Date(prefillDate + "T09:00").getTime()
    : Math.ceil(now / 3_600_000) * 3_600_000;
  const defaultEnd = defaultStart + 3_600_000;

  const [title, setTitle] = React.useState(prefillTitle ?? "");
  const [allDay, setAllDay] = React.useState(false);
  const [startVal, setStartVal] = React.useState(toLocalDatetimeValue(defaultStart));
  const [endVal, setEndVal] = React.useState(toLocalDatetimeValue(defaultEnd));
  const [startDate, setStartDate] = React.useState(prefillDate ?? new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = React.useState(prefillDate ?? new Date().toISOString().slice(0, 10));
  const [location, setLocation] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [attendeeInput, setAttendeeInput] = React.useState("");
  const [attendees, setAttendees] = React.useState<string[]>(prefillAttendees ?? []);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const ts = prefillDate
      ? new Date(prefillDate + "T09:00").getTime()
      : Math.ceil(Date.now() / 3_600_000) * 3_600_000;
    setTitle(prefillTitle ?? "");
    setAttendees(prefillAttendees ?? []);
    setAllDay(false);
    setStartVal(toLocalDatetimeValue(ts));
    setEndVal(toLocalDatetimeValue(ts + 3_600_000));
    setStartDate(prefillDate ?? new Date().toISOString().slice(0, 10));
    setEndDate(prefillDate ?? new Date().toISOString().slice(0, 10));
    setLocation("");
    setDescription("");
    setAttendeeInput("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillTitle, prefillAttendees, prefillDate]);

  const gmailAccount = Array.from(localStore.accounts.values()).find((a) => a.provider === "gmail");

  function addAttendee() {
    const email = attendeeInput.trim();
    if (email && !attendees.includes(email)) {
      setAttendees((prev) => [...prev, email]);
    }
    setAttendeeInput("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { toast.error("Title is required"); return; }
    if (!gmailAccount) { toast.error("No Gmail account connected"); return; }

    const startTs = allDay ? new Date(startDate + "T00:00:00").getTime() : localDatetimeToTs(startVal);
    const endTs = allDay ? new Date(endDate + "T00:00:00").getTime() : localDatetimeToTs(endVal);

    setSubmitting(true);
    try {
      const eventId = await createCalendarEvent({
        accountId: gmailAccount.id,
        title: title.trim(),
        startTs,
        endTs,
        allDay,
        location: location.trim() || undefined,
        description: description.trim() || undefined,
        attendeeEmails: attendees,
      });
      Mut.recordMutation("UPSERT_CALENDAR_EVENT", {
        event: {
          id: eventId,
          vaultId: gmailAccount.vaultId,
          accountId: gmailAccount.id,
          calendarId: "primary",
          title: title.trim(),
          startTs,
          endTs,
          allDay,
          location: location.trim() || undefined,
          description: description.trim() || undefined,
          status: "confirmed",
          attendees: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      toast.success("Event created");
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

              <div className="space-y-3">
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Event title"
                  className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />

                <label className="flex items-center gap-2 text-small text-text-secondary cursor-pointer">
                  <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-accent" />
                  All day
                </label>

                {allDay ? (
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="mb-1 block text-small text-text-secondary">Start date</label>
                      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                        className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary focus:border-accent focus:outline-none" />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1 block text-small text-text-secondary">End date</label>
                      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                        className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary focus:border-accent focus:outline-none" />
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="mb-1 block text-small text-text-secondary">Start</label>
                      <input type="datetime-local" value={startVal} onChange={(e) => setStartVal(e.target.value)}
                        className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary focus:border-accent focus:outline-none" />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1 block text-small text-text-secondary">End</label>
                      <input type="datetime-local" value={endVal} onChange={(e) => setEndVal(e.target.value)}
                        className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary focus:border-accent focus:outline-none" />
                    </div>
                  </div>
                )}

                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Location (optional)"
                  className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />

                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description (optional)"
                  rows={3}
                  className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none resize-none"
                />

                <div>
                  <label className="mb-1 block text-small text-text-secondary">Attendees</label>
                  <div className="flex gap-2">
                    <input
                      value={attendeeInput}
                      onChange={(e) => setAttendeeInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addAttendee(); } }}
                      placeholder="email@example.com"
                      className="flex-1 rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                    />
                    <Button type="button" variant="secondary" size="sm" onClick={addAttendee}>
                      <Plus size={14} />
                    </Button>
                  </div>
                  {attendees.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {attendees.map((email) => (
                        <li key={email} className="flex items-center justify-between text-small text-text-secondary">
                          <span>{email}</span>
                          <button type="button" onClick={() => setAttendees((prev) => prev.filter((e) => e !== email))}
                            className="text-text-muted hover:text-danger transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

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
