/**
 * Surface taxonomy and trust×surface gating (substrate §7.2). Vocabulary +
 * gating only; actual UI wiring of contributed surfaces is deferred.
 */

/** The nine surface types a module may contribute UI through. */
export const SURFACE_TYPES = [
  "dock",
  "rail",
  "inspector-section",
  "embedded-widget",
  "overlay",
  "headless",
  "full-window",
  "ambient-indicator",
  "canvas",
] as const;

export type SurfaceType = (typeof SURFACE_TYPES)[number];

/** Module trust tiers. */
export type TrustTier = "core" | "first-party" | "third-party";

/** Surfaces a third-party module is allowed to contribute (substrate §7.2 matrix). */
const THIRD_PARTY_ALLOWED: ReadonlySet<SurfaceType> = new Set([
  "dock",
  "inspector-section",
  "overlay",
  "ambient-indicator",
  "canvas",
  "headless",
]);

/**
 * True if a module of `tier` may contribute a surface of `type`. Core and
 * first-party may contribute any; third-party is restricted to the safe set
 * (never rail, embedded-widget, or full-window — anti-spoofing).
 */
export function canContributeSurface(tier: TrustTier, type: SurfaceType): boolean {
  if (tier === "core" || tier === "first-party") return true;
  return THIRD_PARTY_ALLOWED.has(type);
}

/**
 * A UI surface a module declares in its manifest (substrate §7.2). v1 renders
 * `dock`; other types are declarable + trust-gated but not yet wired.
 */
export interface SurfaceSpec {
  type: SurfaceType;
  /** Module-local surface id, unique within the module (e.g. "tasks.main"). */
  id: string;
  title: string;
  /** Optional icon hint (lucide name); host decides how to render it. */
  icon?: string;
  /** Optional dock-surface color: a "link-N" token ref (→ var(--color-link-N)) or a hex
   *  string. Drives the panel's --module-color; falls back to a per-id hash when absent. */
  color?: string;
  /** Dock only: may the panel detach into its own OS window? Default false. */
  detachable?: boolean;
}
