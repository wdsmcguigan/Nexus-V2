/**
 * Workspace persistence — stores named workspace snapshots in localStorage.
 * Synchronous so layout is available before first React render.
 */

import type { MetadataFilter } from "@/data/types";

export interface ListPanelSnapshotState {
  filter: MetadataFilter;
  selectedFolderId: string;
  selectedSavedViewId: string | null;
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
  };
}
