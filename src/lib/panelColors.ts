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
