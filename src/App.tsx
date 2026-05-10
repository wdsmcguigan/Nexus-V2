import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { Workspace } from "@/components/Workspace";
import { MobileShell } from "@/components/mobile/MobileShell";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { useIsMobile } from "@/lib/useMediaQuery";
import { useWorkspace } from "@/state/workspace";

export default function App() {
  const isMobile = useIsMobile();

  return (
    <TooltipProvider delayDuration={600}>
      <div
        className="flex h-dvh w-screen flex-col bg-canvas text-text-primary"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            const tag = (document.activeElement as HTMLElement)?.tagName;
            if (tag !== "INPUT" && tag !== "TEXTAREA") {
              useWorkspace.getState().clearSelection();
            }
          }
        }}
      >
        {isMobile ? <MobileShell /> : <Workspace />}

        <CommandPalette />

        <Toaster
          position={isMobile ? "top-center" : "bottom-right"}
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
