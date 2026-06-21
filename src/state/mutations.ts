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

import { listModules } from "@/modules/registry";
import {
  type CalendarEvent,
  type Calendar,
  type Contact,
  type ContactGroup,
  type CustomFieldDef,
  type CustomFieldOption,
  type CustomFieldValue,
  type EventTemplate,
  type FlagState,
  type Folder,
  type Label,
  type Link,
  type Message,
  type Mutation,
  type MutationKind,
  type MutationSource,
  type MetadataFilter,
  type Rule,
  type SavedView,
  type StarStyle,
  type Status,
  type Template,
} from "@/data/types";
import { LocalStore, localStore as _defaultStore } from "@/storage/local";
import { isTauri, applyMutationIpc } from "@/storage/tauri";
import { kindNamespace } from "@/state/mutationKind";
import { getModuleReducer } from "@/state/moduleReducers";
import { emit as emitBusEvent } from "@/state/eventBus";
import { wrapEnvelope, unwrapEnvelope, type MutationMeta } from "@/state/provenance";

// ─── Lamport clock + device id ───────────────────────────────────────────────

let _lamport = 0;
let _deviceId = "web-" + Math.random().toString(36).slice(2, 10);

export function setDeviceId(id: string): void {
  _deviceId = id;
}

export function currentDeviceId(): string {
  return _deviceId;
}

// ─── Undo stack ──────────────────────────────────────────────────────────────

interface UndoEntry {
  /** The original mutation(s) — replayed to redo. */
  forwardSteps: Array<{ kind: MutationKind; payload: unknown }>;
  /** The inverse mutation(s) — replayed to undo. */
  reverseSteps: Array<{ kind: MutationKind; payload: unknown }>;
  description: string;
  /** False for actions that are visible in history but cannot be reversed (e.g. sent email). */
  canUndo: boolean;
  source?: MutationSource;
}

const _undoStack: UndoEntry[] = [];
const _redoStack: UndoEntry[] = [];
const UNDO_MAX = 20;

// When true, recordMutation skips stack push/clear (used during undo/redo replay).
let _skipStack = false;

// ─── Module inverse registry (substrate §4.3) ────────────────────────────────
// Lets a module declare how to reverse its own namespaced mutations, so they
// participate in the undo stack like core mutations.
export interface ModuleInverseResult {
  reverseSteps: Array<{ kind: MutationKind; payload: unknown }>;
  description: string;
}
export type ModuleInverseBuilder = (
  kind: MutationKind,
  payload: unknown,
  store: LocalStore,
) => ModuleInverseResult | null;

const _moduleInverses = new Map<string, ModuleInverseBuilder>();

/** Register an inverse-builder for a module namespace. Returns a disposer. */
export function registerModuleInverse(namespace: string, builder: ModuleInverseBuilder): () => void {
  if (namespace === "nexus") {
    throw new Error(`Cannot register a module inverse for reserved namespace "${namespace}"`);
  }
  if (_moduleInverses.has(namespace)) {
    throw new Error(`A module inverse is already registered for namespace "${namespace}"`);
  }
  _moduleInverses.set(namespace, builder);
  return () => {
    if (_moduleInverses.get(namespace) === builder) _moduleInverses.delete(namespace);
  };
}

/** Test-only: clear all module inverse builders. */
export function _resetModuleInverses(): void {
  _moduleInverses.clear();
}

/** Test-only: clear the undo/redo stacks (module-global mutation pipeline state). */
export function _resetUndoStacks(): void {
  _undoStack.length = 0;
  _redoStack.length = 0;
}

/** Undo the last undoable mutation. Returns a human-readable description, or null if nothing can be undone. */
export function undoLastMutation(store: LocalStore = _defaultStore): string | null {
  // A non-undoable entry at the top of the stack acts as a barrier — z does nothing.
  const top = _undoStack[_undoStack.length - 1];
  if (!top?.canUndo) return null;
  const entry = _undoStack.pop()!;
  _redoStack.push(entry);
  if (_redoStack.length > UNDO_MAX) _redoStack.shift();
  _skipStack = true;
  for (const step of entry.reverseSteps) recordMutation(step.kind, step.payload, store);
  _skipStack = false;
  return entry.description;
}

/** Redo the last undone mutation. Returns a human-readable description, or null if nothing to redo. */
export function redoLastMutation(store: LocalStore = _defaultStore): string | null {
  const entry = _redoStack.pop();
  if (!entry) return null;
  _undoStack.push(entry);
  if (_undoStack.length > UNDO_MAX) _undoStack.shift();
  _skipStack = true;
  for (const step of entry.forwardSteps) recordMutation(step.kind, step.payload, store);
  _skipStack = false;
  return entry.description;
}

export interface HistoryEntry {
  description: string;
  canUndo: boolean;
  /** True when a non-undoable barrier exists between this item and "Now", making it unreachable. */
  blocked: boolean;
  /** Provenance of the action (e.g. "ai"). Absent ⇒ user action. */
  source?: MutationSource;
}

/** Returns the undo history with the most-recent action first. */
export function getUndoHistory(): HistoryEntry[] {
  const items = [..._undoStack].reverse();
  let barrier = false;
  return items.map((e) => {
    const entry: HistoryEntry = { description: e.description, canUndo: e.canUndo, blocked: barrier, source: e.source };
    if (!e.canUndo) barrier = true;
    return entry;
  });
}

/** Returns the redo history with the next-to-redo action first. */
export function getRedoHistory(): HistoryEntry[] {
  return [..._redoStack].reverse().map((e) => ({ description: e.description, canUndo: e.canUndo, blocked: false, source: e.source }));
}

/** Entries for actions that appear in history but cannot be reversed. */
function _buildNonUndoableEntry(kind: MutationKind, payload: unknown): UndoEntry | null {
  const forward = [{ kind, payload }];
  switch (kind) {
    case "SEND_MESSAGE":
      return { forwardSteps: forward, reverseSteps: [], description: "Send email", canUndo: false };
    case "DELETE_MESSAGE":
      return { forwardSteps: forward, reverseSteps: [], description: "Delete message", canUndo: false };
    default:
      return null;
  }
}

function _buildReverseEntry(
  kind: MutationKind,
  payload: unknown,
  store: LocalStore,
): UndoEntry | null {
  const ns = kindNamespace(kind);
  if (ns !== null) {
    const result = _moduleInverses.get(ns)?.(kind, payload, store);
    if (!result) return null;
    return {
      forwardSteps: [{ kind, payload }],
      reverseSteps: result.reverseSteps,
      description: result.description,
      canUndo: true,
    };
  }
  const inner = _buildReverseEntryInner(kind, payload, store);
  return inner ? { ...inner, canUndo: true } : null;
}

function _buildReverseEntryInner(
  kind: MutationKind,
  payload: unknown,
  store: LocalStore,
): Omit<UndoEntry, "canUndo"> | null {
  type Step = { kind: MutationKind; payload: unknown };
  const forward: Step[] = [{ kind, payload }];

  switch (kind) {
    case "ADD_LABEL":
      return { forwardSteps: forward, reverseSteps: [{ kind: "REMOVE_LABEL", payload }], description: "Add label" };

    case "REMOVE_LABEL":
      return { forwardSteps: forward, reverseSteps: [{ kind: "ADD_LABEL", payload }], description: "Remove label" };

    case "READ": {
      const { messageId } = payload as { messageId: string };
      return { forwardSteps: forward, reverseSteps: [{ kind: "UNREAD", payload: { messageId } }], description: "Mark read" };
    }

    case "UNREAD": {
      const { messageId } = payload as { messageId: string };
      return { forwardSteps: forward, reverseSteps: [{ kind: "READ", payload: { messageId } }], description: "Mark unread" };
    }

    case "ARCHIVE": {
      const { messageId } = payload as { messageId: string };
      const inboxId = _systemLabelId(store, "inbox");
      const archiveId = _systemLabelId(store, "archive");
      if (!inboxId) return null;
      const reverseSteps: Step[] = [{ kind: "ADD_LABEL", payload: { messageId, labelId: inboxId } }];
      if (archiveId) reverseSteps.push({ kind: "REMOVE_LABEL", payload: { messageId, labelId: archiveId } });
      return { forwardSteps: forward, reverseSteps, description: "Archive" };
    }

    case "TRASH": {
      const { messageId } = payload as { messageId: string };
      const inboxId = _systemLabelId(store, "inbox");
      const trashId = _systemLabelId(store, "trash");
      if (!inboxId) return null;
      const reverseSteps: Step[] = [{ kind: "ADD_LABEL", payload: { messageId, labelId: inboxId } }];
      if (trashId) reverseSteps.push({ kind: "REMOVE_LABEL", payload: { messageId, labelId: trashId } });
      return { forwardSteps: forward, reverseSteps, description: "Move to trash" };
    }

    case "SET_STAR": {
      const { messageId } = payload as { messageId: string; star: StarStyle };
      return { forwardSteps: forward, reverseSteps: [{ kind: "CLEAR_STAR", payload: { messageId } }], description: "Star" };
    }

    case "CLEAR_STAR": {
      const { messageId } = payload as { messageId: string };
      const msg = store.messages.get(messageId);
      if (!msg?.star) return null;
      return { forwardSteps: forward, reverseSteps: [{ kind: "SET_STAR", payload: { messageId, star: msg.star } }], description: "Unstar" };
    }

    case "SET_PINNED": {
      const { messageId, pinned } = payload as { messageId: string; pinned: boolean };
      return { forwardSteps: forward, reverseSteps: [{ kind: "SET_PINNED", payload: { messageId, pinned: !pinned } }], description: pinned ? "Pin" : "Unpin" };
    }

    case "SET_MUTED": {
      const { messageId, muted } = payload as { messageId: string; muted: boolean };
      return { forwardSteps: forward, reverseSteps: [{ kind: "SET_MUTED", payload: { messageId, muted: !muted } }], description: muted ? "Mute" : "Unmute" };
    }

    case "SET_NOTE": {
      const { messageId } = payload as { messageId: string };
      const msg = store.messages.get(messageId);
      return { forwardSteps: forward, reverseSteps: [{ kind: "SET_NOTE", payload: { messageId, notes: msg?.notes ?? null } }], description: "Set note" };
    }

    case "MOVE_TO_FOLDER": {
      const { messageId } = payload as { messageId: string };
      const msg = store.messages.get(messageId);
      if (!msg?.folderId) return null;
      return { forwardSteps: forward, reverseSteps: [{ kind: "MOVE_TO_FOLDER", payload: { messageId, folderId: msg.folderId } }], description: "Move to folder" };
    }

    case "SET_STATUS": {
      const { messageId } = payload as { messageId: string };
      const msg = store.messages.get(messageId);
      const reverseSteps: Step[] = msg?.statusId
        ? [{ kind: "SET_STATUS", payload: { messageId, statusId: msg.statusId } }]
        : [{ kind: "CLEAR_STATUS", payload: { messageId } }];
      return { forwardSteps: forward, reverseSteps, description: "Set status" };
    }

    case "CLEAR_STATUS": {
      const { messageId } = payload as { messageId: string };
      const msg = store.messages.get(messageId);
      if (!msg?.statusId) return null;
      return { forwardSteps: forward, reverseSteps: [{ kind: "SET_STATUS", payload: { messageId, statusId: msg.statusId } }], description: "Clear status" };
    }

    case "SET_PRIORITY": {
      const { messageId } = payload as { messageId: string };
      const msg = store.messages.get(messageId);
      const reverseSteps: Step[] = msg?.priority
        ? [{ kind: "SET_PRIORITY", payload: { messageId, priority: msg.priority } }]
        : [{ kind: "CLEAR_PRIORITY", payload: { messageId } }];
      return { forwardSteps: forward, reverseSteps, description: "Set priority" };
    }

    case "CLEAR_PRIORITY": {
      const { messageId } = payload as { messageId: string };
      const msg = store.messages.get(messageId);
      if (!msg?.priority) return null;
      return { forwardSteps: forward, reverseSteps: [{ kind: "SET_PRIORITY", payload: { messageId, priority: msg.priority } }], description: "Clear priority" };
    }

    case "CREATE_FOLDER": {
      const { id: folderId } = payload as { id: string };
      return {
        forwardSteps: forward,
        reverseSteps: [{ kind: "DELETE_FOLDER", payload: { folderId } }],
        description: "Create folder",
      };
    }

    case "CREATE_LINK": {
      const link = payload as Link;
      return {
        forwardSteps: forward,
        reverseSteps: [{ kind: "DELETE_LINK", payload: { linkId: link.id } }],
        description: "Link",
      };
    }

    case "DELETE_LINK": {
      const { linkId } = payload as { linkId: string };
      const existing = store.links.get(linkId);
      if (!existing) return null;
      return {
        forwardSteps: forward,
        reverseSteps: [{ kind: "CREATE_LINK", payload: existing }],
        description: "Unlink",
      };
    }

    default:
      return null;
  }
}

// ─── Core record function ────────────────────────────────────────────────────

/**
 * Apply + persist + broadcast a single mutation — EVERYTHING recordMutation does
 * EXCEPT the undo-stack push/clear. Shared by recordMutation and recordMutations.
 * The undo-entry build + stack push stays in the callers because the inverse must
 * be captured BEFORE the mutation is applied (pre-state).
 */
function _applyAndPersist(
  kind: MutationKind,
  payload: unknown,
  store: LocalStore,
  opts?: MutationMeta,
): Mutation {
  _lamport += 1;
  const persistedPayload = wrapEnvelope(payload, opts);
  const mutation: Mutation = {
    id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    vaultId: store.vault?.id ?? "local",
    deviceId: _deviceId,
    ts: Date.now(),
    lamport: _lamport,
    kind,
    payload: persistedPayload,
    source: opts?.source ?? "user",
    ...(opts?.generatedBy ? { generatedBy: opts.generatedBy } : {}),
  };

  store.appendMutation(mutation);
  applyMutation(mutation, store);

  // Fire-and-forget persistence to SQLite in Tauri mode
  if (isTauri()) {
    applyMutationIpc(kind, persistedPayload, mutation.deviceId, mutation.lamport).catch((e) =>
      console.warn("IPC mutation persist failed:", e),
    );
  }

  // Notify the in-process event bus (live mutation only — replay does not emit).
  emitBusEvent(mutation);

  return mutation;
}

export function recordMutation(
  kind: MutationKind,
  payload: unknown,
  store: LocalStore = _defaultStore,
  opts?: MutationMeta,
): Mutation {
  // Capture reverse entry before applyMutation modifies the store.
  const undoEntry = _skipStack
    ? null
    : (_buildReverseEntry(kind, payload, store) ?? _buildNonUndoableEntry(kind, payload));
  if (undoEntry && opts?.source) undoEntry.source = opts.source;

  const mutation = _applyAndPersist(kind, payload, store, opts);

  if (!_skipStack) {
    if (undoEntry) {
      _undoStack.push(undoEntry);
      if (_undoStack.length > UNDO_MAX) _undoStack.shift();
    }
    _redoStack.length = 0;
  }

  return mutation;
}

/**
 * Apply N mutations as one atomic compound action (substrate §4.4). Each step is
 * persisted/broadcast exactly like recordMutation, but the whole batch pushes ONE
 * combined undo entry whose reverseSteps are every step's inverse concatenated in
 * REVERSE order (undo unwinds last-applied-first). If any step is non-undoable, the
 * compound is recorded without an undo entry.
 */
export function recordMutations(
  steps: Array<{ kind: MutationKind; payload: unknown }>,
  store: LocalStore = _defaultStore,
  description = "Multiple changes",
  opts?: MutationMeta,
): void {
  if (steps.length === 0) return;
  const reverse: Array<{ kind: MutationKind; payload: unknown }> = [];
  let undoable = true;
  for (const step of steps) {
    // Inverse must be captured BEFORE this step is applied (pre-state).
    const entry = _skipStack ? null : _buildReverseEntry(step.kind, step.payload, store);
    if (entry && entry.canUndo) reverse.unshift(...entry.reverseSteps);
    else undoable = false;
    _applyAndPersist(step.kind, step.payload, store, opts);
  }
  if (!_skipStack) {
    if (undoable && reverse.length) {
      _undoStack.push({ forwardSteps: [...steps], reverseSteps: reverse, description, canUndo: true, source: opts?.source });
      if (_undoStack.length > UNDO_MAX) _undoStack.shift();
    }
    _redoStack.length = 0;
  }
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

/**
 * Replay all logged mutations for a module namespace onto the store. A module
 * calls this when it registers (often after hydration) to rebuild its
 * projection from the mutation log — including mutations that arrived from other
 * devices while the module was not installed. (substrate §4.2, P5)
 */
export function replayModuleMutations(namespace: string, store: LocalStore): void {
  for (const m of store.mutations) {
    if (kindNamespace(m.kind) === namespace) applyMutation(m, store);
  }
}

/**
 * Replay the logged mutations for every registered module, rebuilding their
 * projections after the vault's mutation log has been hydrated. Modules register
 * at bootstrap (before hydration), so this runs post-hydrate.
 */
export function replayRegisteredModules(store: LocalStore = _defaultStore): void {
  for (const m of listModules()) replayModuleMutations(m.namespace, store);
}

/**
 * Apply a mutation that originated in another window (received via the
 * `vault:mutation-applied` Tauri broadcast). Patches the local in-memory store
 * only — it must NOT re-persist to SQLite (the originating window already did)
 * nor push to the undo stack (undo is a per-window affordance). Advances the
 * local Lamport clock so subsequent local writes stay causally ordered.
 */
export function applyRemoteMutation(
  kind: MutationKind,
  payload: unknown,
  lamport: number,
  store: LocalStore = _defaultStore,
): void {
  if (lamport > _lamport) _lamport = lamport;
  const mutation: Mutation = {
    id: `remote-${lamport}`,
    vaultId: store.vault?.id ?? "local",
    deviceId: "remote",
    ts: Date.now(),
    lamport,
    kind,
    payload,
  };
  applyMutation(mutation, store);
  emitBusEvent(mutation);
}

// ─── Apply ───────────────────────────────────────────────────────────────────
// Dispatches a single mutation to the appropriate handler.

export function applyMutation(mIn: Mutation, store: LocalStore): void {
  const { payload, meta } = unwrapEnvelope(mIn.payload);
  if (meta) {
    if (meta.source) mIn.source = meta.source;
    if (meta.generatedBy) mIn.generatedBy = meta.generatedBy;
  }
  const m = meta ? { ...mIn, payload } : mIn;
  const ns = kindNamespace(m.kind);
  if (ns !== null) {
    // Module-namespaced mutation: dispatch to the registered module reducer.
    // If the module isn't registered in this window, the mutation is still
    // recorded in the log (appendMutation / SQLite) and will be replayed when
    // the module registers — see replayModuleMutations. (substrate §4.2)
    getModuleReducer(ns)?.apply(m.kind, m.payload, store);
    return;
  }
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
      const msg = store.messages.get(messageId);
      if (!msg) break;
      const starredLabel = Array.from(store.labels.values()).find((l) => l.systemKind === "starred");
      const labelIds = starredLabel && !msg.labelIds.includes(starredLabel.id)
        ? [...msg.labelIds, starredLabel.id]
        : msg.labelIds;
      _updateMessage(store, messageId, { star, labelIds });
      break;
    }
    case "CLEAR_STAR": {
      const { messageId } = m.payload as { messageId: string };
      const msg = store.messages.get(messageId);
      if (!msg) break;
      const starredLabel = Array.from(store.labels.values()).find((l) => l.systemKind === "starred");
      const labelIds = starredLabel
        ? msg.labelIds.filter((l) => l !== starredLabel.id)
        : msg.labelIds;
      _updateMessage(store, messageId, { star: null, labelIds });
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
    case "REORDER_CUSTOM_FIELD_DEFS": {
      const { orderedIds } = m.payload as { orderedIds: string[] };
      for (let i = 0; i < orderedIds.length; i++) {
        const def = store.customFieldDefs.get(orderedIds[i]!);
        if (def) store.customFieldDefs.set(def.id, { ...def, position: i });
      }
      break;
    }
    case "REORDER_CUSTOM_FIELD_OPTIONS": {
      const { fieldId, orderedIds } = m.payload as { fieldId: string; orderedIds: string[] };
      const def = store.customFieldDefs.get(fieldId);
      if (!def?.options) break;
      const byId = new Map(def.options.map((o) => [o.id, o]));
      const reordered: CustomFieldOption[] = [];
      for (let i = 0; i < orderedIds.length; i++) {
        const opt = byId.get(orderedIds[i]!);
        if (opt) reordered.push({ ...opt, position: i });
      }
      store.customFieldDefs.set(def.id, { ...def, options: reordered });
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
    case "TRASH": {
      const { messageId } = m.payload as { messageId: string };
      const msg = store.messages.get(messageId);
      if (msg) {
        const inboxId = _systemLabelId(store, "inbox");
        const trashId = _systemLabelId(store, "trash");
        let labelIds = msg.labelIds.filter((l) => l !== inboxId);
        if (trashId && !labelIds.includes(trashId)) labelIds = [...labelIds, trashId];
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

    // ── Link / relations graph ops (substrate Pillar 3) ─────────
    case "CREATE_LINK": {
      store.putLink(m.payload as Link);
      break;
    }
    case "DELETE_LINK": {
      const { linkId } = m.payload as { linkId: string };
      store.deleteLink(linkId);
      break;
    }

    // ── Saved view ops ───────────────────────────────────────────
    case "SAVE_VIEW": {
      const view = m.payload as SavedView;
      store.putSavedView(view);
      break;
    }
    case "DELETE_VIEW": {
      const { viewId } = m.payload as { viewId: string };
      store.deleteSavedView(viewId);
      break;
    }
    case "RENAME_VIEW": {
      const { viewId, name } = m.payload as { viewId: string; name: string };
      const sv = store.savedViews.get(viewId);
      if (sv) store.putSavedView({ ...sv, name });
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
    case "CREATE_CONTACT_GROUP":
    case "UPDATE_CONTACT_GROUP": {
      const { group } = m.payload as { group: ContactGroup };
      store.putContactGroup(group);
      break;
    }
    case "DELETE_CONTACT_GROUP": {
      const { groupId } = m.payload as { groupId: string };
      store.deleteContactGroup(groupId);
      break;
    }
    case "ADD_CONTACT_TO_GROUP": {
      const { groupId, contactId } = m.payload as { groupId: string; contactId: string };
      store.addContactToGroup(groupId, contactId);
      break;
    }
    case "REMOVE_CONTACT_FROM_GROUP": {
      const { groupId, contactId } = m.payload as { groupId: string; contactId: string };
      store.removeContactFromGroup(groupId, contactId);
      break;
    }

    // ── Rule ops ─────────────────────────────────────────────────
    case "CREATE_RULE":
    case "UPDATE_RULE": {
      const rule = m.payload as Rule;
      store.putRule(rule);
      break;
    }
    case "DELETE_RULE": {
      const { ruleId } = m.payload as { ruleId: string };
      store.deleteRule(ruleId);
      break;
    }
    case "REORDER_RULES": {
      const { orderedIds } = m.payload as { orderedIds: string[] };
      for (let i = 0; i < orderedIds.length; i++) {
        const r = store.rules.get(orderedIds[i]!);
        if (r) store.putRule({ ...r, position: i });
      }
      break;
    }

    // ── Template ops ──────────────────────────────────────────────
    case "CREATE_TEMPLATE":
    case "UPDATE_TEMPLATE": {
      const template = m.payload as Template;
      store.putTemplate(template);
      break;
    }
    case "DELETE_TEMPLATE": {
      const { templateId } = m.payload as { templateId: string };
      store.deleteTemplate(templateId);
      break;
    }

    // ── Calendar ops ──────────────────────────────────────────────
    case "UPSERT_CALENDAR_EVENT": {
      const event = m.payload as CalendarEvent;
      store.putCalendarEvent(event);
      break;
    }
    case "DELETE_CALENDAR_EVENT": {
      const { eventId } = m.payload as { eventId: string };
      store.deleteCalendarEvent(eventId);
      break;
    }
    case "UPDATE_CALENDAR_EVENT_NOTES": {
      const { id, notes } = m.payload as { id: string; notes: string | undefined };
      const existing = store.calendarEvents.get(id);
      if (existing) store.putCalendarEvent({ ...existing, notes });
      break;
    }
    case "UPDATE_CALENDAR_EVENT": {
      const { id, startTs, endTs } = m.payload as { id: string; startTs: number; endTs: number };
      const existing = store.calendarEvents.get(id);
      if (existing) store.putCalendarEvent({ ...existing, startTs, endTs, updatedAt: Date.now() });
      break;
    }
    case "SAVE_EVENT_TEMPLATE": {
      const tmpl = m.payload as EventTemplate;
      store.putEventTemplate(tmpl);
      break;
    }
    case "DELETE_EVENT_TEMPLATE": {
      const { templateId } = m.payload as { templateId: string };
      store.deleteEventTemplate(templateId);
      break;
    }

    // ── Calendar collection + recurrence ops (EP-14) ──────────────
    case "UPSERT_CALENDAR":
    case "UPDATE_CALENDAR": {
      const cal = m.payload as Calendar;
      const existing = store.calendars.get(cal.id);
      store.putCalendar({ ...existing, ...cal });
      break;
    }
    case "DELETE_CALENDAR": {
      const { calendarId } = m.payload as { calendarId: string };
      store.deleteCalendar(calendarId);
      break;
    }
    case "EDIT_EVENT_OCCURRENCE": {
      // Optimistic: update the targeted occurrence's times/fields in place.
      // The Rust core rewrites the master's ICS and re-expands on the next
      // hydration, which is the canonical result.
      const { masterId, occurrenceStart, changes } = m.payload as {
        masterId: string;
        occurrenceStart: number;
        changes: Partial<CalendarEvent>;
      };
      const key = `${masterId}::${occurrenceStart}`;
      const existing = store.calendarEvents.get(key) ?? store.calendarEvents.get(masterId);
      if (existing) store.putCalendarEvent({ ...existing, ...changes, updatedAt: Date.now() });
      break;
    }
    case "EDIT_EVENT_SERIES": {
      // Optimistic: update the master; full re-expansion comes from hydration.
      const { masterId, changes } = m.payload as { masterId: string; changes: Partial<CalendarEvent> };
      const existing = store.calendarEvents.get(masterId);
      if (existing) store.putCalendarEvent({ ...existing, ...changes, updatedAt: Date.now() });
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
export const reorderCustomFieldDefs = (s: LocalStore, orderedIds: string[]) =>
  recordMutation("REORDER_CUSTOM_FIELD_DEFS", { orderedIds }, s);
export const reorderCustomFieldOptions = (
  s: LocalStore, fieldId: string, orderedIds: string[],
) => recordMutation("REORDER_CUSTOM_FIELD_OPTIONS", { fieldId, orderedIds }, s);

// Message ops
export const readMessage = (s: LocalStore, messageId: string) =>
  recordMutation("READ", { messageId }, s);
export const unreadMessage = (s: LocalStore, messageId: string) =>
  recordMutation("UNREAD", { messageId }, s);
export const archiveMessage = (s: LocalStore, messageId: string) =>
  recordMutation("ARCHIVE", { messageId }, s);
export const unarchiveMessage = (s: LocalStore, messageId: string) => {
  const msg = s.messages.get(messageId);
  if (!msg) return;
  const inboxId = _systemLabelId(s, "inbox");
  const archiveId = _systemLabelId(s, "archive");
  if (inboxId && !msg.labelIds.includes(inboxId))
    recordMutation("ADD_LABEL", { messageId, labelId: inboxId }, s);
  if (archiveId && msg.labelIds.includes(archiveId))
    recordMutation("REMOVE_LABEL", { messageId, labelId: archiveId }, s);
};
export const trashMessage = (s: LocalStore, messageId: string) =>
  recordMutation("TRASH", { messageId }, s);
export const markAsSpam = (s: LocalStore, messageId: string) => {
  const msg = s.messages.get(messageId);
  if (!msg) return;
  const spamId = _spamLabelId(s);
  const inboxId = _systemLabelId(s, "inbox");
  if (spamId && !msg.labelIds.includes(spamId))
    recordMutation("ADD_LABEL", { messageId, labelId: spamId }, s);
  if (inboxId && msg.labelIds.includes(inboxId))
    recordMutation("REMOVE_LABEL", { messageId, labelId: inboxId }, s);
};
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

// Spam has no stable systemKind: fixtures tag it "important", Gmail sync leaves it
// null. Both keep kind "system" and either an id of "spam"/"{vault}-spam" or the
// name "Spam", so match on those instead.
function _spamLabelId(store: LocalStore): string | null {
  for (const label of store.labels.values()) {
    if (
      label.kind === "system" &&
      (label.id === "spam" || label.id.endsWith("-spam") || label.name.toLowerCase() === "spam")
    )
      return label.id;
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
  recordMutation("SAVE_VIEW", view, store);
  return view;
}

export function deleteView(store: LocalStore, viewId: string): void {
  recordMutation("DELETE_VIEW", { viewId }, store);
}

export function renameView(store: LocalStore, viewId: string, name: string): void {
  recordMutation("RENAME_VIEW", { viewId, name }, store);
}

// ── Link ops (substrate Pillar 3) ────────────────────────────────────────────

/**
 * Create a typed edge between two entities. Returns the full Link (with a
 * generated id). Flows through recordMutation so it syncs, undoes, and
 * broadcasts. (substrate Pillar 3)
 */
export function createLink(
  store: LocalStore,
  spec: {
    srcType: string;
    srcId: string;
    linkType: string;
    dstType: string;
    dstId: string;
    meta?: unknown;
  },
): Link {
  const link: Link = {
    id: `lnk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    vaultId: store.vault?.id ?? "local",
    srcType: spec.srcType,
    srcId: spec.srcId,
    linkType: spec.linkType,
    dstType: spec.dstType,
    dstId: spec.dstId,
    meta: spec.meta,
    createdAt: Date.now(),
  };
  recordMutation("CREATE_LINK", link, store);
  return link;
}

/** Remove a link by id. */
export function deleteLink(store: LocalStore, linkId: string): void {
  recordMutation("DELETE_LINK", { linkId }, store);
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
  patch: Partial<Pick<Contact, "name" | "emails" | "phones" | "company" | "title" | "website" | "location" | "notes" | "tags" | "alwaysShowImages" | "birthday" | "socialProfiles" | "addresses" | "importance">>,
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

// ── Rule ops ─────────────────────────────────────────────────────────────────

export function saveRuleMutation(rule: Rule, store: LocalStore = _defaultStore): void {
  const exists = store.rules.has(rule.id);
  recordMutation(exists ? "UPDATE_RULE" : "CREATE_RULE", rule, store);
}

export function deleteRuleMutation(ruleId: string, store: LocalStore = _defaultStore): void {
  recordMutation("DELETE_RULE", { ruleId }, store);
}

export function reorderRulesMutation(orderedIds: string[], store: LocalStore = _defaultStore): void {
  recordMutation("REORDER_RULES", { orderedIds }, store);
}

// ── Template ops ──────────────────────────────────────────────────────────────

export function saveTemplateMutation(template: Template, store: LocalStore = _defaultStore): void {
  const exists = store.templates.has(template.id);
  recordMutation(exists ? "UPDATE_TEMPLATE" : "CREATE_TEMPLATE", template, store);
}

export function deleteTemplateMutation(templateId: string, store: LocalStore = _defaultStore): void {
  recordMutation("DELETE_TEMPLATE", { templateId }, store);
}

// ── Event template ops ────────────────────────────────────────────────────────

export function saveEventTemplateMutation(tmpl: EventTemplate, store: LocalStore = _defaultStore): void {
  recordMutation("SAVE_EVENT_TEMPLATE", tmpl, store);
}

export function deleteEventTemplateMutation(templateId: string, store: LocalStore = _defaultStore): void {
  recordMutation("DELETE_EVENT_TEMPLATE", { templateId }, store);
}

export function rescheduleCalendarEvent(
  store: LocalStore,
  eventId: string,
  newStartTs: number,
  newEndTs: number,
): void {
  recordMutation("UPDATE_CALENDAR_EVENT", { id: eventId, startTs: newStartTs, endTs: newEndTs }, store);
}

// ── Calendar collection ops (EP-14) ───────────────────────────────────────────

export function upsertCalendarMutation(cal: Calendar, store: LocalStore = _defaultStore): void {
  recordMutation("UPSERT_CALENDAR", cal, store);
}

export function updateCalendarMutation(cal: Calendar, store: LocalStore = _defaultStore): void {
  recordMutation("UPDATE_CALENDAR", cal, store);
}

export function deleteCalendarMutation(calendarId: string, store: LocalStore = _defaultStore): void {
  recordMutation("DELETE_CALENDAR", { calendarId }, store);
}

// ── Recurring-event edit ops (EP-14) ──────────────────────────────────────────

/**
 * Which instances a recurring-event edit applies to. Mirrors the Rust
 * `EditScope` enum. `thisAndFollowing` is intentionally unsupported (it would
 * need to split the series) — `applyEventEdit` rejects it with a typed error so
 * the UI can show a clear message instead of corrupting the series.
 */
export type EditScope = "occurrence" | "series" | "thisAndFollowing";

export class UnsupportedEditScopeError extends Error {
  constructor() {
    super("Editing 'this and following' events is not supported yet.");
    this.name = "UnsupportedEditScopeError";
  }
}

/**
 * Apply a recurring-event edit at the given scope. Throws
 * `UnsupportedEditScopeError` for `thisAndFollowing`.
 */
export function applyEventEdit(
  store: LocalStore,
  scope: EditScope,
  masterId: string,
  occurrenceStart: number,
  changes: Partial<CalendarEvent>,
): void {
  switch (scope) {
    case "occurrence":
      editEventOccurrence(store, masterId, occurrenceStart, changes);
      return;
    case "series":
      editEventSeries(store, masterId, changes);
      return;
    case "thisAndFollowing":
      throw new UnsupportedEditScopeError();
  }
}

/** Edit a single occurrence of a recurring series (creates an inline exception). */
export function editEventOccurrence(
  store: LocalStore,
  masterId: string,
  occurrenceStart: number,
  changes: Partial<CalendarEvent>,
): void {
  recordMutation("EDIT_EVENT_OCCURRENCE", { masterId, occurrenceStart, changes }, store);
}

/** Edit the whole recurring series (shifts master + existing exceptions). */
export function editEventSeries(
  store: LocalStore,
  masterId: string,
  changes: Partial<CalendarEvent>,
): void {
  recordMutation("EDIT_EVENT_SERIES", { masterId, changes }, store);
}
