import { registerModule, type ModuleManifest } from "@/modules/registry";
import { dockComponentKey } from "@/modules/surfaceRegistry";
import { TimekitPanel } from "@/modules/timekit/TimekitPanel";
import { timekitReducer } from "@/modules/timekit/reducer";
import { timekitInverse, KIND } from "@/modules/timekit/mutations";
import { useWorkspace } from "@/state/workspace";

export const TIMEKIT_MODULE_ID = "org.nexus.timekit";
export const TIMEKIT_MAIN_SURFACE_ID = "timekit.main";

/** The dockview component key / panel id for the Timekit main dock surface. */
export const TIMEKIT_MAIN_PANEL_KEY = dockComponentKey(TIMEKIT_MODULE_ID, TIMEKIT_MAIN_SURFACE_ID);

const manifest: ModuleManifest = {
  id: TIMEKIT_MODULE_ID,
  name: "Clock",
  version: "0.1.0",
  namespace: TIMEKIT_MODULE_ID,
  entities: [],
  mutationKinds: [KIND.SET_ZONES],
  capabilities: { "ui.contribute": ["dock", "command"] },
  trust: "core",
  contributes: {
    surfaces: [
      { type: "dock", id: TIMEKIT_MAIN_SURFACE_ID, title: "Clock", icon: "clock", detachable: false },
    ],
    commands: [{ id: "open", title: "Open Clock", icon: "clock" }],
  },
};

/** Register the Timekit module. Wires reducer, inverse, dock surface, and commands. */
export function registerTimekitModule(): () => void {
  return registerModule(manifest, (host) => {
    host.registerReducer(timekitReducer);
    host.registerInverse(timekitInverse);
    host.contribute.surface(TIMEKIT_MAIN_SURFACE_ID, TimekitPanel);
    host.contribute.command("open", () => {
      useWorkspace.getState().openModulePanel(TIMEKIT_MAIN_PANEL_KEY, "Clock");
    });
  });
}
