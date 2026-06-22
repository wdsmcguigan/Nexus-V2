export type TimekitSection = "clock" | "tracker" | "timers" | "alarms";

let _requested: TimekitSection = "clock";
const _listeners = new Set<(s: TimekitSection) => void>();

/** Ask a (possibly-already-open) Timekit panel to focus a section. */
export function requestSection(s: TimekitSection): void {
  _requested = s;
  for (const l of [..._listeners]) l(s);
}

/** The last-requested section — read as the panel's initial section on mount. */
export function getRequestedSection(): TimekitSection {
  return _requested;
}

/** Subscribe to focus requests. Returns a disposer. */
export function subscribeSection(l: (s: TimekitSection) => void): () => void {
  _listeners.add(l);
  return () => _listeners.delete(l);
}
