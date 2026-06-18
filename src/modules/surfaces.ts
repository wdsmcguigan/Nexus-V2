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
