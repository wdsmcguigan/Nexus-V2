/**
 * Workspace state — EP-0 refactor.
 *
 * UI state (theme, density, panel focus, selection) is still managed here
 * directly. Email data is now backed by LocalStore + queryMessages
 * (WF-SEARCH-QUERY). All user mutations route through recordMutation
 * (WF-OUTBOUND-MUTATION).
 *
 * Backward-compat: `useVisibleEmails()` returns the old Email shape so
 * existing EmailRow / EmailListPanel components don't need to change in 0b.
 * Phase 0c–0e will migrate to Message directly.
 */

import { create } from "zustand";
import type { Density, Theme } from "@/design-system/tokens";
import { localStore } from "@/storage/local";
import { queryMessages } from "@/storage/query";
import type { Email } from "@/data/fixtures";
import { emailsByFolder } from "@/data/fixtures";
import * as Mut from "@/state/mutations";
import type {
  CustomFieldValue,
  FlagState,
  Label,
  Folder,
  Status,
  StarStyle,
  CustomFieldDef,
  Message,
} from "@/data/types";

// ─── Workspace state ──────────────────────────────────────────────────────────

interface WorkspaceState {
  // Theme
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;

  // Density
  density: Density;
  setDensity: (d: Density) => void;
  cycleDensity: () => void;

  // Folder / label selection (the "current view" selection in the nav)
  selectedFolderId: string;
  setSelectedFolder: (id: string) => void;

  // Email selection
  selectedEmailId: string | null;
  selectedEmailIds: Set<string>;
  focusedRowId: string | null;
  selectionAnchorId: string | null;
  setSelectedEmail: (id: string | null) => void;
  toggleEmailSelection: (id: string) => void;
  setSelectionRange: (idsInRange: string[]) => void;
  clearSelection: () => void;
  setFocusedRow: (id: string | null) => void;

  // Panel focus + Focus Memory Stack
  activePanelId: string | null;
  previousPanelId: string | null;
  setActivePanel: (id: string) => void;

  // Inspector pin (UI-layer pin, not MSG.pinned)
  inspectorPinned: boolean;
  pinnedEmailId: string | null;
  togglePin: () => void;

  // Composer
  composerOpen: boolean;
  setComposerOpen: (open: boolean) => void;

  // Command palette
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  // HUD strip
  hudExpanded: boolean;
  toggleHud: () => void;

  // ── EP-0 mutation actions (all route through WF-OUTBOUND-MUTATION) ──────────

  // Label ops
  addLabel: (messageId: string, labelId: string) => void;
  removeLabel: (messageId: string, labelId: string) => void;
  createLabel: (label: Label) => void;
  renameLabel: (labelId: string, name: string) => void;
  deleteLabel: (labelId: string) => void;

  // Tag ops
  addTag: (messageId: string, tag: string) => void;
  removeTag: (messageId: string, tag: string) => void;

  // Status ops
  setStatus: (messageId: string, statusId: string) => void;
  clearStatus: (messageId: string) => void;
  createStatus: (status: Status) => void;

  // Priority / Star / Flag / Pin / Mute / Note
  setPriority: (messageId: string, priority: 1 | 2 | 3 | 4) => void;
  clearPriority: (messageId: string) => void;
  setStar: (messageId: string, star: StarStyle) => void;
  clearStar: (messageId: string) => void;
  setFlag: (messageId: string, flag: FlagState) => void;
  clearFlag: (messageId: string) => void;
  setPinned: (messageId: string, pinned: boolean) => void;
  setMuted: (messageId: string, muted: boolean) => void;
  setNote: (messageId: string, notes: string | null) => void;

  // Custom fields
  createCustomField: (def: CustomFieldDef) => void;
  setCustomFieldValue: (messageId: string, fieldId: string, value: CustomFieldValue) => void;
  clearCustomFieldValue: (messageId: string, fieldId: string) => void;

  // Message ops
  archive: (messageId: string) => void;
  snooze: (messageId: string, until: number) => void;
  setRead: (messageId: string, read: boolean) => void;
  setStarred: (messageId: string, starred: boolean) => void;

  // Folder ops
  createFolder: (folder: Folder) => void;
  renameFolder: (folderId: string, name: string, diskSlug: string) => void;
  deleteFolder: (folderId: string) => void;
  moveToFolder: (messageId: string, folderId: string) => void;
}

const DENSITIES: Density[] = ["compact", "comfortable", "cozy"];

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  theme: "dark",
  setTheme: (t) => {
    document.documentElement.classList.toggle("dark", t === "dark");
    set({ theme: t });
  },
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    set({ theme: next });
  },

  density: "comfortable",
  setDensity: (d) => set({ density: d }),
  cycleDensity: () => {
    const i = DENSITIES.indexOf(get().density);
    set({ density: DENSITIES[(i + 1) % DENSITIES.length]! });
  },

  selectedFolderId: "inbox",
  setSelectedFolder: (id) =>
    set({
      selectedFolderId: id,
      selectedEmailId: null,
      selectedEmailIds: new Set(),
      focusedRowId: null,
    }),

  selectedEmailId: null,
  selectedEmailIds: new Set(),
  focusedRowId: null,
  selectionAnchorId: null,
  setSelectedEmail: (id) =>
    set({
      selectedEmailId: id,
      selectedEmailIds: id ? new Set([id]) : new Set(),
      selectionAnchorId: id,
      focusedRowId: id,
    }),
  toggleEmailSelection: (id) => {
    const next = new Set(get().selectedEmailIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({
      selectedEmailIds: next,
      selectedEmailId: id,
      selectionAnchorId: id,
      focusedRowId: id,
    });
  },
  setSelectionRange: (idsInRange) =>
    set({
      selectedEmailIds: new Set(idsInRange),
      selectedEmailId: idsInRange[idsInRange.length - 1] ?? null,
      focusedRowId: idsInRange[idsInRange.length - 1] ?? null,
    }),
  clearSelection: () =>
    set({
      selectedEmailId: null,
      selectedEmailIds: new Set(),
      selectionAnchorId: null,
    }),
  setFocusedRow: (id) => set({ focusedRowId: id }),

  activePanelId: "list",
  previousPanelId: null,
  setActivePanel: (id) => {
    const prev = get().activePanelId;
    if (prev === id) return;
    set({ activePanelId: id, previousPanelId: prev });
  },

  inspectorPinned: false,
  pinnedEmailId: null,
  togglePin: () => {
    const { inspectorPinned, selectedEmailId } = get();
    if (inspectorPinned) {
      set({ inspectorPinned: false, pinnedEmailId: null });
    } else {
      set({ inspectorPinned: true, pinnedEmailId: selectedEmailId });
    }
  },

  composerOpen: false,
  setComposerOpen: (open) => set({ composerOpen: open }),

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  hudExpanded: false,
  toggleHud: () => set({ hudExpanded: !get().hudExpanded }),

  // ── EP-0 mutation actions ────────────────────────────────────────────────────

  addLabel: (messageId, labelId) => { Mut.addLabel(localStore, messageId, labelId); },
  removeLabel: (messageId, labelId) => { Mut.removeLabel(localStore, messageId, labelId); },
  createLabel: (label) => { Mut.createLabel(localStore, label); },
  renameLabel: (labelId, name) => { Mut.renameLabel(localStore, labelId, name); },
  deleteLabel: (labelId) => { Mut.deleteLabel(localStore, labelId); },

  addTag: (messageId, tag) => { Mut.addTag(localStore, messageId, tag); },
  removeTag: (messageId, tag) => { Mut.removeTag(localStore, messageId, tag); },

  setStatus: (messageId, statusId) => { Mut.setStatus(localStore, messageId, statusId); },
  clearStatus: (messageId) => { Mut.clearStatus(localStore, messageId); },
  createStatus: (status) => { Mut.createStatus(localStore, status); },

  setPriority: (messageId, priority) => { Mut.setPriority(localStore, messageId, priority); },
  clearPriority: (messageId) => { Mut.clearPriority(localStore, messageId); },
  setStar: (messageId, star) => { Mut.setStar(localStore, messageId, star); },
  clearStar: (messageId) => { Mut.clearStar(localStore, messageId); },
  setFlag: (messageId, flag) => { Mut.setFlag(localStore, messageId, flag); },
  clearFlag: (messageId) => { Mut.clearFlag(localStore, messageId); },
  setPinned: (messageId, pinned) => { Mut.setPinned(localStore, messageId, pinned); },
  setMuted: (messageId, muted) => { Mut.setMuted(localStore, messageId, muted); },
  setNote: (messageId, notes) => { Mut.setNote(localStore, messageId, notes); },

  createCustomField: (def) => { Mut.createCustomField(localStore, def); },
  setCustomFieldValue: (messageId, fieldId, value) => {
    Mut.setCustomFieldValue(localStore, messageId, fieldId, value);
  },
  clearCustomFieldValue: (messageId, fieldId) => {
    Mut.clearCustomFieldValue(localStore, messageId, fieldId);
  },

  archive: (messageId) => { Mut.archiveMessage(localStore, messageId); },
  snooze: (messageId, until) => { Mut.snoozeMessage(localStore, messageId, until); },
  setRead: (messageId, read) => {
    if (read) Mut.readMessage(localStore, messageId);
    else Mut.unreadMessage(localStore, messageId);
  },
  setStarred: (messageId, starred) => {
    if (starred) Mut.setStar(localStore, messageId, "yellow");
    else Mut.clearStar(localStore, messageId);
  },

  createFolder: (folder) => { Mut.createFolder(localStore, folder); },
  renameFolder: (folderId, name, diskSlug) => {
    Mut.renameFolder(localStore, folderId, name, diskSlug);
  },
  deleteFolder: (folderId) => { Mut.deleteFolder(localStore, folderId); },
  moveToFolder: (messageId, folderId) => {
    Mut.moveToFolder(localStore, messageId, folderId);
  },
}));

// ─── Derived selectors ────────────────────────────────────────────────────────

/** Email currently shown in the inspector — pinned overrides selected. */
export function useInspectorEmailId(): string | null {
  return useWorkspace((s) =>
    s.inspectorPinned ? s.pinnedEmailId : s.selectedEmailId,
  );
}

/**
 * Returns emails for the currently selected folder/label as the old Email shape.
 * Used by EmailListPanel until Phase 0c migrates to Message directly.
 */
export function useVisibleEmails(): Email[] {
  const folderId = useWorkspace((s) => s.selectedFolderId);
  return emailsByFolder(folderId);
}

/**
 * Returns Message objects directly from the store for the current selection.
 * Used by Phase 0c+ components that are Message-aware.
 */
export function useVisibleMessages(): Message[] {
  const folderId = useWorkspace((s) => s.selectedFolderId);
  const label = localStore.labels.get(folderId);
  if (label) {
    return queryMessages({ labelIds: [folderId], limit: 500 }, localStore).items;
  }
  if (localStore.folders.has(folderId)) {
    return queryMessages({ folderId, limit: 500 }, localStore).items;
  }
  return [];
}
