import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useWorkspace } from "@/state/workspace";
import { folders, customFolders } from "@/data/fixtures";
import { useEmail } from "@/state/workspace";
import { cn } from "@/lib/utils";

interface MobileTopBarProps {
  trailing?: React.ReactNode;
}

function useTitle(): string {
  const view = useWorkspace((s) => s.mobileView);
  const folderId = useWorkspace((s) => s.selectedFolderId);
  const inspectorEmailId = useWorkspace((s) =>
    s.inspectorPinned ? s.pinnedEmailId : s.selectedEmailId,
  );
  const inspectedEmail = useEmail(inspectorEmailId);
  if (view === "nav") return "Mail";
  if (view === "list") {
    const f =
      folders.find((x) => x.id === folderId) ??
      customFolders.find((x) => x.id === folderId);
    return f?.name ?? "Mail";
  }
  if (view === "viewer") return inspectedEmail?.subject ?? "Message";
  return "Inspector";
}

export function MobileTopBar({ trailing }: MobileTopBarProps) {
  const view = useWorkspace((s) => s.mobileView);
  const popMobileView = useWorkspace((s) => s.popMobileView);
  const title = useTitle();
  const showBack = view !== "nav";

  return (
    <header
      role="banner"
      className={cn(
        "flex h-11 shrink-0 items-center gap-1 border-b border-border-default bg-surface-1 px-1",
        "pt-[env(safe-area-inset-top)]",
      )}
    >
      <div className="flex w-12 shrink-0 items-center justify-start">
        {showBack && (
          <Button
            variant="ghost"
            size="md"
            iconOnly
            aria-label="Back"
            onClick={popMobileView}
          >
            <ChevronLeft />
          </Button>
        )}
      </div>
      <h1 className="min-w-0 flex-1 truncate text-center font-sans text-h3 font-semibold text-text-primary">
        {title}
      </h1>
      <div className="flex w-12 shrink-0 items-center justify-end">{trailing}</div>
    </header>
  );
}
