import { describe, it, expect, beforeEach } from "vitest";
import { registerTasksModule, TASKS_MODULE_ID } from "@/modules/tasks";
import { getModule, _resetModules } from "@/modules/registry";
import { getModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { _resetDockSurfaces } from "@/modules/surfaceRegistry";
import { _resetModuleInverses } from "@/state/mutations";

beforeEach(() => { _resetModules(); _resetModuleReducers(); _resetDockSurfaces(); _resetModuleInverses(); });

describe("Tasks module registration", () => {
  it("declares its entity + mutation kinds and wires reducer", () => {
    registerTasksModule();
    const m = getModule(TASKS_MODULE_ID);
    expect(m?.entities).toContain("org.nexus.tasks/task");
    expect(m?.mutationKinds).toEqual([
      "org.nexus.tasks/CREATE_TASK",
      "org.nexus.tasks/SET_TASK_STATUS",
      "org.nexus.tasks/SET_TASK_FIELDS",
      "org.nexus.tasks/REORDER_TASK",
      "org.nexus.tasks/DELETE_TASK",
    ]);
    expect(getModuleReducer(TASKS_MODULE_ID)).toBeDefined();
  });
});
