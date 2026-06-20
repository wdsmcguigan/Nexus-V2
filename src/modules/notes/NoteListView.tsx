import { Plus } from "lucide-react";
import { localStore } from "@/storage/local";
import { useNotes } from "@/modules/notes/hooks";
import { createNoteMutation } from "@/modules/notes/mutations";
import { NoteRow } from "@/modules/notes/NoteRow";

interface NoteListViewProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function NoteListView({ selectedId, onSelect }: NoteListViewProps) {
  const notes = useNotes();
  function handleNew() {
    const n = createNoteMutation({}, localStore);
    onSelect(n.id);
  }
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <h2 className="text-h3 font-semibold text-text-primary">Notes</h2>
        <button
          type="button"
          aria-label="New note"
          onClick={handleNew}
          className="flex size-7 items-center justify-center rounded-md bg-surface-2 text-text-secondary hover:text-text-primary"
        >
          <Plus size={16} />
        </button>
      </header>
      <div className="nx-scroll flex-1 overflow-y-auto p-1">
        {notes.length === 0 ? (
          <p className="px-2 py-4 text-center text-small text-text-muted">No notes yet</p>
        ) : (
          notes.map((n) => (
            <NoteRow key={n.id} note={n} isSelected={n.id === selectedId} onSelect={onSelect} />
          ))
        )}
      </div>
    </div>
  );
}
