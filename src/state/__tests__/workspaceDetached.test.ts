/**
 * Detached windows are per-workspace. Switching workspaces must tear down the
 * outgoing workspace's pop-outs and re-open the incoming one's — without leaking
 * one workspace's detached set into another.
 *
 * The detach lifecycle is Tauri-gated, so we mock @/storage/tauri to simulate a
 * desktop environment (isTauri → true) with fake window IPC.
 */

import "./_domStub"; // must precede any store import (sets document/localStorage)
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/storage/tauri", () => ({
  isTauri: () => true,
  openPopoutWindow: vi.fn(async () => "popout-viewer-new"),
  closePopoutWindow: vi.fn(async () => {}),
  broadcastUiPref: vi.fn(async () => {}),
  applyMutationIpc: vi.fn(async () => {}),
}));

import { useWorkspace } from "@/state/workspace";
import { makeDefaultWorkspace, type DetachedWindowSnapshot } from "@/storage/workspaceManager";
import * as tauri from "@/storage/tauri";

const flush = () => new Promise((r) => setTimeout(r, 0));
const snapOf = (id: string) =>
  useWorkspace.getState().workspaces.find((w) => w.id === id)!;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  const a = { ...makeDefaultWorkspace(), id: "wsA", name: "A", detachedWindows: [] };
  const b = { ...makeDefaultWorkspace(), id: "wsB", name: "B", detachedWindows: [] };
  useWorkspace.setState({ workspaces: [a, b], activeWorkspaceId: "wsA", detachedWindows: {} });
});

describe("detached windows ↔ workspace switching", () => {
  it("closes the outgoing windows and clears the runtime registry on switch", () => {
    useWorkspace.getState().trackDetachedWindow("popout-viewer-x", "viewer", "m1");
    expect(useWorkspace.getState().detachedWindows["popout-viewer-x"]).toBeTruthy();

    useWorkspace.getState().switchWorkspace("wsB");

    expect(tauri.closePopoutWindow).toHaveBeenCalledWith("popout-viewer-x");
    expect(useWorkspace.getState().detachedWindows).toEqual({});
  });

  it("does not leak one workspace's detached set into another", () => {
    useWorkspace.getState().trackDetachedWindow("popout-viewer-x", "viewer", "m1");
    useWorkspace.getState().switchWorkspace("wsB");

    expect(snapOf("wsA").detachedWindows).toHaveLength(1);
    expect(snapOf("wsB").detachedWindows ?? []).toHaveLength(0);
  });

  it("a trailing close event after a switch is a no-op (no contamination)", () => {
    useWorkspace.getState().trackDetachedWindow("popout-viewer-x", "viewer", "m1");
    useWorkspace.getState().switchWorkspace("wsB");
    // Simulate the outgoing window's popout:closed arriving late.
    useWorkspace.getState().untrackDetachedWindow("popout-viewer-x");

    expect(snapOf("wsB").detachedWindows ?? []).toHaveLength(0);
    expect(snapOf("wsA").detachedWindows).toHaveLength(1);
  });

  it("restoreDetachedWindows re-opens the active workspace's saved set", async () => {
    useWorkspace.setState((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === "wsA"
          ? { ...w, detachedWindows: [{ kind: "viewer", targetId: "m1", geometry: null }] as DetachedWindowSnapshot[] }
          : w,
      ),
    }));

    await useWorkspace.getState().restoreDetachedWindows(true);

    expect(tauri.openPopoutWindow).toHaveBeenCalledWith(
      "viewer",
      expect.objectContaining({ targetId: "m1" }),
    );
    expect(useWorkspace.getState().detachedWindows["popout-viewer-new"]).toMatchObject({
      kind: "viewer",
      targetId: "m1",
    });
  });

  it("round-trips: detach in A, switch A→B→A, and A's window re-opens", async () => {
    useWorkspace.getState().trackDetachedWindow("popout-viewer-x", "viewer", "m1");

    useWorkspace.getState().switchWorkspace("wsB");
    await flush();
    expect(Object.keys(useWorkspace.getState().detachedWindows)).toHaveLength(0);

    useWorkspace.getState().switchWorkspace("wsA");
    await flush();
    expect(tauri.openPopoutWindow).toHaveBeenCalledWith(
      "viewer",
      expect.objectContaining({ targetId: "m1" }),
    );
    expect(Object.keys(useWorkspace.getState().detachedWindows)).toHaveLength(1);
  });
});
