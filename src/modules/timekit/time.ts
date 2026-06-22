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
