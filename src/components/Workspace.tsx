import * as React from "react";
import { DockviewReact } from "dockview";
import type { DockviewReadyEvent, IDockviewPanelProps } from "dockview";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { WorkspaceChrome } from "@/components/chrome/WorkspaceChrome";
import { StatusBar } from "@/components/chrome/StatusBar";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { NavigationPanel } from "@/components/nav/NavigationPanel";
import { EmailListPanel } from "@/components/email/EmailListPanel";
import { EmailViewerPanel } from "@/components/email/EmailViewerPanel";
import { InspectorPanel } from "@/components/inspector/InspectorPanel";
import { EmailComposerPanel } from "@/components/email/EmailComposerPanel";
import { HudStrip } from "@/components/hud/HudStrip";
import { useWorkspace, setDockviewApi, setDefaultLayoutJson, getDefaultLayoutJson, scheduleAutoSave } from "@/state/workspace";

// ─── Panel wrapper components ─────────────────────────────────────────────────
// dockview renders panel content by string key — wrap our panels so they
// accept IDockviewPanelProps but use hooks internally as before.

const NavPanel = (_: IDockviewPanelProps) => <NavigationPanel />;
const ListPanel = (props: IDockviewPanelProps) => <EmailListPanel panelId={props.api.id} />;
const ViewerPanel = (props: IDockviewPanelProps) => {
  const composerOpen = useWorkspace((s) => s.composerOpen);
  return composerOpen ? <EmailComposerPanel /> : <EmailViewerPanel panelId={props.api.id} />;
};
const InspPanel = (_: IDockviewPanelProps) => <InspectorPanel />;

const DV_COMPONENTS: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  nav: NavPanel,
  list: ListPanel,
  viewer: ViewerPanel,
  inspector: InspPanel,
};

// ─── Initial layout ───────────────────────────────────────────────────────────
// Called once when dockview mounts. Sets up the 4-column layout with
// proportional initial widths. Users can resize and rearrange from here.

// Panel sizing targets a 1440 px screen (sum = 1420 px).
// minimumWidth prevents accidental squishing below usable sizes.
function buildDefaultLayout(api: DockviewReadyEvent["api"]) {
  const nav = api.addPanel({
    id: "nav",
    component: "nav",
    title: "Navigation",
    initialWidth: 220,
    minimumWidth: 160,
  });

  const list = api.addPanel({
    id: "list",
    component: "list",
    title: "Mail",
    initialWidth: 320,
    minimumWidth: 260,
    position: { direction: "right", referencePanel: nav },
  });

  const viewer = api.addPanel({
    id: "viewer",
    component: "viewer",
    title: "Message",
    initialWidth: 620,
    minimumWidth: 360,
    position: { direction: "right", referencePanel: list },
  });

  api.addPanel({
    id: "inspector",
    component: "inspector",
    title: "Inspector",
    initialWidth: 260,
    minimumWidth: 200,
    position: { direction: "right", referencePanel: viewer },
  });
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
}

// ─── Workspace ────────────────────────────────────────────────────────────────

/**
 * Workspace shell — dockview owns the panel layout.
 * Panels are resizable by dragging the sash between groups, and
 * rearrangeable by dragging panel tabs to new positions.
 */
export function Workspace() {
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
        <WorkspaceChrome />

        <div className="relative min-h-0 flex-1">
          <DockviewReact
            className="h-full w-full"
            components={DV_COMPONENTS}
            onReady={initLayout}
            singleTabMode="fullwidth"
            disableFloatingGroups={false}
            gap={4}
          />
          <HudStrip />
        </div>

        <StatusBar />
        <CommandPalette />

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
