import { describe, it, expect, beforeEach } from "vitest";
import {
  registerModuleInverse,
  recordMutation,
  undoLastMutation,
  _resetModuleInverses,
  _resetUndoStacks,
} from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { LocalStore } from "@/storage/local";

const NS = "com.acme.counter";

function setup() {
  const store = new LocalStore();
  const values = new Map<string, number>();
  registerModuleReducer(NS, {
    apply: (kind, payload) => {
      const p = payload as { id: string; value: number };
      if (kind === `${NS}/SET`) values.set(p.id, p.value);
    },
  });
  registerModuleInverse(NS, (kind, payload) => {
    const p = payload as { id: string; value: number };
    if (kind === `${NS}/SET`) {
      const prev = values.get(p.id) ?? 0;
      return { reverseSteps: [{ kind: `${NS}/SET`, payload: { id: p.id, value: prev } }], description: "Set value" };
    }
    return null;
  });
  return { store, values };
}

beforeEach(() => {
  _resetModuleReducers();
  _resetModuleInverses();
  _resetUndoStacks();
});

describe("module-inverse hook", () => {
  it("makes a module mutation undoable via the registered inverse", () => {
    const { store, values } = setup();
    recordMutation(`${NS}/SET`, { id: "a", value: 1 }, store);
    recordMutation(`${NS}/SET`, { id: "a", value: 2 }, store);
    expect(values.get("a")).toBe(2);
    const desc = undoLastMutation(store);
    expect(desc).toBe("Set value");
    expect(values.get("a")).toBe(1);
  });

  it("leaves a module mutation non-undoable when no inverse is registered", () => {
    const store = new LocalStore();
    registerModuleReducer(NS, { apply: () => {} });
    recordMutation(`${NS}/SET`, { id: "a", value: 1 }, store);
    expect(undoLastMutation(store)).toBeNull();
  });
});
