import { useEffect, useRef, useState } from "react";
import { X, Trash2 } from "lucide-react";
import { localStore } from "@/storage/local";
import { useWorkspace } from "@/state/workspace";
import { Button } from "@/components/ui/Button";
import { useTask } from "@/modules/tasks/hooks";
import { TASK_STATUSES, TASK_STATUS_LABEL } from "@/modules/tasks/model";
import {
  setTaskFieldsMutation,
  setTaskStatusMutation,
  deleteTaskMutation,
} from "@/modules/tasks/mutations";
import { taskLinkedItems, type LinkedItem } from "@/modules/tasks/links";
import type { TaskStatus } from "@/data/types";

function openLinkedItem(item: LinkedItem): void {
  const ws = useWorkspace.getState();
  if (item.entityType === "nexus/email.message") ws.setSelectedEmail(item.entityId);
  else if (item.entityType === "nexus/contact") ws.openContactsPanel(item.entityId);
  else if (item.entityType === "nexus/calendar.event") ws.openCalendarPanel();
}

interface TaskDetailProps {
  taskId: string;
  onClose: () => void;
}

function dueToInput(dueAt: number | null): string {
  return dueAt != null ? new Date(dueAt).toISOString().slice(0, 10) : "";
}

export function TaskDetail({ taskId, onClose }: TaskDetailProps) {
  const task = useTask(taskId);
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");

  // Resync local draft state when the underlying task changes (id swap or remote edit).
  // Guard: only adopt the incoming server value if the user's draft hasn't diverged,
  // so an undo/relay sync doesn't clobber a title or notes edit in progress.
  const prevTaskRef = useRef(task);
  useEffect(() => {
    const prev = prevTaskRef.current;
    prevTaskRef.current = task;
    if (!task) return;
    if (prev?.id !== task.id) {
      // switched to a different task — load its values
      setTitle(task.title);
      setNotes(task.notes ?? "");
      return;
    }
    // same task: only adopt the incoming server value if the user's draft
    // hasn't diverged from the previous server value (avoids clobbering an edit).
    if (title === (prev?.title ?? "")) setTitle(task.title);
    if (notes === (prev?.notes ?? "")) setNotes(task.notes ?? "");
  }, [task, title, notes]);

  if (!task) return null;

  // Recomputes on every useTask version-bump re-render — no extra hook needed.
  const linked = taskLinkedItems(localStore, taskId);

  function commitTitle() {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task!.title) {
      setTaskFieldsMutation(taskId, { title: trimmed }, localStore);
    } else {
      setTitle(task!.title);
    }
  }

  function commitNotes() {
    if (notes !== (task!.notes ?? "")) {
      setTaskFieldsMutation(taskId, { notes: notes || null }, localStore);
    }
  }

  function handleDelete() {
    deleteTaskMutation(taskId, localStore);
    onClose();
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-mono-sm uppercase tracking-[0.04em] text-text-muted">
          Task
        </span>
        <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-full bg-transparent text-h3 font-semibold text-text-primary focus:outline-none"
      />

      <label className="flex flex-col gap-1 text-small text-text-secondary">
        Status
        <select
          value={task.status}
          onChange={(e) => setTaskStatusMutation(taskId, e.target.value as TaskStatus, localStore)}
          className="h-ctrl-md rounded-sm border border-border-default bg-surface-2 px-2 text-body text-text-primary focus:border-accent focus:outline-none"
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-small text-text-secondary">
        Priority
        <select
          value={task.priority ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            const n = v ? Number(v) : null;
            const priority = (n === 1 || n === 2 || n === 3 || n === 4) ? n : null; // options are 1–4 only
            setTaskFieldsMutation(taskId, { priority }, localStore);
          }}
          className="h-ctrl-md rounded-sm border border-border-default bg-surface-2 px-2 text-body text-text-primary focus:border-accent focus:outline-none"
        >
          <option value="">None</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-small text-text-secondary">
        Due
        <input
          type="date"
          value={dueToInput(task.dueAt)}
          // Due dates store UTC midnight of the chosen day; dueToInput uses toISOString
          // for a consistent round-trip. Display paths must use the same (UTC) basis.
          onChange={(e) => {
            const v = e.target.value;
            setTaskFieldsMutation(taskId, { dueAt: v ? Date.parse(v) : null }, localStore);
          }}
          className="h-ctrl-md rounded-sm border border-border-default bg-surface-2 px-2 text-body text-text-primary focus:border-accent focus:outline-none"
        />
      </label>

      <label className="flex flex-1 flex-col gap-1 text-small text-text-secondary">
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
          className="nx-scroll min-h-24 flex-1 resize-none rounded-sm border border-border-default bg-surface-2 px-2 py-1.5 text-body text-text-primary focus:border-accent focus:outline-none"
        />
      </label>

      {linked.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-small text-text-secondary">Linked</span>
          {linked.map((item) => (
            <button
              key={item.linkId}
              type="button"
              onClick={() => openLinkedItem(item)}
              className="truncate rounded-sm border border-border-default bg-surface-2 px-2 py-1 text-left text-body text-text-primary hover:border-accent focus:border-accent focus:outline-none"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <Button variant="destructive" size="sm" onClick={handleDelete}>
        <Trash2 />
        Delete
      </Button>
    </div>
  );
}
