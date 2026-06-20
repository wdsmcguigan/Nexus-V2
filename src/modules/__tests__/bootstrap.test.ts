import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapModules, _resetBootstrapForTests } from "@/modules/bootstrap";
import { getModule, _resetModules } from "@/modules/registry";
import { dockSurfaceComponents, _resetDockSurfaces } from "@/modules/surfaceRegistry";
import { _resetModuleReducers } from "@/state/moduleReducers";
import { TASKS_MAIN_PANEL_KEY } from "@/modules/tasks";

beforeEach(() => {
  _resetModules();
  _resetModuleReducers();
  _resetDockSurfaces();
  _resetBootstrapForTests();
});

describe("bootstrapModules", () => {
  it("registers the core Tasks module", () => {
    bootstrapModules();
    expect(getModule("org.nexus.tasks")).toBeDefined();
  });

  it("populates the dockview component map with the Tasks panel", () => {
    bootstrapModules();
    expect(dockSurfaceComponents()[TASKS_MAIN_PANEL_KEY]).toBeDefined();
  });

  it("is idempotent — a second call does not throw or double-register", () => {
    bootstrapModules();
    expect(() => bootstrapModules()).not.toThrow();
    expect(getModule("org.nexus.tasks")).toBeDefined();
    // Tasks + Notes each contribute one dock surface.
    expect(Object.keys(dockSurfaceComponents())).toHaveLength(2);
  });
});
