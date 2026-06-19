const KEY = "nexus-client-mode";

export type ClientMode = "traditional" | "local-first";

export function loadClientMode(): ClientMode {
  // Guarded for non-DOM environments (Node test runner) where this module is
  // pulled in transitively without localStorage.
  if (typeof localStorage === "undefined") return "local-first";
  const stored = localStorage.getItem(KEY);
  if (stored === "traditional" || stored === "local-first") return stored;
  return "local-first";
}

export function saveClientMode(mode: ClientMode): void {
  localStorage.setItem(KEY, mode);
}
