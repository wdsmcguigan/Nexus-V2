import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExt from "@tiptap/extension-underline";
import LinkExt from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { X, Trash2 } from "lucide-react";
import { localStore } from "@/storage/local";
import { useWorkspace } from "@/state/workspace";
import { Button } from "@/components/ui/Button";
import { useNote } from "@/modules/notes/hooks";
import { setNoteFieldsMutation, setNoteBodyMutation, deleteNoteMutation } from "@/modules/notes/mutations";
import { noteLinkedItems, type LinkedItem } from "@/modules/notes/links";

const BODY_DEBOUNCE_MS = 800;

function openLinkedItem(item: LinkedItem): void {
  const ws = useWorkspace.getState();
  if (item.entityType === "nexus/email.message") ws.setSelectedEmail(item.entityId);
  else if (item.entityType === "nexus/contact") ws.openContactsPanel(item.entityId);
  else if (item.entityType === "nexus/calendar.event") ws.openCalendarPanel();
}

interface NoteEditorProps {
  noteId: string;
  onClose: () => void;
}

export function NoteEditor({ noteId, onClose }: NoteEditorProps) {
  const note = useNote(noteId);
  const [title, setTitle] = useState(note?.title ?? "");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBodyRef = useRef<string | null>(null);
  const noteIdRef = useRef(noteId);

  // Hoisted function declaration so the editor callbacks below can reference it.
  function flushBody(): void {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const body = pendingBodyRef.current;
    pendingBodyRef.current = null;
    if (body == null) return;
    const id = noteIdRef.current;
    const cur = localStore.notes.get(id);
    if (cur && cur.body !== body) setNoteBodyMutation(id, body, localStore);
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: { HTMLAttributes: { class: "nx-code-block" } } }),
      UnderlineExt,
      LinkExt.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Write…" }),
    ],
    content: note?.body ?? "",
    onUpdate: ({ editor }) => {
      pendingBodyRef.current = editor.getHTML();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flushBody, BODY_DEBOUNCE_MS);
    },
    onBlur: () => flushBody(),
  });

  // On note switch: flush the OUTGOING note's pending body, then load the new note's
  // content. setContent(..., false) does not emit an update, so it won't autosave.
  const prevNoteRef = useRef(note);
  useEffect(() => {
    const prev = prevNoteRef.current;
    prevNoteRef.current = note;
    if (prev && prev.id !== noteId) flushBody();
    noteIdRef.current = noteId;
    if (!note || !editor) return;
    if (prev?.id !== note.id) {
      setTitle(note.title);
      editor.commands.setContent(note.body, { emitUpdate: false });
    }
  }, [note, noteId, editor]);

  // Flush any pending body on unmount.
  useEffect(() => () => flushBody(), []);

  if (!note) return null;

  const linked = noteLinkedItems(localStore, noteId);

  function commitTitle() {
    const trimmed = title.trim();
    if (trimmed !== note!.title) setNoteFieldsMutation(noteId, { title: trimmed }, localStore);
  }
  function handleDelete() {
    deleteNoteMutation(noteId, localStore);
    onClose();
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-mono-sm uppercase tracking-[0.04em] text-text-muted">Note</span>
        <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      <input
        type="text"
        value={title}
        placeholder="Title"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-full bg-transparent text-h3 font-semibold text-text-primary placeholder:text-text-muted focus:outline-none"
      />

      <EditorContent
        editor={editor}
        className="nx-scroll min-h-0 flex-1 overflow-y-auto rounded-sm border border-border-default bg-surface-2 px-3 py-2 text-body text-text-primary"
      />

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
