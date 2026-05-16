/**
 * Workspace UI state — EP-1 + workspace management.
 *
 * UI state (theme, density, panel focus, selection, filter pills, view mode)
 * lives here. Email data is backed by LocalStore + queryMessages
 * (WF-SEARCH-QUERY). All user mutations route through recordMutation
 * (WF-OUTBOUND-MUTATION).
 *
 * Workspace snapshots are persisted to localStorage synchronously so the
 * active workspace's state (layout, filter, density, etc.) is available
 * before the first React render.
 */

import { create } from "zustand";
import type { Density, Theme } from "@/design-system/tokens";
import { localStore } from "@/storage/local";
import * as Mut from "@/state/mutations";
import {
  loadWorkspacesFromStorage,
  saveWorkspacesToStorage,
  makeDefaultWorkspace,
} from "@/storage/workspaceManager";
import type { WorkspaceSnapshot } from "@/storage/workspaceManager";
import type {
  CustomFieldValue,
  FlagState,
  Label,
  Folder,
  Message,
  MetadataFilter,
  Status,
  StarStyle,
  CustomFieldDef,
} from "@/data/types";
import type { DockviewApi } from "dockview";

// ─── Module-level dockview API reference ─────────────────────────────────────
// Not in Zustand — DockviewApi is not serializable.

let _dockviewApi: DockviewApi | null = null;
export function setDockviewApi(api: DockviewApi): void { _dockviewApi = api; }
export function getDockviewApi(): DockviewApi | null { return _dockviewApi; }

let _panelSeq = 0;
export function newPanelId(type: string): string { return `${type}-${++_panelSeq}`; }

// ─── Composer context ────────────────────────────────────────────────────────

export type ComposerMode = "reply" | "reply-all" | "forward";
export interface ComposerContext {
  mode: ComposerMode;
  replyToMessage: Message;
}

// ─── Default layout capture ───────────────────────────────────────────────────
// Captured once after initLayout so "start fresh" workspaces can use it.

let _defaultLayoutJson: unknown = null;
export function setDefaultLayoutJson(json: unknown): void { _defaultLayoutJson = json; }
export function getDefaultLayoutJson(): unknown { return _defaultLayoutJson; }

// ─── Auto-save machinery ──────────────────────────────────────────────────────

let _isRestoring = false;
let _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule a debounced auto-save if the active workspace has autoSave on. */
export function scheduleAutoSave(): void {
  if (_isRestoring) return;
  const s = useWorkspace.getState();
  const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
  if (!ws?.autoSave) return;
  if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => {
    useWorkspace.getState().saveWorkspace();
  }, 1500);
}

// ─── Bootstrap from localStorage ─────────────────────────────────────────────

const _savedData = loadWorkspacesFromStorage();
const _defaultWs = makeDefaultWorkspace();
const _initialWorkspaces: WorkspaceSnapshot[] = _savedData?.workspaces ?? [_defaultWs];
const _initialActiveId: string = _savedData?.activeId ?? _defaultWs.id;
const _activeWs: WorkspaceSnapshot =
  _initialWorkspaces.find((w) => w.id === _initialActiveId) ??
  _initialWorkspaces[0] ??
  _defaultWs;

// Apply saved theme to DOM before first paint.
document.documentElement.classList.toggle("dark", _activeWs.theme === "dark");

// ─── Per-panel state types ────────────────────────────────────────────────────

/** Per-panel state for list panels when "detached" (own filter, not following global). */
export interface ListPanelLocalState {
  filter: MetadataFilter;
  selectedFolderId: string;
  selectedSavedViewId: string | null;
}

// ─── WorkspaceState interface ─────────────────────────────────────────────────

interface WorkspaceState {
  // ── Workspace management ─────────────────────────────────────────────────
  workspaces: WorkspaceSnapshot[];
  activeWorkspaceId: string;
  saveWorkspace: () => void;
  saveAsWorkspace: (name: string) => void;
  createWorkspace: (name: string, mode: "fresh" | "clone") => void;
  switchWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;
  toggleAutoSave: (id: string) => void;
  resetWorkspaceLayout: () => void;

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

  // Table view column configuration (order + widths, persisted per workspace)
  tableColumnOrder: string[];
  tableColumnWidths: Record<string, number>;
  setTableColumnOrder: (order: string[]) => void;
  setTableColumnWidths: (widths: Record<string, number>) => void;

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

  // Contact selection
  selectedContactId: string | null;
  setSelectedContactId: (id: string | null) => void;
  /** When non-null, the contacts panel left-column is scoped to these participant emails. */
  contactParticipantFilter: string[] | null;
  setContactParticipantFilter: (emails: string[] | null) => void;
  openContactsPanel: (contactId?: string, participantEmails?: string[]) => void;
  /** Open a filtered email list showing all messages for a given contact.
   *  Pass invertBehavior=true (Cmd/Ctrl+click) to do the opposite of the preference. */
  openContactMessages: (contactId: string, invertBehavior?: boolean) => void;

  // Preferences
  filteredViewBehavior: "replace" | "new-panel";
  setFilteredViewBehavior: (v: "replace" | "new-panel") => void;

  // Settings panel
  openSettingsPanel: () => void;

  // Panel focus + Focus Memory Stack
  activePanelId: string | null;
  previousPanelId: string | null;
  setActivePanel: (id: string) => void;

  // Inspector pin (UI-layer pin, not MSG.pinned)
  inspectorPinned: boolean;
  pinnedEmailId: string | null;
  togglePin: () => void;

  // Per-viewer pin state (each viewer can pin to a specific email)
  viewerPinState: Record<string, string | null>; // panelId → pinnedEmailId (null = follow global)
  pinViewerToEmail: (panelId: string, emailId: string) => void;
  unpinViewer: (panelId: string) => void;

  // Per-list panel state (when detached, list has its own filter independent of global)
  listPanelState: Record<string, ListPanelLocalState | null>;
  detachListPanel: (panelId: string) => void;
  attachListPanel: (panelId: string) => void;
  setListPanelAxis: (panelId: string, axis: Partial<MetadataFilter>) => void;
  removeListPanelAxis: (panelId: string, key: keyof MetadataFilter) => void;
  clearListPanelFilter: (panelId: string) => void;

  // Per-viewer inspector association
  // viewerPanelId → inspectorPanelId that was opened from that viewer.
  // Absence of key means the viewer has no associated inspector open.
  viewerInspectorMap: Record<string, string>;
  setViewerInspector: (viewerPanelId: string, inspectorPanelId: string) => void;
  clearViewerInspector: (viewerPanelId: string) => void;

  // Composer
  composerOpen: boolean;
  setComposerOpen: (open: boolean) => void;
  composerContext: ComposerContext | null;
  openComposer: (ctx?: ComposerContext) => void;

  // Command palette
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  // Sync status (updated from Tauri events or manual triggers)
  lastSyncedAt: number | null;
  isSyncing: boolean;
  setSyncStatus: (syncing: boolean, syncedAt?: number) => void;

  // HUD strip
  hudExpanded: boolean;
  toggleHud: () => void;

  // ── EP-0 mutation actions (all route through WF-OUTBOUND-MUTATION) ──────────

  // Label ops
  addLabel: (messageId: string, labelId: string) => void;
  removeLabel: (messageId: string, labelId: string) => void;
  createLabel: (label: Label) => void;
  renameLabel: (labelId: string, name: string) => void;
  recolorLabel: (labelId: string, color: number) => void;
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
  updateFlag: (messageId: string, updates: Partial<FlagState>) => void;
  completeFlag: (messageId: string) => void;
  clearFlag: (messageId: string) => void;
  setPinned: (messageId: string, pinned: boolean) => void;
  setMuted: (messageId: string, muted: boolean) => void;
  setNote: (messageId: string, notes: string | null) => void;

  // Custom fields
  createCustomField: (def: CustomFieldDef) => void;
  updateCustomField: (fieldId: string, updates: Partial<CustomFieldDef>) => void;
  deleteCustomField: (fieldId: string) => void;
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
  recolorFolder: (folderId: string, color: number) => void;
  deleteFolder: (folderId: string) => void;
  moveToFolder: (messageId: string, folderId: string) => void;
}

const DENSITIES: Density[] = ["compact", "comfortable", "cozy"];

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  // ── Workspace management ───────────────────────────────────────────────────

  workspaces: _initialWorkspaces,
  activeWorkspaceId: _initialActiveId,

  saveWorkspace: () => {
    const s = get();
    const api = getDockviewApi();
    const layout = api ? api.toJSON() : null;
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    if (!ws) return;
    const updated: WorkspaceSnapshot = {
      ...ws,
      updatedAt: Date.now(),
      dockviewLayout: layout,
      viewerPinState: s.viewerPinState,
      listPanelState: s.listPanelState,
      selectedFolderId: s.selectedFolderId,
      activeFilter: s.activeFilter,
      selectedSavedViewId: s.selectedSavedViewId,
      density: s.density,
      viewMode: s.viewMode,
      theme: s.theme,
      tableColumnOrder: s.tableColumnOrder,
      tableColumnWidths: s.tableColumnWidths,
      filteredViewBehavior: s.filteredViewBehavior,
    };
    const workspaces = s.workspaces.map((w) =>
      w.id === s.activeWorkspaceId ? updated : w,
    );
    set({ workspaces });
    saveWorkspacesToStorage({ workspaces, activeId: s.activeWorkspaceId });
  },

  saveAsWorkspace: (name) => {
    get().createWorkspace(name, "clone");
  },

  createWorkspace: (name, mode) => {
    const s = get();
    const api = getDockviewApi();
    const id = `ws-${Date.now()}`;
    const base = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    const newWs: WorkspaceSnapshot = {
      id,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      autoSave: false,
      dockviewLayout:
        mode === "clone" ? (api ? api.toJSON() : (base?.dockviewLayout ?? null)) : null,
      viewerPinState: mode === "clone" ? { ...s.viewerPinState } : {},
      listPanelState: mode === "clone" ? { ...s.listPanelState } : {},
      selectedFolderId: mode === "clone" ? s.selectedFolderId : "inbox",
      activeFilter: mode === "clone" ? { ...s.activeFilter } : {},
      selectedSavedViewId: mode === "clone" ? s.selectedSavedViewId : null,
      density: mode === "clone" ? s.density : "comfortable",
      viewMode: mode === "clone" ? s.viewMode : "list",
      theme: s.theme,
      tableColumnOrder: mode === "clone" ? [...s.tableColumnOrder] : [],
      tableColumnWidths: mode === "clone" ? { ...s.tableColumnWidths } : {},
      filteredViewBehavior: s.filteredViewBehavior,
    };
    const workspaces = [...s.workspaces, newWs];
    set({ workspaces });
    get().switchWorkspace(id);
  },

  switchWorkspace: (id) => {
    const s = get();
    const ws = s.workspaces.find((w) => w.id === id);
    if (!ws) return;

    _isRestoring = true;

    const api = getDockviewApi();
    if (api) {
      const layout = ws.dockviewLayout ?? _defaultLayoutJson;
      if (layout) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        api.fromJSON(layout as any);
      }
    }

    document.documentElement.classList.toggle("dark", ws.theme === "dark");

    set({
      activeWorkspaceId: id,
      viewerPinState: ws.viewerPinState,
      listPanelState: ws.listPanelState as Record<string, ListPanelLocalState | null>,
      selectedFolderId: ws.selectedFolderId,
      activeFilter: ws.activeFilter,
      selectedSavedViewId: ws.selectedSavedViewId,
      density: ws.density,
      viewMode: ws.viewMode,
      theme: ws.theme,
      tableColumnOrder: ws.tableColumnOrder ?? [],
      tableColumnWidths: ws.tableColumnWidths ?? {},
      filteredViewBehavior: ws.filteredViewBehavior ?? "replace",
      // Panel associations from the old layout are invalid after fromJSON —
      // clear so no stale ownership blocks the new layout's inspector panels.
      viewerInspectorMap: {},
      // Reset ephemeral selection state on workspace switch
      selectedEmailId: null,
      selectedEmailIds: new Set(),
      focusedRowId: null,
      selectionAnchorId: null,
    });

    const updatedWorkspaces = s.workspaces.map((w) =>
      w.id === id ? w : w,
    );
    saveWorkspacesToStorage({ workspaces: updatedWorkspaces, activeId: id });

    // Reset flag after all synchronous handlers (including onDidLayoutChange)
    setTimeout(() => { _isRestoring = false; }, 0);
  },

  renameWorkspace: (id, name) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === id ? { ...w, name, updatedAt: Date.now() } : w,
      ),
    }));
    const s = get();
    saveWorkspacesToStorage({ workspaces: s.workspaces, activeId: s.activeWorkspaceId });
  },

  deleteWorkspace: (id) => {
    const s = get();
    if (s.workspaces.length <= 1) return; // never delete the last workspace
    const workspaces = s.workspaces.filter((w) => w.id !== id);
    if (s.activeWorkspaceId === id) {
      set({ workspaces });
      get().switchWorkspace(workspaces[0]!.id);
    } else {
      set({ workspaces });
      saveWorkspacesToStorage({ workspaces, activeId: s.activeWorkspaceId });
    }
  },

  toggleAutoSave: (id) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === id ? { ...w, autoSave: !w.autoSave } : w,
      ),
    }));
    const s = get();
    saveWorkspacesToStorage({ workspaces: s.workspaces, activeId: s.activeWorkspaceId });
  },

  resetWorkspaceLayout: () => {
    const s = get();
    const api = getDockviewApi();
    const defaultLayout = _defaultLayoutJson;
    if (api && defaultLayout) {
      _isRestoring = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api.fromJSON(defaultLayout as any);
      setTimeout(() => { _isRestoring = false; }, 0);
    }
    const workspaces = s.workspaces.map((w) =>
      w.id === s.activeWorkspaceId
        ? { ...w, dockviewLayout: null, updatedAt: Date.now() }
        : w,
    );
    set({ workspaces });
    saveWorkspacesToStorage({ workspaces, activeId: s.activeWorkspaceId });
  },

  // ── Filtered view behavior preference ─────────────────────────────────────

  filteredViewBehavior: (_activeWs.filteredViewBehavior ?? "replace"),
  setFilteredViewBehavior: (v) => set({ filteredViewBehavior: v }),

  // ── Theme ──────────────────────────────────────────────────────────────────

  theme: _activeWs.theme,
  setTheme: (t) => {
    document.documentElement.classList.toggle("dark", t === "dark");
    set({ theme: t });
  },
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    set({ theme: next });
  },

  // ── Density ────────────────────────────────────────────────────────────────

  density: _activeWs.density,
  setDensity: (d) => set({ density: d }),
  cycleDensity: () => {
    const i = DENSITIES.indexOf(get().density);
    set({ density: DENSITIES[(i + 1) % DENSITIES.length]! });
  },

  // ── Folder / label selection ───────────────────────────────────────────────

  selectedFolderId: _activeWs.selectedFolderId,
  setSelectedFolder: (id) =>
    set({
      selectedFolderId: id,
      selectedEmailId: null,
      selectedEmailIds: new Set(),
      focusedRowId: null,
      activeFilter: {},
      selectedSavedViewId: null,
    }),

  // ── Active filter ──────────────────────────────────────────────────────────

  activeFilter: _activeWs.activeFilter,
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
  selectedSavedViewId: _activeWs.selectedSavedViewId,

  // ── View mode ──────────────────────────────────────────────────────────────

  viewMode: _activeWs.viewMode,
  setViewMode: (mode) => set({ viewMode: mode }),

  tableColumnOrder: _activeWs.tableColumnOrder ?? [],
  tableColumnWidths: _activeWs.tableColumnWidths ?? {},
  setTableColumnOrder: (order) => set({ tableColumnOrder: order }),
  setTableColumnWidths: (widths) => set({ tableColumnWidths: widths }),

  // ── Email selection ────────────────────────────────────────────────────────

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

  // ── Contact selection ──────────────────────────────────────────────────────

  selectedContactId: null,
  setSelectedContactId: (id) => set({ selectedContactId: id }),
  contactParticipantFilter: null,
  setContactParticipantFilter: (emails) => set({ contactParticipantFilter: emails }),
  openContactsPanel: (contactId, participantEmails) => {
    const api = getDockviewApi();
    if (!api) return;
    if (contactId) set({ selectedContactId: contactId });
    // participantEmails scopes the left column; undefined → clear filter (standalone open)
    set({ contactParticipantFilter: participantEmails ?? null });
    const existing = api.panels.find((p) => p.id === "contacts");
    if (existing) {
      existing.api.setActive();
    } else {
      api.addPanel({
        id: "contacts",
        component: "contacts",
        title: "Contacts",
        minimumWidth: 480,
        position: { direction: "right" },
      });
    }
  },

  openContactMessages: (contactId, invertBehavior = false) => {
    const { filteredViewBehavior, setSelectedFolder, setFilterAxis } = get();
    const inboxLabel = Array.from(localStore.labels.values()).find(
      (l) => l.kind === "system" && l.systemKind === "inbox",
    );
    const inboxId = inboxLabel?.id ?? "inbox";

    const effectiveMode = invertBehavior
      ? (filteredViewBehavior === "replace" ? "new-panel" : "replace")
      : filteredViewBehavior;

    if (effectiveMode === "replace") {
      setSelectedFolder(inboxId);
      setFilterAxis({ contactId });
    } else {
      const api = getDockviewApi();
      if (!api) return;
      const newId = newPanelId("list");
      set((s) => ({
        listPanelState: {
          ...s.listPanelState,
          [newId]: { filter: { contactId }, selectedFolderId: inboxId, selectedSavedViewId: null },
        },
      }));
      api.addPanel({
        id: newId,
        component: "list",
        title: "Mail",
        minimumWidth: 280,
        position: { direction: "right" },
      });
    }
  },

  openSettingsPanel: () => {
    const api = getDockviewApi();
    if (!api) return;
    const existing = api.panels.find((p) => p.id === "settings");
    if (existing) {
      existing.api.setActive();
    } else {
      api.addPanel({
        id: "settings",
        component: "settings",
        title: "Settings",
        minimumWidth: 420,
        position: { direction: "right" },
      });
    }
  },

  // ── Panel focus ────────────────────────────────────────────────────────────

  activePanelId: "list",
  previousPanelId: null,
  setActivePanel: (id) => {
    const prev = get().activePanelId;
    if (prev === id) return;
    set({ activePanelId: id, previousPanelId: prev });
  },

  // ── Inspector pin ──────────────────────────────────────────────────────────

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

  // ── Per-viewer pin state ───────────────────────────────────────────────────

  viewerPinState: _activeWs.viewerPinState,
  pinViewerToEmail: (panelId, emailId) =>
    set((s) => ({ viewerPinState: { ...s.viewerPinState, [panelId]: emailId } })),
  unpinViewer: (panelId) =>
    set((s) => ({ viewerPinState: { ...s.viewerPinState, [panelId]: null } })),

  // ── Per-list panel state ───────────────────────────────────────────────────

  listPanelState: _activeWs.listPanelState as Record<string, ListPanelLocalState | null>,
  detachListPanel: (panelId) => {
    const { selectedFolderId, activeFilter, selectedSavedViewId } = get();
    set((s) => ({
      listPanelState: {
        ...s.listPanelState,
        [panelId]: { filter: { ...activeFilter }, selectedFolderId, selectedSavedViewId },
      },
    }));
  },
  attachListPanel: (panelId) =>
    set((s) => {
      const next = { ...s.listPanelState };
      delete next[panelId];
      return { listPanelState: next };
    }),
  setListPanelAxis: (panelId, axis) =>
    set((s) => {
      const cur = s.listPanelState[panelId];
      if (!cur) return {};
      return { listPanelState: { ...s.listPanelState, [panelId]: { ...cur, filter: { ...cur.filter, ...axis } } } };
    }),
  removeListPanelAxis: (panelId, key) =>
    set((s) => {
      const cur = s.listPanelState[panelId];
      if (!cur) return {};
      const f = { ...cur.filter };
      delete f[key];
      return { listPanelState: { ...s.listPanelState, [panelId]: { ...cur, filter: f } } };
    }),
  clearListPanelFilter: (panelId) =>
    set((s) => {
      const cur = s.listPanelState[panelId];
      if (!cur) return {};
      return { listPanelState: { ...s.listPanelState, [panelId]: { ...cur, filter: {} } } };
    }),

  viewerInspectorMap: {},
  setViewerInspector: (viewerPanelId, inspectorPanelId) =>
    set((s) => ({ viewerInspectorMap: { ...s.viewerInspectorMap, [viewerPanelId]: inspectorPanelId } })),
  clearViewerInspector: (viewerPanelId) =>
    set((s) => {
      const next = { ...s.viewerInspectorMap };
      delete next[viewerPanelId];
      return { viewerInspectorMap: next };
    }),

  // ── Composer ───────────────────────────────────────────────────────────────

  composerOpen: false,
  composerContext: null,
  setComposerOpen: (open) => set(open ? { composerOpen: true } : { composerOpen: false, composerContext: null }),
  openComposer: (ctx) => set({ composerOpen: true, composerContext: ctx ?? null }),

  // ── Command palette ────────────────────────────────────────────────────────

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  // ── Sync status ────────────────────────────────────────────────────────────

  lastSyncedAt: null,
  isSyncing: false,
  setSyncStatus: (syncing, syncedAt) =>
    set(syncing
      ? { isSyncing: true }
      : { isSyncing: false, lastSyncedAt: syncedAt ?? get().lastSyncedAt }),

  // ── HUD strip ─────────────────────────────────────────────────────────────

  hudExpanded: false,
  toggleHud: () => set({ hudExpanded: !get().hudExpanded }),

  // ── EP-0 mutation actions ────────────────────────────────────────────────────

  addLabel: (messageId, labelId) => { Mut.addLabel(localStore, messageId, labelId); },
  removeLabel: (messageId, labelId) => { Mut.removeLabel(localStore, messageId, labelId); },
  createLabel: (label) => { Mut.createLabel(localStore, label); },
  renameLabel: (labelId, name) => { Mut.renameLabel(localStore, labelId, name); },
  recolorLabel: (labelId, color) => { Mut.recolorLabel(localStore, labelId, color); },
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
  updateFlag: (messageId, updates) => { Mut.updateFlag(localStore, messageId, updates); },
  completeFlag: (messageId) => { Mut.completeFlag(localStore, messageId); },
  clearFlag: (messageId) => { Mut.clearFlag(localStore, messageId); },
  setPinned: (messageId, pinned) => { Mut.setPinned(localStore, messageId, pinned); },
  setMuted: (messageId, muted) => { Mut.setMuted(localStore, messageId, muted); },
  setNote: (messageId, notes) => { Mut.setNote(localStore, messageId, notes); },

  createCustomField: (def) => { Mut.createCustomField(localStore, def); },
  updateCustomField: (fieldId, updates) => { Mut.updateCustomField(localStore, fieldId, updates); },
  deleteCustomField: (fieldId) => { Mut.deleteCustomField(localStore, fieldId); },
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
  recolorFolder: (folderId, color) => { Mut.recolorFolder(localStore, folderId, color); },
  deleteFolder: (folderId) => { Mut.deleteFolder(localStore, folderId); },
  moveToFolder: (messageId, folderId) => {
    Mut.moveToFolder(localStore, messageId, folderId);
  },
}));

// ─── Auto-save subscription ───────────────────────────────────────────────────
// Fires on every state change; schedules a debounced save when relevant
// fields change and the active workspace has autoSave enabled.

useWorkspace.subscribe((state, prev) => {
  if (_isRestoring) return;
  if (
    state.selectedFolderId === prev.selectedFolderId &&
    state.activeFilter === prev.activeFilter &&
    state.selectedSavedViewId === prev.selectedSavedViewId &&
    state.density === prev.density &&
    state.viewMode === prev.viewMode &&
    state.theme === prev.theme &&
    state.viewerPinState === prev.viewerPinState &&
    state.listPanelState === prev.listPanelState
  ) return;
  scheduleAutoSave();
});

// ─── Derived selectors ────────────────────────────────────────────────────────

/** Email currently shown in the inspector — pinned overrides selected. */
export function useInspectorEmailId(): string | null {
  return useWorkspace((s) =>
    s.inspectorPinned ? s.pinnedEmailId : s.selectedEmailId,
  );
}
