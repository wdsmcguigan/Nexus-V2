import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { NavigationPanel } from "@/components/nav/NavigationPanel";
import { EmailListPanel } from "@/components/email/EmailListPanel";
import { EmailViewerPanel } from "@/components/email/EmailViewerPanel";
import { InspectorPanel } from "@/components/inspector/InspectorPanel";
import { EmailComposerPanel } from "@/components/email/EmailComposerPanel";
import { MobileTopBar } from "./MobileTopBar";
import { MobileTabBar } from "./MobileTabBar";
import { useWorkspace } from "@/state/workspace";
import { useSwipeBack } from "@/lib/useSwipeBack";
import { cn } from "@/lib/utils";

export function MobileShell() {
  const view = useWorkspace((s) => s.mobileView);
  const setMobileView = useWorkspace((s) => s.setMobileView);
  const composerOpen = useWorkspace((s) => s.composerOpen);
  const setComposerOpen = useWorkspace((s) => s.setComposerOpen);
  const popMobileView = useWorkspace((s) => s.popMobileView);

  const swipeRef = useSwipeBack<HTMLDivElement>(popMobileView, {
    enabled: view !== "nav",
  });

  let body: React.ReactNode;
  let trailing: React.ReactNode = null;

  if (view === "nav") body = <NavigationPanel />;
  else if (view === "list") body = <EmailListPanel />;
  else if (view === "viewer") {
    body = <EmailViewerPanel />;
    trailing = (
      <Button
        variant="ghost"
        size="md"
        iconOnly
        aria-label="Inspector"
        onClick={() => setMobileView("inspector")}
      >
        <Info />
      </Button>
    );
  } else body = <InspectorPanel />;

  return (
    <>
      <div
        ref={swipeRef}
        className="flex min-h-0 flex-1 flex-col"
      >
        <MobileTopBar trailing={trailing} />
        <div className="relative min-h-0 flex-1 overflow-hidden">{body}</div>
        <MobileTabBar />
      </div>

      <RadixDialog.Root open={composerOpen} onOpenChange={setComposerOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay
            className={cn(
              "fixed inset-0 z-50 bg-canvas/60 backdrop-blur-sm",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            )}
          />
          <RadixDialog.Content
            aria-label="Compose"
            className={cn(
              "fixed inset-0 z-50 flex flex-col bg-surface-1",
              "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
              "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4",
            )}
          >
            <RadixDialog.Title className="sr-only">Compose</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">
              Write a new email
            </RadixDialog.Description>
            <EmailComposerPanel />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </>
  );
}
