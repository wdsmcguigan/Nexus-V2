/**
 * Calendar-routing helpers (EP-14).
 *
 * One question all calendar mutations need to answer: "does this write go to
 * a remote provider, or stay purely local?". The rule is provider-driven:
 *
 *   - `provider === "local"`               → local only
 *   - `provider === "google"`  + accountId + externalId → Google push
 *   - `provider === "caldav"`              → local only (CalDAV outbound is
 *                                           the drainer's responsibility,
 *                                           not the modal's)
 *   - missing/unknown calendar             → local only (fail safe)
 *
 * Centralizing the decision here keeps the New/Edit/Delete modals consistent
 * and means a future provider only has to be added in one place.
 */
import type { Calendar } from "@/data/types";

export type SyncTarget =
  | { kind: "local" }
  | { kind: "google"; accountId: string; externalCalendarId: string };

/** Decide where a write to this calendar should be replicated to. */
export function resolveSyncTarget(cal: Calendar | undefined): SyncTarget {
  if (!cal) return { kind: "local" };
  if (cal.provider === "google" && cal.accountId && cal.externalId) {
    return { kind: "google", accountId: cal.accountId, externalCalendarId: cal.externalId };
  }
  // local, caldav, or google without identity → modal does a local upsert and
  // leaves any remote push to the drainer.
  return { kind: "local" };
}

/** Human-readable label for the provider badge next to the calendar name. */
export function providerBadge(cal: Calendar): "Local" | "Google" | "CalDAV" {
  switch (cal.provider) {
    case "google":
      return "Google";
    case "caldav":
      return "CalDAV";
    case "local":
    default:
      return "Local";
  }
}

/** True when the user is allowed to create/edit events on this calendar. */
export function isWritable(cal: Calendar): boolean {
  return cal.enabled && !cal.readOnly;
}

/**
 * Pick the calendar a new event should default to. Preference order:
 *
 *   1. The caller's `preferredId` if it still exists and is writable.
 *   2. The calendar with id `"local-default"` (guaranteed to exist post-hydration).
 *   3. The first writable calendar in the list.
 *   4. The first calendar in the list (even if read-only — caller can override).
 *
 * Throws if the list is empty; the hydrate path guarantees at least one entry.
 */
export function defaultWritableCalendar(cals: Calendar[], preferredId?: string): Calendar {
  if (cals.length === 0) {
    throw new Error("defaultWritableCalendar: no calendars available");
  }
  if (preferredId) {
    const preferred = cals.find((c) => c.id === preferredId);
    if (preferred && isWritable(preferred)) return preferred;
  }
  const localDefault = cals.find((c) => c.id === "local-default" && isWritable(c));
  if (localDefault) return localDefault;
  const firstWritable = cals.find(isWritable);
  if (firstWritable) return firstWritable;
  return cals[0]!;
}
