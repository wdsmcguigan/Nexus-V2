/**
 * Workspace persistence — stores named workspace snapshots in localStorage.
 * Synchronous so layout is available before first React render.
 */

import type { MetadataFilter, PanelColorPrefs, StarStyle } from "@/data/types";
import type { ShortcutAction } from "@/lib/shortcuts";
import type { PopoutKind, WindowGeometry } from "@/storage/tauri";

export interface ListPanelSnapshotState {
  filter: MetadataFilter;
  selectedFolderId: string;
  selectedSavedViewId: string | null;
}

/** A panel detached into its own OS window, restored on next launch. */
export interface DetachedWindowSnapshot {
  kind: PopoutKind;
  /** Message id for viewer/inspector windows; null for the rest. */
  targetId: string | null;
  /** Last-known window geometry (physical px) + monitor; null until captured. */
  geometry: WindowGeometry | null;
}

export interface WorkspaceSnapshot {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** When true, saves automatically on layout/state changes (debounced). */
  autoSave: boolean;
  /** Dockview serialized layout — null means use default initLayout. */
  dockviewLayout: unknown;
  viewerPinState: Record<string, string | null>;
  listPanelState: Record<string, ListPanelSnapshotState | null>;
  selectedFolderId: string;
  activeFilter: MetadataFilter;
  selectedSavedViewId: string | null;
  density: "compact" | "comfortable" | "cozy";
  viewMode: "list" | "kanban" | "table";
  theme: "dark" | "light";
  /** Ordered list of column keys for the table view (empty = default order). */
  tableColumnOrder: string[];
  /** Per-column width overrides for the table view (key → px width). */
  tableColumnWidths: Record<string, number>;
  /** Controls whether contextual "jump to filtered messages" opens in-place or a new panel. */
  filteredViewBehavior: "replace" | "new-panel";
  /** When true, the list collapses messages into one row per threadId (default: true). */
  threadedView: boolean;
  /** When false, message rows never show the body snippet preview (default: true). */
  showSnippets: boolean;
  /** Ordered list of star styles that cycle when clicking the star icon. Empty = all 12. */
  activeStars: StarStyle[];
  /** Custom key bindings: action → key string. Absent key = use default. */
  keyBindings: Partial<Record<ShortcutAction, string>>;
  /** Per-workspace panel color override. Absent means inherit user-level prefs. */
  panelColors?: PanelColorPrefs;
  /** Panels detached into their own OS windows, replayed on next launch. */
  detachedWindows?: DetachedWindowSnapshot[];
}

export interface WorkspacesData {
  workspaces: WorkspaceSnapshot[];
  activeId: string;
}

const STORAGE_KEY = "nexus_workspaces_v3";

export function loadWorkspacesFromStorage(): WorkspacesData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WorkspacesData;
  } catch {
    return null;
  }
}

export function saveWorkspacesToStorage(data: WorkspacesData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Quota exceeded — silently ignore
  }
}

export function makeDefaultWorkspace(): WorkspaceSnapshot {
  return {
    id: "default",
    name: "Default",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    autoSave: false,
    dockviewLayout: null,
    viewerPinState: {},
    listPanelState: {},
    selectedFolderId: "inbox",
    activeFilter: {},
    selectedSavedViewId: null,
    density: "comfortable",
    viewMode: "list",
    theme: "dark",
    tableColumnOrder: [],
    tableColumnWidths: {},
    filteredViewBehavior: "replace",
    threadedView: true,
    showSnippets: true,
    activeStars: [],
    keyBindings: {},
    detachedWindows: [],
  };
}
