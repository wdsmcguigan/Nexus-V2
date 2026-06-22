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

import { timerEndsAt, timerRemainingMs } from "@/modules/timekit/time";
import type { CountdownTimer } from "@/data/types";

function timer(p: Partial<CountdownTimer>): CountdownTimer {
  return {
    id: "ct-1", vaultId: "local", label: "T", durationMs: 10_000,
    startedAt: null, elapsedBeforeMs: 0, state: "idle", createdAt: 0, ...p,
  };
}

describe("timerEndsAt / timerRemainingMs", () => {
  it("running: endsAt = startedAt + (duration - elapsedBefore)", () => {
    const t = timer({ state: "running", startedAt: 1_000, durationMs: 10_000, elapsedBeforeMs: 2_000 });
    expect(timerEndsAt(t)).toBe(9_000);          // 1000 + (10000 - 2000)
    expect(timerRemainingMs(t, 4_000)).toBe(5_000);
  });
  it("idle/paused: remaining = duration - elapsedBefore (now ignored)", () => {
    expect(timerEndsAt(timer({ state: "idle" }))).toBeNull();
    expect(timerRemainingMs(timer({ state: "paused", elapsedBeforeMs: 3_000 }), 999)).toBe(7_000);
  });
  it("done: remaining is 0", () => {
    expect(timerRemainingMs(timer({ state: "done" }), 0)).toBe(0);
  });
  it("running past end clamps to 0", () => {
    const t = timer({ state: "running", startedAt: 0, durationMs: 1_000, elapsedBeforeMs: 0 });
    expect(timerRemainingMs(t, 5_000)).toBe(0);
  });
});
