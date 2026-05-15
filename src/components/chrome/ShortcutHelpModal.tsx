/**
 * Keyboard shortcut reference modal — triggered by pressing `?`.
 * Groups shortcuts by context; dismisses with Escape or click-outside.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/utils";

// ─── Shortcut data ────────────────────────────────────────────────────────────

interface ShortcutEntry {
  keys: string[];
  label: string;
}

const SECTIONS: { title: string; items: ShortcutEntry[] }[] = [
  {
    title: "Navigation",
    items: [
      { keys: ["J", "↓"], label: "Next message" },
      { keys: ["K", "↑"], label: "Previous message" },
      { keys: ["⌘K"], label: "Open command palette / global search" },
      { keys: ["/"], label: "Focus list search" },
      { keys: ["Esc"], label: "Clear selection" },
    ],
  },
  {
    title: "Message actions",
    items: [
      { keys: ["R"], label: "Reply" },
      { keys: ["F"], label: "Forward" },
      { keys: ["E"], label: "Archive" },
      { keys: ["#"], label: "Delete" },
      { keys: ["U"], label: "Toggle read / unread" },
      { keys: ["S"], label: "Toggle star" },
      { keys: ["H"], label: "Snooze to tomorrow 8am" },
      { keys: ["C"], label: "Compose new email" },
    ],
  },
  {
    title: "Composer",
    items: [
      { keys: ["⌘↵"], label: "Send" },
      { keys: ["⌘B"], label: "Bold" },
      { keys: ["⌘I"], label: "Italic" },
      { keys: ["⌘U"], label: "Underline" },
      { keys: ["⌘K"], label: "Insert link" },
      { keys: ["Esc"], label: "Discard (with confirmation)" },
    ],
  },
  {
    title: "Selection (multi-select)",
    items: [
      { keys: ["⌘ click"], label: "Toggle individual message" },
      { keys: ["⇧ click"], label: "Select range" },
      { keys: ["Esc"], label: "Clear selection" },
    ],
  },
  {
    title: "App",
    items: [
      { keys: ["⌘,"], label: "Open Settings" },
      { keys: ["?"], label: "Show this help" },
    ],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShortcutHelpModal({ open, onClose }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-border-subtle bg-surface-2 shadow-xl",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-4",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "max-h-[80vh] overflow-auto",
          )}
        >
          {/* Header */}
          <div className="sticky top-0 flex items-center justify-between border-b border-border-subtle bg-surface-2 px-6 py-4">
            <Dialog.Title className="text-body-strong text-text-primary">Keyboard shortcuts</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-xs p-1 text-text-tertiary hover:text-text-primary"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          {/* Shortcut grid */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-0 p-6">
            {SECTIONS.map((section) => (
              <div key={section.title} className="mb-6">
                <div className="mb-2 text-overline uppercase tracking-wider text-text-tertiary">
                  {section.title}
                </div>
                <div className="space-y-1.5">
                  {section.items.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-4">
                      <span className="text-small text-text-secondary">{item.label}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        {item.keys.map((k) => (
                          <Kbd key={k} size="sm">{k}</Kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border-subtle px-6 py-3">
            <p className="text-small text-text-muted">Press <Kbd size="xs">?</Kbd> anywhere to show this panel. Press <Kbd size="xs">Esc</Kbd> to close.</p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
