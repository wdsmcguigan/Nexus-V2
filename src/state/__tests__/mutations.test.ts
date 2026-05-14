/**
 * Mutation round-trip tests.
 * For every MUTN kind: emit → apply → assert state.
 * Also tests mutation replay (replayMutations reconstructs state).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import {
  addLabel,
  addTag,
  archiveMessage,
  clearCustomFieldValue,
  clearFlag,
  clearPriority,
  clearStar,
  clearStatus,
  completeFlag,
  createCustomField,
  createFolder,
  createLabel,
  createStatus,
  deleteCustomField,
  deleteFolder,
  deleteLabel,
  deleteMessage,
  deleteStatus,
  deleteTagGlobal,
  moveToFolder,
  readMessage,
  receiveFromProvider,
  removeLabel,
  removeTag,
  renameFolder,
  renameLabel,
  renameStatus,
  renameTagGlobal,
  reorderLabels,
  reorderStatuses,
  setCustomFieldValue,
  setFlag,
  setMuted,
  setNote,
  setPinned,
  setPriority,
  setStar,
  setStatus,
  snoozeMessage,
  unreadMessage,
  updateCustomField,
  updateFlag,
  replayMutations,
} from "@/state/mutations";
import {
  makeSeedStore,
  LABEL_IDS,
  STATUS_IDS,
  FOLDER_IDS,
  CFD_IDS,
  VAULT_ID,
} from "@/storage/__tests__/seed";
import type { Message } from "@/data/types";

let store: LocalStore;

beforeEach(() => {
  store = makeSeedStore();
});

// ─── Folder ops ──────────────────────────────────────────────────────────────

describe("MOVE_TO_FOLDER", () => {
  it("moves message to new folder, updates indexes", () => {
    moveToFolder(store, "m1", FOLDER_IDS.personal);
    expect(store.messages.get("m1")!.folderId).toBe(FOLDER_IDS.personal);
    expect(store.messagesByFolder.get(FOLDER_IDS.personal)!.has("m1")).toBe(true);
    expect(store.messagesByFolder.get(FOLDER_IDS.inbox)!.has("m1")).toBe(false);
  });
});

describe("CREATE_FOLDER", () => {
  it("adds folder to store", () => {
    createFolder(store, {
      id: "f-new",
      vaultId: VAULT_ID,
      parentId: null,
      name: "Archive Box",
      diskSlug: "Archive-Box",
      diskPath: "Archive-Box",
    });
    expect(store.folders.has("f-new")).toBe(true);
    expect(store.folders.get("f-new")!.name).toBe("Archive Box");
  });
});

describe("RENAME_FOLDER", () => {
  it("renames the folder", () => {
    renameFolder(store, FOLDER_IDS.personal, "Family", "Family");
    expect(store.folders.get(FOLDER_IDS.personal)!.name).toBe("Family");
  });
});

describe("DELETE_FOLDER", () => {
  it("removes folder and cascades messages", () => {
    deleteFolder(store, FOLDER_IDS.personal);
    expect(store.folders.has(FOLDER_IDS.personal)).toBe(false);
    // m5 was in personal folder — it should still exist but folderId cleared
    expect(store.messages.has("m5")).toBe(true);
    expect(store.messages.get("m5")!.folderId).toBe("");
  });
});

// ─── Label ops ───────────────────────────────────────────────────────────────

describe("ADD_LABEL", () => {
  it("adds label to message, updates indexes", () => {
    addLabel(store, "m5", LABEL_IDS.work);
    expect(store.messages.get("m5")!.labelIds).toContain(LABEL_IDS.work);
    expect(store.messagesByLabel.get(LABEL_IDS.work)!.has("m5")).toBe(true);
  });

  it("is idempotent", () => {
    addLabel(store, "m1", LABEL_IDS.work); // already has work
    expect(store.messages.get("m1")!.labelIds.filter((l) => l === LABEL_IDS.work).length).toBe(1);
  });
});

describe("REMOVE_LABEL", () => {
  it("removes label from message", () => {
    removeLabel(store, "m1", LABEL_IDS.work);
    expect(store.messages.get("m1")!.labelIds).not.toContain(LABEL_IDS.work);
    expect(store.messagesByLabel.get(LABEL_IDS.work)!.has("m1")).toBe(false);
  });
});

describe("CREATE_LABEL", () => {
  it("adds label definition to store", () => {
    createLabel(store, {
      id: "lbl-design",
      vaultId: VAULT_ID,
      name: "Design",
      color: 4,
      kind: "user",
      position: 10,
    });
    expect(store.labels.has("lbl-design")).toBe(true);
  });
});

describe("RENAME_LABEL", () => {
  it("renames label", () => {
    renameLabel(store, LABEL_IDS.work, "Work Projects");
    expect(store.labels.get(LABEL_IDS.work)!.name).toBe("Work Projects");
  });
});

describe("DELETE_LABEL", () => {
  it("removes label and cascades off all messages", () => {
    deleteLabel(store, LABEL_IDS.work);
    expect(store.labels.has(LABEL_IDS.work)).toBe(false);
    for (const msg of store.messages.values()) {
      expect(msg.labelIds).not.toContain(LABEL_IDS.work);
    }
  });
});

describe("REORDER_LABELS", () => {
  it("updates positions", () => {
    reorderLabels(store, [LABEL_IDS.newsletter, LABEL_IDS.work, LABEL_IDS.personal]);
    expect(store.labels.get(LABEL_IDS.newsletter)!.position).toBe(0);
    expect(store.labels.get(LABEL_IDS.work)!.position).toBe(1);
    expect(store.labels.get(LABEL_IDS.personal)!.position).toBe(2);
  });
});

// ─── Tag ops ─────────────────────────────────────────────────────────────────

describe("ADD_TAG", () => {
  it("adds tag and increments usage", () => {
    addTag(store, "m1", "invoice");
    expect(store.messages.get("m1")!.tags).toContain("invoice");
    expect(store.tagUsage.get("invoice")!.count).toBe(1);
    expect(store.messagesByTag.get("invoice")!.has("m1")).toBe(true);
  });
});

describe("REMOVE_TAG", () => {
  it("removes tag and decrements usage", () => {
    addTag(store, "m1", "invoice");
    removeTag(store, "m1", "invoice");
    expect(store.messages.get("m1")!.tags).not.toContain("invoice");
    expect(store.tagUsage.has("invoice")).toBe(false);
  });
});

describe("RENAME_TAG_GLOBAL", () => {
  it("renames tag across all messages", () => {
    addTag(store, "m1", "foo");
    addTag(store, "m3", "foo");
    renameTagGlobal(store, "foo", "bar");
    expect(store.messages.get("m1")!.tags).toContain("bar");
    expect(store.messages.get("m3")!.tags).toContain("bar");
    expect(store.messages.get("m1")!.tags).not.toContain("foo");
    expect(store.tagUsage.has("foo")).toBe(false);
    expect(store.tagUsage.has("bar")).toBe(true);
  });
});

describe("DELETE_TAG_GLOBAL", () => {
  it("removes tag from all messages", () => {
    addTag(store, "m2", "urgent"); // m2 already has "urgent" in seed
    deleteTagGlobal(store, "urgent");
    for (const msg of store.messages.values()) {
      expect(msg.tags).not.toContain("urgent");
    }
    expect(store.tagUsage.has("urgent")).toBe(false);
  });
});

// ─── Status ops ──────────────────────────────────────────────────────────────

describe("SET_STATUS", () => {
  it("sets status and updates index", () => {
    setStatus(store, "m1", STATUS_IDS.reading);
    expect(store.messages.get("m1")!.statusId).toBe(STATUS_IDS.reading);
    expect(store.messagesByStatus.get(STATUS_IDS.reading)!.has("m1")).toBe(true);
  });
});

describe("CLEAR_STATUS", () => {
  it("clears status", () => {
    clearStatus(store, "m2");
    expect(store.messages.get("m2")!.statusId).toBeNull();
    expect(store.messagesByStatus.get(STATUS_IDS.triage)!.has("m2")).toBe(false);
  });
});

describe("CREATE_STATUS", () => {
  it("adds status definition", () => {
    createStatus(store, {
      id: "sta-backlog",
      vaultId: VAULT_ID,
      name: "Backlog",
      color: 2,
      position: 5,
    });
    expect(store.statuses.has("sta-backlog")).toBe(true);
  });
});

describe("RENAME_STATUS", () => {
  it("renames status", () => {
    renameStatus(store, STATUS_IDS.triage, "Inbox Review");
    expect(store.statuses.get(STATUS_IDS.triage)!.name).toBe("Inbox Review");
  });
});

describe("DELETE_STATUS", () => {
  it("removes status and clears from messages", () => {
    deleteStatus(store, STATUS_IDS.triage);
    expect(store.statuses.has(STATUS_IDS.triage)).toBe(false);
    expect(store.messages.get("m2")!.statusId).toBeNull();
  });
});

describe("REORDER_STATUSES", () => {
  it("updates positions", () => {
    reorderStatuses(store, [STATUS_IDS.done, STATUS_IDS.triage]);
    expect(store.statuses.get(STATUS_IDS.done)!.position).toBe(0);
    expect(store.statuses.get(STATUS_IDS.triage)!.position).toBe(1);
  });
});

// ─── Priority ─────────────────────────────────────────────────────────────────

describe("SET_PRIORITY / CLEAR_PRIORITY", () => {
  it("sets and clears priority", () => {
    setPriority(store, "m2", 2);
    expect(store.messages.get("m2")!.priority).toBe(2);
    clearPriority(store, "m2");
    expect(store.messages.get("m2")!.priority).toBeNull();
  });
});

// ─── Star ─────────────────────────────────────────────────────────────────────

describe("SET_STAR / CLEAR_STAR", () => {
  it("sets and clears star", () => {
    setStar(store, "m1", "bang-red");
    expect(store.messages.get("m1")!.star).toBe("bang-red");
    clearStar(store, "m1");
    expect(store.messages.get("m1")!.star).toBeNull();
  });
});

// ─── Flag ─────────────────────────────────────────────────────────────────────

describe("SET_FLAG / UPDATE_FLAG / COMPLETE_FLAG / CLEAR_FLAG", () => {
  it("sets flag and marks RFC flagged", () => {
    setFlag(store, "m1", { setAt: 1000 });
    expect(store.messages.get("m1")!.flag!.setAt).toBe(1000);
    expect(store.messages.get("m1")!.flags.flagged).toBe(true);
  });

  it("updates flag fields", () => {
    setFlag(store, "m1", { setAt: 1000 });
    updateFlag(store, "m1", { dueAt: 2000 });
    expect(store.messages.get("m1")!.flag!.dueAt).toBe(2000);
  });

  it("completes flag", () => {
    setFlag(store, "m1", { setAt: 1000 });
    completeFlag(store, "m1");
    expect(store.messages.get("m1")!.flag!.completedAt).toBeTruthy();
  });

  it("clears flag and unsets RFC flagged", () => {
    setFlag(store, "m1", { setAt: 1000 });
    clearFlag(store, "m1");
    expect(store.messages.get("m1")!.flag).toBeNull();
    expect(store.messages.get("m1")!.flags.flagged).toBe(false);
  });
});

// ─── Pin ─────────────────────────────────────────────────────────────────────

describe("SET_PINNED", () => {
  it("pins and unpins message", () => {
    setPinned(store, "m1", true);
    expect(store.messages.get("m1")!.pinned).toBe(true);
    setPinned(store, "m1", false);
    expect(store.messages.get("m1")!.pinned).toBe(false);
  });
});

// ─── Mute ─────────────────────────────────────────────────────────────────────

describe("SET_MUTED", () => {
  it("mutes all messages in a thread", () => {
    // m7 and m8 share thread-t1
    setMuted(store, "m7", true);
    expect(store.messages.get("m7")!.muted).toBe(true);
    expect(store.messages.get("m8")!.muted).toBe(true);
  });

  it("unmutes all messages in a thread", () => {
    setMuted(store, "m7", false);
    expect(store.messages.get("m7")!.muted).toBe(false);
    expect(store.messages.get("m8")!.muted).toBe(false);
  });
});

// ─── Note ─────────────────────────────────────────────────────────────────────

describe("SET_NOTE", () => {
  it("sets and clears note", () => {
    setNote(store, "m1", "Follow up on this");
    expect(store.messages.get("m1")!.notes).toBe("Follow up on this");
    setNote(store, "m1", null);
    expect(store.messages.get("m1")!.notes).toBeNull();
  });
});

// ─── Custom fields ────────────────────────────────────────────────────────────

describe("CREATE_CUSTOM_FIELD", () => {
  it("adds CFD definition", () => {
    createCustomField(store, {
      id: "cfd-stage",
      vaultId: VAULT_ID,
      name: "Deal Stage",
      type: "select",
      position: 1,
    });
    expect(store.customFieldDefs.has("cfd-stage")).toBe(true);
  });
});

describe("UPDATE_CUSTOM_FIELD", () => {
  it("updates CFD", () => {
    updateCustomField(store, CFD_IDS.project, { name: "Project Name" });
    expect(store.customFieldDefs.get(CFD_IDS.project)!.name).toBe("Project Name");
  });
});

describe("SET_CUSTOM_FIELD_VALUE / CLEAR_CUSTOM_FIELD_VALUE", () => {
  it("sets and clears a custom field value", () => {
    setCustomFieldValue(store, "m1", CFD_IDS.project, "opt-nexus");
    expect(store.messages.get("m1")!.customFields[CFD_IDS.project]).toBe("opt-nexus");
    clearCustomFieldValue(store, "m1", CFD_IDS.project);
    expect(store.messages.get("m1")!.customFields[CFD_IDS.project]).toBeUndefined();
  });
});

describe("DELETE_CUSTOM_FIELD", () => {
  it("removes CFD and cascades values", () => {
    deleteCustomField(store, CFD_IDS.project);
    expect(store.customFieldDefs.has(CFD_IDS.project)).toBe(false);
    for (const msg of store.messages.values()) {
      expect(CFD_IDS.project in msg.customFields).toBe(false);
    }
  });
});

// ─── Message ops ──────────────────────────────────────────────────────────────

describe("READ / UNREAD", () => {
  it("marks read and unread", () => {
    readMessage(store, "m1");
    expect(store.messages.get("m1")!.flags.read).toBe(true);
    unreadMessage(store, "m1");
    expect(store.messages.get("m1")!.flags.read).toBe(false);
  });
});

describe("ARCHIVE", () => {
  it("removes inbox label and adds archive label", () => {
    archiveMessage(store, "m1");
    const msg = store.messages.get("m1")!;
    expect(msg.labelIds).not.toContain(LABEL_IDS.inbox);
    expect(msg.labelIds).toContain(LABEL_IDS.archive);
  });
});

describe("SNOOZE", () => {
  it("swaps inbox for snoozed label and sets flag dueAt", () => {
    const until = Date.now() + 86_400_000;
    snoozeMessage(store, "m1", until);
    const msg = store.messages.get("m1")!;
    expect(msg.labelIds).not.toContain(LABEL_IDS.inbox);
    expect(msg.labelIds).toContain(LABEL_IDS.snoozed);
    expect(msg.flag!.dueAt).toBe(until);
  });
});

describe("DELETE_MESSAGE", () => {
  it("removes message from store and all indexes", () => {
    deleteMessage(store, "m1");
    expect(store.messages.has("m1")).toBe(false);
    expect(store.messagesByLabel.get(LABEL_IDS.inbox)!.has("m1")).toBe(false);
    expect(store.messagesByLabel.get(LABEL_IDS.work)!.has("m1")).toBe(false);
    expect(store.messagesByFolder.get(FOLDER_IDS.inbox)!.has("m1")).toBe(false);
  });
});

describe("RECEIVE_FROM_PROVIDER", () => {
  it("inserts a new message into the store", () => {
    const newMsg: Message = {
      id: "m-new",
      vaultId: VAULT_ID,
      folderId: FOLDER_IDS.inbox,
      threadId: "thread-new",
      providerIds: { gmail: "gm-abc" },
      labelIds: [LABEL_IDS.inbox],
      tags: [],
      statusId: null,
      priority: null,
      star: null,
      flag: null,
      pinned: false,
      muted: false,
      notes: null,
      customFields: {},
      flags: { read: false, answered: false, draft: false, flagged: false },
      receivedAt: Date.now(),
      sentAt: Date.now(),
      fromAddr: { name: "New Sender", email: "new@example.com" },
      toAddrs: [],
      ccAddrs: [],
      bccAddrs: [],
      subject: "New email",
      snippet: "New email snippet",
      bodyRef: "hash-new",
      attachmentRefs: [],
    };
    receiveFromProvider(store, newMsg);
    expect(store.messages.has("m-new")).toBe(true);
    expect(store.messagesByLabel.get(LABEL_IDS.inbox)!.has("m-new")).toBe(true);
  });
});

// ─── Mutation replay ─────────────────────────────────────────────────────────

describe("replayMutations", () => {
  it("reconstructs state from mutation log", () => {
    // Apply some mutations
    addLabel(store, "m5", LABEL_IDS.work);
    setStatus(store, "m5", STATUS_IDS.action);
    setPriority(store, "m5", 1);
    setStar(store, "m5", "check-green");
    setPinned(store, "m5", true);
    setNote(store, "m5", "check this one");
    addTag(store, "m5", "important-client");

    const log = store.mutations;

    // Build a fresh store with same base data and replay
    const fresh = makeSeedStore();
    // Remove the mutations from the seed (hydrate starts fresh mutations)
    replayMutations(log, fresh);

    const msg = fresh.messages.get("m5")!;
    expect(msg.labelIds).toContain(LABEL_IDS.work);
    expect(msg.statusId).toBe(STATUS_IDS.action);
    expect(msg.priority).toBe(1);
    expect(msg.star).toBe("check-green");
    expect(msg.pinned).toBe(true);
    expect(msg.notes).toBe("check this one");
    expect(msg.tags).toContain("important-client");
  });
});
