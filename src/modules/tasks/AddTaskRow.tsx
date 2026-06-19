import { useState } from "react";
import { Plus } from "lucide-react";
import { localStore } from "@/storage/local";
import { createTaskMutation } from "@/modules/tasks/mutations";
import type { TaskStatus } from "@/data/types";

interface AddTaskRowProps {
  status: TaskStatus;
}

export function AddTaskRow({ status }: AddTaskRowProps) {
  const [value, setValue] = useState("");

  function commit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    createTaskMutation({ title: trimmed, status }, localStore);
    setValue("");
  }

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-text-muted focus-within:text-text-secondary">
      <Plus size={14} className="shrink-0" aria-hidden />
      <input
        type="text"
        value={value}
        placeholder="Add task…"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className="min-w-0 flex-1 bg-transparent text-body text-text-primary placeholder:text-text-muted focus:outline-none"
      />
    </div>
  );
}
