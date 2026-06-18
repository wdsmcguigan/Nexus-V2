import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { makeSeedStore } from "@/storage/__tests__/seed";
import { recordMutation } from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";

let store: LocalStore;

beforeEach(() => {
  store = makeSeedStore();
  _resetModuleReducers();
});

describe("module mutation dispatch", () => {
  it("routes a namespaced mutation to the registered module reducer", () => {
    const seen: Array<{ kind: string; payload: unknown }> = [];
    registerModuleReducer("com.acme.timer", {
      apply: (kind, payload) => seen.push({ kind, payload }),
    });

    recordMutation("com.acme.timer/START", { id: "t1" }, store);

    expect(seen).toEqual([{ kind: "com.acme.timer/START", payload: { id: "t1" } }]);
  });

  it("records an unknown namespaced mutation without throwing and without a reducer", () => {
    expect(() => recordMutation("com.unknown/PING", { x: 1 }, store)).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const last = store.mutations[store.mutations.length - 1]!;
    expect(last.kind).toBe("com.unknown/PING");
  });

  it("logs module mutations so they sync and can replay", () => {
    registerModuleReducer("com.acme.timer", { apply: () => {} });
    recordMutation("com.acme.timer/START", { id: "t1" }, store);
    expect(store.mutations.map((m) => m.kind)).toContain("com.acme.timer/START");
  });
});
