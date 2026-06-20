import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { undoLastMutation, _resetModuleInverses, _resetUndoStacks, registerModuleInverse } from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { notesReducer } from "@/modules/notes/reducer";
import { notesInverse, NOTES_NS, createNoteFromEntity, NOTE_ENTITY } from "@/modules/notes/mutations";
import { linksFrom } from "@/state/linksGraph";

function wire(): LocalStore {
  const s = new LocalStore();
  registerModuleReducer(NOTES_NS, notesReducer);
  registerModuleInverse(NOTES_NS, notesInverse);
  return s;
}

beforeEach(() => { _resetModuleReducers(); _resetModuleInverses(); _resetUndoStacks(); });

describe("createNoteFromEntity", () => {
  it("creates a note + a references link atomically, one undo reverts both", () => {
    const s = wire();
    const note = createNoteFromEntity("nexus/email.message", "msg-1", "Re: hello", s);
    expect(s.notes.get(note.id)?.title).toBe("Re: hello");
    const links = linksFrom(s, NOTE_ENTITY, note.id);
    expect(links).toHaveLength(1);
    expect(links[0]!.linkType).toBe("references");
    expect(links[0]!.dstId).toBe("msg-1");

    undoLastMutation(s);
    expect(s.notes.has(note.id)).toBe(false);
    expect(linksFrom(s, NOTE_ENTITY, note.id)).toHaveLength(0);
  });
});
