import { cn, formatRelativeTime } from "@/lib/utils";
import { noteSnippet } from "@/modules/notes/noteSort";
import type { Note } from "@/data/types";

interface NoteRowProps {
  note: Note;
  isSelected?: boolean;
  onSelect: (id: string) => void;
}

export function NoteRow({ note, isSelected, onSelect }: NoteRowProps) {
  const snippet = noteSnippet(note.body);
  return (
    <button
      type="button"
      onClick={() => onSelect(note.id)}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors duration-fast",
        isSelected ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-surface-2",
      )}
    >
      <span className="truncate text-body font-medium text-text-primary">{note.title || "Untitled"}</span>
      <span className="truncate text-small text-text-muted">{snippet || "No content"}</span>
      <span className="font-mono text-mono-xs text-text-muted">{formatRelativeTime(new Date(note.updatedAt))}</span>
    </button>
  );
}
