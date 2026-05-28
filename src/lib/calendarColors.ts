export const GOOGLE_COLOR_MAP: Record<string, string> = {
  "1":  "#D50000", // Tomato
  "2":  "#E67C73", // Flamingo
  "3":  "#F4511E", // Tangerine
  "4":  "#F6BF26", // Banana
  "5":  "#33B679", // Sage
  "6":  "#0B8043", // Basil
  "7":  "#039BE5", // Peacock
  "8":  "#3F51B5", // Blueberry
  "9":  "#7986CB", // Lavender
  "10": "#8E24AA", // Grape
  "11": "#616161", // Graphite
};

export function eventColor(colorId?: string): string {
  return (colorId && GOOGLE_COLOR_MAP[colorId]) ?? "var(--color-accent)";
}
