import { useEffect, useState } from "react";
import { localStore } from "@/storage/local";
import { useTimeEntries } from "@/modules/timekit/hooks";
import { startTrackingMutation, stopTrackingMutation, deleteEntryMutation } from "@/modules/timekit/mutations";
import { entryElapsedMs, formatDuration } from "@/modules/timekit/time";
import { entryTrackedTask } from "@/modules/timekit/links";

/** Start/stop time tracking with a live-elapsed running row and a past-entry list. */
export function TrackerSection() {
  const entries = useTimeEntries();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const running = entries.find((e) => e.stoppedAt === null);
  const total = entries.reduce((sum, e) => sum + entryElapsedMs(e, now), 0);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        {running ? (
          <>
            <div className="text-h3 font-semibold tabular-nums text-text-primary">
              {formatDuration(entryElapsedMs(running, now))}
            </div>
            <button
              type="button"
              onClick={() => stopTrackingMutation(running.id, localStore)}
              className="rounded-md bg-surface-2 px-3 py-1 text-small text-text-primary"
            >
              Stop
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => startTrackingMutation({}, localStore)}
            className="rounded-md bg-surface-2 px-3 py-1 text-small text-text-primary"
          >
            Start tracking
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {entries.filter((e) => e.stoppedAt !== null).map((e) => {
          const tracked = entryTrackedTask(localStore, e.id);
          return (
            <li key={e.id} className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
              <div className="min-w-0">
                <div className="text-body tabular-nums text-text-primary">{formatDuration(entryElapsedMs(e, now))}</div>
                <div className="truncate text-small text-text-secondary">
                  {tracked ? `↳ ${tracked.title}` : (e.note ?? "—")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteEntryMutation(e.id, localStore)}
                aria-label="Delete entry"
                className="text-small text-text-secondary hover:text-text-primary"
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>

      <div className="text-small text-text-secondary">Total: <span className="tabular-nums">{formatDuration(total)}</span></div>
    </div>
  );
}
