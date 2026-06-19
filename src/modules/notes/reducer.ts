import type { ModuleReducer } from "@/state/moduleReducers";
import type { LocalStore } from "@/storage/local";
import type { Note } from "@/data/types";
import type { NoteFields } from "@/modules/notes/model";

// updatedAt is always carried in the payload (stamped at record-time in the
// helpers) and applied verbatim here — never Date.now() in the reducer, which
// would break replay determinism.
function patch(store: LocalStore, noteId: string, change: Partial<Note>): void {
  const prev = store.notes.get(noteId);
  if (!prev) return;
  store.putNote({ ...prev, ...change, updatedAt: change.updatedAt ?? prev.updatedAt });
}

export const notesReducer: ModuleReducer = {
  apply(kind, payload, store) {
    const local = store as LocalStore;
    switch (kind) {
      case "org.nexus.notes/CREATE_NOTE":
        local.putNote(payload as Note);
        break;
      case "org.nexus.notes/SET_NOTE_FIELDS": {
        const p = payload as { noteId: string; fields: NoteFields; updatedAt: number };
        patch(local, p.noteId, { ...p.fields, updatedAt: p.updatedAt });
        break;
      }
      case "org.nexus.notes/SET_NOTE_BODY": {
        const p = payload as { noteId: string; body: string; updatedAt: number };
        patch(local, p.noteId, { body: p.body, updatedAt: p.updatedAt });
        break;
      }
      case "org.nexus.notes/DELETE_NOTE": {
        const p = payload as { noteId: string };
        local.deleteNote(p.noteId);
        break;
      }
    }
  },
};
