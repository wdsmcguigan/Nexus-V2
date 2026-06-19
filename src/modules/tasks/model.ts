import type { Task, TaskStatus } from "@/data/types";

/** The task fields editable via SET_TASK_FIELDS. */
export type TaskFields = Partial<Pick<Task, "title" | "dueAt" | "notes" | "priority" | "assignee">>;

/** The task statuses surfaced in the UI (status picker, kanban columns). "cancelled"
 *  is intentionally excluded — it is reserved (per design) and not user-selectable yet. */
export const TASK_STATUSES: TaskStatus[] = ["needs-action", "in-process", "completed"];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  "needs-action": "To do",
  "in-process": "Doing",
  completed: "Done",
  cancelled: "Cancelled",
};

// Monotonic within this module instance (not across module re-evaluation). Combined
// with Date.now() this guarantees unique ids for tasks created in the same tick.
let _seq = 0;
function taskId(): string {
  _seq += 1;
  return `task-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

/** Build a full Task from partial input, filling defaults. */
export function makeTask(input: Partial<Task> & { title: string }, vaultId: string, now: number): Task {
  return {
    id: input.id ?? taskId(),
    vaultId,
    title: input.title,
    status: input.status ?? "needs-action",
    dueAt: input.dueAt ?? null,
    notes: input.notes ?? null,
    priority: input.priority ?? null,
    assignee: input.assignee ?? null,
    order: input.order ?? 0,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}
