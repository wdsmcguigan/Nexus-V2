/**
 * EP-1: SavedView CRUD tests.
 * Verifies putSavedView, deleteSavedView, renameSavedView, and getSavedViewsSorted.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { saveView, deleteView, renameView } from "@/state/mutations";
import type { SavedView } from "@/data/types";

let store: LocalStore;

beforeEach(() => {
  store = new LocalStore();
  store.hydrate({
    vault: { id: "local", path: "/", createdAt: Date.now() },
    accounts: [],
    folders: [],
    labels: [],
    statuses: [],
    customFieldDefs: [],
    messages: [],
    tagUsage: [],
    mutations: [],
  });
});

describe("SavedView CRUD", () => {
  it("putSavedView stores a view and notifies listeners", () => {
    let notified = false;
    store.subscribe(() => { notified = true; });

    const view: SavedView = {
      id: "sv-1",
      vaultId: "local",
      name: "Triage work",
      filter: { statusId: "sta-triage", labelIds: ["lbl-work"] },
      position: 0,
      createdAt: Date.now(),
    };
    store.putSavedView(view);

    expect(store.savedViews.has("sv-1")).toBe(true);
    expect(store.savedViews.get("sv-1")!.name).toBe("Triage work");
    expect(notified).toBe(true);
  });

  it("deleteSavedView removes a view", () => {
    store.putSavedView({
      id: "sv-2", vaultId: "local", name: "Test", filter: {}, position: 0, createdAt: Date.now(),
    });
    expect(store.savedViews.has("sv-2")).toBe(true);

    store.deleteSavedView("sv-2");
    expect(store.savedViews.has("sv-2")).toBe(false);
  });

  it("renameSavedView updates the name only", () => {
    const originalFilter = { statusId: "sta-triage" };
    store.putSavedView({
      id: "sv-3", vaultId: "local", name: "Old name", filter: originalFilter, position: 0, createdAt: Date.now(),
    });

    store.renameSavedView("sv-3", "New name");
    const updated = store.savedViews.get("sv-3")!;
    expect(updated.name).toBe("New name");
    expect(updated.filter).toEqual(originalFilter);
  });

  it("getSavedViewsSorted returns views ordered by position", () => {
    store.putSavedView({ id: "sv-b", vaultId: "local", name: "B", filter: {}, position: 1, createdAt: Date.now() });
    store.putSavedView({ id: "sv-a", vaultId: "local", name: "A", filter: {}, position: 0, createdAt: Date.now() });
    store.putSavedView({ id: "sv-c", vaultId: "local", name: "C", filter: {}, position: 2, createdAt: Date.now() });

    const sorted = store.getSavedViewsSorted();
    expect(sorted.map((v) => v.name)).toEqual(["A", "B", "C"]);
  });

  it("saveView mutation helper creates a view and records a MUTN", () => {
    const view = saveView(store, "Urgent work", { maxPriority: 1, labelIds: ["lbl-work"] });

    expect(store.savedViews.has(view.id)).toBe(true);
    expect(store.savedViews.get(view.id)!.filter.maxPriority).toBe(1);

    const mut = store.mutations.find((m) => m.kind === "SAVE_VIEW");
    expect(mut).toBeDefined();
  });

  it("deleteView mutation helper removes view and records a MUTN", () => {
    const view = saveView(store, "To delete", {});
    expect(store.savedViews.has(view.id)).toBe(true);

    deleteView(store, view.id);
    expect(store.savedViews.has(view.id)).toBe(false);
    expect(store.mutations.some((m) => m.kind === "DELETE_VIEW")).toBe(true);
  });

  it("renameView mutation helper renames and records a MUTN", () => {
    const view = saveView(store, "Original", {});
    renameView(store, view.id, "Renamed");

    expect(store.savedViews.get(view.id)!.name).toBe("Renamed");
    expect(store.mutations.some((m) => m.kind === "RENAME_VIEW")).toBe(true);
  });

  it("hydrate restores saved views from snapshot", () => {
    store.putSavedView({ id: "sv-snap", vaultId: "local", name: "Snap view", filter: { pinned: true }, position: 0, createdAt: 1000 });

    const snap = store.toSnapshot();
    const store2 = new LocalStore();
    store2.hydrate({ ...snap, messages: [] });

    expect(store2.savedViews.has("sv-snap")).toBe(true);
    expect(store2.savedViews.get("sv-snap")!.filter.pinned).toBe(true);
  });
});
