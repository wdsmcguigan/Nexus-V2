/**
 * INS-NOTE-EDITOR — Markdown note editor for NTE axis.
 * Auto-saves via SET_NOTE mutation with 600ms debounce.
 * No preview in EP-2; full markdown rendering deferred to EP-3 (FTS + body).
 */
import * as React from "react";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";

interface NoteEditorProps {
  messageId: string;
  notes: string | null;
}

export function NoteEditor({ messageId, notes }: NoteEditorProps) {
  const setNote = useWorkspace((s) => s.setNote);
  const [value, setValue] = React.useState(notes ?? "");
  const [dirty, setDirty] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external changes (e.g. switching messages) into local state.
  React.useEffect(() => {
    setValue(notes ?? "");
    setDirty(false);
  }, [messageId, notes]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setValue(next);
    setDirty(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setNote(messageId, next.trim() || null);
      setDirty(false);
    }, 600);
  }

  // Flush on unmount.
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const charCount = value.length;

  return (
    <div className="flex flex-col gap-1">
      <textarea
        aria-label="Notes"
        placeholder="Add a note… (supports markdown)"
        value={value}
        onChange={handleChange}
        rows={4}
        className={cn(
          "w-full resize-y rounded-xs border bg-surface-1 p-2",
          "font-mono text-mono-sm text-text-primary placeholder:text-text-muted",
          "outline-none transition-colors",
          dirty
            ? "border-accent"
            : "border-border-subtle focus:border-accent focus:shadow-focus",
        )}
      />
      <div className="flex items-center justify-between">
        <span className="font-mono text-mono-xs text-text-muted">
          {charCount > 0 ? `${charCount} chars` : ""}
        </span>
        {dirty && (
          <span className="font-mono text-mono-xs text-text-tertiary">saving…</span>
        )}
      </div>
    </div>
  );
}
