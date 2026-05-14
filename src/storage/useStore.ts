/**
 * React bindings for LocalStore.
 * useSyncExternalStore-based hooks that re-render when the store is mutated.
 */

import { useSyncExternalStore } from "react";
import { localStore } from "@/storage/local";
import { queryMessages } from "@/storage/query";
import { useWorkspace } from "@/state/workspace";
import type { Folder, Label, SavedView, Status, Account, Message, MetadataFilter, CustomFieldDef } from "@/data/types";

function subscribe(cb: () => void): () => void {
  return localStore.subscribe(cb);
}

/** Returns all labels sorted by position. */
export function useLabels(): Label[] {
  return useSyncExternalStore(subscribe, () =>
    Array.from(localStore.labels.values()).sort((a, b) => a.position - b.position),
  );
}

/** Returns system labels in canonical order. */
export function useSystemLabels(): Label[] {
  return useSyncExternalStore(subscribe, () =>
    Array.from(localStore.labels.values())
      .filter((l) => l.kind === "system")
      .sort((a, b) => a.position - b.position),
  );
}

/** Returns user labels sorted by position. */
export function useUserLabels(): Label[] {
  return useSyncExternalStore(subscribe, () =>
    Array.from(localStore.labels.values())
      .filter((l) => l.kind === "user")
      .sort((a, b) => a.position - b.position),
  );
}

/** Returns all folders. */
export function useFolders(): Folder[] {
  return useSyncExternalStore(subscribe, () =>
    Array.from(localStore.folders.values()),
  );
}

/** Returns root folders (parentId === null). */
export function useRootFolders(): Folder[] {
  return useSyncExternalStore(subscribe, () =>
    Array.from(localStore.folders.values()).filter((f) => f.parentId === null),
  );
}

/** Returns child folders for a given parent. */
export function useChildFolders(parentId: string): Folder[] {
  return useSyncExternalStore(subscribe, () =>
    Array.from(localStore.folders.values()).filter((f) => f.parentId === parentId),
  );
}

/** Returns all statuses sorted by position. */
export function useStatuses(): Status[] {
  return useSyncExternalStore(subscribe, () =>
    Array.from(localStore.statuses.values()).sort((a, b) => a.position - b.position),
  );
}

/** Returns all accounts. */
export function useAccounts(): Account[] {
  return useSyncExternalStore(subscribe, () =>
    Array.from(localStore.accounts.values()),
  );
}

/** Returns unread count for a label. */
export function useLabelUnreadCount(labelId: string): number {
  return useSyncExternalStore(subscribe, () => {
    const msgIds = localStore.messagesByLabel.get(labelId) ?? new Set();
    let count = 0;
    for (const id of msgIds) {
      const msg = localStore.messages.get(id);
      if (msg && !msg.flags.read) count++;
    }
    return count;
  });
}

/** Returns total count for a label. */
export function useLabelCount(labelId: string): number {
  return useSyncExternalStore(subscribe, () =>
    localStore.messagesByLabel.get(labelId)?.size ?? 0,
  );
}

/** Returns folder message count. */
export function useFolderCount(folderId: string): number {
  return useSyncExternalStore(subscribe, () =>
    localStore.messagesByFolder.get(folderId)?.size ?? 0,
  );
}

/** Returns a single message by id, or null. */
export function useMessage(id: string | null): Message | null {
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

  return useSyncExternalStore(subscribe, () => {
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
    // Merge active filter pills on top (pills win for shared keys).
    return queryMessages({ ...base, ...activeFilter }, localStore).items;
  });
}

/** Returns display title of the current view (nav selection or saved view name). */
export function useSelectionTitle(): string {
  const folderId = useWorkspace((s) => s.selectedFolderId);
  const savedViewId = useWorkspace((s) => s.selectedSavedViewId);
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
  return useSyncExternalStore(subscribe, () => localStore.getSavedViewsSorted());
}

/** Returns custom field definitions sorted by position. */
export function useCustomFieldDefs(): CustomFieldDef[] {
  return useSyncExternalStore(subscribe, () =>
    Array.from(localStore.customFieldDefs.values()).sort((a, b) => a.position - b.position),
  );
}
