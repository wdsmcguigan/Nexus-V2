import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { recordMutation, undoLastMutation, _resetModuleInverses, _resetUndoStacks, registerModuleInverse } from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { notesReducer } from "@/modules/notes/reducer";
import {
  notesInverse, NOTES_NS,
  createNoteMutation,
  setNoteFieldsMutation,
  setNoteBodyMutation,
  deleteNoteMutation,
  KIND,
} from "@/modules/notes/mutations";

function wire(): LocalStore {
  const s = new LocalStore();
  registerModuleReducer(NOTES_NS, notesReducer);
  registerModuleInverse(NOTES_NS, notesInverse);
  return s;
}

beforeEach(() => { _resetModuleReducers(); _resetModuleInverses(); _resetUndoStacks(); });

describe("notes data layer", () => {
  it("CREATE_NOTE puts a note", () => {
    const s = wire();
    const n = createNoteMutation({ title: "Hi" }, s);
    expect(s.notes.get(n.id)?.title).toBe("Hi");
  });

  it("SET_NOTE_FIELDS updates title and bumps updatedAt", () => {
    const s = wire();
    const n = createNoteMutation({ title: "A" }, s);
    const before = s.notes.get(n.id)!.updatedAt;
    setNoteFieldsMutation(n.id, { title: "B" }, s);
    const after = s.notes.get(n.id)!;
    expect(after.title).toBe("B");
    expect(after.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("SET_NOTE_BODY updates body", () => {
    const s = wire();
    const n = createNoteMutation({ title: "A" }, s);
    setNoteBodyMutation(n.id, "<p>hello</p>", s);
    expect(s.notes.get(n.id)?.body).toBe("<p>hello</p>");
  });

  it("DELETE_NOTE removes it", () => {
    const s = wire();
    const n = createNoteMutation({ title: "A" }, s);
    deleteNoteMutation(n.id, s);
    expect(s.notes.has(n.id)).toBe(false);
  });

  it("undo round-trips each kind", () => {
    const s = wire();
    const n = createNoteMutation({ title: "A", body: "<p>x</p>" }, s);
    const origUpdated = s.notes.get(n.id)!.updatedAt;

    setNoteFieldsMutation(n.id, { title: "B" }, s);
    undoLastMutation(s);
    expect(s.notes.get(n.id)!.title).toBe("A");
    expect(s.notes.get(n.id)!.updatedAt).toBe(origUpdated);

    setNoteBodyMutation(n.id, "<p>y</p>", s);
    undoLastMutation(s);
    expect(s.notes.get(n.id)!.body).toBe("<p>x</p>");

    deleteNoteMutation(n.id, s);
    undoLastMutation(s);
    expect(s.notes.get(n.id)!.title).toBe("A");
    expect(s.notes.get(n.id)!.body).toBe("<p>x</p>");

    undoLastMutation(s); // undo the create
    expect(s.notes.has(n.id)).toBe(false);
  });

  it("replaying logged mutations rebuilds the projection", () => {
    const s = wire();
    const n = createNoteMutation({ title: "A" }, s);
    setNoteBodyMutation(n.id, "<p>body</p>", s);

    // Simulate a fresh store replaying the same kinds.
    // The reducer is already registered from wire() above so we just need a new store.
    const s2 = new LocalStore();
    recordMutation(KIND.CREATE, { ...s.notes.get(n.id)!, body: "" }, s2);
    recordMutation(KIND.BODY, { noteId: n.id, body: "<p>body</p>", updatedAt: Date.now() }, s2);
    expect(s2.notes.get(n.id)?.body).toBe("<p>body</p>");
  });
});
