import type { TimeEntry, CountdownTimer } from "@/data/types";

/**
 * Format an epoch (ms) as a wall clock. With `zone`, renders that IANA zone's
 * local time; without, the host's local time. Pure (caller injects `now`).
 */
export function formatClock(now: number, zone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...(zone ? { timeZone: zone } : {}),
  }).format(now);
}

/** Elapsed ms for an entry; running entries measure against `now`. Never negative. */
export function entryElapsedMs(entry: TimeEntry, now: number): number {
  const end = entry.stoppedAt ?? now;
  return Math.max(0, end - entry.startedAt);
}

/** Format ms as `m:ss` (under 1h) or `h:mm:ss`. Negatives clamp to "0:00". */
export function formatDuration(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** When a running timer will reach zero, or null when not running. */
export function timerEndsAt(t: CountdownTimer): number | null {
  if (t.startedAt == null) return null;
  return t.startedAt + (t.durationMs - t.elapsedBeforeMs);
}

/** Remaining ms for a timer. Never negative. */
export function timerRemainingMs(t: CountdownTimer, now: number): number {
  if (t.state === "done") return 0;
  if (t.startedAt == null) return Math.max(0, t.durationMs - t.elapsedBeforeMs);
  return Math.max(0, timerEndsAt(t)! - now);
}
