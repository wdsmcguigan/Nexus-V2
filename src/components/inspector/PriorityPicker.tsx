/**
 * INS-PRIORITY-PICKER — 4-level priority dropdown.
 * SET_PRIORITY / CLEAR_PRIORITY.
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";

interface PriorityPickerProps {
  messageId: string;
  priority: 1 | 2 | 3 | 4 | null;
}

const LEVELS: { value: 1 | 2 | 3 | 4; label: string; color: string }[] = [
  { value: 1, label: "Urgent", color: "text-[oklch(0.62_0.16_25)]" },
  { value: 2, label: "High", color: "text-[oklch(0.62_0.14_78)]" },
  { value: 3, label: "Normal", color: "text-text-secondary" },
  { value: 4, label: "Low", color: "text-text-tertiary" },
];

const BANG_COUNT: Record<number, number> = { 1: 3, 2: 2, 3: 1, 4: 1 };

function PriBadge({ priority }: { priority: 1 | 2 | 3 | 4 | null }) {
  if (!priority) return <span className="text-text-tertiary">No priority</span>;
  const level = LEVELS.find((l) => l.value === priority)!;
  return (
    <span className={cn("font-mono text-mono-xs font-semibold", level.color)}>
      {"!".repeat(BANG_COUNT[priority] ?? 1)} {level.label}
    </span>
  );
}

export function PriorityPicker({ messageId, priority }: PriorityPickerProps) {
  const setPriority = useWorkspace((s) => s.setPriority);
  const clearPriority = useWorkspace((s) => s.clearPriority);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-xs border border-border-subtle px-2",
            "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
            "transition-colors focus-visible:outline-none focus-visible:shadow-focus",
          )}
        >
          <PriBadge priority={priority} />
          <ChevronDown size={11} className="ml-auto opacity-dim" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn(
            "z-50 min-w-[160px] overflow-hidden rounded-md border border-border-subtle",
            "bg-surface-2 p-1 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
          sideOffset={4}
          align="start"
        >
          {LEVELS.map((level) => (
            <DropdownMenu.Item
              key={level.value}
              onSelect={() => setPriority(messageId, level.value)}
              className={cn(
                "flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body outline-none",
                "focus:bg-surface-3",
                priority === level.value && "bg-accent-soft",
              )}
            >
              <span className={cn("w-5 font-mono text-mono-xs font-semibold", level.color)}>
                {"!".repeat(BANG_COUNT[level.value] ?? 1)}
              </span>
              <span className={cn("text-text-secondary", priority === level.value && "text-text-primary")}>
                {level.label}
              </span>
              {priority === level.value && (
                <span className="ml-auto font-mono text-mono-xs text-text-tertiary">✓</span>
              )}
            </DropdownMenu.Item>
          ))}
          {priority && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
              <DropdownMenu.Item
                onSelect={() => clearPriority(messageId)}
                className={cn(
                  "flex h-7 cursor-pointer items-center rounded-xs px-2 text-body text-text-tertiary outline-none",
                  "focus:bg-surface-3 focus:text-text-primary",
                )}
              >
                Clear priority
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
