/**
 * EP-2 mutation tests: flags, notes, custom field CRUD, recolor.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import {
  setFlag, updateFlag, completeFlag, clearFlag,
  setNote,
  createCustomField, updateCustomField, deleteCustomField,
  setCustomFieldValue, clearCustomFieldValue,
  recolorLabel, recolorFolder,
  createLabel, createFolder,
} from "@/state/mutations";
import type { CustomFieldDef, Label, Folder } from "@/data/types";

const VAULT = "local";
const BASE_MSG_ID = "msg-ep2-1";

let store: LocalStore;

beforeEach(() => {
  store = new LocalStore();
  store.hydrate({
    vault: { id: VAULT, path: "/", createdAt: Date.now() },
    accounts: [],
    folders: [
      {
        id: "fld-1", vaultId: VAULT, parentId: null,
        name: "Inbox", diskSlug: "inbox", diskPath: "inbox",
      },
    ],
    labels: [],
    statuses: [],
    customFieldDefs: [],
    tagUsage: [],
    mutations: [],
    messages: [
      {
        id: BASE_MSG_ID,
        vaultId: VAULT,
        folderId: "fld-1",
        threadId: "thr-1",
        providerIds: {},
        labelIds: [],
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
        fromAddr: { name: "Alice", email: "alice@test.com" },
        toAddrs: [],
        ccAddrs: [],
        bccAddrs: [],
        subject: "EP-2 test message",
        snippet: "Test",
        bodyRef: "hash-1",
        attachmentRefs: [],
      },
    ],
  });
});

// ─── Flag tests ───────────────────────────────────────────────────────────────

describe("Flag mutations (FLG)", () => {
  it("setFlag sets flag with dueAt and marks flagged", () => {
    const dueAt = Date.now() + 86400_000;
    setFlag(store, BASE_MSG_ID, { setAt: Date.now(), dueAt });
    const msg = store.messages.get(BASE_MSG_ID)!;
    expect(msg.flag?.dueAt).toBe(dueAt);
    expect(msg.flags.flagged).toBe(true);
  });

  it("updateFlag merges partial updates", () => {
    setFlag(store, BASE_MSG_ID, { setAt: Date.now() });
    const reminder = Date.now() + 3600_000;
    updateFlag(store, BASE_MSG_ID, { reminderAt: reminder });
    const msg = store.messages.get(BASE_MSG_ID)!;
    expect(msg.flag?.reminderAt).toBe(reminder);
  });

  it("completeFlag sets completedAt", () => {
    setFlag(store, BASE_MSG_ID, { setAt: Date.now() });
    completeFlag(store, BASE_MSG_ID);
    const msg = store.messages.get(BASE_MSG_ID)!;
    expect(msg.flag?.completedAt).toBeGreaterThan(0);
  });

  it("clearFlag removes flag and clears flagged bit", () => {
    setFlag(store, BASE_MSG_ID, { setAt: Date.now() });
    clearFlag(store, BASE_MSG_ID);
    const msg = store.messages.get(BASE_MSG_ID)!;
    expect(msg.flag).toBeNull();
    expect(msg.flags.flagged).toBe(false);
  });

  it("records MUTN for each flag op", () => {
    setFlag(store, BASE_MSG_ID, { setAt: Date.now() });
    updateFlag(store, BASE_MSG_ID, { reminderAt: Date.now() });
    completeFlag(store, BASE_MSG_ID);
    clearFlag(store, BASE_MSG_ID);
    const kinds = store.mutations.map((m) => m.kind);
    expect(kinds).toContain("SET_FLAG");
    expect(kinds).toContain("UPDATE_FLAG");
    expect(kinds).toContain("COMPLETE_FLAG");
    expect(kinds).toContain("CLEAR_FLAG");
  });
});

// ─── Note tests ───────────────────────────────────────────────────────────────

describe("Note mutations (NTE)", () => {
  it("setNote stores markdown notes", () => {
    setNote(store, BASE_MSG_ID, "## Follow-up\nCall tomorrow.");
    const msg = store.messages.get(BASE_MSG_ID)!;
    expect(msg.notes).toBe("## Follow-up\nCall tomorrow.");
  });

  it("setNote(null) clears notes", () => {
    setNote(store, BASE_MSG_ID, "some note");
    setNote(store, BASE_MSG_ID, null);
    expect(store.messages.get(BASE_MSG_ID)!.notes).toBeNull();
  });

  it("records SET_NOTE mutation", () => {
    setNote(store, BASE_MSG_ID, "test");
    expect(store.mutations.some((m) => m.kind === "SET_NOTE")).toBe(true);
  });
});

// ─── Custom field CRUD tests ──────────────────────────────────────────────────

describe("Custom field definition CRUD (CFD)", () => {
  const textDef: CustomFieldDef = {
    id: "cfd-project", vaultId: VAULT, name: "Project",
    type: "text", position: 0,
  };
  const selectDef: CustomFieldDef = {
    id: "cfd-stage", vaultId: VAULT, name: "Stage",
    type: "select",
    options: [
      { id: "opt-1", label: "Planning", color: 3, position: 0 },
      { id: "opt-2", label: "Active", color: 5, position: 1 },
    ],
    position: 1,
  };

  it("createCustomField stores a definition", () => {
    createCustomField(store, textDef);
    expect(store.customFieldDefs.has("cfd-project")).toBe(true);
    expect(store.customFieldDefs.get("cfd-project")!.name).toBe("Project");
  });

  it("updateCustomField merges partial updates", () => {
    createCustomField(store, selectDef);
    updateCustomField(store, "cfd-stage", { name: "Pipeline" });
    expect(store.customFieldDefs.get("cfd-stage")!.name).toBe("Pipeline");
    expect(store.customFieldDefs.get("cfd-stage")!.type).toBe("select");
  });

  it("deleteCustomField removes definition and cascades to messages", () => {
    createCustomField(store, textDef);
    setCustomFieldValue(store, BASE_MSG_ID, "cfd-project", "Nexus");
    expect(store.messages.get(BASE_MSG_ID)!.customFields["cfd-project"]).toBe("Nexus");

    deleteCustomField(store, "cfd-project");
    expect(store.customFieldDefs.has("cfd-project")).toBe(false);
    expect(store.messages.get(BASE_MSG_ID)!.customFields["cfd-project"]).toBeUndefined();
  });

  it("records MUTN for CREATE/UPDATE/DELETE", () => {
    createCustomField(store, textDef);
    updateCustomField(store, "cfd-project", { name: "X" });
    deleteCustomField(store, "cfd-project");
    const kinds = store.mutations.map((m) => m.kind);
    expect(kinds).toContain("CREATE_CUSTOM_FIELD");
    expect(kinds).toContain("UPDATE_CUSTOM_FIELD");
    expect(kinds).toContain("DELETE_CUSTOM_FIELD");
  });
});

// ─── Custom field value tests ─────────────────────────────────────────────────

describe("Custom field values (CFV)", () => {
  const def: CustomFieldDef = {
    id: "cfd-v", vaultId: VAULT, name: "Score", type: "number", position: 0,
  };

  beforeEach(() => { createCustomField(store, def); });

  it("setCustomFieldValue stores a typed value", () => {
    setCustomFieldValue(store, BASE_MSG_ID, "cfd-v", 42);
    expect(store.messages.get(BASE_MSG_ID)!.customFields["cfd-v"]).toBe(42);
  });

  it("clearCustomFieldValue removes the value", () => {
    setCustomFieldValue(store, BASE_MSG_ID, "cfd-v", 99);
    clearCustomFieldValue(store, BASE_MSG_ID, "cfd-v");
    expect(store.messages.get(BASE_MSG_ID)!.customFields["cfd-v"]).toBeUndefined();
  });

  it("records SET_CUSTOM_FIELD_VALUE / CLEAR_CUSTOM_FIELD_VALUE", () => {
    setCustomFieldValue(store, BASE_MSG_ID, "cfd-v", 1);
    clearCustomFieldValue(store, BASE_MSG_ID, "cfd-v");
    const kinds = store.mutations.map((m) => m.kind);
    expect(kinds).toContain("SET_CUSTOM_FIELD_VALUE");
    expect(kinds).toContain("CLEAR_CUSTOM_FIELD_VALUE");
  });
});

// ─── Recolor tests ────────────────────────────────────────────────────────────

describe("Recolor mutations (EP-2)", () => {
  it("recolorLabel updates color and records RECOLOR_LABEL", () => {
    const label: Label = {
      id: "lbl-ep2", vaultId: VAULT, name: "Work", color: 1, kind: "user", position: 0,
    };
    createLabel(store, label);
    recolorLabel(store, "lbl-ep2", 5);
    expect(store.labels.get("lbl-ep2")!.color).toBe(5);
    expect(store.mutations.some((m) => m.kind === "RECOLOR_LABEL")).toBe(true);
  });

  it("recolorFolder updates color and records RECOLOR_FOLDER", () => {
    const folder: Folder = {
      id: "fld-ep2", vaultId: VAULT, parentId: null,
      name: "Archive", diskSlug: "archive", diskPath: "archive", color: 2,
    };
    createFolder(store, folder);
    recolorFolder(store, "fld-ep2", 7);
    expect(store.folders.get("fld-ep2")!.color).toBe(7);
    expect(store.mutations.some((m) => m.kind === "RECOLOR_FOLDER")).toBe(true);
  });
});
