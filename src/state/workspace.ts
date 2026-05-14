/**
 * Workspace UI state — EP-1.
 *
 * UI state (theme, density, panel focus, selection, filter pills, view mode)
 * lives here. Email data is backed by LocalStore + queryMessages
 * (WF-SEARCH-QUERY). All user mutations route through recordMutation
 * (WF-OUTBOUND-MUTATION).
 */

import { create } from "zustand";
import type { Density, Theme } from "@/design-system/tokens";
import { localStore } from "@/storage/local";
import * as Mut from "@/state/mutations";
import type {
  CustomFieldValue,
  FlagState,
  Label,
  Folder,
  MetadataFilter,
  Status,
  StarStyle,
  CustomFieldDef,
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

  // EP-1: active filter (pills overlay on top of nav selection)
  activeFilter: MetadataFilter;
  /** Merge additional axis predicates into the active filter. */
  setFilterAxis: (axis: Partial<MetadataFilter>) => void;
  /** Remove a specific axis key from the active filter. */
  removeFilterAxis: (key: keyof MetadataFilter) => void;
  clearFilter: () => void;
  /** Save the current activeFilter as a named saved view. */
  saveCurrentFilter: (name: string) => void;
  deleteSavedView: (id: string) => void;
  renameSavedView: (id: string, name: string) => void;
  /** Load a saved view: replaces activeFilter, sets selectedSavedViewId. */
  loadSavedView: (id: string) => void;
  selectedSavedViewId: string | null;

  // EP-1: view mode (list / kanban / table)
  viewMode: "list" | "kanban" | "table";
  setViewMode: (mode: "list" | "kanban" | "table") => void;

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
      activeFilter: {},
      selectedSavedViewId: null,
    }),

  activeFilter: {},
  setFilterAxis: (axis) => set((s) => ({ activeFilter: { ...s.activeFilter, ...axis } })),
  removeFilterAxis: (key) =>
    set((s) => {
      const next = { ...s.activeFilter };
      delete next[key];
      return { activeFilter: next };
    }),
  clearFilter: () => set({ activeFilter: {} }),
  saveCurrentFilter: (name) => {
    const filter = get().activeFilter;
    Mut.saveView(localStore, name, filter);
  },
  deleteSavedView: (id) => { Mut.deleteView(localStore, id); },
  renameSavedView: (id, name) => { Mut.renameView(localStore, id, name); },
  loadSavedView: (id) => {
    const view = localStore.savedViews.get(id);
    if (!view) return;
    set({
      activeFilter: view.filter,
      selectedSavedViewId: id,
      selectedEmailId: null,
      selectedEmailIds: new Set(),
      focusedRowId: null,
    });
  },
  selectedSavedViewId: null,

  viewMode: "list",
  setViewMode: (mode) => set({ viewMode: mode }),

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

