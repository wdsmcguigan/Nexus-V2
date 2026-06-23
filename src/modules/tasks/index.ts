import { registerModule, type ModuleManifest } from "@/modules/registry";
import { dockComponentKey } from "@/modules/surfaceRegistry";
import { TasksPanel } from "@/modules/tasks/TasksPanel";
import { tasksReducer } from "@/modules/tasks/reducer";
import { tasksInverse, KIND } from "@/modules/tasks/mutations";
import { useWorkspace } from "@/state/workspace";

export const TASKS_MODULE_ID = "org.nexus.tasks";
export const TASKS_MAIN_SURFACE_ID = "tasks.main";

/** The dockview component key / panel id for the Tasks main dock surface. */
export const TASKS_MAIN_PANEL_KEY = dockComponentKey(TASKS_MODULE_ID, TASKS_MAIN_SURFACE_ID);

const manifest: ModuleManifest = {
  id: TASKS_MODULE_ID,
  name: "Tasks",
  version: "0.1.0",
  namespace: TASKS_MODULE_ID,
  entities: ["org.nexus.tasks/task"],
  mutationKinds: [KIND.CREATE, KIND.STATUS, KIND.FIELDS, KIND.REORDER, KIND.DELETE],
  capabilities: { "ui.contribute": ["dock"] },
  trust: "core",
  contributes: {
    surfaces: [
      { type: "dock", id: TASKS_MAIN_SURFACE_ID, title: "Tasks", icon: "check", color: "link-11", detachable: false },
    ],
    commands: [{ id: "open", title: "Open Tasks", icon: "check", shortcut: "t" }],
  },
};

/**
 * Register the Tasks module. Wires reducer, inverse, and dock surface contribution.
 * Returns the registry disposer.
 */
export function registerTasksModule(): () => void {
  return registerModule(manifest, (host) => {
    host.registerReducer(tasksReducer);
    host.registerInverse(tasksInverse);
    host.contribute.surface(TASKS_MAIN_SURFACE_ID, TasksPanel);
    host.contribute.command("open", () => {
      useWorkspace.getState().openModulePanel(TASKS_MAIN_PANEL_KEY, "Tasks");
    });
  });
}
