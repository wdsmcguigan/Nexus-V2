import { describe, it, expect } from "vitest";
import { formatClock, entryElapsedMs, formatDuration } from "@/modules/timekit/time";
import type { TimeEntry } from "@/data/types";

describe("formatClock", () => {
  it("formats an epoch in a given IANA zone (UTC)", () => {
    // 1970-01-01T00:00:30Z
    expect(formatClock(30_000, "UTC")).toBe("12:00:30 AM");
  });

  it("returns a non-empty string for local time without a zone", () => {
    expect(formatClock(0).length).toBeGreaterThan(0);
  });
});

function entry(startedAt: number, stoppedAt: number | null): TimeEntry {
  return { id: "te-1", vaultId: "local", startedAt, stoppedAt, note: null, createdAt: startedAt };
}

describe("entryElapsedMs", () => {
  it("uses now for a running entry", () => {
    expect(entryElapsedMs(entry(1_000, null), 4_000)).toBe(3_000);
  });
  it("uses stoppedAt for a finished entry (now ignored)", () => {
    expect(entryElapsedMs(entry(1_000, 6_000), 999_999)).toBe(5_000);
  });
  it("never returns negative", () => {
    expect(entryElapsedMs(entry(5_000, null), 1_000)).toBe(0);
  });
});

describe("formatDuration", () => {
  it("formats minutes:seconds under an hour", () => {
    expect(formatDuration(90_000)).toBe("1:30");
  });
  it("formats hours:minutes:seconds at/over an hour", () => {
    expect(formatDuration(3_661_000)).toBe("1:01:01");
  });
  it("clamps negatives to 0:00", () => {
    expect(formatDuration(-5_000)).toBe("0:00");
  });
});
