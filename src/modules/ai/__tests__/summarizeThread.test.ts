import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { registerModuleInverse, _resetModuleInverses, _resetUndoStacks, undoLastMutation } from "@/state/mutations";
import { linksFrom } from "@/state/linksGraph";
import { notesReducer } from "@/modules/notes/reducer";
import { notesInverse } from "@/modules/notes/mutations";
import { NOTE_ENTITY } from "@/modules/notes/mutations";
import { summarizeThread } from "@/modules/ai/summarizeThread";

function freshStore(): LocalStore {
  const s = new LocalStore();
  (s as unknown as { vault: { id: string } }).vault = { id: "v1" };
  return s;
}
beforeEach(() => {
  _resetModuleReducers();
  _resetModuleInverses();
  _resetUndoStacks();
  registerModuleReducer("org.nexus.notes", notesReducer);
  registerModuleInverse("org.nexus.notes", notesInverse);
});

describe("summarizeThread (stub summarizer in node)", () => {
  it("creates an AI note + a 'summarizes' link, atomically undoable, tagged source:'ai'", async () => {
    const s = freshStore();
    s.messages.set("m1", { id: "m1", threadId: "t1", subject: "Q2", fromAddr: { name: "A", email: "a@x" }, snippet: "hi" } as never);

    await summarizeThread("m1", s);

    const notes = Array.from(s.notes.values());
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe("AI summary: Q2");
    const links = linksFrom(s, NOTE_ENTITY, notes[0]!.id);
    expect(links).toHaveLength(1);
    expect(links[0]!.linkType).toBe("summarizes");
    expect(links[0]!.dstId).toBe("m1");

    undoLastMutation(s);
    expect(s.notes.size).toBe(0);
    expect(linksFrom(s, NOTE_ENTITY, notes[0]!.id)).toHaveLength(0);
  });
});
