import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { registerModuleInverse, _resetModuleInverses, _resetUndoStacks } from "@/state/mutations";
import { createNoteFromEntity, notesInverse } from "@/modules/notes/mutations";
import { notesReducer } from "@/modules/notes/reducer";
import { noteLinkedItems } from "@/modules/notes/links";

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

describe("noteLinkedItems", () => {
  it("resolves an email link to the message subject", () => {
    const s = freshStore();
    s.messages.set("msg-1", { id: "msg-1", subject: "Quarterly review" } as never);
    const note = createNoteFromEntity("nexus/email.message", "msg-1", "n", s);
    const items = noteLinkedItems(s, note.id);
    expect(items).toHaveLength(1);
    expect(items[0]!.entityType).toBe("nexus/email.message");
    expect(items[0]!.label).toBe("Quarterly review");
  });
});
