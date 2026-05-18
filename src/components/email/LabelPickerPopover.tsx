/**
 * Floating label picker — shows all user labels, toggles them on/off for a message.
 * Also exports LabelPickerDialog for the keyboard-shortcut (L key) entry point.
 */
import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import { Tag as TagIcon, Check, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { useUserLabels } from "@/storage/useStore";
import { useMessage } from "@/storage/useStore";
import { localStore } from "@/storage/local";
import { addLabel, removeLabel, createLabel } from "@/state/mutations";
import { cn } from "@/lib/utils";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function getMsgLabelIds(messageId: string): Set<string> {
  const result = new Set<string>();
  for (const [lid, ids] of localStore.messagesByLabel.entries()) {
    if (ids.has(messageId)) result.add(lid);
  }
  return result;
}

// ─── Inner picker UI (shared between popover and dialog) ─────────────────────

interface PickerBodyProps {
  /** Single message ID (legacy usage). */
  messageId?: string | null;
  /** Multiple message IDs — used from bulk-action bar. */
  messageIds?: string[];
  onClose?: () => void;
}

function LabelPickerBody({ messageId, messageIds, onClose }: PickerBodyProps) {
  const labels = useUserLabels();
  useMessage(messageId ?? null);
  // For single-message mode, show current state; for bulk, no pre-selection.
  const msgLabelIds = messageId ? getMsgLabelIds(messageId) : new Set<string>();
  const effectiveIds: string[] = messageIds ?? (messageId ? [messageId] : []);

  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    // Auto-focus the search field when the picker opens
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? labels.filter((l) => l.name.toLowerCase().includes(q))
    : labels;

  const exactMatch = labels.some((l) => l.name.toLowerCase() === q);
  const canCreate = q.length > 0 && !exactMatch;

  function handleToggle(labelId: string, active: boolean) {
    if (effectiveIds.length === 0) return;
    for (const mid of effectiveIds) {
      if (active) removeLabel(localStore, mid, labelId);
      else addLabel(localStore, mid, labelId);
    }
  }

  function handleCreate() {
    if (!q) return;
    const name = query.trim();
    const id = `lbl-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    const vaultId = localStore.vault?.id ?? "local";
    const position = labels.length;
    const color = (position % 21) + 1;
    createLabel(localStore, { id, vaultId, name, color, kind: "user", position });
    for (const mid of effectiveIds) addLabel(localStore, mid, id);
    setQuery("");
    onClose?.();
  }

  return (
    <div className="flex flex-col">
      {/* Search / create input */}
      <div className="flex items-center gap-1.5 border-b border-border-subtle px-2 py-1.5">
        <Search size={11} className="shrink-0 text-text-tertiary" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search or create…"
          className="min-w-0 flex-1 bg-transparent text-body text-text-primary outline-none placeholder:text-text-tertiary"
          onKeyDown={(e) => {
            if (e.key === "Enter" && canCreate) { e.preventDefault(); handleCreate(); }
            if (e.key === "Escape") { e.preventDefault(); onClose?.(); }
          }}
        />
      </div>

      {/* Scrollable label list */}
      <div className="max-h-64 overflow-y-auto py-1">
        {filtered.length === 0 && !canCreate && (
          <p className="px-2 py-1.5 text-body text-text-tertiary">No labels yet</p>
        )}
        {filtered.map((lbl) => {
          const active = msgLabelIds.has(lbl.id);
          return (
            <button
              key={lbl.id}
              type="button"
              onClick={() => handleToggle(lbl.id, active)}
              className="flex h-8 w-full items-center gap-2 rounded-xs px-2 text-body text-text-secondary hover:bg-surface-3 hover:text-text-primary"
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: `var(--color-link-${lbl.color})` }}
              />
              <span className="flex-1 text-left">{lbl.name}</span>
              {active && <Check size={11} className="shrink-0 text-accent" />}
            </button>
          );
        })}
      </div>

      {/* Create new label row */}
      {canCreate && (
        <div className="border-t border-border-subtle pt-1 pb-1">
          <button
            type="button"
            onClick={handleCreate}
            className="flex h-8 w-full items-center gap-2 rounded-xs px-2 text-body text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          >
            <Plus size={12} className="shrink-0 text-accent" />
            <span className="flex-1 text-left">
              Create <span className="font-medium text-text-primary">"{query.trim()}"</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── LabelPickerPopover ───────────────────────────────────────────────────────

interface PopoverProps {
  messageId?: string | null;
  /** Multiple message IDs for bulk label actions. */
  messageIds?: string[];
  variant?: "icon" | "menu-item" | "button";
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}

export function LabelPickerPopover({
  messageId,
  messageIds,
  variant = "icon",
  open,
  onOpenChange,
}: PopoverProps) {
  const trigger =
    variant === "icon" ? (
      <span>
        <Tooltip label="Apply label" shortcut="L">
          <Button variant="ghost" size="sm" iconOnly aria-label="Apply label">
            <TagIcon />
          </Button>
        </Tooltip>
      </span>
    ) : variant === "button" ? (
      <Button variant="ghost" size="xs" aria-label="Tag">
        <TagIcon />
        Tag
      </Button>
    ) : (
      <button
        type="button"
        className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary hover:bg-surface-3 hover:text-text-primary"
      >
        <TagIcon size={12} />
        Label…
      </button>
    );

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="end"
          className={cn(
            "z-50 w-56 overflow-hidden rounded-md border border-border-subtle bg-surface-2 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          <LabelPickerBody
            messageId={messageId}
            messageIds={messageIds}
            onClose={() => onOpenChange?.(false)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── LabelPickerDialog ────────────────────────────────────────────────────────

interface DialogProps {
  messageId: string | null;
  open: boolean;
  onClose: () => void;
}

export function LabelPickerDialog({ messageId, open, onClose }: DialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-56 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border border-border-subtle bg-surface-2 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <Dialog.Title className="sr-only">Apply label</Dialog.Title>
          <LabelPickerBody messageId={messageId} onClose={onClose} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
