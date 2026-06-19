import { describe, it, expect } from "vitest";
import { LocalStore } from "@/storage/local";
import { createLink } from "@/state/mutations";
import { taskLinkedItems } from "@/modules/tasks/links";
import { TASK_ENTITY } from "@/modules/tasks/mutations";

describe("taskLinkedItems", () => {
  it("resolves a task's tracks-link to an email with its subject as label", () => {
    const s = new LocalStore();
    // seed a message so the label resolves
    s.messages.set("msg-1", { id: "msg-1", subject: "Build #4218 succeeded" } as never);
    createLink(s, {
      srcType: TASK_ENTITY,
      srcId: "task-1",
      linkType: "tracks",
      dstType: "nexus/email.message",
      dstId: "msg-1",
    });
    const items = taskLinkedItems(s, "task-1");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      entityType: "nexus/email.message",
      entityId: "msg-1",
      label: "Build #4218 succeeded",
    });
  });

  it("returns [] for a task with no links", () => {
    expect(taskLinkedItems(new LocalStore(), "nope")).toEqual([]);
  });
});
