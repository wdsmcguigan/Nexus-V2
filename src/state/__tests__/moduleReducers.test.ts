import { describe, it, expect, beforeEach } from "vitest";
import {
  registerModuleReducer,
  getModuleReducer,
  _resetModuleReducers,
} from "@/state/moduleReducers";

beforeEach(() => {
  _resetModuleReducers();
});

describe("module reducer registry", () => {
  it("registers and retrieves a reducer by namespace", () => {
    const reducer = { apply: () => {} };
    registerModuleReducer("com.acme.timer", reducer);
    expect(getModuleReducer("com.acme.timer")).toBe(reducer);
  });

  it("returns undefined for an unregistered namespace", () => {
    expect(getModuleReducer("com.unknown")).toBeUndefined();
  });

  it("unregisters via the returned disposer", () => {
    const dispose = registerModuleReducer("com.acme.timer", { apply: () => {} });
    dispose();
    expect(getModuleReducer("com.acme.timer")).toBeUndefined();
  });

  it("rejects the reserved core namespace", () => {
    expect(() => registerModuleReducer("nexus", { apply: () => {} })).toThrow(/reserved/);
  });

  it("rejects double registration of the same namespace", () => {
    registerModuleReducer("com.acme.timer", { apply: () => {} });
    expect(() => registerModuleReducer("com.acme.timer", { apply: () => {} })).toThrow(/already/);
  });
});
