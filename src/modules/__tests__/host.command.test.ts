import { describe, it, expect, beforeEach } from "vitest";
import { registerModule, _resetModules } from "@/modules/registry";
import type { ModuleManifest } from "@/modules/registry";
import { listModuleCommands, _resetModuleCommands } from "@/modules/commands";
import { _resetModuleReducers } from "@/state/moduleReducers";
import { _resetDockSurfaces } from "@/modules/surfaceRegistry";
import { _resetModuleInverses } from "@/state/mutations";

function manifest(over: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    id: "com.acme.x", name: "X", version: "1", namespace: "com.acme.x",
    entities: [], mutationKinds: [], capabilities: {}, trust: "core", ...over,
  };
}

beforeEach(() => {
  _resetModules(); _resetModuleReducers(); _resetDockSurfaces();
  _resetModuleInverses(); _resetModuleCommands();
});

describe("host.contribute.command", () => {
  it("binds a run handler to a manifest-declared command", () => {
    let ran = false;
    registerModule(
      manifest({ contributes: { commands: [{ id: "go", title: "Go" }] } }),
      (host) => host.contribute.command("go", () => { ran = true; }),
    );
    const cmds = listModuleCommands();
    expect(cmds.map((c) => c.key)).toEqual(["com.acme.x:go"]);
    cmds[0]!.run();
    expect(ran).toBe(true);
  });

  it("throws binding a command the manifest did not declare", () => {
    expect(() =>
      registerModule(manifest(), (host) => host.contribute.command("ghost", () => {})),
    ).toThrow(/not declared/);
  });

  it("disposer removes the command", () => {
    const dispose = registerModule(
      manifest({ contributes: { commands: [{ id: "go", title: "Go" }] } }),
      (host) => host.contribute.command("go", () => {}),
    );
    dispose();
    expect(listModuleCommands()).toHaveLength(0);
  });
});
