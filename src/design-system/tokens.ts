/** Design system token types — keep in sync with tokens.css and the spec. */

export type Theme = "dark" | "light";
export type Density = "compact" | "comfortable" | "cozy";
export type PanelLink = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21;
export type Elevation = "l0" | "l1" | "l2" | "l3" | "l4";
export type Semantic = "info" | "success" | "warning" | "danger";
export type ControlSize = "xs" | "sm" | "md" | "lg" | "xl";
export type PanelType = "stage" | "inspector" | "hud" | "navigation";

export const DENSITY_ROW_HEIGHT_PX: Record<Density, number> = {
  compact: 28,
  comfortable: 36,
  cozy: 48,
};

export const CONTROL_SIZE_PX: Record<ControlSize, number> = {
  xs: 20,
  sm: 24,
  md: 28,
  lg: 32,
  xl: 40,
};

/** Deterministic color picker for unknown senders / panel pairings. */
export function pickPanelLink(seed: string): PanelLink {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return ((h % 21) + 1) as PanelLink;
}
