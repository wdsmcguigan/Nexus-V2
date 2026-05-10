import { WorkspaceChrome } from "@/components/chrome/WorkspaceChrome";
import { StatusBar } from "@/components/chrome/StatusBar";
import { NavigationPanel } from "@/components/nav/NavigationPanel";
import { EmailListPanel } from "@/components/email/EmailListPanel";
import { EmailViewerPanel } from "@/components/email/EmailViewerPanel";
import { InspectorPanel } from "@/components/inspector/InspectorPanel";
import { EmailComposerPanel } from "@/components/email/EmailComposerPanel";
import { HudStrip } from "@/components/hud/HudStrip";
import { useWorkspace } from "@/state/workspace";

/**
 * Desktop workspace shell.
 *
 * Note: dockview is wired into the project (CSS imported, theme overrides
 * applied) and will own the layout once the panel-orchestration layer is
 * in. For the design-system shell we render a CSS-Grid layout that
 * mirrors the planned dockview "default workspace" so we can validate the
 * design tokens, panel chrome, focus model, and interactions on real
 * data. Swapping in dockview is a structural change, not a token change.
 */
export function Workspace() {
  const composerOpen = useWorkspace((s) => s.composerOpen);

  return (
    <div className="dv-theme-nexus flex min-h-0 flex-1 flex-col">
      <WorkspaceChrome />

      <div className="relative grid min-h-0 flex-1 grid-cols-[240px_minmax(360px,1fr)_minmax(420px,1.4fr)_320px] gap-1.5 p-1.5">
        <NavigationPanel />
        <EmailListPanel />
        {composerOpen ? <EmailComposerPanel /> : <EmailViewerPanel />}
        <InspectorPanel />
        <HudStrip />
      </div>

      <StatusBar />
    </div>
  );
}
