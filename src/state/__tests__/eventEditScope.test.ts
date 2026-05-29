import { describe, it, expect } from "vitest";
import { LocalStore } from "@/storage/local";
import {
  applyEventEdit,
  editEventOccurrence,
  UnsupportedEditScopeError,
} from "@/state/mutations";

describe("applyEventEdit scope guard (EP-14)", () => {
  it("rejects 'thisAndFollowing' with a typed error", () => {
    const store = new LocalStore();
    expect(() =>
      applyEventEdit(store, "thisAndFollowing", "master-1", 0, { title: "x" }),
    ).toThrow(UnsupportedEditScopeError);
  });

  it("records a mutation for the 'occurrence' scope", () => {
    const store = new LocalStore();
    applyEventEdit(store, "occurrence", "master-1", 123, { title: "moved" });
    const last = store.mutations.at(-1);
    expect(last?.kind).toBe("EDIT_EVENT_OCCURRENCE");
  });

  it("records a mutation for the 'series' scope", () => {
    const store = new LocalStore();
    applyEventEdit(store, "series", "master-1", 0, { title: "renamed" });
    const last = store.mutations.at(-1);
    expect(last?.kind).toBe("EDIT_EVENT_SERIES");
  });
});

describe("recurring-occurrence drag routing (EP-14)", () => {
  // Dragging an expanded occurrence must record an inline exception
  // (EDIT_EVENT_OCCURRENCE), never the master timestamp-swap
  // (UPDATE_CALENDAR_EVENT) the CLAUDE.md guard warns against.
  it("reschedule of an occurrence emits EDIT_EVENT_OCCURRENCE, not UPDATE_CALENDAR_EVENT", () => {
    const store = new LocalStore();
    const occurrenceStart = 1_780_304_400_000;
    editEventOccurrence(store, "master-9", occurrenceStart, {
      startTs: occurrenceStart + 3_600_000,
      endTs: occurrenceStart + 7_200_000,
    });
    const kinds = store.mutations.map((m) => m.kind);
    expect(kinds).toContain("EDIT_EVENT_OCCURRENCE");
    expect(kinds).not.toContain("UPDATE_CALENDAR_EVENT");

    const payload = store.mutations.at(-1)!.payload as {
      masterId: string;
      occurrenceStart: number;
    };
    expect(payload.masterId).toBe("master-9");
    expect(payload.occurrenceStart).toBe(occurrenceStart);
  });
});
