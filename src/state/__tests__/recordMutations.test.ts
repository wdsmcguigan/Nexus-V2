/**
 * recordMutations — atomic compound mutation with single undo entry (substrate §4.4).
 *
 * A compound applies N mutations (each persisted/broadcast like recordMutation)
 * but pushes ONE combined undo entry whose reverseSteps unwind last-applied-first.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import {
  recordMutation,
  recordMutations,
  undoLastMutation,
  redoLastMutation,
  _resetUndoStacks,
} from "@/state/mutations";
import { makeSeedStore, FOLDER_IDS } from "@/storage/__tests__/seed";

let store: LocalStore;

beforeEach(() => {
  store = makeSeedStore();
  _resetUndoStacks();
});

describe("recordMutations", () => {
  it("applies all steps and a single undo reverts the whole compound", () => {
    // m1 starts in inbox with no star.
    expect(store.messages.get("m1")!.folderId).toBe(FOLDER_IDS.inbox);
    expect(store.messages.get("m1")!.star).toBeNull();

    recordMutations(
      [
        { kind: "MOVE_TO_FOLDER", payload: { messageId: "m1", folderId: FOLDER_IDS.personal } },
        { kind: "SET_STAR", payload: { messageId: "m1", star: "yellow" } },
      ],
      store,
      "Compound op",
    );

    // Both effects applied.
    expect(store.messages.get("m1")!.folderId).toBe(FOLDER_IDS.personal);
    expect(store.messages.get("m1")!.star).toBe("yellow");

    // One undo reverts BOTH steps and returns the compound description.
    const desc = undoLastMutation(store);
    expect(desc).toBe("Compound op");
    expect(store.messages.get("m1")!.folderId).toBe(FOLDER_IDS.inbox);
    expect(store.messages.get("m1")!.star).toBeNull();
  });

  it("pushes exactly one undo entry for the whole compound", () => {
    recordMutations(
      [
        { kind: "MOVE_TO_FOLDER", payload: { messageId: "m1", folderId: FOLDER_IDS.personal } },
        { kind: "SET_STAR", payload: { messageId: "m1", star: "yellow" } },
      ],
      store,
      "Compound op",
    );

    // First undo consumes the single compound entry.
    expect(undoLastMutation(store)).toBe("Compound op");
    // Nothing else on the stack — it was one entry, not two.
    expect(undoLastMutation(store)).toBeNull();
  });

  it("a compound with a non-undoable step pushes no undo entry but still clears redo", () => {
    // First create something undoable + undo it, so redo has an entry.
    recordMutation("READ", { messageId: "m1" }, store);
    undoLastMutation(store); // now redo stack has 1 entry
    // A compound containing a namespaced kind with no registered inverse is non-undoable.
    recordMutations([
      { kind: "READ", payload: { messageId: "m1" } },
      { kind: "com.test/NOINVERSE", payload: {} },
    ], store, "Has a non-undoable step");
    // No undoable entry was pushed for the compound, AND redo was invalidated.
    expect(undoLastMutation(store)).toBeNull(); // nothing undoable on top (compound not recorded)
    expect(redoLastMutation(store)).toBeNull(); // redo was cleared by the compound action
  });

  it("redo re-applies a compound as a single unit", () => {
    const before = store.messages.get("m1")!.folderId;
    recordMutations([
      { kind: "MOVE_TO_FOLDER", payload: { messageId: "m1", folderId: FOLDER_IDS.personal } },
      { kind: "READ", payload: { messageId: "m1" } },
    ], store, "Compound op");
    undoLastMutation(store);
    expect(store.messages.get("m1")!.folderId).toBe(before);
    const desc = redoLastMutation(store);
    expect(desc).toBe("Compound op");
    expect(store.messages.get("m1")!.folderId).toBe(FOLDER_IDS.personal); // both steps re-applied
  });
});
