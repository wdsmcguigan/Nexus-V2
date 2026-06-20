import type { Note } from "@/data/types";

/** The note fields editable via SET_NOTE_FIELDS. */
export type NoteFields = Partial<Pick<Note, "title">>;

// Monotonic within this module instance; combined with Date.now() for unique ids.
let _seq = 0;
function noteId(): string {
  _seq += 1;
  return `note-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

/** Build a full Note from partial input, filling defaults. */
export function makeNote(input: Partial<Note>, vaultId: string, now: number): Note {
  return {
    id: input.id ?? noteId(),
    vaultId,
    title: input.title ?? "",
    body: input.body ?? "",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}
