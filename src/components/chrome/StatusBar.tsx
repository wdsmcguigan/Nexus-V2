import * as React from "react";
import { Wifi, Keyboard, Archive, Trash2, FolderInput } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/utils";
import { LabelPickerPopover } from "@/components/email/LabelPickerPopover";
import { FolderPickerDialog } from "@/components/email/FolderPickerDialog";

export function StatusBar() {
  const selected = useWorkspace((s) => s.selectedEmailIds);
  const density = useWorkspace((s) => s.density);
  const cycleDensity = useWorkspace((s) => s.cycleDensity);
  const archive = useWorkspace((s) => s.archive);
  const trash = useWorkspace((s) => s.trash);
  const clearSelection = useWorkspace((s) => s.clearSelection);
  const count = selected.size;

  const [tagOpen, setTagOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);

  const selectedIds = React.useMemo(() => Array.from(selected), [selected]);

  function handleArchive() {
    for (const id of selectedIds) archive(id);
    clearSelection();
  }

  function handleTrash() {
    for (const id of selectedIds) trash(id);
    clearSelection();
  }

  return (
    <footer
      role="contentinfo"
      className={cn(
        "flex h-7 shrink-0 items-center gap-3 border-t border-border-default bg-surface-1 px-3",
        "text-caption text-text-tertiary",
      )}
    >
      <span className="flex items-center gap-1">
        <Wifi size={11} className="text-success" />
        Online
      </span>
      <span className="h-3 w-px bg-border-default" />
      <span className="font-mono text-mono-xs">
        {count > 0 ? `${count} selected` : "0 selected"}
      </span>

      {count > 0 && (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={handleArchive}>
            <Archive />
            Archive
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setMoveOpen(true)}>
            <FolderInput />
            Move
          </Button>
          <LabelPickerPopover
            messageIds={selectedIds}
            variant="button"
            open={tagOpen}
            onOpenChange={setTagOpen}
          />
          <Button variant="ghost" size="xs" onClick={handleTrash}>
            <Trash2 />
            Delete
          </Button>
        </div>
      )}

      <FolderPickerDialog
        messageIds={selectedIds}
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
      />

      <div className="ml-auto flex items-center gap-3">
        <button
          onClick={cycleDensity}
          className="flex items-center gap-1 rounded-xs px-1 py-0.5 hover:bg-surface-2 hover:text-text-secondary"
        >
          Density:
          <span className="font-mono text-mono-xs text-text-secondary">
            {density}
          </span>
        </button>
        <span className="flex items-center gap-1">
          <Keyboard size={11} />
          Press
          <Kbd size="xs">?</Kbd>
          for shortcuts
        </span>
      </div>
    </footer>
  );
}
