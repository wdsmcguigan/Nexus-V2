import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Wifi, Keyboard, Archive, Trash2, FolderInput, MoreHorizontal, Printer, FileDown } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/utils";
import { LabelPickerPopover } from "@/components/email/LabelPickerPopover";
import { FolderPickerDialog } from "@/components/email/FolderPickerDialog";
import { localStore } from "@/storage/local";
import { loadBodies } from "@/lib/loadBodies";
import { printMessages } from "@/lib/print";
import { exportMessagesAsMbox } from "@/lib/export";

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

  function getSelectedMessages() {
    return selectedIds.flatMap((id) => {
      const m = localStore.messages.get(id);
      return m ? [m] : [];
    });
  }

  function handleArchive() {
    for (const id of selectedIds) archive(id);
    clearSelection();
  }

  function handleTrash() {
    for (const id of selectedIds) trash(id);
    clearSelection();
  }

  async function handlePrint() {
    const msgs = getSelectedMessages().sort((a, b) => a.receivedAt - b.receivedAt);
    if (msgs.length === 0) return;
    const bodies = await loadBodies(msgs);
    printMessages(msgs, bodies);
  }

  async function handleExportMbox() {
    const msgs = getSelectedMessages().sort((a, b) => a.receivedAt - b.receivedAt);
    if (msgs.length === 0) return;
    const bodies = await loadBodies(msgs);
    const hint = msgs.length === 1 ? (msgs[0]?.subject ?? "email") : `nexus_${msgs.length}_emails`;
    await exportMessagesAsMbox(msgs, bodies, hint);
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
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="xs" iconOnly aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                sideOffset={6}
                align="start"
                className="z-50 min-w-[180px] overflow-hidden rounded-md border border-border-subtle bg-surface-2 p-1 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
              >
                <DropdownMenu.Item
                  onSelect={handlePrint}
                  className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                >
                  <Printer size={12} />
                  Print selected
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={handleExportMbox}
                  className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                >
                  <FileDown size={12} />
                  Export as MBOX
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
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
