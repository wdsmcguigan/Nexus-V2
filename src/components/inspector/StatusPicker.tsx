/**
 * INS-STATUS-PICKER — Single-select status dropdown.
 * SET_STATUS / CLEAR_STATUS / CREATE_STATUS.
 */
import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Plus } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { useStatuses } from "@/storage/useStore";
import { cn } from "@/lib/utils";

interface StatusPickerProps {
  messageId: string;
  statusId: string | null;
}

function StatusDot({ color }: { color: number }) {
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: `var(--color-link-${color})` }}
    />
  );
}

function CreateStatusForm({ onDone }: { onDone: () => void }) {
  const createStatus = useWorkspace((s) => s.createStatus);
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState(1);
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    ref.current?.focus();
  }, []);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    createStatus({
      id: `sta-${trimmed.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
      vaultId: "local",
      name: trimmed,
      color,
      position: 999,
    });
    onDone();
  }

  return (
    <div className="p-2 space-y-2">
      <input
        ref={ref}
        placeholder="Status name…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          else if (e.key === "Escape") { e.preventDefault(); onDone(); }
        }}
        className={cn(
          "h-6 w-full rounded-xs border border-border-subtle bg-surface-1 px-2 text-body",
          "text-text-primary outline-none placeholder:text-text-tertiary",
        )}
      />
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={cn(
              "size-4 rounded-full border-2 transition-colors",
              color === c ? "border-text-primary" : "border-transparent",
            )}
            style={{ backgroundColor: `var(--color-link-${c})` }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={submit}
        className="h-6 w-full rounded-xs bg-accent px-2 text-body text-text-on-accent hover:opacity-90"
      >
        Create
      </button>
    </div>
  );
}

export function StatusPicker({ messageId, statusId }: StatusPickerProps) {
  const statuses = useStatuses();
  const setStatus = useWorkspace((s) => s.setStatus);
  const clearStatus = useWorkspace((s) => s.clearStatus);
  const [creating, setCreating] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  const current = statuses.find((s) => s.id === statusId);

  return (
    <DropdownMenu.Root open={open} onOpenChange={(v) => { setOpen(v); if (!v) setCreating(false); }}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-xs border border-border-subtle px-2 text-body",
            "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
            "transition-colors focus-visible:outline-none focus-visible:shadow-focus",
          )}
        >
          {current ? (
            <>
              <StatusDot color={current.color} />
              <span>{current.name}</span>
            </>
          ) : (
            <span className="text-text-tertiary">No status</span>
          )}
          <ChevronDown size={11} className="ml-auto opacity-dim" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn(
            "z-50 min-w-[180px] overflow-hidden rounded-md border border-border-subtle",
            "bg-surface-2 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
          sideOffset={4}
          align="start"
        >
          {creating ? (
            <CreateStatusForm onDone={() => { setCreating(false); setOpen(false); }} />
          ) : (
            <div className="p-1">
              {statusId && (
                <DropdownMenu.Item
                  onSelect={() => clearStatus(messageId)}
                  className={cn(
                    "flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body outline-none",
                    "text-text-tertiary focus:bg-surface-3 focus:text-text-primary",
                  )}
                >
                  Clear status
                </DropdownMenu.Item>
              )}
              {statuses.map((s) => (
                <DropdownMenu.Item
                  key={s.id}
                  onSelect={() => setStatus(messageId, s.id)}
                  className={cn(
                    "flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body outline-none",
                    "text-text-secondary focus:bg-surface-3 focus:text-text-primary",
                    s.id === statusId && "text-text-primary",
                  )}
                >
                  <StatusDot color={s.color} />
                  {s.name}
                  {s.id === statusId && (
                    <span className="ml-auto font-mono text-mono-xs text-text-tertiary">✓</span>
                  )}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
              <DropdownMenu.Item
                onSelect={(e) => { e.preventDefault(); setCreating(true); }}
                className={cn(
                  "flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body outline-none",
                  "text-text-tertiary focus:bg-surface-3 focus:text-text-primary",
                )}
              >
                <Plus size={12} />
                Create new status
              </DropdownMenu.Item>
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
