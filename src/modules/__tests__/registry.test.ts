import { describe, it, expect, beforeEach } from "vitest";
import {
  registerModule,
  getModule,
  listModules,
  _resetModules,
} from "@/modules/registry";
import { getModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import type { ModuleManifest } from "@/modules/registry";

function manifest(over: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    id: "com.acme.timer",
    name: "Timer",
    version: "1.0.0",
    namespace: "com.acme.timer",
    entities: ["com.acme.timer/timer"],
    mutationKinds: ["com.acme.timer/START", "com.acme.timer/STOP"],
    capabilities: { "mutations.emit": ["com.acme.timer/*"] },
    trust: "third-party",
    ...over,
  };
}

beforeEach(() => {
  _resetModules();
  _resetModuleReducers();
});

describe("module registry", () => {
  it("registers a module and exposes it", () => {
    registerModule(manifest(), { apply: () => {} });
    expect(getModule("com.acme.timer")?.name).toBe("Timer");
    expect(listModules().map((m) => m.id)).toEqual(["com.acme.timer"]);
  });

  it("wires the module's reducer under its namespace", () => {
    registerModule(manifest(), { apply: () => {} });
    expect(getModuleReducer("com.acme.timer")).toBeDefined();
  });

  it("rejects a mutationKind outside the module namespace", () => {
    expect(() =>
      registerModule(manifest({ mutationKinds: ["com.other/HACK"] }), { apply: () => {} }),
    ).toThrow(/namespace/);
  });

  it("rejects an entity type outside the module namespace", () => {
    expect(() =>
      registerModule(manifest({ entities: ["com.other/thing"] }), { apply: () => {} }),
    ).toThrow(/namespace/);
  });

  it("disposer unregisters the module and its reducer", () => {
    const dispose = registerModule(manifest(), { apply: () => {} });
    dispose();
    expect(getModule("com.acme.timer")).toBeUndefined();
    expect(getModuleReducer("com.acme.timer")).toBeUndefined();
  });

  it("allows a headless module with no reducer", () => {
    registerModule(manifest({ id: "com.acme.headless", namespace: "com.acme.headless", entities: [], mutationKinds: [] }));
    expect(getModule("com.acme.headless")?.name).toBe("Timer");
  });
});
