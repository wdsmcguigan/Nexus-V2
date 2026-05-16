/**
 * Floating label picker — shows all user labels, toggles them on/off for a message.
 * Also exports LabelPickerDialog for the keyboard-shortcut (L key) entry point.
 */
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import { Tag as TagIcon, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { useUserLabels } from "@/storage/useStore";
import { useMessage } from "@/storage/useStore";
import { localStore } from "@/storage/local";
import { addLabel, removeLabel } from "@/state/mutations";
import { cn } from "@/lib/utils";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function getMsgLabelIds(messageId: string): Set<string> {
  const result = new Set<string>();
  for (const [lid, ids] of localStore.messagesByLabel.entries()) {
    if (ids.has(messageId)) result.add(lid);
  }
  return result;
}

// ─── LabelPickerPopover ───────────────────────────────────────────────────────

interface PopoverProps {
  messageId: string | null;
  /** "icon" = toolbar icon button (default); "menu-item" = plain clickable row */
  variant?: "icon" | "menu-item";
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}

export function LabelPickerPopover({
  messageId,
  variant = "icon",
  open,
  onOpenChange,
}: PopoverProps) {
  const labels = useUserLabels();
  // Subscribe to store so active-label dots update reactively
  useMessage(messageId);
  const msgLabelIds = messageId ? getMsgLabelIds(messageId) : new Set<string>();

  if (labels.length === 0) return null;

  const trigger =
    variant === "icon" ? (
      <span>
        <Tooltip label="Apply label" shortcut="L">
          <Button variant="ghost" size="sm" iconOnly aria-label="Apply label">
            <TagIcon />
          </Button>
        </Tooltip>
      </span>
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
            "z-50 w-52 overflow-hidden rounded-md border border-border-subtle bg-surface-2 p-1 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          {labels.map((lbl) => {
            const active = msgLabelIds.has(lbl.id);
            return (
              <button
                key={lbl.id}
                type="button"
                onClick={() => {
                  if (!messageId) return;
                  if (active) removeLabel(localStore, messageId, lbl.id);
                  else addLabel(localStore, messageId, lbl.id);
                }}
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── LabelPickerDialog ────────────────────────────────────────────────────────
// Used by the keyboard shortcut (L key) in EmailListPanel — centres on screen.

interface DialogProps {
  messageId: string | null;
  open: boolean;
  onClose: () => void;
}

export function LabelPickerDialog({ messageId, open, onClose }: DialogProps) {
  const labels = useUserLabels();
  // Subscribe to store so active-label dots update reactively
  useMessage(messageId);
  const msgLabelIds = messageId ? getMsgLabelIds(messageId) : new Set<string>();

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-52 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border border-border-subtle bg-surface-2 p-1 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <Dialog.Title className="sr-only">Apply label</Dialog.Title>
          {labels.length === 0 ? (
            <p className="px-2 py-1.5 text-body text-text-tertiary">No labels yet</p>
          ) : (
            labels.map((lbl) => {
              const active = msgLabelIds.has(lbl.id);
              return (
                <button
                  key={lbl.id}
                  type="button"
                  onClick={() => {
                    if (!messageId) return;
                    if (active) removeLabel(localStore, messageId, lbl.id);
                    else addLabel(localStore, messageId, lbl.id);
                  }}
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
            })
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
