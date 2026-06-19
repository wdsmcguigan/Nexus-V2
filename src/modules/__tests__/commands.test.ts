import { describe, it, expect, beforeEach } from "vitest";
import {
  moduleCommandKey, registerModuleCommand, listModuleCommands, _resetModuleCommands,
} from "@/modules/commands";
import type { ModuleCommandSpec } from "@/modules/commands";

const spec: ModuleCommandSpec = { id: "open", title: "Open Tasks" };
const run = () => {};

beforeEach(() => _resetModuleCommands());

describe("module command registry", () => {
  it("builds a namespaced command key", () => {
    expect(moduleCommandKey("org.nexus.tasks", "open")).toBe("org.nexus.tasks:open");
  });
  it("registers a command and lists it", () => {
    registerModuleCommand("org.nexus.tasks", spec, run);
    const all = listModuleCommands();
    expect(all).toHaveLength(1);
    expect(all[0]!.key).toBe("org.nexus.tasks:open");
    expect(all[0]!.spec.title).toBe("Open Tasks");
    expect(all[0]!.run).toBe(run);
  });
  it("rejects a duplicate command key", () => {
    registerModuleCommand("org.nexus.tasks", spec, run);
    expect(() => registerModuleCommand("org.nexus.tasks", spec, run)).toThrow(/already registered/);
  });
  it("disposer removes the command", () => {
    const dispose = registerModuleCommand("org.nexus.tasks", spec, run);
    dispose();
    expect(listModuleCommands()).toHaveLength(0);
  });
});
