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
import { useWorkspace } from "@/state/workspace";

/**
 * Workspace shell.
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
    <TooltipProvider delayDuration={600}>
      <div
        className="dv-theme-nexus flex h-screen w-screen flex-col bg-canvas text-text-primary"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            // clear selection at panel rest — see spec §6.2
            const tag = (document.activeElement as HTMLElement)?.tagName;
            if (tag !== "INPUT" && tag !== "TEXTAREA") {
              useWorkspace.getState().clearSelection();
            }
          }
        }}
      >
        <WorkspaceChrome />

        <div className="relative grid min-h-0 flex-1 grid-cols-[240px_minmax(360px,1fr)_minmax(420px,1.4fr)_320px] gap-1.5 p-1.5">
          <NavigationPanel />
          <EmailListPanel />
          {composerOpen ? <EmailComposerPanel /> : <EmailViewerPanel />}
          <InspectorPanel />
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
