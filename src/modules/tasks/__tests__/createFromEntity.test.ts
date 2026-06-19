import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { undoLastMutation, _resetModuleInverses, _resetUndoStacks, registerModuleInverse } from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { tasksReducer } from "@/modules/tasks/reducer";
import { tasksInverse, TASKS_NS, createTaskFromEntity, TASK_ENTITY } from "@/modules/tasks/mutations";
import { linksFrom } from "@/state/linksGraph";

const EMAIL_ENT = "nexus/email.message";

function wire(): LocalStore {
  const s = new LocalStore();
  registerModuleReducer(TASKS_NS, tasksReducer);
  registerModuleInverse(TASKS_NS, tasksInverse);
  return s;
}
beforeEach(() => { _resetModuleReducers(); _resetModuleInverses(); _resetUndoStacks(); });

describe("createTaskFromEntity", () => {
  it("creates a task AND a 'tracks' link to the source entity", () => {
    const s = wire();
    const t = createTaskFromEntity(EMAIL_ENT, "msg-1", "Follow up on build", s);
    expect(s.tasks.get(t.id)?.title).toBe("Follow up on build");
    const links = linksFrom(s, TASK_ENTITY, t.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ linkType: "tracks", dstType: EMAIL_ENT, dstId: "msg-1" });
    expect(links[0]!.srcType).toBe(TASK_ENTITY);
    expect(links[0]!.srcId).toBe(t.id);
  });

  it("one undo removes BOTH the task and the link (atomic)", () => {
    const s = wire();
    const t = createTaskFromEntity(EMAIL_ENT, "msg-1", "X", s);
    expect(undoLastMutation(s)).toBeTruthy();
    expect(s.tasks.has(t.id)).toBe(false);
    expect(linksFrom(s, TASK_ENTITY, t.id)).toHaveLength(0);
  });
});
