import { describe, it, expect } from "vitest";
import { LocalStore } from "@/storage/local";
import { applyEventEdit, UnsupportedEditScopeError } from "@/state/mutations";

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
