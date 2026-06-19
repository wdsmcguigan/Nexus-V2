import "./_domStub"; // must precede any store import (sets document/localStorage)
import { describe, it, expect, vi, afterEach } from "vitest";
import { useWorkspace, setDockviewApi } from "@/state/workspace";
import type { DockviewApi } from "dockview";

describe("openModulePanel", () => {
  afterEach(() => setDockviewApi(null as unknown as DockviewApi));

  it("adds a new panel when none exists with that key", () => {
    const addPanel = vi.fn();
    setDockviewApi({ panels: [], addPanel } as unknown as DockviewApi);
    useWorkspace.getState().openModulePanel("org.nexus.tasks:tasks.main", "Tasks");
    expect(addPanel).toHaveBeenCalledTimes(1);
    expect(addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "org.nexus.tasks:tasks.main",
        component: "org.nexus.tasks:tasks.main",
        title: "Tasks",
      }),
    );
  });

  it("passes a right-docked position and a minimum width", () => {
    const addPanel = vi.fn();
    setDockviewApi({ panels: [], addPanel } as unknown as DockviewApi);
    useWorkspace.getState().openModulePanel("org.nexus.notes:notes.main", "Notes");
    const opts = addPanel.mock.calls[0]![0];
    expect(opts.position).toEqual({ direction: "right" });
    expect(opts.minimumWidth).toBe(360);
  });

  it("focuses an existing panel instead of adding a duplicate", () => {
    const setActive = vi.fn();
    const addPanel = vi.fn();
    setDockviewApi({
      panels: [{ id: "org.nexus.tasks:tasks.main", api: { setActive } }],
      addPanel,
    } as unknown as DockviewApi);
    useWorkspace.getState().openModulePanel("org.nexus.tasks:tasks.main", "Tasks");
    expect(setActive).toHaveBeenCalledTimes(1);
    expect(addPanel).not.toHaveBeenCalled();
  });
});
