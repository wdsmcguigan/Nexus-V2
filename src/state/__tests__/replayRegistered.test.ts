import { describe, it, expect, beforeEach } from "vitest";
import type { Mutation } from "@/data/types";
import { LocalStore } from "@/storage/local";
import { replayRegisteredModules, _resetModuleInverses } from "@/state/mutations";
import { _resetModuleReducers } from "@/state/moduleReducers";
import { registerModule, _resetModules } from "@/modules/registry";
import { _resetDockSurfaces } from "@/modules/surfaceRegistry";

beforeEach(() => { _resetModules(); _resetModuleReducers(); _resetDockSurfaces(); _resetModuleInverses(); });

describe("replayRegisteredModules", () => {
  it("rebuilds a module projection from the hydrated mutation log", () => {
    const store = new LocalStore();
    store.mutations.push({ id: "m1", vaultId: "v", deviceId: "d", ts: 1, lamport: 1,
      kind: "com.acme.x/PUT", payload: { id: "a" } } as Mutation);
    const seen: string[] = [];
    registerModule({ id: "com.acme.x", name: "X", version: "1", namespace: "com.acme.x",
      entities: [], mutationKinds: [], capabilities: {}, trust: "core" },
      (host) => host.registerReducer({ apply: (_k, p) => { seen.push((p as { id: string }).id); } }));
    replayRegisteredModules(store);
    expect(seen).toEqual(["a"]);
  });
});
