import { describe, it, expect } from "vitest";
import { eventColor, GOOGLE_COLOR_MAP } from "@/lib/calendarColors";

describe("eventColor", () => {
  it("maps a known Google colorId to its hex", () => {
    expect(eventColor("1")).toBe("#D50000");
    expect(eventColor("11")).toBe("#616161");
  });

  it("falls back to the accent token when colorId is undefined", () => {
    expect(eventColor()).toBe("var(--color-accent)");
  });

  it("falls back to the accent token for an unknown colorId", () => {
    expect(eventColor("999")).toBe("var(--color-accent)");
  });

  it("falls back to the accent token for an empty-string colorId", () => {
    expect(eventColor("")).toBe("var(--color-accent)");
  });

  it("every mapped color is a hex value", () => {
    for (const hex of Object.values(GOOGLE_COLOR_MAP)) {
      expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
