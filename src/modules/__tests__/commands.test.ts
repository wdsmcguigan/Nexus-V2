import { describe, it, expect, beforeEach } from "vitest";
import {
  moduleCommandKey, registerModuleCommand, listModuleCommands, _resetModuleCommands, moduleCommandForKey,
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

describe("moduleCommandForKey", () => {
  beforeEach(() => _resetModuleCommands());

  it("matches a command's declared shortcut (case-insensitive)", () => {
    registerModuleCommand("org.nexus.tasks", { id: "open", title: "Open Tasks", shortcut: "t" }, run);
    const cmds = listModuleCommands();
    expect(moduleCommandForKey("t", cmds)?.key).toBe("org.nexus.tasks:open");
    expect(moduleCommandForKey("T", cmds)?.key).toBe("org.nexus.tasks:open");
  });
  it("returns null for a reserved key even if a command declares it (core wins)", () => {
    registerModuleCommand("org.nexus.tasks", { id: "x", title: "X", shortcut: "c" }, run); // c = compose
    expect(moduleCommandForKey("c", listModuleCommands())).toBeNull();
  });
  it("returns null when no command declares the key", () => {
    registerModuleCommand("org.nexus.tasks", { id: "open", title: "Open Tasks", shortcut: "t" }, run);
    expect(moduleCommandForKey("q", listModuleCommands())).toBeNull();
  });
  it("returns null when a command has no shortcut", () => {
    registerModuleCommand("org.nexus.notes", { id: "open", title: "Open Notes" }, run);
    expect(moduleCommandForKey("t", listModuleCommands())).toBeNull();
  });
  it("first registration wins on a module-vs-module collision", () => {
    registerModuleCommand("org.nexus.tasks", { id: "open", title: "Open Tasks", shortcut: "y" }, run);
    registerModuleCommand("org.nexus.notes", { id: "open", title: "Open Notes", shortcut: "y" }, run);
    expect(moduleCommandForKey("y", listModuleCommands())?.key).toBe("org.nexus.tasks:open");
  });
});
