import { describe, it, expect, beforeEach } from "vitest";
import {
  dockComponentKey,
  registerDockSurface,
  listDockSurfaces,
  dockSurfaceComponents,
  _resetDockSurfaces,
} from "@/modules/surfaceRegistry";
import type { SurfaceSpec } from "@/modules/surfaces";

const spec: SurfaceSpec = { type: "dock", id: "tasks.main", title: "Tasks" };
const Comp = () => null;

beforeEach(() => _resetDockSurfaces());

describe("dock surface registry", () => {
  it("builds a namespaced component key", () => {
    expect(dockComponentKey("org.nexus.tasks", "tasks.main")).toBe("org.nexus.tasks:tasks.main");
  });

  it("registers a dock surface and lists it", () => {
    registerDockSurface("org.nexus.tasks", spec, Comp);
    const all = listDockSurfaces();
    expect(all).toHaveLength(1);
    expect(all[0]!.componentKey).toBe("org.nexus.tasks:tasks.main");
    expect(all[0]!.component).toBe(Comp);
  });

  it("exposes a dockview-ready component map keyed by component key", () => {
    registerDockSurface("org.nexus.tasks", spec, Comp);
    expect(dockSurfaceComponents()).toEqual({ "org.nexus.tasks:tasks.main": Comp });
  });

  it("rejects a duplicate surface key", () => {
    registerDockSurface("org.nexus.tasks", spec, Comp);
    expect(() => registerDockSurface("org.nexus.tasks", spec, Comp)).toThrow(/already registered/);
  });

  it("disposer removes the surface", () => {
    const dispose = registerDockSurface("org.nexus.tasks", spec, Comp);
    dispose();
    expect(listDockSurfaces()).toHaveLength(0);
  });
});
