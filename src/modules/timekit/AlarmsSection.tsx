import { useState } from "react";
import { localStore } from "@/storage/local";
import { useAlarms } from "@/modules/timekit/hooks";
import { createAlarmMutation, setAlarmEnabledMutation, deleteAlarmMutation } from "@/modules/timekit/mutations";
import { formatClock } from "@/modules/timekit/time";

/** Create and toggle alarms. Firing happens in the tick worker. */
export function AlarmsSection() {
  const alarms = useAlarms();
  const [label, setLabel] = useState("");
  const [time, setTime] = useState(""); // "HH:MM" from <input type="time">

  function create() {
    if (!time) return;
    const parts = time.split(":");
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    let fireAt = d.getTime();
    if (fireAt <= Date.now()) fireAt += 24 * 60 * 60 * 1000; // next occurrence today/tomorrow
    createAlarmMutation(label.trim() || "Alarm", fireAt, localStore);
    setLabel("");
    setTime("");
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border-subtle bg-surface-1 px-2 py-1 text-body text-text-primary"
          placeholder="Label"
          aria-label="Alarm label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          type="time"
          className="rounded-md border border-border-subtle bg-surface-1 px-2 py-1 text-body text-text-primary"
          aria-label="Alarm time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <button type="button" onClick={create} className="rounded-md bg-surface-2 px-3 py-1 text-small text-text-primary">
          Add alarm
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {alarms.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-body text-text-primary">{a.label}</div>
              <div className="text-small tabular-nums text-text-secondary">
                {formatClock(a.fireAt)}{a.firedAt != null ? " · fired" : ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="rounded-sm bg-surface-1 px-2 py-1 text-small text-text-primary"
                aria-pressed={a.enabled}
                onClick={() => setAlarmEnabledMutation(a.id, !a.enabled, localStore)}
              >
                {a.enabled ? "On" : "Off"}
              </button>
              <button
                type="button"
                className="rounded-sm bg-surface-1 px-2 py-1 text-small text-text-primary"
                aria-label={`Delete ${a.label}`}
                onClick={() => deleteAlarmMutation(a.id, localStore)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
