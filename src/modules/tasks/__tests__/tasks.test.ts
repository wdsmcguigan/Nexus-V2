import { describe, it, expect, beforeEach } from "vitest";
import { registerTasksModule, TASKS_MODULE_ID, TASKS_MAIN_SURFACE_ID, TASKS_MAIN_PANEL_KEY } from "@/modules/tasks";
import { TasksPanel } from "@/modules/tasks/TasksPanel";
import { getModule, _resetModules } from "@/modules/registry";
import { listDockSurfaces, _resetDockSurfaces } from "@/modules/surfaceRegistry";
import { _resetModuleReducers } from "@/state/moduleReducers";

beforeEach(() => {
  _resetModules();
  _resetModuleReducers();
  _resetDockSurfaces();
});

describe("Tasks module (skeleton)", () => {
  it("registers under the org.nexus.tasks namespace as a core module", () => {
    registerTasksModule();
    const mod = getModule(TASKS_MODULE_ID);
    expect(mod?.name).toBe("Tasks");
    expect(mod?.trust).toBe("core");
  });

  it("declares one dock surface in its manifest", () => {
    registerTasksModule();
    const mod = getModule(TASKS_MODULE_ID);
    expect(mod?.contributes?.surfaces).toEqual([
      expect.objectContaining({ type: "dock", id: TASKS_MAIN_SURFACE_ID, title: "Tasks" }),
    ]);
  });

  it("binds the TasksPanel component under TASKS_MAIN_PANEL_KEY", () => {
    registerTasksModule();
    const surfaces = listDockSurfaces();
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]!.componentKey).toBe(TASKS_MAIN_PANEL_KEY);
    expect(TASKS_MAIN_PANEL_KEY).toBe("org.nexus.tasks:tasks.main");
    expect(surfaces[0]!.component).toBe(TasksPanel);
  });

  it("returns a disposer that unregisters the module and its surface", () => {
    const dispose = registerTasksModule();
    dispose();
    expect(getModule(TASKS_MODULE_ID)).toBeUndefined();
    expect(listDockSurfaces()).toHaveLength(0);
  });
});
