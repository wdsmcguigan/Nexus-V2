import { Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildRrule, parseRrule, type Weekday, type RruleParts } from "@/lib/rrule";
import { tsToDateInput, dateInputToTs } from "@/lib/calendarUtils";

const WEEKDAYS: { value: Weekday; label: string }[] = [
  { value: "MO", label: "M" },
  { value: "TU", label: "T" },
  { value: "WE", label: "W" },
  { value: "TH", label: "T" },
  { value: "FR", label: "F" },
  { value: "SA", label: "S" },
  { value: "SU", label: "S" },
];

interface Props {
  /** RRULE string, e.g. "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10". Empty / undefined = no recurrence. */
  value: string | undefined;
  onChange: (rrule: string | undefined) => void;
  /** Start date as epoch ms, used to seed UNTIL when the user picks an end date. */
  dtstart: number;
  /** When true, UNTIL serialises as a date (YYYYMMDD) rather than a UTC datetime. */
  allDay: boolean;
}

function rruleOrUndef(parts: RruleParts | undefined): string | undefined {
  if (!parts) return undefined;
  const s = buildRrule(parts);
  return s.length ? s : undefined;
}


export function RecurrenceEditor({ value, onChange, dtstart, allDay }: Props) {
  const parts = parseRrule(value);

  function setFreq(freq: RruleParts["freq"] | "NONE") {
    if (freq === "NONE") {
      onChange(undefined);
      return;
    }
    onChange(rruleOrUndef({ freq, allDay }));
  }

  function setInterval(n: number) {
    if (!parts) return;
    onChange(rruleOrUndef({ ...parts, interval: n > 1 ? n : undefined, allDay }));
  }

  function toggleWeekday(d: Weekday) {
    if (!parts) return;
    const current = parts.byday ?? [];
    const next = current.includes(d) ? current.filter((x) => x !== d) : [...current, d];
    onChange(rruleOrUndef({ ...parts, byday: next.length > 0 ? next : undefined, allDay }));
  }

  type EndMode = "never" | "until" | "count";
  const endMode: EndMode =
    parts == null ? "never" : parts.count != null ? "count" : parts.until != null ? "until" : "never";

  function setEndMode(mode: EndMode) {
    if (!parts) return;
    if (mode === "never") {
      onChange(rruleOrUndef({ ...parts, count: undefined, until: undefined, allDay }));
    } else if (mode === "count") {
      onChange(rruleOrUndef({ ...parts, count: 10, until: undefined, allDay }));
    } else {
      // Default UNTIL: 1 year from dtstart.
      const oneYear = dtstart + 365 * 24 * 60 * 60 * 1000;
      onChange(rruleOrUndef({ ...parts, count: undefined, until: oneYear, allDay }));
    }
  }

  function setCount(n: number) {
    if (!parts) return;
    if (!Number.isFinite(n) || n < 1) return;
    onChange(rruleOrUndef({ ...parts, count: n, until: undefined, allDay }));
  }

  function setUntilDate(s: string) {
    if (!parts) return;
    const ts = dateInputToTs(s);
    if (ts == null) return;
    onChange(rruleOrUndef({ ...parts, until: ts, count: undefined, allDay }));
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-small text-text-secondary">
        <Repeat size={12} className="text-text-tertiary" />
        <span>Repeats</span>
      </div>
      <select
        value={parts?.freq ?? "NONE"}
        onChange={(e) => setFreq(e.target.value as RruleParts["freq"] | "NONE")}
        className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary focus:border-accent focus:outline-none"
      >
        <option value="NONE">Does not repeat</option>
        <option value="DAILY">Daily</option>
        <option value="WEEKLY">Weekly</option>
        <option value="MONTHLY">Monthly</option>
        <option value="YEARLY">Yearly</option>
      </select>

      {parts && (
        <div className="mt-2 space-y-2 pl-3 border-l border-border-subtle">
          {/* Interval */}
          <div className="flex items-center gap-2 text-small text-text-secondary">
            <span>Every</span>
            <input
              type="number"
              min={1}
              max={99}
              value={parts.interval ?? 1}
              onChange={(e) => setInterval(Number.parseInt(e.target.value, 10) || 1)}
              className="w-14 rounded-sm border border-border-default bg-surface-1 px-2 py-1 text-body text-text-primary focus:border-accent focus:outline-none"
            />
            <span>
              {parts.freq === "DAILY" ? "day(s)" :
                parts.freq === "WEEKLY" ? "week(s)" :
                parts.freq === "MONTHLY" ? "month(s)" :
                "year(s)"}
            </span>
          </div>

          {/* Weekly: BYDAY toggles */}
          {parts.freq === "WEEKLY" && (
            <div>
              <div className="mb-1 text-small text-text-secondary">On</div>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((d) => {
                  const active = parts.byday?.includes(d.value) ?? false;
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleWeekday(d.value)}
                      title={d.value}
                      className={cn(
                        "h-6 w-6 rounded-full text-caption font-medium transition-colors",
                        active
                          ? "bg-accent text-white"
                          : "bg-surface-1 text-text-secondary border border-border-default hover:border-accent",
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* End condition */}
          <div>
            <div className="mb-1 text-small text-text-secondary">Ends</div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-small text-text-primary">
                <input
                  type="radio"
                  name="rrule-end"
                  checked={endMode === "never"}
                  onChange={() => setEndMode("never")}
                  className="accent-accent"
                />
                Never
              </label>
              <label className="flex items-center gap-2 text-small text-text-primary">
                <input
                  type="radio"
                  name="rrule-end"
                  checked={endMode === "until"}
                  onChange={() => setEndMode("until")}
                  className="accent-accent"
                />
                On
                <input
                  type="date"
                  disabled={endMode !== "until"}
                  value={parts.until != null ? tsToDateInput(parts.until) : ""}
                  onChange={(e) => setUntilDate(e.target.value)}
                  className="rounded-sm border border-border-default bg-surface-1 px-2 py-1 text-small text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
                />
              </label>
              <label className="flex items-center gap-2 text-small text-text-primary">
                <input
                  type="radio"
                  name="rrule-end"
                  checked={endMode === "count"}
                  onChange={() => setEndMode("count")}
                  className="accent-accent"
                />
                After
                <input
                  type="number"
                  min={1}
                  max={999}
                  disabled={endMode !== "count"}
                  value={parts.count ?? 10}
                  onChange={(e) => setCount(Number.parseInt(e.target.value, 10))}
                  className="w-16 rounded-sm border border-border-default bg-surface-1 px-2 py-1 text-small text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
                />
                occurrence(s)
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
