import { useMemo } from "react";
import { localStore } from "@/storage/local";
import { useStoreVersion } from "@/storage/useStore";
import { sortTasks, groupTasksByStatus } from "@/modules/tasks/sort";
import type { Task, TaskStatus } from "@/data/types";

export { sortTasks, groupTasksByStatus };

/** All tasks, sorted. */
export function useTasks(): Task[] {
  const v = useStoreVersion();
  return useMemo(() => sortTasks(Array.from(localStore.tasks.values())), [v]);
}

/** Tasks grouped by status. */
export function useTasksByStatus(): Map<TaskStatus, Task[]> {
  const v = useStoreVersion();
  return useMemo(() => groupTasksByStatus(Array.from(localStore.tasks.values())), [v]);
}

/** A single task by id (reactive), or undefined. */
export function useTask(id: string): Task | undefined {
  const v = useStoreVersion();
  return useMemo(() => localStore.tasks.get(id), [v, id]);
}
