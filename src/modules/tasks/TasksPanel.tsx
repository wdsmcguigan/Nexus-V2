import { useState } from "react";
import type { IDockviewPanelProps } from "dockview";
import { cn } from "@/lib/utils";
import { useTask } from "@/modules/tasks/hooks";
import { TaskListView } from "@/modules/tasks/TaskListView";
import { TaskKanbanView } from "@/modules/tasks/TaskKanbanView";
import { TaskDetail } from "@/modules/tasks/TaskDetail";

type View = "list" | "kanban";

/**
 * Tasks dock panel. Hosts a list/kanban view toggle, task selection, and an
 * in-panel detail side column. Contributed by the org.nexus.tasks module.
 */
export function TasksPanel(_: IDockviewPanelProps) {
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Only show the detail column when the selected task still exists.
  const selectedTask = useTask(selectedId ?? "");
  const showDetail = selectedId != null && selectedTask != null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <h2 className="text-h3 font-semibold text-text-primary">Tasks</h2>
        <div className="flex items-center gap-1 rounded-md bg-surface-2 p-0.5">
          {(["list", "kanban"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-sm px-2.5 py-1 text-small font-medium transition-colors duration-fast",
                view === v
                  ? "bg-surface-1 text-text-primary shadow-sm"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {v === "list" ? "List" : "Kanban"}
            </button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {view === "list" ? (
            <TaskListView selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <TaskKanbanView onSelect={setSelectedId} />
          )}
        </div>

        {showDetail && (
          <div className="w-80 shrink-0 border-l border-border-subtle">
            <TaskDetail taskId={selectedId} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
