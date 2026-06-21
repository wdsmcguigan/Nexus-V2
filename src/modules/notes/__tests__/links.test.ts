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

  it("resolves a contact link to the contact name", () => {
    const s = freshStore();
    s.contacts.set("c-1", { id: "c-1", name: "Ada Lovelace" } as never);
    const note = createNoteFromEntity("nexus/contact", "c-1", "n", s);
    const items = noteLinkedItems(s, note.id);
    expect(items[0]!.label).toBe("Ada Lovelace");
  });

  it("resolves a calendar-event link to the event title", () => {
    const s = freshStore();
    s.calendarEvents.set("e-1", { id: "e-1", title: "Standup" } as never);
    const note = createNoteFromEntity("nexus/calendar.event", "e-1", "n", s);
    const items = noteLinkedItems(s, note.id);
    expect(items[0]!.label).toBe("Standup");
  });

  it("falls back to the raw id for an unknown entity type", () => {
    const s = freshStore();
    const note = createNoteFromEntity("com.acme/widget", "w-1", "n", s);
    const items = noteLinkedItems(s, note.id);
    expect(items[0]!.label).toBe("w-1");
  });
});
