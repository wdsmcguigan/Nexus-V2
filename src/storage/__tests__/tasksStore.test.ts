import { describe, it, expect } from "vitest";
import { LocalStore } from "@/storage/local";
import type { Task } from "@/data/types";

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1", vaultId: "v", title: "A", status: "needs-action",
    dueAt: null, notes: null, priority: null, assignee: null,
    order: 0, createdAt: 1, updatedAt: 1, ...over,
  };
}

describe("LocalStore tasks projection", () => {
  it("putTask stores the task and indexes it by status", () => {
    const s = new LocalStore();
    s.putTask(task({ id: "t1", status: "needs-action" }));
    expect(s.tasks.get("t1")?.title).toBe("A");
    expect([...(s.tasksByStatus.get("needs-action") ?? [])]).toEqual(["t1"]);
  });

  it("putTask re-indexes when status changes", () => {
    const s = new LocalStore();
    s.putTask(task({ id: "t1", status: "needs-action" }));
    s.putTask(task({ id: "t1", status: "completed" }));
    expect(s.tasksByStatus.get("needs-action")?.has("t1") ?? false).toBe(false);
    expect(s.tasksByStatus.get("completed")?.has("t1") ?? false).toBe(true);
  });

  it("deleteTask removes the task and its index entry", () => {
    const s = new LocalStore();
    s.putTask(task({ id: "t1", status: "needs-action" }));
    s.deleteTask("t1");
    expect(s.tasks.has("t1")).toBe(false);
    expect(s.tasksByStatus.get("needs-action")?.has("t1") ?? false).toBe(false);
  });

  it("putTask bumps the store version (notifies subscribers)", () => {
    const s = new LocalStore();
    const v0 = s.version;
    s.putTask(task({ id: "t1" }));
    expect(s.version).toBeGreaterThan(v0);
  });

  it("deleteTask bumps the store version (notifies subscribers)", () => {
    const s = new LocalStore();
    s.putTask(task({ id: "t1" }));
    const v1 = s.version;
    s.deleteTask("t1");
    expect(s.version).toBeGreaterThan(v1);
  });
});
