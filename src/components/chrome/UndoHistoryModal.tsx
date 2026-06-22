import * as Dialog from "@radix-ui/react-dialog";
import { X, Undo2, Redo2, Clock, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HistoryEntry } from "@/state/mutations";

interface Props {
  open: boolean;
  onClose: () => void;
  undoHistory: HistoryEntry[];
  redoHistory: HistoryEntry[];
  /** Called with the number of steps to undo (1 = most recent). */
  onUndoSteps: (steps: number) => void;
  /** Called with the number of steps to redo (1 = most recent). */
  onRedoSteps: (steps: number) => void;
}

export function UndoHistoryModal({
  open, onClose, undoHistory, redoHistory, onUndoSteps, onRedoSteps,
}: Props) {
  const isEmpty = undoHistory.length === 0 && redoHistory.length === 0;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-border-subtle bg-surface-2 shadow-xl",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-4",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "max-h-[70vh] flex flex-col",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-text-tertiary" />
              <Dialog.Title className="text-body-strong text-text-primary">Action history</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="rounded-xs p-1 text-text-tertiary hover:text-text-primary" aria-label="Close">
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="min-h-0 overflow-y-auto p-4">
            {isEmpty ? (
              <p className="py-6 text-center text-small text-text-muted">Nothing to undo or redo.</p>
            ) : (
              <div className="space-y-3">
                {/* Redo section — top item is next redo */}
                {redoHistory.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-overline uppercase tracking-wider text-text-tertiary">
                      Redo ({redoHistory.length})
                    </div>
                    <div className="space-y-0.5">
                      {redoHistory.map((item, i) => (
                        <RedoItem
                          key={i}
                          item={item}
                          onClick={() => { onRedoSteps(redoHistory.length - i); onClose(); }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* "Now" marker */}
                <div className="flex items-center gap-2 py-1">
                  <div className="h-px flex-1 bg-border-subtle" />
                  <span className="text-caption text-accent font-medium">● Now</span>
                  <div className="h-px flex-1 bg-border-subtle" />
                </div>

                {/* Undo section — most recent at top */}
                {undoHistory.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-overline uppercase tracking-wider text-text-tertiary">
                      Undo ({undoHistory.length})
                    </div>
                    <div className="space-y-0.5">
                      {undoHistory.map((item, i) => (
                        <UndoItem
                          key={i}
                          item={item}
                          onClick={() => { onUndoSteps(i + 1); onClose(); }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border-subtle px-5 py-3">
            <p className="text-small text-text-muted">
              Click an item to undo/redo to that point.
              Press <kbd className="mx-0.5 rounded-xs border border-border-subtle bg-surface-3 px-1 text-caption">Z</kbd> to undo,{" "}
              <kbd className="mx-0.5 rounded-xs border border-border-subtle bg-surface-3 px-1 text-caption">⇧Z</kbd> to redo.
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Row sub-components ───────────────────────────────────────────────────────

function UndoItem({ item, onClick }: { item: HistoryEntry; onClick: () => void }) {
  const disabled = !item.canUndo || item.blocked;

  if (disabled) {
    return (
      <div
        className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 opacity-40"
        title={!item.canUndo ? "This action cannot be undone" : "Blocked by a non-undoable action above"}
      >
        <Ban size={11} className="shrink-0" />
        <span className="text-small text-text-muted line-through">{item.description}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left",
        "text-small text-text-secondary hover:bg-surface-3 hover:text-text-primary",
        "transition-colors",
      )}
    >
      <Undo2 size={11} className="shrink-0 opacity-60" />
      <span>{item.description}</span>
      {item.source === "ai" && (
        <span className="ml-auto rounded-xs border border-accent/40 bg-accent/10 px-1 text-caption text-accent">AI</span>
      )}
    </button>
  );
}

function RedoItem({ item, onClick }: { item: HistoryEntry; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left",
        "text-small text-text-muted hover:bg-surface-3 hover:text-text-primary",
        "transition-colors",
      )}
    >
      <Redo2 size={11} className="shrink-0 opacity-60" />
      <span>{item.description}</span>
      {item.source === "ai" && (
        <span className="ml-auto rounded-xs border border-accent/40 bg-accent/10 px-1 text-caption text-accent">AI</span>
      )}
    </button>
  );
}
