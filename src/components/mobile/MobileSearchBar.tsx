import { Search } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";

export function MobileSearchBar() {
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);

  return (
    <div className="shrink-0 border-b border-border-subtle bg-surface-1 px-3 py-2">
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-sm bg-surface-2 px-3",
          "text-caption text-text-tertiary",
          "border border-border-subtle hover:border-border-default hover:bg-surface-3",
          "transition-colors duration-fast",
        )}
      >
        <Search size={14} />
        <span className="flex-1 text-left">Search emails, contacts, files…</span>
      </button>
    </div>
  );
}
