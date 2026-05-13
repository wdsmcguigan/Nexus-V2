/**
 * Test seed helpers — build a small but representative LocalStore for tests.
 */

import { LocalStore } from "@/storage/local";
import type { Folder, Label, Message, Status, Vault, CustomFieldDef } from "@/data/types";

export const VAULT_ID = "test-vault";

export const FOLDER_IDS = {
  inbox: "folder-inbox",
  personal: "folder-personal",
  receipts: "folder-receipts",
};

export const LABEL_IDS = {
  inbox: "lbl-sys-inbox",
  archive: "lbl-sys-archive",
  snoozed: "lbl-sys-snoozed",
  sent: "lbl-sys-sent",
  drafts: "lbl-sys-drafts",
  trash: "lbl-sys-trash",
  starred: "lbl-sys-starred",
  important: "lbl-sys-important",
  work: "lbl-work",
  personal: "lbl-personal",
  newsletter: "lbl-newsletter",
};

export const STATUS_IDS = {
  triage: "sta-triage",
  reading: "sta-reading",
  awaiting: "sta-awaiting",
  action: "sta-action",
  done: "sta-done",
};

export const CFD_IDS = {
  project: "cfd-project",
};

function makeVault(): Vault {
  return { id: VAULT_ID, path: "/test-vault", createdAt: 1_700_000_000_000 };
}

function makeFolders(): Folder[] {
  return [
    {
      id: FOLDER_IDS.inbox,
      vaultId: VAULT_ID,
      parentId: null,
      name: "Inbox",
      diskSlug: "Inbox",
      diskPath: "Inbox",
    },
    {
      id: FOLDER_IDS.personal,
      vaultId: VAULT_ID,
      parentId: null,
      name: "Personal",
      diskSlug: "Personal",
      diskPath: "Personal",
    },
    {
      id: FOLDER_IDS.receipts,
      vaultId: VAULT_ID,
      parentId: FOLDER_IDS.personal,
      name: "Receipts",
      diskSlug: "Receipts",
      diskPath: "Personal/Receipts",
    },
  ];
}

function makeLabels(): Label[] {
  const sys = (id: string, name: string, systemKind: Label["systemKind"]): Label => ({
    id,
    vaultId: VAULT_ID,
    name,
    color: 1,
    kind: "system",
    systemKind,
    position: 0,
  });
  return [
    sys(LABEL_IDS.inbox, "Inbox", "inbox"),
    sys(LABEL_IDS.archive, "Archive", "archive"),
    sys(LABEL_IDS.snoozed, "Snoozed", "snoozed"),
    sys(LABEL_IDS.sent, "Sent", "sent"),
    sys(LABEL_IDS.drafts, "Drafts", "drafts"),
    sys(LABEL_IDS.trash, "Trash", "trash"),
    sys(LABEL_IDS.starred, "Starred", "starred"),
    sys(LABEL_IDS.important, "Important", "important"),
    { id: LABEL_IDS.work, vaultId: VAULT_ID, name: "Work", color: 5, kind: "user", position: 0 },
    { id: LABEL_IDS.personal, vaultId: VAULT_ID, name: "Personal", color: 6, kind: "user", position: 1 },
    { id: LABEL_IDS.newsletter, vaultId: VAULT_ID, name: "Newsletter", color: 8, kind: "user", position: 2 },
  ];
}

function makeStatuses(): Status[] {
  return [
    { id: STATUS_IDS.triage, vaultId: VAULT_ID, name: "Triage", color: 1, position: 0, isDefault: true },
    { id: STATUS_IDS.reading, vaultId: VAULT_ID, name: "Reading", color: 2, position: 1 },
    { id: STATUS_IDS.awaiting, vaultId: VAULT_ID, name: "Awaiting Reply", color: 3, position: 2 },
    { id: STATUS_IDS.action, vaultId: VAULT_ID, name: "Action", color: 4, position: 3 },
    { id: STATUS_IDS.done, vaultId: VAULT_ID, name: "Done", color: 5, position: 4, isTerminal: true },
  ];
}

function makeCustomFields(): CustomFieldDef[] {
  return [
    {
      id: CFD_IDS.project,
      vaultId: VAULT_ID,
      name: "Project",
      type: "select",
      options: [
        { id: "opt-acme", label: "Acme", color: 1, position: 0 },
        { id: "opt-nexus", label: "Nexus", color: 2, position: 1 },
      ],
      position: 0,
    },
  ];
}

function makeMessage(
  id: string,
  overrides: Partial<Message> = {},
): Message {
  const base: Message = {
    id,
    vaultId: VAULT_ID,
    folderId: FOLDER_IDS.inbox,
    threadId: `thread-${id}`,
    providerIds: {},
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
    receivedAt: 1_700_000_000_000,
    sentAt: 1_700_000_000_000,
    fromAddr: { name: "Alice", email: "alice@example.com" },
    toAddrs: [{ name: "Bob", email: "bob@example.com" }],
    ccAddrs: [],
    bccAddrs: [],
    subject: `Subject ${id}`,
    snippet: `Snippet for ${id}`,
    bodyRef: `hash-${id}`,
    attachmentRefs: [],
  };
  return { ...base, ...overrides };
}

export function makeSeedStore(): LocalStore {
  const store = new LocalStore();
  store.hydrate({
    vault: makeVault(),
    accounts: [],
    folders: makeFolders(),
    labels: makeLabels(),
    statuses: makeStatuses(),
    customFieldDefs: makeCustomFields(),
    tagUsage: [],
    mutations: [],
    messages: [
      makeMessage("m1", { labelIds: [LABEL_IDS.inbox, LABEL_IDS.work], priority: 1 }),
      makeMessage("m2", { labelIds: [LABEL_IDS.inbox], tags: ["urgent"], statusId: STATUS_IDS.triage }),
      makeMessage("m3", { labelIds: [LABEL_IDS.inbox, LABEL_IDS.newsletter], priority: 3, star: "yellow" }),
      makeMessage("m4", {
        labelIds: [LABEL_IDS.inbox, LABEL_IDS.work],
        statusId: STATUS_IDS.awaiting,
        priority: 2,
        pinned: true,
      }),
      makeMessage("m5", {
        folderId: FOLDER_IDS.personal,
        labelIds: [],
        customFields: { [CFD_IDS.project]: "opt-acme" },
      }),
      makeMessage("m6", { labelIds: [LABEL_IDS.archive], flags: { read: true, answered: false, draft: false, flagged: false } }),
      makeMessage("m7", { labelIds: [LABEL_IDS.inbox], muted: true, threadId: "thread-t1" }),
      makeMessage("m8", { labelIds: [LABEL_IDS.inbox], muted: false, threadId: "thread-t1" }),
    ],
  });
  return store;
}
