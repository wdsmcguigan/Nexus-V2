import { registerModule, type ModuleManifest } from "@/modules/registry";
import { dockComponentKey } from "@/modules/surfaceRegistry";
import { NotesPanel } from "@/modules/notes/NotesPanel";
import { notesReducer } from "@/modules/notes/reducer";
import { notesInverse, KIND } from "@/modules/notes/mutations";
import { useWorkspace } from "@/state/workspace";

export const NOTES_MODULE_ID = "org.nexus.notes";
export const NOTES_MAIN_SURFACE_ID = "notes.main";

/** The dockview component key / panel id for the Notes main dock surface. */
export const NOTES_MAIN_PANEL_KEY = dockComponentKey(NOTES_MODULE_ID, NOTES_MAIN_SURFACE_ID);

const manifest: ModuleManifest = {
  id: NOTES_MODULE_ID,
  name: "Notes",
  version: "0.1.0",
  namespace: NOTES_MODULE_ID,
  entities: ["org.nexus.notes/note"],
  mutationKinds: [KIND.CREATE, KIND.FIELDS, KIND.BODY, KIND.DELETE],
  capabilities: { "ui.contribute": ["dock"] },
  trust: "core",
  contributes: {
    surfaces: [
      { type: "dock", id: NOTES_MAIN_SURFACE_ID, title: "Notes", icon: "notebook", detachable: false },
    ],
    commands: [{ id: "open", title: "Open Notes", icon: "notebook" }],
  },
};

/** Register the Notes module. Wires reducer, inverse, dock surface, and open command. */
export function registerNotesModule(): () => void {
  return registerModule(manifest, (host) => {
    host.registerReducer(notesReducer);
    host.registerInverse(notesInverse);
    host.contribute.surface(NOTES_MAIN_SURFACE_ID, NotesPanel);
    host.contribute.command("open", () => {
      useWorkspace.getState().openModulePanel(NOTES_MAIN_PANEL_KEY, "Notes");
    });
  });
}
