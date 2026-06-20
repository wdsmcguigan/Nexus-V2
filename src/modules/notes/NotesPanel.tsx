import { useState } from "react";
import type { IDockviewPanelProps } from "dockview";
import { useNote } from "@/modules/notes/hooks";
import { NoteListView } from "@/modules/notes/NoteListView";
import { NoteEditor } from "@/modules/notes/NoteEditor";

/** Notes dock panel: master-detail (list + rich-text editor). Contributed by org.nexus.notes. */
export function NotesPanel(_: IDockviewPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useNote(selectedId ?? "");
  const showEditor = selectedId != null && selected != null;

  return (
    <div className="flex h-full">
      <div className="w-72 shrink-0 border-r border-border-subtle">
        <NoteListView selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <div className="min-w-0 flex-1">
        {showEditor ? (
          <NoteEditor noteId={selectedId} onClose={() => setSelectedId(null)} />
        ) : (
          <div className="flex h-full items-center justify-center text-body text-text-muted">
            Select or create a note
          </div>
        )}
      </div>
    </div>
  );
}
