import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { undoLastMutation, _resetModuleInverses, _resetUndoStacks, registerModuleInverse } from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { timekitReducer } from "@/modules/timekit/reducer";
import { timekitInverse, TIMEKIT_NS, startTrackingWithTask } from "@/modules/timekit/mutations";
import { entryTrackedTask } from "@/modules/timekit/links";
import type { Task } from "@/data/types";

function wire(): LocalStore {
  const s = new LocalStore();
  registerModuleReducer(TIMEKIT_NS, timekitReducer);
  registerModuleInverse(TIMEKIT_NS, timekitInverse);
  return s;
}

function seedTask(s: LocalStore, id: string, title: string): void {
  const t: Task = {
    id, vaultId: "local", title, status: "needs-action",
    dueAt: null, notes: null, priority: null, assignee: null,
    order: 0, createdAt: 0, updatedAt: 0,
  };
  s.putTask(t);
}

beforeEach(() => { _resetModuleReducers(); _resetModuleInverses(); _resetUndoStacks(); });

describe("timekit tracks-link", () => {
  it("startTrackingWithTask creates entry + tracks link atomically", () => {
    const s = wire();
    seedTask(s, "task-1", "Ship timekit");
    const e = startTrackingWithTask("task-1", s);

    expect(s.timeEntries.has(e.id)).toBe(true);
    const tracked = entryTrackedTask(s, e.id);
    expect(tracked?.taskId).toBe("task-1");
    expect(tracked?.title).toBe("Ship timekit");

    // One undo reverts BOTH the link and the entry.
    undoLastMutation(s);
    expect(s.timeEntries.has(e.id)).toBe(false);
    expect(entryTrackedTask(s, e.id)).toBeNull();
  });
});
