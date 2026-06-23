import type { ModuleKey, PanelColorPrefs } from "@/data/types";

/**
 * System defaults. Each value is a token reference (link-N) that resolves
 * to a CSS custom property in src/design-system/tokens.css. If a new
 * ModuleKey is added, add a default here too.
 */
export const DEFAULT_MODULE_COLORS: Record<ModuleKey, string> = {
  nav: "link-16",
  list: "link-4",
  viewer: "link-21",
  inspector: "link-18",
  contacts: "link-2",
  calendar: "link-7",
  settings: "link-8",
};

/**
 * Convert a stored color value to a CSS-usable color string.
 * - "link-N" → "var(--color-link-N)"
 * - "#rrggbb" or "#rgb" → passed through unchanged
 */
export function toCssColor(value: string): string {
  if (value.startsWith("link-")) return `var(--color-${value})`;
  return value;
}

/**
 * Resolve the effective color for a module.
 * Order: workspace override → user preference → system default.
 */
export function resolvePanelColor(
  module: ModuleKey,
  user: PanelColorPrefs,
  workspace?: PanelColorPrefs,
): string {
  const stored =
    workspace?.colors[module] ??
    user.colors[module] ??
    DEFAULT_MODULE_COLORS[module];
  return toCssColor(stored);
}

/**
 * Resolve the effective body-tint level for the active workspace.
 * Workspace override beats user preference.
 */
export function resolveBodyTintLevel(
  user: PanelColorPrefs,
  workspace?: PanelColorPrefs,
): "L2" | "L3" {
  return workspace?.bodyTintLevel ?? user.bodyTintLevel;
}

/**
 * Deterministic, stable per-id fallback color for a module dock surface that
 * declares none. Maps the componentKey hash into the 21-color link palette.
 * Returns the stored form ("link-N"), like DEFAULT_MODULE_COLORS.
 */
export function moduleSurfaceFallbackColor(componentKey: string): string {
  let h = 0;
  for (let i = 0; i < componentKey.length; i++) {
    h = (h * 31 + componentKey.charCodeAt(i)) >>> 0;
  }
  return `link-${(h % 21) + 1}`;
}

/**
 * Resolve the effective CSS color for a module dock panel.
 * Order: workspace override → user override → manifest-declared → fallback(id).
 */
export function resolveModulePanelColor(
  componentKey: string,
  declared: string | undefined,
  user: PanelColorPrefs,
  workspace?: PanelColorPrefs,
): string {
  const stored =
    workspace?.moduleColors?.[componentKey] ??
    user.moduleColors?.[componentKey] ??
    declared ??
    moduleSurfaceFallbackColor(componentKey);
  return toCssColor(stored);
}
