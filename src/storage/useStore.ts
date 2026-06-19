/**
 * React bindings for LocalStore.
 *
 * Pattern: useSyncExternalStore returns localStore.version (a number —
 * primitives pass Object.is tearing checks). useMemo derives arrays/objects
 * from that version so references are stable until data actually changes.
 */

import { useMemo, useEffect, useRef } from "react";
import { useSyncExternalStore } from "react";
import { localStore } from "@/storage/local";
import { queryMessages } from "@/storage/query";
import { useWorkspace } from "@/state/workspace";
import { isTauri, getMessagesForLabel } from "@/storage/tauri";
import type { Contact, ContactGroup, Folder, Label, SavedView, Status, Account, Message, MetadataFilter, CustomFieldDef } from "@/data/types";

function subscribe(cb: () => void): () => void {
  return localStore.subscribe(cb);
}

/** Returns the current store version (increments on every mutation). */
export function useStoreVersion(): number {
  return useSyncExternalStore(subscribe, () => localStore.version);
}

/** Returns all labels sorted by position. */
export function useLabels(): Label[] {
  const v = useStoreVersion();
  return useMemo(
    () => Array.from(localStore.labels.values()).sort((a, b) => a.position - b.position),
    [v],
  );
}

/** Returns system labels in canonical order. */
export function useSystemLabels(): Label[] {
  const v = useStoreVersion();
  return useMemo(
    () =>
      Array.from(localStore.labels.values())
        .filter((l) => l.kind === "system")
        .sort((a, b) => a.position - b.position),
    [v],
  );
}

/** Returns user labels sorted by position. */
export function useUserLabels(): Label[] {
  const v = useStoreVersion();
  return useMemo(
    () =>
      Array.from(localStore.labels.values())
        .filter((l) => l.kind === "user")
        .sort((a, b) => a.position - b.position),
    [v],
  );
}

/** Returns root user labels (no parentId) sorted by position. */
export function useRootUserLabels(): Label[] {
  const v = useStoreVersion();
  return useMemo(
    () =>
      Array.from(localStore.labels.values())
        .filter((l) => l.kind === "user" && !l.parentId)
        .sort((a, b) => a.position - b.position),
    [v],
  );
}

/** Returns direct children of a given label, sorted by position. */
export function useLabelChildren(parentId: string): Label[] {
  const v = useStoreVersion();
  return useMemo(
    () =>
      Array.from(localStore.labels.values())
        .filter((l) => l.parentId === parentId)
        .sort((a, b) => a.position - b.position),
    [v, parentId],
  );
}

/** Returns all folders. */
export function useFolders(): Folder[] {
  const v = useStoreVersion();
  return useMemo(() => Array.from(localStore.folders.values()), [v]);
}

/** Returns root folders (parentId === null). */
export function useRootFolders(): Folder[] {
  const v = useStoreVersion();
  return useMemo(
    () => Array.from(localStore.folders.values()).filter((f) => f.parentId === null),
    [v],
  );
}

/** Returns child folders for a given parent. */
export function useChildFolders(parentId: string): Folder[] {
  const v = useStoreVersion();
  return useMemo(
    () => Array.from(localStore.folders.values()).filter((f) => f.parentId === parentId),
    [v, parentId],
  );
}

/** Returns all statuses sorted by position. */
export function useStatuses(): Status[] {
  const v = useStoreVersion();
  return useMemo(
    () => Array.from(localStore.statuses.values()).sort((a, b) => a.position - b.position),
    [v],
  );
}

/** Returns all accounts. */
export function useAccounts(): Account[] {
  const v = useStoreVersion();
  return useMemo(() => Array.from(localStore.accounts.values()), [v]);
}

/** Returns unread count for a label. */
export function useLabelUnreadCount(labelId: string): number {
  const v = useStoreVersion();
  return useMemo(() => {
    const msgIds = localStore.messagesByLabel.get(labelId) ?? new Set();
    let count = 0;
    for (const id of msgIds) {
      const msg = localStore.messages.get(id);
      if (msg && !msg.flags.read) count++;
    }
    return count;
  }, [v, labelId]);
}

/** Returns total count for a label. */
export function useLabelCount(labelId: string): number {
  const v = useStoreVersion();
  return useMemo(
    () => localStore.messagesByLabel.get(labelId)?.size ?? 0,
    [v, labelId],
  );
}

/** Returns folder message count. */
export function useFolderCount(folderId: string): number {
  const v = useStoreVersion();
  return useMemo(
    () => localStore.messagesByFolder.get(folderId)?.size ?? 0,
    [v, folderId],
  );
}

/** Returns unread count for a folder. */
export function useFolderUnreadCount(folderId: string): number {
  const v = useStoreVersion();
  return useMemo(() => {
    const msgIds = localStore.messagesByFolder.get(folderId) ?? new Set();
    let count = 0;
    for (const id of msgIds) {
      const msg = localStore.messages.get(id);
      if (msg && !msg.flags.read) count++;
    }
    return count;
  }, [v, folderId]);
}

/** Returns total unread count across all messages in the inbox label. */
export function useTotalInboxUnread(): number {
  const v = useStoreVersion();
  return useMemo(() => {
    let count = 0;
    // Find the inbox system label
    for (const label of localStore.labels.values()) {
      if (label.kind === "system" && label.systemKind === "inbox") {
        const msgIds = localStore.messagesByLabel.get(label.id) ?? new Set();
        for (const id of msgIds) {
          const msg = localStore.messages.get(id);
          if (msg && !msg.flags.read) count++;
        }
        break;
      }
    }
    return count;
  }, [v]);
}

export function useContacts(): Contact[] {
  const v = useStoreVersion();
  void v;
  // Some contacts (notably Google-imported ones with only an email) have
  // name === null at runtime even though the type says string. Sort by name
  // when present, falling back to the primary email so they group near
  // alphabetically rather than throwing "null is not an object" (mirrors the
  // guard added in the command palette in commit e295200).
  const label = (c: Contact): string => c.name ?? c.emails?.[0] ?? "";
  return Array.from(localStore.contacts.values()).sort((a, b) =>
    label(a).localeCompare(label(b)),
  );
}

export function useContactGroups(): ContactGroup[] {
  const v = useStoreVersion();
  void v;
  return localStore.getContactGroups();
}

export function useContactByEmail(email: string): Contact | null {
  const v = useStoreVersion();
  void v;
  return localStore.lookupByEmail(email);
}

export function useContactMessageCount(contactId: string): number {
  const v = useStoreVersion();
  void v;
  return localStore.messagesByContact.get(contactId)?.size ?? 0;
}

/** Returns the most recent `limit` messages involving a contact, newest first. */
export function useContactMessages(contactId: string, limit = 5): Message[] {
  const v = useStoreVersion();
  void v;
  const ids = localStore.messagesByContact.get(contactId);
  if (!ids) return [];
  return Array.from(ids)
    .map((id) => localStore.messages.get(id))
    .filter((m): m is Message => m !== undefined)
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, limit);
}

export function useCalendarEvents(startTs: number, endTs: number): import("@/data/types").CalendarEvent[] {
  const v = useStoreVersion();
  void v;
  return localStore.getCalendarEventsInRange(startTs, endTs);
}

export function useEventTemplates(): import("@/data/types").EventTemplate[] {
  const v = useStoreVersion();
  void v;
  return Array.from(localStore.eventTemplates.values())
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function useCalendars(): import("@/data/types").Calendar[] {
  const v = useStoreVersion();
  void v;
  return localStore.getCalendarsSorted();
}

/** Returns a single message by id, or null. */
export function useMessage(id: string | null): Message | null {
  // messages.get() returns the same object reference until mutated — stable snapshot.
  return useSyncExternalStore(subscribe, () =>
    id ? (localStore.messages.get(id) ?? null) : null,
  );
}

/** Returns all other messages in the same thread, sorted oldest→newest. */
export function useThreadMessages(threadId: string, excludeId: string): Message[] {
  const v = useStoreVersion();
  void v;
  const ids = localStore.messagesByThread.get(threadId) ?? new Set<string>();
  return Array.from(ids)
    .filter((id) => id !== excludeId)
    .map((id) => localStore.messages.get(id))
    .filter((m): m is Message => m != null)
    .sort((a, b) => a.receivedAt - b.receivedAt);
}

/** Returns the total number of messages in a thread. */
export function useThreadCount(threadId: string): number {
  const v = useStoreVersion();
  void v;
  return localStore.messagesByThread.get(threadId)?.size ?? 1;
}

/**
 * Returns messages for the current view — combining nav selection and
 * any active filter pills (EP-1). When a saved view is loaded, the
 * activeFilter IS the complete filter.
 */
export function useVisibleMessages(
  sortBy: MetadataFilter["sortBy"] = "receivedAt",
  sortDir: MetadataFilter["sortDir"] = "desc",
): Message[] {
  const folderId = useWorkspace((s) => s.selectedFolderId);
  const activeFilter = useWorkspace((s) => s.activeFilter);
  const savedViewId = useWorkspace((s) => s.selectedSavedViewId);
  const v = useStoreVersion();

  return useMemo(() => {
    // Saved view: its filter is complete — use directly.
    if (savedViewId) {
      return queryMessages({ ...activeFilter, sortBy, sortDir, limit: 2000 }, localStore).items;
    }

    // Nav selection + overlay filter pills.
    const base: MetadataFilter = { sortBy, sortDir, limit: 2000 };
    const lbl = localStore.labels.get(folderId);
    if (lbl) {
      base.labelIds = [folderId];
    } else if (localStore.folders.has(folderId)) {
      base.folderId = folderId;
    } else {
      return [];
    }
    return queryMessages({ ...base, ...activeFilter }, localStore).items;
  }, [v, folderId, activeFilter, savedViewId, sortBy, sortDir]);
}

/** Returns all tag strings sorted by usage count descending, then alphabetically.
 *
 * Sourced from `messagesByTag` (the source of truth — `putMessage` always
 * indexes every tag on every synced message). `tagUsage` was previously the
 * source but only ever populates from explicit `ADD_TAG` mutations, which
 * misses tags that arrive on Gmail-synced messages and made them invisible
 * in the nav. Counts come from each tag's message set size.
 */
export function useAllTags(): string[] {
  const v = useStoreVersion();
  return useMemo(() => {
    const entries: { tag: string; count: number }[] = [];
    for (const [tag, msgs] of localStore.messagesByTag.entries()) {
      if (msgs.size > 0) entries.push({ tag, count: msgs.size });
    }
    return entries
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .map((t) => t.tag);
  }, [v]);
}

/** Returns display title of the current view (nav selection or saved view name). */
export function useSelectionTitle(): string {
  const folderId = useWorkspace((s) => s.selectedFolderId);
  const savedViewId = useWorkspace((s) => s.selectedSavedViewId);
  // Returns a string (primitive) — stable snapshot without memoization.
  return useSyncExternalStore(subscribe, () => {
    if (savedViewId) {
      return localStore.savedViews.get(savedViewId)?.name ?? "Saved view";
    }
    const lbl = localStore.labels.get(folderId);
    if (lbl) return lbl.name;
    if (folderId.startsWith("tag:")) return `#${folderId.slice(4)}`;
    const folder = localStore.folders.get(folderId);
    if (folder) return folder.name;
    return "Mail";
  });
}

/** Returns all saved views sorted by position. */
export function useSavedViews(): SavedView[] {
  const v = useStoreVersion();
  return useMemo(() => localStore.getSavedViewsSorted(), [v]);
}

/** Returns custom field definitions sorted by position. */
export function useCustomFieldDefs(): CustomFieldDef[] {
  const v = useStoreVersion();
  return useMemo(
    () => Array.from(localStore.customFieldDefs.values()).sort((a, b) => a.position - b.position),
    [v],
  );
}

/**
 * Like useVisibleMessages but panel-aware. When the list panel is detached
 * (has its own filter state), uses that instead of the global filter.
 */
export function useVisibleMessagesForPanel(
  panelId: string,
  sortBy: MetadataFilter["sortBy"] = "receivedAt",
  sortDir: MetadataFilter["sortDir"] = "desc",
): Message[] {
  const globalFolderId = useWorkspace((s) => s.selectedFolderId);
  const globalFilter = useWorkspace((s) => s.activeFilter);
  const globalSavedViewId = useWorkspace((s) => s.selectedSavedViewId);
  const panelState = useWorkspace((s) => s.listPanelState[panelId] ?? null);
  const v = useStoreVersion();

  return useMemo(() => {
    const folderId = panelState?.selectedFolderId ?? globalFolderId;
    const filter = panelState?.filter ?? globalFilter;
    const savedViewId = panelState?.selectedSavedViewId ?? globalSavedViewId;

    if (savedViewId) {
      return queryMessages({ ...filter, sortBy, sortDir, limit: 2000 }, localStore).items;
    }
    const base: MetadataFilter = { sortBy, sortDir, limit: 2000 };
    const lbl = localStore.labels.get(folderId);
    if (lbl) {
      base.labelIds = [folderId];
    } else if (folderId.startsWith("tag:")) {
      base.tags = [folderId.slice(4)];
    } else if (localStore.folders.has(folderId)) {
      base.folderId = folderId;
    } else {
      return [];
    }
    return queryMessages({ ...base, ...filter }, localStore).items;
  }, [v, panelId, panelState, globalFolderId, globalFilter, globalSavedViewId, sortBy, sortDir]);
}

/**
 * When a label is selected and has no messages in the in-memory cache (because
 * they fall outside the initial 2000-message hydration window), fetch them
 * on-demand from the DB and merge into the local store.
 */
export function useEnsureLabelMessages(labelId: string | null): void {
  const fetchedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!labelId || !isTauri()) return;
    if (fetchedRef.current.has(labelId)) return;

    // Only fetch if the label exists but has no messages in the store yet.
    const lbl = localStore.labels.get(labelId);
    if (!lbl) return;
    const cached = localStore.messagesByLabel.get(labelId)?.size ?? 0;
    if (cached > 0) return;

    fetchedRef.current.add(labelId);
    getMessagesForLabel(labelId)
      .then((raw) => {
        if (raw.length === 0) return;
        localStore.mergeMessages(raw as Message[]);
      })
      .catch((e) => console.warn("Failed to load messages for label", labelId, e));
  }, [labelId]);
}
