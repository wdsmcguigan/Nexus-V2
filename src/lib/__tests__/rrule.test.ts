import { describe, it, expect } from "vitest";
import { buildRrule, parseRrule, formatRrule } from "@/lib/rrule";

describe("buildRrule", () => {
  it("emits FREQ alone for the simple case", () => {
    expect(buildRrule({ freq: "DAILY" })).toBe("FREQ=DAILY");
  });

  it("omits INTERVAL=1 (it's the default)", () => {
    expect(buildRrule({ freq: "WEEKLY", interval: 1 })).toBe("FREQ=WEEKLY");
  });

  it("emits INTERVAL > 1", () => {
    expect(buildRrule({ freq: "WEEKLY", interval: 2 })).toBe("FREQ=WEEKLY;INTERVAL=2");
  });

  it("sorts BYDAY into RFC-5545 weekday order regardless of click order", () => {
    expect(
      buildRrule({ freq: "WEEKLY", byday: ["FR", "MO", "WE"] }),
    ).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  });

  it("includes BYMONTHDAY when present", () => {
    expect(
      buildRrule({ freq: "MONTHLY", bymonthday: [15] }),
    ).toBe("FREQ=MONTHLY;BYMONTHDAY=15");
  });

  it("emits COUNT when set", () => {
    expect(
      buildRrule({ freq: "WEEKLY", interval: 1, byday: ["MO", "WE"], count: 10 }),
    ).toBe("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10");
  });

  it("emits UNTIL as a UTC datetime for timed events", () => {
    const until = Date.UTC(2026, 5, 1, 0, 0, 0);
    expect(
      buildRrule({ freq: "WEEKLY", until }),
    ).toBe("FREQ=WEEKLY;UNTIL=20260601T000000Z");
  });

  it("emits UNTIL as a date for all-day events", () => {
    const until = Date.UTC(2026, 5, 1, 0, 0, 0);
    expect(
      buildRrule({ freq: "WEEKLY", until, allDay: true }),
    ).toBe("FREQ=WEEKLY;UNTIL=20260601");
  });

  it("prefers COUNT over UNTIL when both are provided", () => {
    const until = Date.UTC(2026, 5, 1);
    expect(
      buildRrule({ freq: "DAILY", count: 5, until }),
    ).toBe("FREQ=DAILY;COUNT=5");
  });
});

describe("parseRrule", () => {
  it("returns undefined for empty input", () => {
    expect(parseRrule("")).toBeUndefined();
  });

  it("returns undefined for unknown FREQ", () => {
    expect(parseRrule("FREQ=SECONDLY")).toBeUndefined();
  });

  it("round-trips a typical weekly rule", () => {
    const s = "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;COUNT=10";
    const p = parseRrule(s);
    expect(p?.freq).toBe("WEEKLY");
    expect(p?.byday).toEqual(["MO", "WE"]);
    expect(p?.count).toBe(10);
    // interval=1 collapses on build, so re-building won't include it
    expect(buildRrule({ ...p! })).toBe("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10");
  });

  it("strips a 'RRULE:' prefix when present", () => {
    expect(parseRrule("RRULE:FREQ=DAILY")?.freq).toBe("DAILY");
  });

  it("infers allDay from a date-only UNTIL", () => {
    const p = parseRrule("FREQ=WEEKLY;UNTIL=20260601");
    expect(p?.allDay).toBe(true);
    expect(p?.until).toBe(Date.UTC(2026, 5, 1));
  });

  it("treats a datetime UNTIL as timed", () => {
    const p = parseRrule("FREQ=WEEKLY;UNTIL=20260601T120000Z");
    expect(p?.allDay).toBe(false);
    expect(p?.until).toBe(Date.UTC(2026, 5, 1, 12));
  });
});

describe("formatRrule", () => {
  it("returns empty string for missing / unparseable input", () => {
    expect(formatRrule(undefined)).toBe("");
    expect(formatRrule("")).toBe("");
    expect(formatRrule("garbage")).toBe("");
  });

  it("formats simple frequencies", () => {
    expect(formatRrule("FREQ=DAILY")).toBe("Daily");
    expect(formatRrule("FREQ=WEEKLY")).toBe("Weekly");
    expect(formatRrule("FREQ=MONTHLY")).toBe("Monthly");
    expect(formatRrule("FREQ=YEARLY")).toBe("Yearly");
  });

  it("formats intervals > 1", () => {
    expect(formatRrule("FREQ=WEEKLY;INTERVAL=2")).toBe("Every 2 weeks");
    expect(formatRrule("FREQ=DAILY;INTERVAL=3")).toBe("Every 3 days");
  });

  it("formats weekly BYDAY", () => {
    expect(formatRrule("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("Weekly on Mon, Wed");
  });

  it("formats COUNT", () => {
    expect(formatRrule("FREQ=WEEKLY;BYDAY=MO;COUNT=10")).toBe("Weekly on Mon (10 times)");
    expect(formatRrule("FREQ=DAILY;COUNT=1")).toBe("Daily (1 time)");
  });

  it("formats monthly BYMONTHDAY", () => {
    expect(formatRrule("FREQ=MONTHLY;BYMONTHDAY=15")).toBe("Monthly on day 15");
  });
});
