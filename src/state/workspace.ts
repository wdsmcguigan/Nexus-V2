import * as React from "react";
import { create } from "zustand";
import { toast } from "sonner";
import type { Density, Theme } from "@/design-system/tokens";
import { emails as fixtureEmails, emailById, type Email } from "@/data/fixtures";

export type MobileView = "nav" | "list" | "viewer" | "inspector";
export type MobileTab = "mail" | "search" | "compose" | "settings";
export type TabBarBehavior = "always" | "autohide";

export interface EmailOverride {
  archived?: boolean;
  deleted?: boolean;
  snoozedUntil?: number | null;
  starred?: boolean;
  read?: boolean;
  removedLabelIds?: string[];
}

interface WorkspaceState {
  // Theme
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;

  // Density
  density: Density;
  setDensity: (d: Density) => void;
  cycleDensity: () => void;

  // Folder
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

  // Inspector pin
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

  // Email overrides (mutable layer over fixtures)
  emailOverrides: Map<string, EmailOverride>;
  setStarred: (id: string, starred: boolean) => void;
  setRead: (id: string, read: boolean) => void;
  removeLabelFromEmail: (emailId: string, labelId: string) => void;
  archive: (ids: string[]) => void;
  snooze: (ids: string[]) => void;
  deleteEmails: (ids: string[]) => void;

  // Action target resolution
  resolveActionTargets: () => string[];

  // Mobile shell
  mobileView: MobileView;
  mobileTab: MobileTab;
  setMobileView: (v: MobileView) => void;
  setMobileTab: (t: MobileTab) => void;
  popMobileView: () => void;

  // Tab bar behavior
  tabBarBehavior: TabBarBehavior;
  setTabBarBehavior: (b: TabBarBehavior) => void;
  toggleTabBarBehavior: () => void;
}

const DENSITIES: Density[] = ["compact", "comfortable", "cozy"];
const TOAST_DURATION_MS = 5000;
const SNOOZE_DURATION_MS = 60 * 60 * 1000; // 1 hour

function patchOverride(
  map: Map<string, EmailOverride>,
  id: string,
  patch: EmailOverride,
): Map<string, EmailOverride> {
  const next = new Map(map);
  const prev = next.get(id) ?? {};
  next.set(id, { ...prev, ...patch });
  return next;
}

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

  emailOverrides: new Map(),

  setStarred: (id, starred) =>
    set((s) => ({
      emailOverrides: patchOverride(s.emailOverrides, id, { starred }),
    })),

  setRead: (id, read) =>
    set((s) => ({
      emailOverrides: patchOverride(s.emailOverrides, id, { read }),
    })),

  removeLabelFromEmail: (emailId, labelId) =>
    set((s) => {
      const prev = s.emailOverrides.get(emailId) ?? {};
      const removed = new Set(prev.removedLabelIds ?? []);
      removed.add(labelId);
      const next = new Map(s.emailOverrides);
      next.set(emailId, { ...prev, removedLabelIds: [...removed] });
      return { emailOverrides: next };
    }),

  archive: (ids) => {
    if (ids.length === 0) return;
    const before = get().emailOverrides;
    const next = new Map(before);
    ids.forEach((id) => {
      const prev = next.get(id) ?? {};
      next.set(id, { ...prev, archived: true });
    });
    set({ emailOverrides: next, selectedEmailIds: new Set() });
    toast(ids.length === 1 ? "Archived" : `Archived ${ids.length}`, {
      action: {
        label: "Undo",
        onClick: () => set({ emailOverrides: before }),
      },
      duration: TOAST_DURATION_MS,
    });
  },

  snooze: (ids) => {
    if (ids.length === 0) return;
    const before = get().emailOverrides;
    const until = Date.now() + SNOOZE_DURATION_MS;
    const next = new Map(before);
    ids.forEach((id) => {
      const prev = next.get(id) ?? {};
      next.set(id, { ...prev, snoozedUntil: until });
    });
    set({ emailOverrides: next, selectedEmailIds: new Set() });
    toast(ids.length === 1 ? "Snoozed for 1h" : `Snoozed ${ids.length} for 1h`, {
      action: {
        label: "Undo",
        onClick: () => set({ emailOverrides: before }),
      },
      duration: TOAST_DURATION_MS,
    });
  },

  deleteEmails: (ids) => {
    if (ids.length === 0) return;
    const before = get().emailOverrides;
    const next = new Map(before);
    ids.forEach((id) => {
      const prev = next.get(id) ?? {};
      next.set(id, { ...prev, deleted: true });
    });
    set({ emailOverrides: next, selectedEmailIds: new Set() });
    toast(ids.length === 1 ? "Moved to Trash" : `Moved ${ids.length} to Trash`, {
      action: {
        label: "Undo",
        onClick: () => set({ emailOverrides: before }),
      },
      duration: TOAST_DURATION_MS,
    });
  },

  resolveActionTargets: () => {
    const { selectedEmailIds, focusedRowId, selectedEmailId } = get();
    if (selectedEmailIds.size > 0) return [...selectedEmailIds];
    if (focusedRowId) return [focusedRowId];
    if (selectedEmailId) return [selectedEmailId];
    return [];
  },

  mobileView: "nav",
  mobileTab: "mail",
  setMobileView: (v) => set({ mobileView: v }),
  setMobileTab: (t) => set({ mobileTab: t }),
  popMobileView: () => {
    const v = get().mobileView;
    if (v === "inspector") set({ mobileView: "viewer" });
    else if (v === "viewer") set({ mobileView: "list" });
    else if (v === "list") set({ mobileView: "nav" });
  },

  tabBarBehavior: "always",
  setTabBarBehavior: (b) => set({ tabBarBehavior: b }),
  toggleTabBarBehavior: () => {
    const next = get().tabBarBehavior === "always" ? "autohide" : "always";
    set({ tabBarBehavior: next });
    toast(`Tab bar: ${next === "always" ? "always visible" : "auto-hide on scroll"}`);
  },
}));

/** Email currently shown in the inspector — pinned overrides selected. */
export function useInspectorEmailId(): string | null {
  return useWorkspace((s) =>
    s.inspectorPinned ? s.pinnedEmailId : s.selectedEmailId,
  );
}

function applyOverride(email: Email, override: EmailOverride | undefined): Email {
  if (!override) return email;
  const removedLabels = new Set(override.removedLabelIds ?? []);
  return {
    ...email,
    starred: override.starred ?? email.starred,
    read: override.read ?? email.read,
    labels: removedLabels.size
      ? email.labels.filter((l) => !removedLabels.has(l.id))
      : email.labels,
  };
}

function isHidden(folderId: string, override: EmailOverride | undefined, now: number): boolean {
  if (!override) return false;
  if (override.deleted && folderId !== "trash") return true;
  if (override.archived && folderId !== "archive") return true;
  if (
    override.snoozedUntil &&
    override.snoozedUntil > now &&
    folderId !== "snoozed"
  ) {
    return true;
  }
  return false;
}

function emailMatchesFolder(
  email: Email,
  folderId: string,
  override: EmailOverride | undefined,
  now: number,
): boolean {
  if (folderId === "trash") return !!override?.deleted;
  if (folderId === "archive") return !!override?.archived;
  if (folderId === "snoozed") {
    if (override?.snoozedUntil && override.snoozedUntil > now) return true;
    return email.folderId === "snoozed";
  }
  if (email.folderId !== folderId) return false;
  return !isHidden(folderId, override, now);
}

/** Folder list with overrides applied (filters archived/deleted/snoozed). */
export function useVisibleEmails(folderId: string): Email[] {
  const overrides = useWorkspace((s) => s.emailOverrides);
  return React.useMemo(() => {
    const now = Date.now();
    return fixtureEmails
      .filter((e) => emailMatchesFolder(e, folderId, overrides.get(e.id), now))
      .map((e) => applyOverride(e, overrides.get(e.id)));
  }, [folderId, overrides]);
}

/** Single email with overrides applied. */
export function useEmail(id: string | null): Email | null {
  const overrides = useWorkspace((s) => s.emailOverrides);
  return React.useMemo(() => {
    const e = emailById(id);
    if (!e) return null;
    return applyOverride(e, overrides.get(e.id));
  }, [id, overrides]);
}
