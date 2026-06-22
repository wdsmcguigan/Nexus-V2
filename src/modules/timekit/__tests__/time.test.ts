import { describe, it, expect } from "vitest";
import { formatClock } from "@/modules/timekit/time";

describe("formatClock", () => {
  it("formats an epoch in a given IANA zone (UTC)", () => {
    // 1970-01-01T00:00:30Z
    expect(formatClock(30_000, "UTC")).toBe("12:00:30 AM");
  });

  it("returns a non-empty string for local time without a zone", () => {
    expect(formatClock(0).length).toBeGreaterThan(0);
  });
});
