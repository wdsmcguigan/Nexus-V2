import { useEffect, useState } from "react";
import { localStore } from "@/storage/local";
import { useTimekitZones } from "@/modules/timekit/hooks";
import { setTimekitZonesMutation } from "@/modules/timekit/mutations";
import { formatClock } from "@/modules/timekit/time";

/** Live local time plus a user-managed list of IANA timezones. */
export function ClockSection() {
  const zones = useTimekitZones();
  const [now, setNow] = useState(() => Date.now());
  const [zoneInput, setZoneInput] = useState("");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  function addZone() {
    const z = zoneInput.trim();
    if (!z) return;
    try {
      // Throws RangeError on an invalid IANA zone — reject silently.
      new Intl.DateTimeFormat("en-US", { timeZone: z });
    } catch {
      return;
    }
    if (!zones.includes(z)) setTimekitZonesMutation([...zones, z], localStore);
    setZoneInput("");
  }

  function removeZone(z: string) {
    setTimekitZonesMutation(zones.filter((x) => x !== z), localStore);
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="text-small text-text-secondary">Local time</div>
        <div className="text-h2 font-semibold tabular-nums text-text-primary">{formatClock(now)}</div>
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border-subtle bg-surface-1 px-2 py-1 text-body text-text-primary"
          placeholder="Add time zone (e.g. America/New_York)"
          aria-label="Add time zone"
          value={zoneInput}
          onChange={(e) => setZoneInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addZone(); }}
        />
        <button type="button" onClick={addZone} className="rounded-md bg-surface-2 px-3 py-1 text-small text-text-primary">
          Add
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {zones.map((z) => (
          <li key={z} className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
            <div>
              <div className="text-body text-text-primary">{z}</div>
              <div className="text-small tabular-nums text-text-secondary">{formatClock(now, z)}</div>
            </div>
            <button
              type="button"
              onClick={() => removeZone(z)}
              aria-label={`Remove ${z}`}
              className="text-small text-text-secondary hover:text-text-primary"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
