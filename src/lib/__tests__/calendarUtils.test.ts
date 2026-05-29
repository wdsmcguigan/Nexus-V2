import { describe, it, expect } from "vitest";
import { allDayDateKey, formatAllDayDate } from "@/lib/calendarUtils";

describe("all-day (floating) date handling — EP-14 Phase 1", () => {
  // An all-day event on 2026-06-01 is stored anchored at UTC midnight.
  const JUNE_1_UTC_MIDNIGHT = Date.UTC(2026, 5, 1, 0, 0, 0); // month is 0-indexed

  it("allDayDateKey returns the calendar date regardless of viewer timezone", () => {
    // The bug: rendering via local date components shifts the day west of UTC.
    // allDayDateKey reads UTC components, so the key is always 2026-06-01.
    expect(allDayDateKey(JUNE_1_UTC_MIDNIGHT)).toBe("2026-06-01");
  });

  it("formatAllDayDate shows June 1 (not May 31) via UTC components", () => {
    const formatted = formatAllDayDate(JUNE_1_UTC_MIDNIGHT, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    // en-US "MM/DD/YYYY"; the day component must be 01, never 31.
    expect(formatted).toContain("06");
    expect(formatted).toContain("01");
    expect(formatted).not.toContain("31");
  });
});
