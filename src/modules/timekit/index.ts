import { registerModule, type ModuleManifest } from "@/modules/registry";
import { dockComponentKey } from "@/modules/surfaceRegistry";
import { TimekitPanel, type TimekitSection } from "@/modules/timekit/TimekitPanel";
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
  entities: ["org.nexus.timekit/time-entry", "org.nexus.timekit/timer", "org.nexus.timekit/alarm"],
  mutationKinds: [
    KIND.SET_ZONES, KIND.START_TRACKING, KIND.STOP_TRACKING, KIND.SET_ENTRY_NOTE, KIND.DELETE_ENTRY,
    KIND.CREATE_TIMER, KIND.START_TIMER, KIND.PAUSE_TIMER, KIND.RESUME_TIMER,
    KIND.COMPLETE_TIMER, KIND.RESET_TIMER, KIND.DELETE_TIMER,
    KIND.CREATE_ALARM, KIND.SET_ALARM_ENABLED, KIND.FIRE_ALARM, KIND.DELETE_ALARM,
  ],
  capabilities: { "ui.contribute": ["dock", "command"] },
  trust: "core",
  contributes: {
    surfaces: [
      { type: "dock", id: TIMEKIT_MAIN_SURFACE_ID, title: "Clock", icon: "clock", detachable: false },
    ],
    commands: [
      { id: "open", title: "Open Clock", icon: "clock" },
      { id: "start-tracking", title: "Start time tracking", icon: "clock" },
      { id: "new-timer", title: "New timer", icon: "clock" },
      { id: "new-alarm", title: "New alarm", icon: "clock" },
    ],
  },
};

let _launchNonce = 0; // module-local; makes each command launch distinct (event, not state)
function openAt(section: TimekitSection): void {
  _launchNonce += 1;
  useWorkspace.getState().openModulePanel(TIMEKIT_MAIN_PANEL_KEY, "Clock", { section, nonce: _launchNonce });
}

/** Register the Timekit module. Wires reducer, inverse, dock surface, and commands. */
export function registerTimekitModule(): () => void {
  return registerModule(manifest, (host) => {
    host.registerReducer(timekitReducer);
    host.registerInverse(timekitInverse);
    host.contribute.surface(TIMEKIT_MAIN_SURFACE_ID, TimekitPanel);
    host.contribute.command("open", () => openAt("clock"));
    host.contribute.command("start-tracking", () => openAt("tracker"));
    host.contribute.command("new-timer", () => openAt("timers"));
    host.contribute.command("new-alarm", () => openAt("alarms"));
  });
}
