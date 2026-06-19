import type { Task, TaskStatus } from "@/data/types";
import type { LocalStore } from "@/storage/local";
import { recordMutation, type ModuleInverseBuilder } from "@/state/mutations";
import { makeTask, type TaskFields } from "@/modules/tasks/model";

export const TASKS_NS = "org.nexus.tasks";
export const KIND = {
  CREATE: `${TASKS_NS}/CREATE_TASK`,
  STATUS: `${TASKS_NS}/SET_TASK_STATUS`,
  FIELDS: `${TASKS_NS}/SET_TASK_FIELDS`,
  REORDER: `${TASKS_NS}/REORDER_TASK`,
  DELETE: `${TASKS_NS}/DELETE_TASK`,
} as const;

/** Create a task (records CREATE_TASK). Returns the created Task. */
export function createTaskMutation(input: Partial<Task> & { title: string }, store: LocalStore): Task {
  const t = makeTask(input, store.vault?.id ?? "local", Date.now());
  recordMutation(KIND.CREATE, t, store);
  return t;
}
export function setTaskStatusMutation(taskId: string, status: TaskStatus, store: LocalStore): void {
  recordMutation(KIND.STATUS, { taskId, status }, store);
}
export function setTaskFieldsMutation(taskId: string, fields: TaskFields, store: LocalStore): void {
  recordMutation(KIND.FIELDS, { taskId, fields }, store);
}
export function reorderTaskMutation(taskId: string, order: number, status: TaskStatus | undefined, store: LocalStore): void {
  recordMutation(KIND.REORDER, status ? { taskId, order, status } : { taskId, order }, store);
}
export function deleteTaskMutation(taskId: string, store: LocalStore): void {
  recordMutation(KIND.DELETE, { taskId }, store);
}

/** Inverse builder — captures prior state BEFORE the mutation applies (substrate §4.3). */
export const tasksInverse: ModuleInverseBuilder = (kind, payload, store) => {
  const s = store as LocalStore;
  switch (kind) {
    case KIND.CREATE: {
      const t = payload as Task;
      return { reverseSteps: [{ kind: KIND.DELETE, payload: { taskId: t.id } }], description: "Create task" };
    }
    case KIND.STATUS: {
      const p = payload as { taskId: string; status: TaskStatus };
      const prev = s.tasks.get(p.taskId);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.STATUS, payload: { taskId: p.taskId, status: prev.status } }], description: "Change task status" };
    }
    case KIND.FIELDS: {
      const p = payload as { taskId: string; fields: TaskFields };
      const prev = s.tasks.get(p.taskId);
      if (!prev) return null;
      const priorFields: TaskFields = {};
      for (const k of Object.keys(p.fields) as Array<keyof TaskFields>) {
        (priorFields as Record<string, unknown>)[k] = prev[k];
      }
      return { reverseSteps: [{ kind: KIND.FIELDS, payload: { taskId: p.taskId, fields: priorFields } }], description: "Edit task" };
    }
    case KIND.REORDER: {
      const p = payload as { taskId: string; order: number; status?: TaskStatus };
      const prev = s.tasks.get(p.taskId);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.REORDER, payload: { taskId: p.taskId, order: prev.order, status: prev.status } }], description: "Reorder task" };
    }
    case KIND.DELETE: {
      const p = payload as { taskId: string };
      const prev = s.tasks.get(p.taskId);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.CREATE, payload: prev }], description: "Delete task" };
    }
  }
  return null;
};
