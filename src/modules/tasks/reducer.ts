import type { ModuleReducer } from "@/state/moduleReducers";
import type { LocalStore } from "@/storage/local";
import type { Task, TaskStatus } from "@/data/types";
import { type TaskFields } from "@/modules/tasks/model";

// NOTE: SET_TASK_STATUS / SET_TASK_FIELDS / REORDER_TASK do NOT currently bump
// `updatedAt` (only CREATE_TASK sets it, via makeTask). When a UI needs a
// "last modified" timestamp, stamp `updatedAt` in the mutation HELPER payload at
// record-time (mutations.ts) and restore the prior value in the inverse — do NOT
// compute Date.now() here, which would break replay determinism (replay must be pure).
function patch(store: LocalStore, taskId: string, change: Partial<Task>): void {
  const prev = store.tasks.get(taskId);
  if (!prev) return;
  store.putTask({ ...prev, ...change, updatedAt: change.updatedAt ?? prev.updatedAt });
}

export const tasksReducer: ModuleReducer = {
  apply(kind, payload, store) {
    const local = store as LocalStore;
    switch (kind) {
      case "org.nexus.tasks/CREATE_TASK":
        local.putTask(payload as Task);
        break;
      case "org.nexus.tasks/SET_TASK_STATUS": {
        const p = payload as { taskId: string; status: TaskStatus };
        patch(local, p.taskId, { status: p.status });
        break;
      }
      case "org.nexus.tasks/SET_TASK_FIELDS": {
        const p = payload as { taskId: string; fields: TaskFields };
        patch(local, p.taskId, p.fields);
        break;
      }
      case "org.nexus.tasks/REORDER_TASK": {
        const p = payload as { taskId: string; order: number; status?: TaskStatus };
        patch(local, p.taskId, p.status ? { order: p.order, status: p.status } : { order: p.order });
        break;
      }
      case "org.nexus.tasks/DELETE_TASK": {
        const p = payload as { taskId: string };
        local.deleteTask(p.taskId);
        break;
      }
    }
  },
};
