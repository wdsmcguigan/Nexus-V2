import * as Dialog from "@radix-ui/react-dialog";
import { Folder, Search } from "lucide-react";
import { localStore } from "@/storage/local";
import { moveToFolder } from "@/state/mutations";
import { cn } from "@/lib/utils";
import React from "react";

interface Props {
  messageId?: string | null;
  /** Multiple message IDs for bulk move. */
  messageIds?: string[];
  open: boolean;
  onClose: () => void;
}

export function FolderPickerDialog({ messageId, messageIds, open, onClose }: Props) {
  const [query, setQuery] = React.useState("");

  // Reset query when dialog closes
  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Get all user folders (exclude system folders) — localStore.folders is Map<string, Folder>
  const folders = React.useMemo(() =>
    Array.from(localStore.folders.values()).filter((f) => !f.systemKind),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open], // recompute when dialog opens
  );

  const filtered = query.trim()
    ? folders.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
    : folders;

  function handleSelect(folderId: string) {
    const ids = messageIds ?? (messageId ? [messageId] : []);
    for (const mid of ids) {
      moveToFolder(localStore, mid, folderId);
    }
    onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-72 -translate-x-1/2 -translate-y-1/2",
            "overflow-hidden rounded-md border border-border-subtle bg-surface-2 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          <Dialog.Title className="sr-only">Move to folder</Dialog.Title>
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
            <Search size={12} className="shrink-0 text-text-tertiary" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Move to folder…"
              className="flex-1 bg-transparent text-body text-text-primary placeholder:text-text-muted focus:outline-none"
            />
          </div>
          {/* Folder list */}
          <div className="max-h-64 overflow-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-small text-text-tertiary">No folders found</p>
            ) : (
              filtered.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleSelect(f.id)}
                  className="flex h-8 w-full items-center gap-2 rounded-xs px-2 text-body text-text-secondary hover:bg-surface-3 hover:text-text-primary"
                >
                  <Folder size={12} className="shrink-0 text-text-tertiary" />
                  {f.name}
                </button>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
