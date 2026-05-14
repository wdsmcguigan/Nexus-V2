/**
 * Phase 0g: Index schema assertions.
 * Verifies that every index from docs/architecture.md §5 exists on LocalStore
 * and is correctly maintained after putMessage/deleteMessage.
 */

import { describe, it, expect } from "vitest";
import { LocalStore } from "@/storage/local";
import { makeSeedStore, LABEL_IDS, FOLDER_IDS, STATUS_IDS, CFD_IDS } from "./seed";

describe("LocalStore index schema", () => {
  it("has all required inverted index properties (architecture.md §5)", () => {
    const store = new LocalStore();
    expect(store.messagesByLabel).toBeInstanceOf(Map);
    expect(store.labelsByMessage).toBeInstanceOf(Map);
    expect(store.messagesByTag).toBeInstanceOf(Map);
    expect(store.messagesByFolder).toBeInstanceOf(Map);
    expect(store.messagesByStatus).toBeInstanceOf(Map);
    expect(store.messagesByPriority).toBeInstanceOf(Map);
    expect(store.messagesByThread).toBeInstanceOf(Map);
    expect(store.messagesByCustomField).toBeInstanceOf(Map);
  });

  it("messagesByLabel and labelsByMessage are maintained symmetrically", () => {
    const store = makeSeedStore();

    const inWork = store.messagesByLabel.get(LABEL_IDS.work) ?? new Set();
    for (const msgId of inWork) {
      const msgLabels = store.labelsByMessage.get(msgId) ?? new Set();
      expect(msgLabels.has(LABEL_IDS.work)).toBe(true);
    }
    for (const [msgId, lblSet] of store.labelsByMessage) {
      if (lblSet.has(LABEL_IDS.work)) {
        expect(inWork.has(msgId)).toBe(true);
      }
    }
  });

  it("messagesByFolder index is maintained on putMessage and deleteMessage", () => {
    const store = makeSeedStore();

    const beforeCount = store.messagesByFolder.get(FOLDER_IDS.inbox)?.size ?? 0;
    expect(beforeCount).toBeGreaterThan(0);

    const msg = store.messages.get("m1")!;
    const newMsg = { ...msg, id: "m-new", threadId: "t-new" };
    store.putMessage(newMsg);

    const afterCount = store.messagesByFolder.get(FOLDER_IDS.inbox)?.size ?? 0;
    expect(afterCount).toBe(beforeCount + 1);

    store.deleteMessage("m-new");
    expect(store.messagesByFolder.get(FOLDER_IDS.inbox)?.size ?? 0).toBe(beforeCount);
  });

  it("messagesByStatus index is maintained", () => {
    const store = makeSeedStore();

    const inTriage = store.messagesByStatus.get(STATUS_IDS.triage)?.size ?? 0;
    expect(inTriage).toBeGreaterThan(0);

    const msgId = Array.from(store.messagesByStatus.get(STATUS_IDS.triage) ?? [])[0]!;
    const msg = store.messages.get(msgId)!;
    store.putMessage({ ...msg, statusId: STATUS_IDS.done });

    expect(store.messagesByStatus.get(STATUS_IDS.triage)?.size ?? 0).toBe(inTriage - 1);
    expect(store.messagesByStatus.get(STATUS_IDS.done)?.has(msgId)).toBe(true);
  });

  it("messagesByPriority index uses numeric keys only", () => {
    const store = makeSeedStore();

    for (const key of store.messagesByPriority.keys()) {
      expect(typeof key).toBe("number");
      expect([1, 2, 3, 4]).toContain(key);
    }
  });

  it("messagesByThread index contains every message in its thread set", () => {
    const store = makeSeedStore();

    for (const msg of store.messages.values()) {
      const inThread = store.messagesByThread.get(msg.threadId) ?? new Set();
      expect(inThread.has(msg.id)).toBe(true);
    }
  });

  it("messagesByCustomField EAV index has entries for seeded custom fields", () => {
    const store = makeSeedStore();

    const fieldMap = store.messagesByCustomField.get(CFD_IDS.project);
    expect(fieldMap).toBeDefined();
    expect(fieldMap!.size).toBeGreaterThan(0);
  });

  it("messagesByTag index is maintained on put/delete", () => {
    const store = makeSeedStore();

    const tagged = store.messagesByTag.get("urgent")?.size ?? 0;
    expect(tagged).toBeGreaterThan(0);

    const msg = store.messages.get("m1")!;
    store.putMessage({ ...msg, id: "m-tag-test", threadId: "t-tag", tags: ["urgent"] });
    expect(store.messagesByTag.get("urgent")?.size ?? 0).toBe(tagged + 1);

    store.deleteMessage("m-tag-test");
    expect(store.messagesByTag.get("urgent")?.size ?? 0).toBe(tagged);
  });

  it("labelsByMessage is cleaned up on deleteMessage", () => {
    const store = makeSeedStore();

    store.deleteMessage("m1");
    expect(store.labelsByMessage.has("m1")).toBe(false);
    expect(store.messages.has("m1")).toBe(false);
  });

  it("messagesByLabel cascade: deleteLabel removes label from all messages", () => {
    const store = makeSeedStore();

    const countBefore = store.messagesByLabel.get(LABEL_IDS.work)?.size ?? 0;
    expect(countBefore).toBeGreaterThan(0);

    store.deleteLabel(LABEL_IDS.work);

    expect(store.labels.has(LABEL_IDS.work)).toBe(false);
    for (const msg of store.messages.values()) {
      expect(msg.labelIds).not.toContain(LABEL_IDS.work);
    }
  });
});
