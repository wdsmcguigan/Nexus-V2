import type { Note, Link } from "@/data/types";
import type { LocalStore } from "@/storage/local";
import { recordMutation, recordMutations, type ModuleInverseBuilder } from "@/state/mutations";
import { makeNote, type NoteFields } from "@/modules/notes/model";

export const NOTES_NS = "org.nexus.notes";
export const KIND = {
  CREATE: `${NOTES_NS}/CREATE_NOTE`,
  FIELDS: `${NOTES_NS}/SET_NOTE_FIELDS`,
  BODY: `${NOTES_NS}/SET_NOTE_BODY`,
  DELETE: `${NOTES_NS}/DELETE_NOTE`,
} as const;

/** The entity type identifier for a note (used as srcType in links). */
export const NOTE_ENTITY = "org.nexus.notes/note";

export function createNoteMutation(input: Partial<Note>, store: LocalStore): Note {
  const n = makeNote(input, store.vault?.id ?? "local", Date.now());
  recordMutation(KIND.CREATE, n, store);
  return n;
}

export function setNoteFieldsMutation(noteId: string, fields: NoteFields, store: LocalStore): void {
  recordMutation(KIND.FIELDS, { noteId, fields, updatedAt: Date.now() }, store);
}

export function setNoteBodyMutation(noteId: string, body: string, store: LocalStore): void {
  recordMutation(KIND.BODY, { noteId, body, updatedAt: Date.now() }, store);
}

export function deleteNoteMutation(noteId: string, store: LocalStore): void {
  recordMutation(KIND.DELETE, { noteId }, store);
}

/**
 * Create a note linked to a source entity (e.g. an email) as ONE atomic undo
 * unit. The link is note --references--> entity.
 */
export function createNoteFromEntity(
  entityType: string,
  entityId: string,
  title: string,
  store: LocalStore,
): Note {
  const note = makeNote({ title }, store.vault?.id ?? "local", Date.now());
  const link: Link = {
    id: `lnk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    vaultId: store.vault?.id ?? "local",
    srcType: NOTE_ENTITY,
    srcId: note.id,
    linkType: "references",
    dstType: entityType,
    dstId: entityId,
    createdAt: Date.now(),
  };
  recordMutations(
    [
      { kind: KIND.CREATE, payload: note },
      { kind: "CREATE_LINK", payload: link },
    ],
    store,
    "Create note from item",
  );
  return note;
}

/** Inverse builder — captures prior state BEFORE the mutation applies (substrate §4.3). */
export const notesInverse: ModuleInverseBuilder = (kind, payload, store) => {
  const s = store as LocalStore;
  switch (kind) {
    case KIND.CREATE: {
      const n = payload as Note;
      return { reverseSteps: [{ kind: KIND.DELETE, payload: { noteId: n.id } }], description: "Create note" };
    }
    case KIND.FIELDS: {
      const p = payload as { noteId: string; fields: NoteFields; updatedAt: number };
      const prev = s.notes.get(p.noteId);
      if (!prev) return null;
      const priorFields: NoteFields = {};
      for (const k of Object.keys(p.fields) as Array<keyof NoteFields>) {
        (priorFields as Record<string, unknown>)[k] = prev[k];
      }
      return {
        reverseSteps: [{ kind: KIND.FIELDS, payload: { noteId: p.noteId, fields: priorFields, updatedAt: prev.updatedAt } }],
        description: "Edit note",
      };
    }
    case KIND.BODY: {
      const p = payload as { noteId: string; body: string; updatedAt: number };
      const prev = s.notes.get(p.noteId);
      if (!prev) return null;
      return {
        reverseSteps: [{ kind: KIND.BODY, payload: { noteId: p.noteId, body: prev.body, updatedAt: prev.updatedAt } }],
        description: "Edit note body",
      };
    }
    case KIND.DELETE: {
      const p = payload as { noteId: string };
      const prev = s.notes.get(p.noteId);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.CREATE, payload: prev }], description: "Delete note" };
    }
  }
  return null;
};
