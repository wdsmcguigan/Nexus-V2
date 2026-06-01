import { Plus, Trash2, Bell } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { CalendarReminder } from "@/data/types";

const MAX_REMINDERS = 5; // matches Google's cap to avoid silent truncation on sync

type Unit = "minutes" | "hours" | "days" | "weeks";
const UNIT_MULTIPLIERS: Record<Unit, number> = {
  minutes: 1,
  hours: 60,
  days: 60 * 24,
  weeks: 60 * 24 * 7,
};

/** Pick the "natural" unit for a minutes value (largest unit that divides evenly). */
function decompose(minutes: number): { amount: number; unit: Unit } {
  const safe = Math.max(0, Math.round(minutes));
  if (safe === 0) return { amount: 0, unit: "minutes" };
  if (safe % UNIT_MULTIPLIERS.weeks === 0) return { amount: safe / UNIT_MULTIPLIERS.weeks, unit: "weeks" };
  if (safe % UNIT_MULTIPLIERS.days === 0) return { amount: safe / UNIT_MULTIPLIERS.days, unit: "days" };
  if (safe % UNIT_MULTIPLIERS.hours === 0) return { amount: safe / UNIT_MULTIPLIERS.hours, unit: "hours" };
  return { amount: safe, unit: "minutes" };
}

interface Props {
  value: CalendarReminder[];
  onChange: (rs: CalendarReminder[]) => void;
}

export function RemindersEditor({ value, onChange }: Props) {
  function updateRow(i: number, patch: Partial<CalendarReminder>) {
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  function addRow() {
    if (value.length >= MAX_REMINDERS) return;
    onChange([...value, { method: "popup", minutes: 10 }]);
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-small text-text-secondary">
        <Bell size={12} className="text-text-tertiary" />
        <span>Reminders</span>
      </div>
      {value.length === 0 ? (
        <div className="text-caption text-text-muted mb-1.5">No reminders set</div>
      ) : (
        <ul className="space-y-1.5 mb-1.5">
          {value.map((r, i) => {
            const { amount, unit } = decompose(r.minutes);
            return (
              <li key={i} className="flex items-center gap-1.5">
                <select
                  value={r.method}
                  onChange={(e) => updateRow(i, { method: e.target.value as CalendarReminder["method"] })}
                  className="rounded-sm border border-border-default bg-surface-1 px-2 py-1 text-small text-text-primary focus:border-accent focus:outline-none"
                >
                  <option value="popup">Notification</option>
                  <option value="email">Email</option>
                </select>
                <input
                  type="number"
                  min={0}
                  max={9999}
                  value={amount}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    if (Number.isNaN(n)) return;
                    updateRow(i, { minutes: n * UNIT_MULTIPLIERS[unit] });
                  }}
                  className="w-16 rounded-sm border border-border-default bg-surface-1 px-2 py-1 text-small text-text-primary focus:border-accent focus:outline-none"
                />
                <select
                  value={unit}
                  onChange={(e) => {
                    const newUnit = e.target.value as Unit;
                    updateRow(i, { minutes: amount * UNIT_MULTIPLIERS[newUnit] });
                  }}
                  className="rounded-sm border border-border-default bg-surface-1 px-2 py-1 text-small text-text-primary focus:border-accent focus:outline-none"
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                </select>
                <span className="text-caption text-text-tertiary">before</span>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="ml-auto text-text-muted hover:text-danger transition-colors"
                  aria-label="Remove reminder"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={addRow}
        disabled={value.length >= MAX_REMINDERS}
        title={value.length >= MAX_REMINDERS ? "Google caps at 5 reminders per event" : undefined}
      >
        <Plus size={12} />
        Add reminder
      </Button>
    </div>
  );
}
