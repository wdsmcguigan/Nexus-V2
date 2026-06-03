/**
 * applyRemoteMutation — mutations broadcast from sibling windows are applied to
 * the local store WITHOUT re-persisting or pushing onto the per-window undo
 * stack (that is the originating window's job). It also advances the Lamport
 * clock so subsequent local writes stay causally ordered.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { applyRemoteMutation, recordMutation, getUndoHistory } from "@/state/mutations";
import { makeSeedStore, LABEL_IDS } from "@/storage/__tests__/seed";

let store: LocalStore;

beforeEach(() => {
  store = makeSeedStore();
});

describe("applyRemoteMutation", () => {
  it("applies the mutation to the local store", () => {
    applyRemoteMutation("ADD_LABEL", { messageId: "m1", labelId: LABEL_IDS.work }, 5, store);
    expect(store.messages.get("m1")!.labelIds).toContain(LABEL_IDS.work);
  });

  it("does not push an undo entry (remote edits are not locally undoable)", () => {
    const before = getUndoHistory().length;
    applyRemoteMutation("READ", { messageId: "m1" }, 7, store);
    expect(getUndoHistory().length).toBe(before);
  });

  it("advances the Lamport clock so the next local mutation outranks it", () => {
    applyRemoteMutation("READ", { messageId: "m1" }, 1000, store);
    const next = recordMutation("UNREAD", { messageId: "m1" }, store);
    expect(next.lamport).toBeGreaterThan(1000);
  });
});
