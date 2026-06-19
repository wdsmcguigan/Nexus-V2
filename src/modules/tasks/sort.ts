import { TASK_STATUSES } from "@/modules/tasks/model";
import type { Task, TaskStatus } from "@/data/types";

/** Sort tasks by manual order, then creation time. Pure (testable without React). */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

/** Group tasks by status — every status in TASK_STATUSES gets an entry (possibly empty),
 *  each list sorted by sortTasks. Pure (testable without React). */
export function groupTasksByStatus(tasks: Task[]): Map<TaskStatus, Task[]> {
  const map = new Map<TaskStatus, Task[]>();
  for (const s of TASK_STATUSES) map.set(s, []);
  for (const t of tasks) {
    if (!map.has(t.status)) map.set(t.status, []);
    map.get(t.status)!.push(t);
  }
  for (const [k, list] of map) map.set(k, sortTasks(list));
  return map;
}
