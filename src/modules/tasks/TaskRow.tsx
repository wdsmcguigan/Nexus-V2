import { localStore } from "@/storage/local";
import { cn, formatRelativeTime } from "@/lib/utils";
import { setTaskStatusMutation } from "@/modules/tasks/mutations";
import type { Task } from "@/data/types";

interface TaskRowProps {
  task: Task;
  isSelected?: boolean;
  onSelect: (id: string) => void;
}

/** Priority → link-color hue (1 = most urgent). null priorities render no dot. */
const PRIORITY_COLOR: Record<NonNullable<Task["priority"]>, string> = {
  1: "var(--color-link-1)",
  2: "oklch(0.66 0.16 55)",
  3: "var(--color-link-13)",
  4: "var(--color-text-muted)",
};

export function TaskRow({ task, isSelected, onSelect }: TaskRowProps) {
  const isDone = task.status === "completed";

  function handleToggle(checked: boolean) {
    setTaskStatusMutation(task.id, checked ? "completed" : "needs-action", localStore);
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5",
        "cursor-pointer transition-colors duration-fast",
        isSelected ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-surface-2",
      )}
      onClick={() => onSelect(task.id)}
    >
      <input
        type="checkbox"
        aria-label={`Toggle ${task.title}`}
        checked={isDone}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => handleToggle(e.target.checked)}
        className="size-3.5 shrink-0 cursor-pointer accent-accent"
      />

      {task.priority != null && (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: PRIORITY_COLOR[task.priority] }}
          aria-hidden
        />
      )}

      <span
        className={cn(
          "min-w-0 flex-1 truncate text-body",
          isDone ? "text-text-muted line-through" : "text-text-primary",
        )}
      >
        {task.title}
      </span>

      {task.dueAt != null && (
        <span className="shrink-0 font-mono text-mono-xs text-text-muted">
          {formatRelativeTime(new Date(task.dueAt))}
        </span>
      )}
    </div>
  );
}
