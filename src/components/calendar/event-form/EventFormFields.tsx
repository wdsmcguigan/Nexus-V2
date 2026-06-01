import * as React from "react";
import { Plus, Trash2, ChevronRight, Video, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { providerBadge } from "@/lib/calendars";
import type { Calendar, CalendarEvent, CalendarReminder } from "@/data/types";
import { EventColorPicker } from "./EventColorPicker";
import { RemindersEditor } from "./RemindersEditor";

/**
 * Shape of the form data — the union of every field the two modals expose.
 * Modals own the state and the submit logic; this component owns the layout
 * and the per-field subcomponents.
 */
export interface EventFormState {
  title: string;
  allDay: boolean;
  startVal: string;          // "YYYY-MM-DDTHH:mm" — used when !allDay
  endVal: string;            //
  startDate: string;         // "YYYY-MM-DD" — used when allDay
  endDate: string;           //
  calendarLocalId: string;
  location: string;
  description: string;
  attendees: string[];
  notes: string;
  conferenceUrl: string;
  colorId?: string;
  visibility: NonNullable<CalendarEvent["visibility"]>;
  transparency: NonNullable<CalendarEvent["transparency"]>;
  reminders: CalendarReminder[];
}

interface Props {
  value: EventFormState;
  onChange: (patch: Partial<EventFormState>) => void;
  calendars: Calendar[];
  /** Auto-open the "More options" panel if any field inside it has a value. */
  initialMoreOpen?: boolean;
}

export function EventFormFields({ value, onChange, calendars, initialMoreOpen }: Props) {
  const hasMoreField =
    !!value.conferenceUrl ||
    !!value.colorId ||
    value.visibility !== "default" ||
    value.transparency !== "opaque" ||
    value.reminders.length > 0 ||
    !!value.notes;
  const [moreOpen, setMoreOpen] = React.useState(initialMoreOpen ?? hasMoreField);
  const [attendeeInput, setAttendeeInput] = React.useState("");

  function addAttendee() {
    const email = attendeeInput.trim();
    if (email && !value.attendees.includes(email)) {
      onChange({ attendees: [...value.attendees, email] });
    }
    setAttendeeInput("");
  }

  return (
    <div className="space-y-3">
      <input
        autoFocus
        value={value.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="Event title"
        className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
      />

      <label className="flex items-center gap-2 text-small text-text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={value.allDay}
          onChange={(e) => onChange({ allDay: e.target.checked })}
          className="accent-accent"
        />
        All day
      </label>

      {value.allDay ? (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-small text-text-secondary">Start date</label>
            <input
              type="date"
              value={value.startDate}
              onChange={(e) => onChange({ startDate: e.target.value })}
              className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-small text-text-secondary">End date</label>
            <input
              type="date"
              value={value.endDate}
              onChange={(e) => onChange({ endDate: e.target.value })}
              className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-small text-text-secondary">Start</label>
            <input
              type="datetime-local"
              value={value.startVal}
              onChange={(e) => onChange({ startVal: e.target.value })}
              className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-small text-text-secondary">End</label>
            <input
              type="datetime-local"
              value={value.endVal}
              onChange={(e) => onChange({ endVal: e.target.value })}
              className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-small text-text-secondary">Calendar</label>
        <select
          value={value.calendarLocalId}
          onChange={(e) => onChange({ calendarLocalId: e.target.value })}
          className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary focus:border-accent focus:outline-none"
        >
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({providerBadge(c)})
            </option>
          ))}
        </select>
      </div>

      <input
        value={value.location}
        onChange={(e) => onChange({ location: e.target.value })}
        placeholder="Location (optional)"
        className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
      />

      <textarea
        value={value.description}
        onChange={(e) => onChange({ description: e.target.value })}
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
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addAttendee();
              }
            }}
            placeholder="email@example.com"
            className="flex-1 rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <Button type="button" variant="secondary" size="sm" onClick={addAttendee}>
            <Plus size={14} />
          </Button>
        </div>
        {value.attendees.length > 0 && (
          <ul className="mt-2 space-y-1">
            {value.attendees.map((email) => (
              <li key={email} className="flex items-center justify-between text-small text-text-secondary">
                <span>{email}</span>
                <button
                  type="button"
                  onClick={() =>
                    onChange({ attendees: value.attendees.filter((e) => e !== email) })
                  }
                  className="text-text-muted hover:text-danger transition-colors"
                  aria-label="Remove attendee"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── More options disclosure ───────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setMoreOpen((v) => !v)}
        className="flex items-center gap-1 text-small text-text-secondary hover:text-text-primary transition-colors"
        aria-expanded={moreOpen}
      >
        <ChevronRight
          size={12}
          className={cn("transition-transform", moreOpen && "rotate-90")}
        />
        More options
      </button>

      {moreOpen && (
        <div className="space-y-3 pl-3 border-l border-border-subtle">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-small text-text-secondary">
              <Video size={12} className="text-text-tertiary" />
              <span>Conference URL</span>
            </div>
            <input
              type="url"
              value={value.conferenceUrl}
              onChange={(e) => onChange({ conferenceUrl: e.target.value })}
              placeholder="https://meet.google.com/abc-defg-hij"
              className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-small text-text-secondary">Color</label>
            <EventColorPicker
              value={value.colorId}
              onChange={(id) => onChange({ colorId: id })}
            />
          </div>

          <RemindersEditor
            value={value.reminders}
            onChange={(reminders) => onChange({ reminders })}
          />

          <div className="flex gap-2">
            <div className="flex-1">
              <div className="mb-1 flex items-center gap-1.5 text-small text-text-secondary">
                {value.visibility === "private" || value.visibility === "confidential" ? (
                  <EyeOff size={12} className="text-text-tertiary" />
                ) : (
                  <Eye size={12} className="text-text-tertiary" />
                )}
                <span>Visibility</span>
              </div>
              <select
                value={value.visibility}
                onChange={(e) =>
                  onChange({ visibility: e.target.value as EventFormState["visibility"] })
                }
                className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="default">Default</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
                <option value="confidential">Confidential</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-small text-text-secondary">Availability</label>
              <select
                value={value.transparency}
                onChange={(e) =>
                  onChange({ transparency: e.target.value as EventFormState["transparency"] })
                }
                className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="opaque">Busy</option>
                <option value="transparent">Free</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-small text-text-secondary">Notes (private)</label>
            <textarea
              value={value.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
              placeholder="Internal notes — never sent to the calendar provider"
              rows={2}
              className="w-full resize-none rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}
