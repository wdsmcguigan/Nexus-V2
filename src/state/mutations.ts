/**
 * WF-OUTBOUND-MUTATION — mutation log + optimistic local application.
 *
 * Every user-facing state change:
 *   1. Calls recordMutation(kind, payload)
 *   2. Which applies the change optimistically to the local store
 *   3. And appends a MUTN to the mutations log (relay queue in EP-5)
 *
 * One typed helper per MUTN kind (glossary §8). Helpers are the only
 * write path to the store — direct store mutations should not happen
 * outside this module.
 */

import {
  type Contact,
  type CustomFieldDef,
  type CustomFieldValue,
  type FlagState,
  type Folder,
  type Label,
  type Message,
  type Mutation,
  type MutationKind,
  type MetadataFilter,
  type SavedView,
  type StarStyle,
  type Status,
} from "@/data/types";
import { LocalStore, localStore as _defaultStore } from "@/storage/local";
import { isTauri, applyMutationIpc } from "@/storage/tauri";

// ─── Lamport clock + device id ───────────────────────────────────────────────

let _lamport = 0;
let _deviceId = "web-" + Math.random().toString(36).slice(2, 10);

export function setDeviceId(id: string): void {
  _deviceId = id;
}

export function currentDeviceId(): string {
  return _deviceId;
}

// ─── Core record function ────────────────────────────────────────────────────

export function recordMutation(
  kind: MutationKind,
  payload: unknown,
  store: LocalStore = _defaultStore,
): Mutation {
  _lamport += 1;
  const mutation: Mutation = {
    id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    vaultId: store.vault?.id ?? "local",
    deviceId: _deviceId,
    ts: Date.now(),
    lamport: _lamport,
    kind,
    payload,
  };
  store.appendMutation(mutation);
  applyMutation(mutation, store);

  // Fire-and-forget persistence to SQLite in Tauri mode
  if (isTauri()) {
    applyMutationIpc(kind, payload).catch((e) =>
      console.warn("IPC mutation persist failed:", e),
    );
  }

  return mutation;
}

// ─── Mutation replay ─────────────────────────────────────────────────────────
// Deterministic: replaying a list of mutations onto an empty store must
// produce the same state as the original sequence of recordMutation calls.

export function replayMutations(mutations: Mutation[], store: LocalStore): void {
  // Advance lamport clock past any replayed values
  for (const m of mutations) {
    if (m.lamport > _lamport) _lamport = m.lamport;
    applyMutation(m, store);
  }
}

// ─── Apply ───────────────────────────────────────────────────────────────────
// Dispatches a single mutation to the appropriate handler.

export function applyMutation(m: Mutation, store: LocalStore): void {
  switch (m.kind) {
    // ── Folder ops ──────────────────────────────────────────────
    case "MOVE_TO_FOLDER": {
      const { messageId, folderId } = m.payload as { messageId: string; folderId: string };
      _updateMessage(store, messageId, { folderId });
      break;
    }
    case "CREATE_FOLDER": {
      const folder = m.payload as Folder;
      store.putFolder(folder);
      break;
    }
    case "RENAME_FOLDER": {
      const { folderId, name, diskSlug } = m.payload as {
        folderId: string; name: string; diskSlug: string;
      };
      const f = store.folders.get(folderId);
      if (f) store.putFolder({ ...f, name, diskSlug });
      break;
    }
    case "RECOLOR_FOLDER": {
      const { folderId, color } = m.payload as { folderId: string; color: number };
      const f = store.folders.get(folderId);
      if (f) store.putFolder({ ...f, color });
      break;
    }
    case "DELETE_FOLDER": {
      const { folderId } = m.payload as { folderId: string };
      store.deleteFolder(folderId);
      break;
    }

    // ── Label ops ────────────────────────────────────────────────
    case "ADD_LABEL": {
      const { messageId, labelId } = m.payload as { messageId: string; labelId: string };
      const msg = store.messages.get(messageId);
      if (msg && !msg.labelIds.includes(labelId)) {
        _updateMessage(store, messageId, { labelIds: [...msg.labelIds, labelId] });
      }
      break;
    }
    case "REMOVE_LABEL": {
      const { messageId, labelId } = m.payload as { messageId: string; labelId: string };
      const msg = store.messages.get(messageId);
      if (msg) {
        _updateMessage(store, messageId, {
          labelIds: msg.labelIds.filter((l) => l !== labelId),
        });
      }
      break;
    }
    case "CREATE_LABEL": {
      const label = m.payload as Label;
      store.putLabel(label);
      break;
    }
    case "RENAME_LABEL": {
      const { labelId, name } = m.payload as { labelId: string; name: string };
      const l = store.labels.get(labelId);
      if (l) store.putLabel({ ...l, name });
      break;
    }
    case "RECOLOR_LABEL": {
      const { labelId, color } = m.payload as { labelId: string; color: number };
      const l = store.labels.get(labelId);
      if (l) store.putLabel({ ...l, color });
      break;
    }
    case "DELETE_LABEL": {
      const { labelId } = m.payload as { labelId: string };
      store.deleteLabel(labelId);
      break;
    }
    case "REORDER_LABELS": {
      const { orderedIds } = m.payload as { orderedIds: string[] };
      for (let i = 0; i < orderedIds.length; i++) {
        const l = store.labels.get(orderedIds[i]!);
        if (l) store.putLabel({ ...l, position: i });
      }
      break;
    }

    // ── Tag ops ──────────────────────────────────────────────────
    case "ADD_TAG": {
      const { messageId, tag } = m.payload as { messageId: string; tag: string };
      const msg = store.messages.get(messageId);
      if (msg && !msg.tags.includes(tag)) {
        _updateMessage(store, messageId, { tags: [...msg.tags, tag] });
        store.incrementTagUsage(store.vault?.id ?? "local", tag);
      }
      break;
    }
    case "REMOVE_TAG": {
      const { messageId, tag } = m.payload as { messageId: string; tag: string };
      const msg = store.messages.get(messageId);
      if (msg) {
        _updateMessage(store, messageId, { tags: msg.tags.filter((t) => t !== tag) });
        store.decrementTagUsage(tag);
      }
      break;
    }
    case "RENAME_TAG_GLOBAL": {
      const { oldTag, newTag } = m.payload as { oldTag: string; newTag: string };
      const affected = Array.from(store.messagesByTag.get(oldTag) ?? []);
      if (affected.length > 0) {
        for (const msgId of affected) {
          const msg = store.messages.get(msgId);
          if (msg) {
            _updateMessage(store, msgId, {
              tags: msg.tags.map((t) => (t === oldTag ? newTag : t)),
            });
          }
        }
        const usage = store.tagUsage.get(oldTag);
        if (usage) {
          store.tagUsage.delete(oldTag);
          store.tagUsage.set(newTag, { ...usage, tag: newTag });
        }
      }
      break;
    }
    case "DELETE_TAG_GLOBAL": {
      const { tag } = m.payload as { tag: string };
      const affected = Array.from(store.messagesByTag.get(tag) ?? []);
      if (affected.length > 0) {
        for (const msgId of affected) {
          const msg = store.messages.get(msgId);
          if (msg) {
            _updateMessage(store, msgId, { tags: msg.tags.filter((t) => t !== tag) });
          }
        }
        store.tagUsage.delete(tag);
      }
      break;
    }

    // ── Status ops ───────────────────────────────────────────────
    case "SET_STATUS": {
      const { messageId, statusId } = m.payload as { messageId: string; statusId: string };
      _updateMessage(store, messageId, { statusId });
      break;
    }
    case "CLEAR_STATUS": {
      const { messageId } = m.payload as { messageId: string };
      _updateMessage(store, messageId, { statusId: null });
      break;
    }
    case "CREATE_STATUS": {
      const status = m.payload as Status;
      store.putStatus(status);
      break;
    }
    case "RENAME_STATUS": {
      const { statusId, name } = m.payload as { statusId: string; name: string };
      const s = store.statuses.get(statusId);
      if (s) store.putStatus({ ...s, name });
      break;
    }
    case "DELETE_STATUS": {
      const { statusId } = m.payload as { statusId: string };
      store.deleteStatus(statusId);
      break;
    }
    case "REORDER_STATUSES": {
      const { orderedIds } = m.payload as { orderedIds: string[] };
      for (let i = 0; i < orderedIds.length; i++) {
        const s = store.statuses.get(orderedIds[i]!);
        if (s) store.putStatus({ ...s, position: i });
      }
      break;
    }

    // ── Priority ─────────────────────────────────────────────────
    case "SET_PRIORITY": {
      const { messageId, priority } = m.payload as { messageId: string; priority: 1 | 2 | 3 | 4 };
      _updateMessage(store, messageId, { priority });
      break;
    }
    case "CLEAR_PRIORITY": {
      const { messageId } = m.payload as { messageId: string };
      _updateMessage(store, messageId, { priority: null });
      break;
    }

    // ── Star ─────────────────────────────────────────────────────
    case "SET_STAR": {
      const { messageId, star } = m.payload as { messageId: string; star: StarStyle };
      _updateMessage(store, messageId, { star });
      break;
    }
    case "CLEAR_STAR": {
      const { messageId } = m.payload as { messageId: string };
      _updateMessage(store, messageId, { star: null });
      break;
    }

    // ── Flag ─────────────────────────────────────────────────────
    case "SET_FLAG": {
      const { messageId, flag } = m.payload as { messageId: string; flag: FlagState };
      _updateMessage(store, messageId, { flag, flags: _mergedFlags(store, messageId, { flagged: true }) });
      break;
    }
    case "UPDATE_FLAG": {
      const { messageId, updates } = m.payload as { messageId: string; updates: Partial<FlagState> };
      const msg = store.messages.get(messageId);
      if (msg?.flag) {
        _updateMessage(store, messageId, { flag: { ...msg.flag, ...updates } });
      }
      break;
    }
    case "COMPLETE_FLAG": {
      const { messageId } = m.payload as { messageId: string };
      const msg = store.messages.get(messageId);
      if (msg?.flag) {
        _updateMessage(store, messageId, { flag: { ...msg.flag, completedAt: Date.now() } });
      }
      break;
    }
    case "CLEAR_FLAG": {
      const { messageId } = m.payload as { messageId: string };
      _updateMessage(store, messageId, { flag: null, flags: _mergedFlags(store, messageId, { flagged: false }) });
      break;
    }

    // ── Pin ──────────────────────────────────────────────────────
    case "SET_PINNED": {
      const { messageId, pinned } = m.payload as { messageId: string; pinned: boolean };
      _updateMessage(store, messageId, { pinned });
      break;
    }

    // ── Mute ─────────────────────────────────────────────────────
    case "SET_MUTED": {
      const { messageId, muted } = m.payload as { messageId: string; muted: boolean };
      // MUT applies thread-wide. Snapshot to Array first — putMessage removes+re-adds
      // message to messagesByThread, which would corrupt a live Set iterator.
      const msg = store.messages.get(messageId);
      if (msg) {
        const threadIds = Array.from(store.messagesByThread.get(msg.threadId) ?? []);
        for (const tid of threadIds) {
          _updateMessage(store, tid, { muted });
        }
      }
      break;
    }

    // ── Note ─────────────────────────────────────────────────────
    case "SET_NOTE": {
      const { messageId, notes } = m.payload as { messageId: string; notes: string | null };
      _updateMessage(store, messageId, { notes });
      break;
    }

    // ── Custom fields ────────────────────────────────────────────
    case "CREATE_CUSTOM_FIELD": {
      const def = m.payload as CustomFieldDef;
      store.customFieldDefs.set(def.id, def);
      break;
    }
    case "UPDATE_CUSTOM_FIELD": {
      const { fieldId, updates } = m.payload as { fieldId: string; updates: Partial<CustomFieldDef> };
      const def = store.customFieldDefs.get(fieldId);
      if (def) store.customFieldDefs.set(fieldId, { ...def, ...updates });
      break;
    }
    case "DELETE_CUSTOM_FIELD": {
      const { fieldId } = m.payload as { fieldId: string };
      store.customFieldDefs.delete(fieldId);
      // Cascade: remove values from all messages
      for (const [msgId, msg] of store.messages) {
        if (fieldId in msg.customFields) {
          const updated = { ...msg.customFields };
          delete updated[fieldId];
          _updateMessage(store, msgId, { customFields: updated });
        }
      }
      break;
    }
    case "SET_CUSTOM_FIELD_VALUE": {
      const { messageId, fieldId, value } = m.payload as {
        messageId: string; fieldId: string; value: CustomFieldValue;
      };
      const msg = store.messages.get(messageId);
      if (msg) {
        _updateMessage(store, messageId, {
          customFields: { ...msg.customFields, [fieldId]: value },
        });
      }
      break;
    }
    case "CLEAR_CUSTOM_FIELD_VALUE": {
      const { messageId, fieldId } = m.payload as { messageId: string; fieldId: string };
      const msg = store.messages.get(messageId);
      if (msg) {
        const updated = { ...msg.customFields };
        delete updated[fieldId];
        _updateMessage(store, messageId, { customFields: updated });
      }
      break;
    }

    // ── Message ops ──────────────────────────────────────────────
    case "READ": {
      const { messageId } = m.payload as { messageId: string };
      _updateMessage(store, messageId, { flags: _mergedFlags(store, messageId, { read: true }) });
      break;
    }
    case "UNREAD": {
      const { messageId } = m.payload as { messageId: string };
      _updateMessage(store, messageId, { flags: _mergedFlags(store, messageId, { read: false }) });
      break;
    }
    case "ARCHIVE": {
      const { messageId } = m.payload as { messageId: string };
      const msg = store.messages.get(messageId);
      if (msg) {
        // Remove inbox label, add archive label
        const inboxId = _systemLabelId(store, "inbox");
        const archiveId = _systemLabelId(store, "archive");
        let labelIds = msg.labelIds.filter((l) => l !== inboxId);
        if (archiveId && !labelIds.includes(archiveId)) labelIds = [...labelIds, archiveId];
        _updateMessage(store, messageId, { labelIds });
      }
      break;
    }
    case "SNOOZE": {
      const { messageId, until } = m.payload as { messageId: string; until: number };
      const msg = store.messages.get(messageId);
      if (msg) {
        const inboxId = _systemLabelId(store, "inbox");
        const snoozedId = _systemLabelId(store, "snoozed");
        let labelIds = msg.labelIds.filter((l) => l !== inboxId);
        if (snoozedId && !labelIds.includes(snoozedId)) labelIds = [...labelIds, snoozedId];
        _updateMessage(store, messageId, { labelIds, flag: { setAt: Date.now(), dueAt: until } });
      }
      break;
    }
    case "DELETE_MESSAGE": {
      const { messageId } = m.payload as { messageId: string };
      store.deleteMessage(messageId);
      break;
    }
    case "SEND_MESSAGE":
    case "RECEIVE_FROM_PROVIDER": {
      const msg = m.payload as Message;
      store.putMessage(msg);
      break;
    }

    // ── Contact ops ──────────────────────────────────────────────
    case "UPSERT_CONTACT":
    case "UPDATE_CONTACT": {
      const { contact } = m.payload as { contact: Contact };
      store.putContact(contact);
      break;
    }
    case "DELETE_CONTACT": {
      const { contactId } = m.payload as { contactId: string };
      store.deleteContact(contactId);
      break;
    }
  }
}

// ─── Typed mutation helpers ──────────────────────────────────────────────────
// One per MUTN kind. These are the preferred call sites.

// Folder
export const moveToFolder = (s: LocalStore, messageId: string, folderId: string) =>
  recordMutation("MOVE_TO_FOLDER", { messageId, folderId }, s);
export const createFolder = (s: LocalStore, folder: Folder) =>
  recordMutation("CREATE_FOLDER", folder, s);
export const renameFolder = (s: LocalStore, folderId: string, name: string, diskSlug: string) =>
  recordMutation("RENAME_FOLDER", { folderId, name, diskSlug }, s);
export const recolorFolder = (s: LocalStore, folderId: string, color: number) =>
  recordMutation("RECOLOR_FOLDER", { folderId, color }, s);
export const deleteFolder = (s: LocalStore, folderId: string) =>
  recordMutation("DELETE_FOLDER", { folderId }, s);

// Label
export const addLabel = (s: LocalStore, messageId: string, labelId: string) =>
  recordMutation("ADD_LABEL", { messageId, labelId }, s);
export const removeLabel = (s: LocalStore, messageId: string, labelId: string) =>
  recordMutation("REMOVE_LABEL", { messageId, labelId }, s);
export const createLabel = (s: LocalStore, label: Label) =>
  recordMutation("CREATE_LABEL", label, s);
export const renameLabel = (s: LocalStore, labelId: string, name: string) =>
  recordMutation("RENAME_LABEL", { labelId, name }, s);
export const recolorLabel = (s: LocalStore, labelId: string, color: number) =>
  recordMutation("RECOLOR_LABEL", { labelId, color }, s);
export const deleteLabel = (s: LocalStore, labelId: string) =>
  recordMutation("DELETE_LABEL", { labelId }, s);
export const reorderLabels = (s: LocalStore, orderedIds: string[]) =>
  recordMutation("REORDER_LABELS", { orderedIds }, s);

// Tag
export const addTag = (s: LocalStore, messageId: string, tag: string) =>
  recordMutation("ADD_TAG", { messageId, tag }, s);
export const removeTag = (s: LocalStore, messageId: string, tag: string) =>
  recordMutation("REMOVE_TAG", { messageId, tag }, s);
export const renameTagGlobal = (s: LocalStore, oldTag: string, newTag: string) =>
  recordMutation("RENAME_TAG_GLOBAL", { oldTag, newTag }, s);
export const deleteTagGlobal = (s: LocalStore, tag: string) =>
  recordMutation("DELETE_TAG_GLOBAL", { tag }, s);

// Status
export const setStatus = (s: LocalStore, messageId: string, statusId: string) =>
  recordMutation("SET_STATUS", { messageId, statusId }, s);
export const clearStatus = (s: LocalStore, messageId: string) =>
  recordMutation("CLEAR_STATUS", { messageId }, s);
export const createStatus = (s: LocalStore, status: Status) =>
  recordMutation("CREATE_STATUS", status, s);
export const renameStatus = (s: LocalStore, statusId: string, name: string) =>
  recordMutation("RENAME_STATUS", { statusId, name }, s);
export const deleteStatus = (s: LocalStore, statusId: string) =>
  recordMutation("DELETE_STATUS", { statusId }, s);
export const reorderStatuses = (s: LocalStore, orderedIds: string[]) =>
  recordMutation("REORDER_STATUSES", { orderedIds }, s);

// Priority
export const setPriority = (s: LocalStore, messageId: string, priority: 1 | 2 | 3 | 4) =>
  recordMutation("SET_PRIORITY", { messageId, priority }, s);
export const clearPriority = (s: LocalStore, messageId: string) =>
  recordMutation("CLEAR_PRIORITY", { messageId }, s);

// Star
export const setStar = (s: LocalStore, messageId: string, star: StarStyle) =>
  recordMutation("SET_STAR", { messageId, star }, s);
export const clearStar = (s: LocalStore, messageId: string) =>
  recordMutation("CLEAR_STAR", { messageId }, s);

// Flag
export const setFlag = (s: LocalStore, messageId: string, flag: FlagState) =>
  recordMutation("SET_FLAG", { messageId, flag }, s);
export const updateFlag = (s: LocalStore, messageId: string, updates: Partial<FlagState>) =>
  recordMutation("UPDATE_FLAG", { messageId, updates }, s);
export const completeFlag = (s: LocalStore, messageId: string) =>
  recordMutation("COMPLETE_FLAG", { messageId }, s);
export const clearFlag = (s: LocalStore, messageId: string) =>
  recordMutation("CLEAR_FLAG", { messageId }, s);

// Pin / Mute / Note
export const setPinned = (s: LocalStore, messageId: string, pinned: boolean) =>
  recordMutation("SET_PINNED", { messageId, pinned }, s);
export const setMuted = (s: LocalStore, messageId: string, muted: boolean) =>
  recordMutation("SET_MUTED", { messageId, muted }, s);
export const setNote = (s: LocalStore, messageId: string, notes: string | null) =>
  recordMutation("SET_NOTE", { messageId, notes }, s);

// Custom fields
export const createCustomField = (s: LocalStore, def: CustomFieldDef) =>
  recordMutation("CREATE_CUSTOM_FIELD", def, s);
export const updateCustomField = (s: LocalStore, fieldId: string, updates: Partial<CustomFieldDef>) =>
  recordMutation("UPDATE_CUSTOM_FIELD", { fieldId, updates }, s);
export const deleteCustomField = (s: LocalStore, fieldId: string) =>
  recordMutation("DELETE_CUSTOM_FIELD", { fieldId }, s);
export const setCustomFieldValue = (
  s: LocalStore, messageId: string, fieldId: string, value: CustomFieldValue,
) => recordMutation("SET_CUSTOM_FIELD_VALUE", { messageId, fieldId, value }, s);
export const clearCustomFieldValue = (s: LocalStore, messageId: string, fieldId: string) =>
  recordMutation("CLEAR_CUSTOM_FIELD_VALUE", { messageId, fieldId }, s);

// Message ops
export const readMessage = (s: LocalStore, messageId: string) =>
  recordMutation("READ", { messageId }, s);
export const unreadMessage = (s: LocalStore, messageId: string) =>
  recordMutation("UNREAD", { messageId }, s);
export const archiveMessage = (s: LocalStore, messageId: string) =>
  recordMutation("ARCHIVE", { messageId }, s);
export const snoozeMessage = (s: LocalStore, messageId: string, until: number) =>
  recordMutation("SNOOZE", { messageId, until }, s);
export const deleteMessage = (s: LocalStore, messageId: string) =>
  recordMutation("DELETE_MESSAGE", { messageId }, s);
export const receiveFromProvider = (s: LocalStore, msg: Message) =>
  recordMutation("RECEIVE_FROM_PROVIDER", msg, s);

// ─── Private helpers ─────────────────────────────────────────────────────────

function _updateMessage(store: LocalStore, messageId: string, updates: Partial<Message>): void {
  const msg = store.messages.get(messageId);
  if (!msg) return;
  store.putMessage({ ...msg, ...updates });
}

function _mergedFlags(
  store: LocalStore,
  messageId: string,
  updates: Partial<Message["flags"]>,
): Message["flags"] {
  const msg = store.messages.get(messageId);
  const base = msg?.flags ?? { read: false, answered: false, draft: false, flagged: false };
  return { ...base, ...updates };
}

function _systemLabelId(store: LocalStore, systemKind: string): string | null {
  for (const label of store.labels.values()) {
    if (label.kind === "system" && label.systemKind === systemKind) return label.id;
  }
  return null;
}

// ── Saved view ops (EP-1) ────────────────────────────────────────────────────

export function saveView(
  store: LocalStore,
  name: string,
  filter: MetadataFilter,
  vaultId = "local",
): SavedView {
  const view: SavedView = {
    id: `sv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    vaultId,
    name,
    filter,
    position: store.savedViews.size,
    createdAt: Date.now(),
  };
  recordMutation("SAVE_VIEW", { viewId: view.id, name, filter }, store);
  store.putSavedView(view);
  return view;
}

export function deleteView(store: LocalStore, viewId: string): void {
  recordMutation("DELETE_VIEW", { viewId }, store);
  store.deleteSavedView(viewId);
}

export function renameView(store: LocalStore, viewId: string, name: string): void {
  recordMutation("RENAME_VIEW", { viewId, name }, store);
  store.renameSavedView(viewId, name);
}

// ── Contact ops ─────────────────────────────────────────────────────────────

export function upsertContact(
  contact: Contact,
  store: LocalStore = _defaultStore,
): void {
  recordMutation("UPSERT_CONTACT", { contact }, store);
  store.putContact(contact);
}

export function updateContact(
  id: string,
  patch: Partial<Pick<Contact, "name" | "emails" | "phones" | "company" | "title" | "website" | "location" | "notes" | "tags">>,
  store: LocalStore = _defaultStore,
): void {
  const existing = store.contacts.get(id);
  if (!existing) return;
  const updated: Contact = { ...existing, ...patch, updatedAt: Date.now() };
  recordMutation("UPDATE_CONTACT", { contact: updated }, store);
  store.putContact(updated);
}

export function deleteContact(id: string, store: LocalStore = _defaultStore): void {
  recordMutation("DELETE_CONTACT", { contactId: id }, store);
  store.deleteContact(id);
}
