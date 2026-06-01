import { describe, it, expect } from "vitest";
import {
  resolveSyncTarget,
  providerBadge,
  isWritable,
  defaultWritableCalendar,
} from "@/lib/calendars";
import type { Calendar } from "@/data/types";

function cal(overrides: Partial<Calendar> = {}): Calendar {
  return {
    id: "c1",
    vaultId: "v1",
    name: "C1",
    enabled: true,
    readOnly: false,
    provider: "local",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("resolveSyncTarget", () => {
  it("returns local for purely-local calendars", () => {
    expect(resolveSyncTarget(cal({ provider: "local" }))).toEqual({ kind: "local" });
  });

  it("returns local when the calendar is undefined (fail-safe)", () => {
    expect(resolveSyncTarget(undefined)).toEqual({ kind: "local" });
  });

  it("returns local for caldav (drainer handles outbound, not the modal)", () => {
    expect(
      resolveSyncTarget(cal({ provider: "caldav", accountId: "a1", externalId: "primary" })),
    ).toEqual({ kind: "local" });
  });

  it("returns local for google when accountId is missing", () => {
    expect(
      resolveSyncTarget(cal({ provider: "google", externalId: "primary" })),
    ).toEqual({ kind: "local" });
  });

  it("returns local for google when externalId is missing", () => {
    expect(
      resolveSyncTarget(cal({ provider: "google", accountId: "a1" })),
    ).toEqual({ kind: "local" });
  });

  it("returns google for a fully-populated Google calendar", () => {
    expect(
      resolveSyncTarget(cal({ provider: "google", accountId: "a1", externalId: "primary" })),
    ).toEqual({ kind: "google", accountId: "a1", externalCalendarId: "primary" });
  });
});

describe("providerBadge", () => {
  it("labels each provider", () => {
    expect(providerBadge(cal({ provider: "local" }))).toBe("Local");
    expect(providerBadge(cal({ provider: "google" }))).toBe("Google");
    expect(providerBadge(cal({ provider: "caldav" }))).toBe("CalDAV");
  });
});

describe("isWritable", () => {
  it("is true only when enabled && !readOnly", () => {
    expect(isWritable(cal({ enabled: true, readOnly: false }))).toBe(true);
    expect(isWritable(cal({ enabled: false, readOnly: false }))).toBe(false);
    expect(isWritable(cal({ enabled: true, readOnly: true }))).toBe(false);
  });
});

describe("defaultWritableCalendar", () => {
  const local = cal({ id: "local-default", name: "Default", provider: "local" });
  const google = cal({
    id: "g1",
    name: "Work",
    provider: "google",
    accountId: "a1",
    externalId: "primary",
  });
  const readOnly = cal({ id: "ro", name: "Holidays", readOnly: true });

  it("prefers the caller's preferredId when it exists and is writable", () => {
    expect(defaultWritableCalendar([local, google], "g1").id).toBe("g1");
  });

  it("falls back to local-default when preferredId is unknown", () => {
    expect(defaultWritableCalendar([local, google], "missing").id).toBe("local-default");
  });

  it("falls back to local-default when no preferredId is given", () => {
    expect(defaultWritableCalendar([google, local]).id).toBe("local-default");
  });

  it("skips a preferredId that has become read-only", () => {
    expect(defaultWritableCalendar([local, readOnly], "ro").id).toBe("local-default");
  });

  it("falls back to the first writable calendar when local-default is absent", () => {
    expect(defaultWritableCalendar([readOnly, google]).id).toBe("g1");
  });

  it("falls back to the first calendar when everything is read-only", () => {
    expect(defaultWritableCalendar([readOnly]).id).toBe("ro");
  });

  it("throws on an empty list (hydrate guarantees ≥1)", () => {
    expect(() => defaultWritableCalendar([])).toThrow();
  });
});
