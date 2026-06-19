import { describe, it, expect } from "vitest";
import { sortTasks, groupTasksByStatus } from "@/modules/tasks/sort";
import type { Task } from "@/data/types";

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t", vaultId: "v", title: "A", status: "needs-action",
    dueAt: null, notes: null, priority: null, assignee: null,
    order: 0, createdAt: 0, updatedAt: 0, ...over,
  };
}

describe("tasks hook logic", () => {
  it("sortTasks orders by order then createdAt", () => {
    const a = task({ id: "a", order: 2, createdAt: 1 });
    const b = task({ id: "b", order: 1, createdAt: 5 });
    const c = task({ id: "c", order: 1, createdAt: 2 });
    expect(sortTasks([a, b, c]).map((t) => t.id)).toEqual(["c", "b", "a"]);
  });

  it("sortTasks does not mutate its input", () => {
    const input = [task({ id: "a", order: 2 }), task({ id: "b", order: 1 })];
    sortTasks(input);
    expect(input.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("groupTasksByStatus has an entry for every status, including empties", () => {
    const g = groupTasksByStatus([task({ id: "a", status: "needs-action" })]);
    expect([...g.keys()]).toEqual(["needs-action", "in-process", "completed"]);
    expect(g.get("needs-action")?.map((t) => t.id)).toEqual(["a"]);
    expect(g.get("in-process")).toEqual([]);
    expect(g.get("completed")).toEqual([]);
  });

  it("groupTasksByStatus sorts each group", () => {
    const g = groupTasksByStatus([
      task({ id: "a", status: "needs-action", order: 2 }),
      task({ id: "b", status: "needs-action", order: 1 }),
    ]);
    expect(g.get("needs-action")?.map((t) => t.id)).toEqual(["b", "a"]);
  });
});
