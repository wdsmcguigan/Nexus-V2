import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { undoLastMutation, _resetModuleInverses, _resetUndoStacks, registerModuleInverse } from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { tasksReducer } from "@/modules/tasks/reducer";
import {
  tasksInverse, TASKS_NS,
  createTaskMutation, setTaskStatusMutation, setTaskFieldsMutation,
  reorderTaskMutation, deleteTaskMutation,
} from "@/modules/tasks/mutations";

function wire(): LocalStore {
  const store = new LocalStore();
  registerModuleReducer(TASKS_NS, tasksReducer);
  registerModuleInverse(TASKS_NS, tasksInverse);
  return store;
}

beforeEach(() => { _resetModuleReducers(); _resetModuleInverses(); _resetUndoStacks(); });

describe("tasks data layer", () => {
  it("createTaskMutation adds a task; undo removes it", () => {
    const s = wire();
    const t = createTaskMutation({ title: "Buy milk" }, s);
    expect(s.tasks.get(t.id)?.title).toBe("Buy milk");
    expect(s.tasks.get(t.id)?.status).toBe("needs-action");
    undoLastMutation(s);
    expect(s.tasks.has(t.id)).toBe(false);
  });

  it("setTaskStatusMutation changes status; undo restores prior status", () => {
    const s = wire();
    const t = createTaskMutation({ title: "X" }, s);
    setTaskStatusMutation(t.id, "completed", s);
    expect(s.tasks.get(t.id)?.status).toBe("completed");
    undoLastMutation(s);
    expect(s.tasks.get(t.id)?.status).toBe("needs-action");
  });

  it("setTaskFieldsMutation patches only given fields; undo restores them", () => {
    const s = wire();
    const t = createTaskMutation({ title: "X", priority: 3 }, s);
    setTaskFieldsMutation(t.id, { title: "Y", dueAt: 999 }, s);
    expect(s.tasks.get(t.id)).toMatchObject({ title: "Y", dueAt: 999, priority: 3 });
    undoLastMutation(s);
    expect(s.tasks.get(t.id)).toMatchObject({ title: "X", dueAt: null, priority: 3 });
  });

  it("reorderTaskMutation updates order/status; undo restores", () => {
    const s = wire();
    const t = createTaskMutation({ title: "X" }, s);
    reorderTaskMutation(t.id, 5, "in-process", s);
    expect(s.tasks.get(t.id)).toMatchObject({ order: 5, status: "in-process" });
    undoLastMutation(s);
    expect(s.tasks.get(t.id)).toMatchObject({ order: 0, status: "needs-action" });
  });

  it("deleteTaskMutation removes a task; undo restores the full task", () => {
    const s = wire();
    const t = createTaskMutation({ title: "X", priority: 2 }, s);
    deleteTaskMutation(t.id, s);
    expect(s.tasks.has(t.id)).toBe(false);
    undoLastMutation(s);
    expect(s.tasks.get(t.id)).toMatchObject({ title: "X", priority: 2 });
  });
});
