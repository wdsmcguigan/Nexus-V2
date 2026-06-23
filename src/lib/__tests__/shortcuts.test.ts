import { describe, it, expect } from "vitest";
import { isReservedShortcutKey } from "@/lib/shortcuts";

describe("isReservedShortcutKey", () => {
  it("reserves DEFAULT_SHORTCUTS default keys", () => {
    expect(isReservedShortcutKey("r")).toBe(true); // reply
    expect(isReservedShortcutKey("c")).toBe(true); // compose
    expect(isReservedShortcutKey("e")).toBe(true); // archive
  });
  it("reserves the chord prefixes", () => {
    expect(isReservedShortcutKey("g")).toBe(true); // NAV_PREFIX
    expect(isReservedShortcutKey("*")).toBe(true); // SELECTION_PREFIX
  });
  it("is case-insensitive", () => {
    expect(isReservedShortcutKey("R")).toBe(true);
    expect(isReservedShortcutKey("G")).toBe(true);
  });
  it("does not reserve a free key", () => {
    expect(isReservedShortcutKey("t")).toBe(false);
    expect(isReservedShortcutKey("q")).toBe(false);
  });
});
