/**
 * Shift+wheel → period-navigation decision.
 *
 * The CalendarPanel attaches a single `onWheel` to its view container; this
 * helper isolates the "should I navigate, and which way?" decision so it can
 * be unit-tested without faking a DOM. The handler is responsible for the
 * actual `prevPeriod()` / `nextPeriod()` call and `e.preventDefault()`.
 *
 * Behavior:
 * - Returns `null` unless `shiftKey` is held.
 * - Direction comes from whichever of `deltaX` / `deltaY` has the larger
 *   absolute value (Mac trackpads populate `deltaX` for shift+two-finger
 *   scroll; Windows external mice populate `deltaY` for shift+wheel).
 * - Throttled to one navigation per `throttleMs` (default 250ms) using a
 *   timestamp passed in by the caller — the caller updates its ref when
 *   we return non-null.
 * - A tiny `minDelta` threshold (3px) suppresses noisy near-zero deltas.
 */
export interface WheelLike {
  shiftKey: boolean;
  deltaX: number;
  deltaY: number;
}

export type WheelNavDirection = "prev" | "next" | null;

export function shouldNavigate(
  e: WheelLike,
  lastNavMs: number,
  now: number,
  throttleMs = 250,
  minDelta = 3,
): WheelNavDirection {
  if (!e.shiftKey) return null;
  if (now - lastNavMs < throttleMs) return null;
  const delta = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (Math.abs(delta) < minDelta) return null;
  return delta > 0 ? "next" : "prev";
}
