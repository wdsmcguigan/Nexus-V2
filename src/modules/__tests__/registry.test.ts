import { describe, it, expect, beforeEach } from "vitest";
import {
  registerModule,
  getModule,
  listModules,
  _resetModules,
} from "@/modules/registry";
import { getModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { listDockSurfaces, _resetDockSurfaces } from "@/modules/surfaceRegistry";
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
  _resetDockSurfaces();
});

describe("module registry", () => {
  it("registers a module and exposes it", () => {
    registerModule(manifest());
    expect(getModule("com.acme.timer")?.name).toBe("Timer");
    expect(listModules().map((m) => m.id)).toEqual(["com.acme.timer"]);
  });

  it("wires the module's reducer under its namespace via the host", () => {
    registerModule(manifest(), (host) => host.registerReducer({ apply: () => {} }));
    expect(getModuleReducer("com.acme.timer")).toBeDefined();
  });

  it("rejects a mutationKind outside the module namespace", () => {
    expect(() => registerModule(manifest({ mutationKinds: ["com.other/HACK"] }))).toThrow(/namespace/);
  });

  it("rejects an entity type outside the module namespace", () => {
    expect(() => registerModule(manifest({ entities: ["com.other/thing"] }))).toThrow(/namespace/);
  });

  it("disposer unregisters the module and its reducer", () => {
    const dispose = registerModule(manifest(), (host) => host.registerReducer({ apply: () => {} }));
    dispose();
    expect(getModule("com.acme.timer")).toBeUndefined();
    expect(getModuleReducer("com.acme.timer")).toBeUndefined();
  });

  it("binds a declared dock surface to a component via the host", () => {
    registerModule(
      manifest({ contributes: { surfaces: [{ type: "dock", id: "timer.main", title: "Timer" }] } }),
      (host) => host.contribute.surface("timer.main", () => null),
    );
    expect(listDockSurfaces().map((s) => s.componentKey)).toEqual(["com.acme.timer:timer.main"]);
  });

  it("throws when binding a surface the manifest did not declare", () => {
    expect(() =>
      registerModule(manifest(), (host) => host.contribute.surface("ghost", () => null)),
    ).toThrow(/not declared/);
  });

  it("rejects a manifest declaring a surface its trust tier may not contribute", () => {
    expect(() =>
      registerModule(manifest({ contributes: { surfaces: [{ type: "rail", id: "side", title: "Side" }] } })),
    ).toThrow(/may not contribute/);
  });

  it("disposer also removes the module's dock surfaces", () => {
    const dispose = registerModule(
      manifest({ contributes: { surfaces: [{ type: "dock", id: "timer.main", title: "Timer" }] } }),
      (host) => host.contribute.surface("timer.main", () => null),
    );
    dispose();
    expect(listDockSurfaces()).toHaveLength(0);
  });

  it("allows a headless module with no setup", () => {
    registerModule(manifest({ id: "com.acme.headless", name: "Headless", namespace: "com.acme.headless", entities: [], mutationKinds: [] }));
    expect(getModule("com.acme.headless")?.name).toBe("Headless");
  });

  it("rolls back a reducer if a later setup step throws (atomic registration)", () => {
    expect(() =>
      registerModule(manifest(), (host) => {
        host.registerReducer({ apply: () => {} });
        host.contribute.surface("ghost", () => null); // not declared -> throws
      }),
    ).toThrow(/not declared/);
    // The reducer registered before the throw must have been rolled back.
    expect(getModuleReducer("com.acme.timer")).toBeUndefined();
    expect(getModule("com.acme.timer")).toBeUndefined();
  });
});
