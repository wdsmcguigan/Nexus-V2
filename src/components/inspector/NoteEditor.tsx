/**
 * INS-NOTE-EDITOR — Markdown note editor for NTE axis.
 * Auto-saves via SET_NOTE mutation with 600ms debounce.
 * EP-3: toggle between edit and rendered markdown preview (via `marked`).
 */
import * as React from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";

// Configure marked once: no async, sanitize links
marked.setOptions({ async: false });

interface NoteEditorProps {
  messageId: string;
  notes: string | null;
}

export function NoteEditor({ messageId, notes }: NoteEditorProps) {
  const setNote = useWorkspace((s) => s.setNote);
  const [value, setValue] = React.useState(notes ?? "");
  const [dirty, setDirty] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    setValue(notes ?? "");
    setDirty(false);
    setPreviewing(false);
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

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const charCount = value.length;
  const previewHtml = previewing && value.trim()
    ? DOMPurify.sanitize(marked.parse(value) as string)
    : null;

  return (
    <div className="flex flex-col gap-1">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <span className="text-caption text-text-muted">Markdown</span>
        {value.trim() && (
          <button
            type="button"
            onClick={() => setPreviewing((v) => !v)}
            className={cn(
              "rounded-xs px-1.5 py-0.5 text-caption transition-colors",
              previewing
                ? "bg-accent-soft text-accent"
                : "text-text-tertiary hover:text-text-secondary",
            )}
          >
            {previewing ? "Edit" : "Preview"}
          </button>
        )}
      </div>

      {/* Edit / preview area */}
      {previewing && previewHtml ? (
        <div
          dangerouslySetInnerHTML={{ __html: previewHtml }}
          className={cn(
            "min-h-[96px] rounded-xs border border-border-subtle bg-surface-1 p-2",
            "prose prose-sm prose-invert max-w-none",
            "[&_p]:my-1 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm",
            "[&_code]:font-mono [&_code]:text-mono-xs [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:rounded-xs",
            "[&_a]:text-accent [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4",
            "text-small text-text-primary",
          )}
        />
      ) : (
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
      )}

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
