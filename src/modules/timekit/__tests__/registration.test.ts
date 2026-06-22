import { describe, it, expect, beforeEach } from "vitest";
import { registerTimekitModule, TIMEKIT_MODULE_ID } from "@/modules/timekit";
import { getModule, _resetModules } from "@/modules/registry";
import { getModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { _resetDockSurfaces } from "@/modules/surfaceRegistry";
import { _resetModuleInverses } from "@/state/mutations";
import { listModuleCommands, _resetModuleCommands } from "@/modules/commands";

beforeEach(() => {
  _resetModules(); _resetModuleReducers(); _resetDockSurfaces();
  _resetModuleInverses(); _resetModuleCommands();
});

describe("Timekit module registration", () => {
  it("registers its namespace reducer and SET_TIMEKIT_ZONES kind", () => {
    registerTimekitModule();
    const m = getModule(TIMEKIT_MODULE_ID);
    expect(m?.mutationKinds).toContain("org.nexus.timekit/SET_TIMEKIT_ZONES");
    expect(getModuleReducer(TIMEKIT_MODULE_ID)).toBeDefined();
  });

  it("contributes an 'Open Clock' command", () => {
    registerTimekitModule();
    const cmd = listModuleCommands().find((c) => c.key === "org.nexus.timekit:open");
    expect(cmd?.spec.title).toBe("Open Clock");
    expect(typeof cmd?.run).toBe("function");
  });

  it("declares the time-entry entity and a start-tracking command", () => {
    registerTimekitModule();
    const m = getModule(TIMEKIT_MODULE_ID);
    expect(m?.entities).toContain("org.nexus.timekit/time-entry");
    expect(m?.mutationKinds).toContain("org.nexus.timekit/START_TRACKING");
    const cmd = listModuleCommands().find((c) => c.key === "org.nexus.timekit:start-tracking");
    expect(cmd?.spec.title).toBe("Start time tracking");
  });

  it("declares the timer entity and a new-timer command", () => {
    registerTimekitModule();
    const m = getModule(TIMEKIT_MODULE_ID);
    expect(m?.entities).toContain("org.nexus.timekit/timer");
    expect(m?.mutationKinds).toContain("org.nexus.timekit/COMPLETE_TIMER");
    expect(listModuleCommands().find((c) => c.key === "org.nexus.timekit:new-timer")?.spec.title).toBe("New timer");
  });
});
