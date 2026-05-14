/**
 * INS-LBL-COMBO — Label add combobox.
 * Filters existing labels, shows "Create new", records ADD_LABEL / CREATE_LABEL.
 */
import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Tags, Plus } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { useLabels } from "@/storage/useStore";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { Label } from "@/data/types";

interface LabelComboboxProps {
  messageId: string;
  /** IDs already applied to this message (to show check + allow remove). */
  activeLabelIds: string[];
}

export function LabelCombobox({ messageId, activeLabelIds }: LabelComboboxProps) {
  const labels = useLabels();
  const addLabel = useWorkspace((s) => s.addLabel);
  const removeLabel = useWorkspace((s) => s.removeLabel);
  const createLabel = useWorkspace((s) => s.createLabel);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const userLabels = labels.filter((l) => l.kind === "user");
  const filtered = query
    ? userLabels.filter((l) => l.name.toLowerCase().includes(query.toLowerCase()))
    : userLabels;
  const showCreate = query.trim().length > 0 && !filtered.some(
    (l) => l.name.toLowerCase() === query.trim().toLowerCase(),
  );

  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
    }
  }, [open]);

  function handleSelect(label: Label) {
    if (activeLabelIds.includes(label.id)) {
      removeLabel(messageId, label.id);
    } else {
      addLabel(messageId, label.id);
    }
  }

  function handleCreate() {
    const name = query.trim();
    if (!name) return;
    const newId = `lbl-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
    const autoColor = ((userLabels.length % 8) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
    createLabel({
      id: newId,
      vaultId: "local",
      name,
      color: autoColor,
      kind: "user",
      position: 999,
    });
    addLabel(messageId, newId);
    setQuery("");
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="xs">
          <Tags />
          Add
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          sideOffset={4}
          align="start"
          className={cn(
            "z-50 w-[220px] overflow-hidden rounded-md border border-border-subtle",
            "bg-surface-2 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="border-b border-border-subtle p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (showCreate) handleCreate();
                  else if (filtered.length === 1) handleSelect(filtered[0]!);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
              placeholder="Search or create label…"
              className={cn(
                "h-6 w-full bg-transparent text-body text-text-primary outline-none",
                "placeholder:text-text-tertiary",
              )}
            />
          </div>
          <div className="max-h-[200px] overflow-auto p-1">
            {filtered.map((label) => {
              const active = activeLabelIds.includes(label.id);
              return (
                <button
                  key={label.id}
                  type="button"
                  onClick={() => handleSelect(label)}
                  className={cn(
                    "flex h-7 w-full items-center gap-2 rounded-xs px-2 text-left text-body",
                    "text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary",
                    active && "text-text-primary",
                  )}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: `var(--color-link-${label.color})` }}
                  />
                  <span className="min-w-0 flex-1 truncate">{label.name}</span>
                  {active && <span className="font-mono text-mono-xs text-text-tertiary">✓</span>}
                </button>
              );
            })}
            {filtered.length === 0 && !showCreate && (
              <div className="px-2 py-3 text-center text-small text-text-tertiary">
                No labels found
              </div>
            )}
            {showCreate && (
              <button
                type="button"
                onClick={handleCreate}
                className={cn(
                  "flex h-7 w-full items-center gap-2 rounded-xs px-2 text-left text-body",
                  "text-text-tertiary transition-colors hover:bg-surface-3 hover:text-text-primary",
                )}
              >
                <Plus size={12} />
                Create "{query.trim()}"
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
