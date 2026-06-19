import { useTasksByStatus } from "@/modules/tasks/hooks";
import { TASK_STATUSES, TASK_STATUS_LABEL } from "@/modules/tasks/model";
import { TaskRow } from "@/modules/tasks/TaskRow";
import { AddTaskRow } from "@/modules/tasks/AddTaskRow";

interface TaskListViewProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function TaskListView({ selectedId, onSelect }: TaskListViewProps) {
  const groups = useTasksByStatus();

  return (
    <div className="nx-scroll flex h-full flex-col gap-4 overflow-y-auto p-3">
      {TASK_STATUSES.map((status) => {
        const tasks = groups.get(status) ?? [];
        return (
          <section key={status} className="flex flex-col gap-0.5">
            <h3 className="px-2 pb-1 font-mono text-mono-sm font-medium uppercase tracking-[0.04em] text-text-secondary">
              {TASK_STATUS_LABEL[status]}
              <span className="ml-1.5 text-text-muted">{tasks.length}</span>
            </h3>
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                isSelected={task.id === selectedId}
                onSelect={onSelect}
              />
            ))}
            <AddTaskRow status={status} />
          </section>
        );
      })}
    </div>
  );
}
