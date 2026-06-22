import { useMemo } from "react";
import { localStore } from "@/storage/local";
import { useStoreVersion } from "@/storage/useStore";
import type { Alarm, CountdownTimer, TimeEntry } from "@/data/types";

/** The saved Clock timezone list (reactive). */
export function useTimekitZones(): string[] {
  const v = useStoreVersion();
  return useMemo(() => localStore.timekitZones, [v]);
}

/** All time entries, most-recently-started first. */
export function useTimeEntries(): TimeEntry[] {
  const v = useStoreVersion();
  return useMemo(
    () => Array.from(localStore.timeEntries.values()).sort((a, b) => b.startedAt - a.startedAt),
    [v],
  );
}

/** All countdown timers, oldest-created first. */
export function useCountdownTimers(): CountdownTimer[] {
  const v = useStoreVersion();
  return useMemo(
    () => Array.from(localStore.countdownTimers.values()).sort((a, b) => a.createdAt - b.createdAt),
    [v],
  );
}

/** All alarms, soonest fireAt first. */
export function useAlarms(): Alarm[] {
  const v = useStoreVersion();
  return useMemo(
    () => Array.from(localStore.alarms.values()).sort((a, b) => a.fireAt - b.fireAt),
    [v],
  );
}
