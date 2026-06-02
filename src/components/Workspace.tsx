import * as React from "react";
import { DockviewReact, DockviewDefaultTab } from "dockview";
import type { DockviewReadyEvent, IDockviewPanelProps, IDockviewPanelHeaderProps } from "dockview";
import { GripVertical, X } from "lucide-react";
import { Toaster, toast } from "sonner";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { WorkspaceChrome } from "@/components/chrome/WorkspaceChrome";
import { StatusBar } from "@/components/chrome/StatusBar";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { ShortcutHelpModal } from "@/components/chrome/ShortcutHelpModal";
import { UndoHistoryModal } from "@/components/chrome/UndoHistoryModal";
import { NavigationPanel } from "@/components/nav/NavigationPanel";
import { EmailListPanel } from "@/components/email/EmailListPanel";
import { EmailViewerPanel } from "@/components/email/EmailViewerPanel";
import { InspectorPanel } from "@/components/inspector/InspectorPanel";
import { EmailComposerPanel } from "@/components/email/EmailComposerPanel";
import { HudStrip } from "@/components/hud/HudStrip";
import { ContactsPanel } from "@/components/contacts/ContactsPanel";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { CalendarPanel } from "@/components/calendar/CalendarPanel";
import { EventCreateModal } from "@/components/calendar/EventCreateModal";
import { useWorkspace, setDockviewApi, setDefaultLayoutJson, getDefaultLayoutJson, scheduleAutoSave, getDockviewApi } from "@/state/workspace";
import { useTotalInboxUnread } from "@/storage/useStore";
import { localStore } from "@/storage/local";
import { undoLastMutation, redoLastMutation, getUndoHistory, getRedoHistory } from "@/state/mutations";
import { NAV_PREFIX, navTargetForKey, setNavSequencePending } from "@/lib/shortcuts";
import type { ModuleKey } from "@/data/types";
import { resolvePanelColor, resolveBodyTintLevel } from "@/lib/panelColors";
import { getAppPreferences, useAppPreferencesVersion } from "@/lib/appPreferences";

// ─── Panel wrapper components ─────────────────────────────────────────────────
// dockview renders panel content by string key — wrap our panels so they
// accept IDockviewPanelProps but use hooks internally as before.

const NavPanel = (_: IDockviewPanelProps) => <NavigationPanel />;
const ListPanel = (props: IDockviewPanelProps) => <EmailListPanel panelId={props.api.id} />;
const ViewerPanel = (props: IDockviewPanelProps) => {
  const composerOpen = useWorkspace((s) => s.composerOpen);
  return composerOpen ? <EmailComposerPanel /> : <EmailViewerPanel panelId={props.api.id} />;
};
const InspPanel = (props: IDockviewPanelProps) => <InspectorPanel panelId={props.api.id} />;
const ContactsPanelWrapper = (props: IDockviewPanelProps) => <ContactsPanel panelId={props.api.id} />;
const SettingsPanelWrapper = (props: IDockviewPanelProps) => <SettingsPanel panelId={props.api.id} />;
const CalendarPanelWrapper = (_: IDockviewPanelProps) => <CalendarPanel />;

const DV_COMPONENTS: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  nav: NavPanel,
  list: ListPanel,
  viewer: ViewerPanel,
  inspector: InspPanel,
  contacts: ContactsPanelWrapper,
  settings: SettingsPanelWrapper,
  calendar: CalendarPanelWrapper,
};

// ─── Custom tab component ─────────────────────────────────────────────────────
// Renders a grip affordance and our own close button so we control the styling.
// The whole tab element is dockview's drag handle; grip is purely visual.

function DockviewTab(props: IDockviewPanelHeaderProps) {
  return (
    <div className="group/tab flex h-full items-center pl-1">
      <GripVertical size={11} className="mr-0.5 shrink-0 text-text-muted opacity-40" />
      <DockviewDefaultTab {...props} hideClose />
      <button
        type="button"
        aria-label="Close panel"
        onClick={() => props.api.close()}
        className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-xs text-text-muted opacity-0 transition-opacity hover:text-text-primary group-hover/tab:opacity-100"
      >
        <X size={10} strokeWidth={2.5} />
      </button>
    </div>
  );
}

// ─── Initial layout ───────────────────────────────────────────────────────────
// Called once when dockview mounts. Sets up the 4-column layout with
// proportional initial widths. Users can resize and rearrange from here.

// Panel sizing targets a 1440 px screen (sum = 1440 px).
// Mail list is intentionally wider than the viewer — scan-first layout.
// minimumWidth prevents accidental squishing below usable sizes.
function buildDefaultLayout(api: DockviewReadyEvent["api"]) {
  const nav = api.addPanel({
    id: "nav",
    component: "nav",
    title: "Navigation",
    minimumWidth: 180,
  });

  const list = api.addPanel({
    id: "list",
    component: "list",
    title: "Mail",
    minimumWidth: 280,
    position: { direction: "right", referencePanel: nav },
  });

  const viewer = api.addPanel({
    id: "viewer",
    component: "viewer",
    title: "Message",
    minimumWidth: 300,
    position: { direction: "right", referencePanel: list },
  });

  const inspector = api.addPanel({
    id: "inspector",
    component: "inspector",
    title: "Inspector",
    minimumWidth: 200,
    position: { direction: "right", referencePanel: viewer },
  });

  // Sequential addPanel calls skew proportions — force correct widths after all panels exist.
  // Right-to-left order lets the SplitView settle correctly before each resize.
  inspector.api.setSize({ width: 245 });
  viewer.api.setSize({ width: 400 });
  list.api.setSize({ width: 520 });
  nav.api.setSize({ width: 275 });
}

/**
 * Set --module-color on a dockview group element based on its active panel.
 * The CSS rules in tokens.css consume this property to render the tab-bar
 * wash, active-tab underline, top divider, and selected-row tint.
 */
function applyModuleColor(group: { activePanel?: { id: string } | null; element?: HTMLElement }) {
  const el = group.element;
  if (!el) return;
  const activeId = group.activePanel?.id;
  if (!activeId) {
    el.style.removeProperty("--module-color");
    return;
  }
  // Active panel ids in our layout match DV_COMPONENTS keys, with optional
  // "viewer-2" / "inspector-abc123" disambiguation suffixes. Strip the suffix
  // to get the module key.
  const moduleKey = activeId.split("-")[0] as ModuleKey;
  const userPrefs = getAppPreferences().panelColors;
  const activeWs = useWorkspace.getState().workspaces.find(
    (w) => w.id === useWorkspace.getState().activeWorkspaceId,
  );
  const wsPrefs = activeWs?.panelColors;
  el.style.setProperty("--module-color", resolvePanelColor(moduleKey, userPrefs, wsPrefs));
}

function initLayout(event: DockviewReadyEvent) {
  const { api } = event;
  setDockviewApi(api);

  // Always build (and capture) the default layout first so "start fresh"
  // workspaces have a valid reference even if we immediately override it.
  buildDefaultLayout(api);
  if (!getDefaultLayoutJson()) {
    setDefaultLayoutJson(api.toJSON());
  }

  // Then restore the saved workspace layout if one exists.
  const { workspaces, activeWorkspaceId } = useWorkspace.getState();
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);
  if (activeWs?.dockviewLayout) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api.fromJSON(activeWs.dockviewLayout as any);
  }

  // Trigger auto-save on any dockview layout change (resize, rearrange, float).
  api.onDidLayoutChange(() => {
    scheduleAutoSave();
  });

  // Apply --module-color to every existing group on initial load.
  api.groups.forEach(applyModuleColor);

  // Re-apply when the active panel inside any group changes (user clicks a tab
  // or drags one in/out).
  api.onDidActivePanelChange(() => {
    api.groups.forEach(applyModuleColor);
  });

  // Re-apply when groups are added (new tab dropped into a new column).
  api.onDidAddGroup((group) => {
    applyModuleColor(group);
  });

  // Clean up viewerInspectorMap when panels are removed via their X button,
  // preventing orphaned ownership that blocks other viewers from opening inspectors.
  api.onDidRemovePanel((panel) => {
    const id = panel.id;
    const { viewerInspectorMap, clearViewerInspector } = useWorkspace.getState();

    if (id.startsWith("viewer")) {
      // Viewer removed — release its inspector so the inspector becomes free again.
      clearViewerInspector(id);
    } else if (id === "inspector" || id.startsWith("inspector-")) {
      // Inspector removed — clear its owner's association so the owner's toggle resets.
      const ownerViewerId = Object.entries(viewerInspectorMap).find(([, iid]) => iid === id)?.[0];
      if (ownerViewerId) clearViewerInspector(ownerViewerId);
    }
  });
}

// ─── Workspace ────────────────────────────────────────────────────────────────

/**
 * Workspace shell — dockview owns the panel layout.
 * Panels are resizable by dragging the sash between groups, and
 * rearrangeable by dragging panel tabs to new positions.
 */
export function Workspace() {
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  const eventCreateModalOpen = useWorkspace((s) => s.eventCreateModalOpen);
  const eventCreateModalPrefill = useWorkspace((s) => s.eventCreateModalPrefill);
  const closeEventCreateModal = useWorkspace((s) => s.closeEventCreateModal);
  // Incrementing this forces re-reads of the module-level undo/redo stacks.
  const [, setStackVersion] = React.useState(0);
  const bumpStack = React.useCallback(() => setStackVersion((v) => v + 1), []);

  const unread = useTotalInboxUnread();

  // Update document title with unread badge
  React.useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Nexus` : "Nexus";
  }, [unread]);

  // During any drag operation, disable pointer-events on iframes so they don't
  // swallow dragover/drop events fired at the parent document.
  React.useEffect(() => {
    const add = () => document.body.classList.add("nx-dragging");
    const rem = () => document.body.classList.remove("nx-dragging");
    window.addEventListener("dragstart", add);
    window.addEventListener("dragend", rem);
    window.addEventListener("drop", rem);
    return () => {
      window.removeEventListener("dragstart", add);
      window.removeEventListener("dragend", rem);
      window.removeEventListener("drop", rem);
    };
  }, []);

  // Global `?` key opens shortcut help
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (e.key === "?" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Global `z` = undo, `Z` (Shift+z) = redo
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const isEditable = (document.activeElement as HTMLElement)?.isContentEditable;
      if (tag === "INPUT" || tag === "TEXTAREA" || isEditable) return;
      if (e.key === "z") {
        e.preventDefault();
        const description = undoLastMutation(localStore);
        if (description) { toast(`Undone: ${description}`); bumpStack(); }
      } else if (e.key === "Z") {
        e.preventDefault();
        const description = redoLastMutation(localStore);
        if (description) { toast(`Redone: ${description}`); bumpStack(); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bumpStack]);

  // Global navigation chords: "g" then a key (gi, gs, gt, gd, gb, ga, gc).
  // Works from any panel. The list panel's own handler defers to this one
  // while a "g" sequence is pending (see isNavSequencePending).
  React.useEffect(() => {
    let prefixActive = false;
    let timer: number | undefined;

    function isEditable(el: EventTarget | null): boolean {
      const node = el as HTMLElement | null;
      if (!node) return false;
      return node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable;
    }
    function resetPrefix() {
      prefixActive = false;
      setNavSequencePending(false);
      if (timer !== undefined) { window.clearTimeout(timer); timer = undefined; }
    }
    function goToSystemFolder(systemKind: string) {
      const label = Array.from(localStore.labels.values()).find(
        (l) => l.kind === "system" && l.systemKind === systemKind,
      );
      if (label) useWorkspace.getState().setSelectedFolder(label.id);
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) { resetPrefix(); return; }
      if (isEditable(document.activeElement) || isEditable(e.target)) { resetPrefix(); return; }

      if (prefixActive) {
        // Second key of a "g" sequence.
        prefixActive = false;
        if (timer !== undefined) { window.clearTimeout(timer); timer = undefined; }
        const target = navTargetForKey(e.key);
        if (target) {
          e.preventDefault();
          if (target.kind === "folder") goToSystemFolder(target.systemKind);
          else if (target.kind === "contacts") useWorkspace.getState().openContactsPanel();
          else if (target.kind === "calendar") useWorkspace.getState().openCalendarPanel();
        }
        // Keep the guard set through the end of this event so the list handler
        // ignores this key regardless of window-listener ordering, then clear.
        window.setTimeout(() => setNavSequencePending(false), 0);
        return;
      }

      if (e.key === NAV_PREFIX) {
        prefixActive = true;
        setNavSequencePending(true);
        timer = window.setTimeout(resetPrefix, 1200);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); resetPrefix(); };
  }, []);

  // Subscribe to workspace changes so the data attribute updates when the
  // user toggles per-workspace tint or switches workspaces.
  const activeWs = useWorkspace((s) =>
    s.workspaces.find((w) => w.id === s.activeWorkspaceId),
  );

  // Bump on every saveAppPreferences call so swatch changes immediately
  // re-render this component and re-apply --module-color to all groups.
  const prefsVersion = useAppPreferencesVersion();

  // Re-apply --module-color to every dockview group whenever the active
  // workspace, its color overrides, or user-level prefs change.
  React.useEffect(() => {
    const api = getDockviewApi();
    api?.groups.forEach(applyModuleColor);
  }, [activeWs?.id, activeWs?.panelColors, prefsVersion]);

  const bodyTintLevel = resolveBodyTintLevel(
    getAppPreferences().panelColors,
    activeWs?.panelColors,
  );

  return (
    <TooltipProvider delayDuration={600}>
      <div
        className="dv-theme-nexus flex h-screen w-screen flex-col bg-canvas text-text-primary"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            const tag = (document.activeElement as HTMLElement)?.tagName;
            if (tag !== "INPUT" && tag !== "TEXTAREA") {
              useWorkspace.getState().clearSelection();
            }
          }
        }}
      >
        <WorkspaceChrome onShowHistory={() => setHistoryOpen(true)} />

        <div className="relative min-h-0 flex-1" data-body-tint-level={bodyTintLevel}>
          <DockviewReact
            className="h-full w-full"
            components={DV_COMPONENTS}
            defaultTabComponent={DockviewTab}
            onReady={initLayout}
            singleTabMode="fullwidth"
            disableFloatingGroups={false}
            gap={4}
          />
          <HudStrip />
        </div>

        <StatusBar />
        <CommandPalette />
        <EventCreateModal
          open={eventCreateModalOpen}
          onClose={closeEventCreateModal}
          prefillDate={eventCreateModalPrefill?.date}
          prefillStartTime={eventCreateModalPrefill?.time}
          prefillAttendees={eventCreateModalPrefill?.attendees}
          prefillTitle={eventCreateModalPrefill?.title}
        />
        <ShortcutHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
        <UndoHistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          undoHistory={getUndoHistory()}
          redoHistory={getRedoHistory()}
          onUndoSteps={(n) => { for (let i = 0; i < n; i++) undoLastMutation(localStore); bumpStack(); }}
          onRedoSteps={(n) => { for (let i = 0; i < n; i++) redoLastMutation(localStore); bumpStack(); }}
        />

        <Toaster
          position="bottom-right"
          theme="system"
          toastOptions={{
            classNames: {
              toast:
                "!bg-surface-4 !text-text-primary !border !border-border-default !shadow-l4 !rounded-md !backdrop-blur-md",
              title: "!text-text-primary !text-body !font-medium",
              description: "!text-text-tertiary !text-small",
              actionButton:
                "!bg-accent !text-text-on-accent !rounded-sm !text-caption !h-6 !px-2",
            },
          }}
        />
      </div>
    </TooltipProvider>
  );
}
