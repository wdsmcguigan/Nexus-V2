import { describe, it, expect } from "vitest";
import { formatRelativeTime, formatBytes, initials } from "@/lib/utils";

describe("formatRelativeTime", () => {
  const now = new Date("2026-06-10T12:00:00Z");

  it("shows 'now' under a minute", () => {
    expect(formatRelativeTime(new Date("2026-06-10T11:59:30Z"), now)).toBe("now");
  });

  it("shows minutes under an hour", () => {
    expect(formatRelativeTime(new Date("2026-06-10T11:30:00Z"), now)).toBe("30m");
  });

  it("shows hours under a day", () => {
    expect(formatRelativeTime(new Date("2026-06-10T09:00:00Z"), now)).toBe("3h");
  });

  it("shows days under a week", () => {
    expect(formatRelativeTime(new Date("2026-06-07T12:00:00Z"), now)).toBe("3d");
  });

  it("falls back to an absolute month/day past a week", () => {
    // Locale-dependent exact string; assert it is no longer a relative token.
    const out = formatRelativeTime(new Date("2026-05-01T12:00:00Z"), now);
    expect(out).not.toMatch(/^(now|\d+[mhd])$/);
  });
});

describe("formatBytes", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });
  it("formats kilobytes with one decimal", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
  it("formats megabytes with one decimal", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("formats gigabytes with two decimals", () => {
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
  });
  it("uses B right up to the 1024 boundary", () => {
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
  });
});

describe("initials", () => {
  it("returns ? for empty/nullish names", () => {
    expect(initials(null)).toBe("?");
    expect(initials(undefined)).toBe("?");
    expect(initials("   ")).toBe("?");
  });
  it("takes first two letters of a single name", () => {
    expect(initials("Madonna")).toBe("MA");
  });
  it("takes first + last initials for multi-word names", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Jean Luc Picard")).toBe("JP");
  });
});
