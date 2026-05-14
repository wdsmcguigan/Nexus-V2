/**
 * React bindings for LocalStore.
 *
 * Pattern: useSyncExternalStore returns localStore.version (a number —
 * primitives pass Object.is tearing checks). useMemo derives arrays/objects
 * from that version so references are stable until data actually changes.
 */

import { useMemo } from "react";
import { useSyncExternalStore } from "react";
import { localStore } from "@/storage/local";
import { queryMessages } from "@/storage/query";
import { useWorkspace } from "@/state/workspace";
import type { Folder, Label, SavedView, Status, Account, Message, MetadataFilter, CustomFieldDef } from "@/data/types";

function subscribe(cb: () => void): () => void {
  return localStore.subscribe(cb);
}

/** Returns the current store version (increments on every mutation). */
function useStoreVersion(): number {
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

/** Returns a single message by id, or null. */
export function useMessage(id: string | null): Message | null {
  // messages.get() returns the same object reference until mutated — stable snapshot.
  return useSyncExternalStore(subscribe, () =>
    id ? (localStore.messages.get(id) ?? null) : null,
  );
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
      return queryMessages({ ...activeFilter, sortBy, sortDir, limit: 500 }, localStore).items;
    }

    // Nav selection + overlay filter pills.
    const base: MetadataFilter = { sortBy, sortDir, limit: 500 };
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
