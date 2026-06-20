import { describe, it, expect, beforeEach } from "vitest";
import { registerNotesModule, NOTES_MODULE_ID, NOTES_MAIN_PANEL_KEY } from "@/modules/notes";
import { getModule, _resetModules } from "@/modules/registry";
import { getModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { _resetDockSurfaces, dockSurfaceComponents } from "@/modules/surfaceRegistry";
import { _resetModuleInverses } from "@/state/mutations";
import { listModuleCommands, _resetModuleCommands } from "@/modules/commands";

beforeEach(() => { _resetModules(); _resetModuleReducers(); _resetDockSurfaces(); _resetModuleInverses(); _resetModuleCommands(); });

describe("Notes module registration", () => {
  it("declares its entity + mutation kinds and wires reducer", () => {
    registerNotesModule();
    const m = getModule(NOTES_MODULE_ID);
    expect(m?.entities).toContain("org.nexus.notes/note");
    expect(m?.mutationKinds).toEqual([
      "org.nexus.notes/CREATE_NOTE",
      "org.nexus.notes/SET_NOTE_FIELDS",
      "org.nexus.notes/SET_NOTE_BODY",
      "org.nexus.notes/DELETE_NOTE",
    ]);
    expect(getModuleReducer(NOTES_MODULE_ID)).toBeDefined();
  });

  it("contributes an 'Open Notes' command", () => {
    registerNotesModule();
    const cmd = listModuleCommands().find((c) => c.key === "org.nexus.notes:open");
    expect(cmd?.spec.title).toBe("Open Notes");
    expect(typeof cmd?.run).toBe("function");
  });

  it("registers the Notes dock surface under NOTES_MAIN_PANEL_KEY", () => {
    registerNotesModule();
    const components = dockSurfaceComponents();
    expect(components[NOTES_MAIN_PANEL_KEY]).toBeDefined();
  });
});
