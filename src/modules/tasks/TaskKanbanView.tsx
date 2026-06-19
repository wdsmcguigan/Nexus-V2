/**
 * Tasks kanban board. Columns = TASK_STATUSES; drag a card between columns to
 * change its status (via SET_TASK_STATUS mutation). No intra-column reorder.
 */
import * as React from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { localStore } from "@/storage/local";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useTasksByStatus } from "@/modules/tasks/hooks";
import { TASK_STATUSES, TASK_STATUS_LABEL } from "@/modules/tasks/model";
import { setTaskStatusMutation } from "@/modules/tasks/mutations";
import type { Task, TaskStatus } from "@/data/types";

/** Given the dragged task's current status and the column it was dropped on,
 *  return the new status to apply, or null if the drop is invalid or a no-op. */
export function resolveStatusDrag(current: TaskStatus, overColumnId: string): TaskStatus | null {
  if (!(TASK_STATUSES as string[]).includes(overColumnId)) return null;
  const target = overColumnId as TaskStatus;
  return target === current ? null : target;
}

/** Priority → link-color hue (1 = most urgent). Matches TaskRow. */
const PRIORITY_COLOR: Record<NonNullable<Task["priority"]>, string> = {
  1: "var(--color-link-1)",
  2: "oklch(0.66 0.16 55)",
  3: "var(--color-link-13)",
  4: "var(--color-text-muted)",
};

// ─── Kanban card ──────────────────────────────────────────────────────────────

function TaskCardBody({ task, isDragging }: { task: Task; isDragging?: boolean }) {
  const isDone = task.status === "completed";
  return (
    <div
      className={cn(
        "rounded-md border bg-surface-2 p-2.5 shadow-sm",
        "cursor-pointer transition-all duration-fast",
        "border-border-subtle hover:border-border-default",
        isDragging && "opacity-50 ring-2 ring-accent",
      )}
    >
      <div className="flex items-start gap-2">
        {task.priority != null && (
          <span
            className="mt-1.5 size-2 shrink-0 rounded-full"
            style={{ backgroundColor: PRIORITY_COLOR[task.priority] }}
            aria-hidden
          />
        )}
        <p
          className={cn(
            "min-w-0 flex-1 text-body",
            isDone ? "text-text-muted line-through" : "text-text-primary",
          )}
        >
          {task.title}
        </p>
      </div>

      {task.dueAt != null && (
        <div className="mt-1.5 font-mono text-mono-xs text-text-muted">
          {formatRelativeTime(new Date(task.dueAt))}
        </div>
      )}
    </div>
  );
}

function DraggableTaskCard({ task, onSelect }: { task: Task; onSelect: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onSelect(task.id)}
    >
      <TaskCardBody task={task} isDragging={isDragging} />
    </div>
  );
}

// ─── Kanban column ────────────────────────────────────────────────────────────

interface ColumnProps {
  columnId: TaskStatus;
  title: string;
  tasks: Task[];
  onSelect: (id: string) => void;
}

function TaskKanbanColumn({ columnId, title, tasks, onSelect }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });

  return (
    <div className="flex w-64 shrink-0 flex-col rounded-lg border border-border-subtle bg-surface-1">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="font-mono text-mono-sm font-medium text-text-secondary">{title}</span>
        <span className="ml-auto font-mono text-mono-xs text-text-muted">{tasks.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "nx-scroll flex flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors",
          isOver && "bg-accent/5",
        )}
        style={{ minHeight: 120 }}
      >
        {tasks.length === 0 ? (
          <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-border-subtle text-small text-text-muted">
            Drop here
          </div>
        ) : (
          tasks.map((task) => (
            <DraggableTaskCard key={task.id} task={task} onSelect={onSelect} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function TaskKanbanView({ onSelect }: { onSelect: (id: string) => void }) {
  const grouped = useTasksByStatus();
  const [activeTask, setActiveTask] = React.useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const columns = TASK_STATUSES.map((s) => ({
    id: s,
    title: TASK_STATUS_LABEL[s],
    tasks: grouped.get(s) ?? [],
  }));

  function handleDragStart(event: DragStartEvent) {
    const task = (event.active.data.current as { task: Task } | undefined)?.task;
    if (task) setActiveTask(task);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const task = (event.active.data.current as { task: Task } | undefined)?.task;
    if (!task || !event.over) return;
    const next = resolveStatusDrag(task.status, String(event.over.id));
    if (next) setTaskStatusMutation(task.id, next, localStore);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="nx-scroll flex h-full gap-4 overflow-x-auto p-4">
        {columns.map(({ id, title, tasks }) => (
          <TaskKanbanColumn
            key={id}
            columnId={id}
            title={title}
            tasks={tasks}
            onSelect={onSelect}
          />
        ))}
      </div>

      <DragOverlay>{activeTask && <TaskCardBody task={activeTask} />}</DragOverlay>
    </DndContext>
  );
}
