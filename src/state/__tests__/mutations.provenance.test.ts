import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import {
  recordMutation,
  applyMutation,
  undoLastMutation,
  redoLastMutation,
  getUndoHistory,
  _resetUndoStacks,
} from "@/state/mutations";
import type { Mutation } from "@/data/types";

function freshStore(): LocalStore {
  const s = new LocalStore();
  (s as unknown as { vault: { id: string } }).vault = { id: "v1" };
  return s;
}

function makeFolder(id: string, name: string) {
  return { id, vaultId: "v1", parentId: null, name, diskSlug: name, diskPath: name };
}

function seedMessage(s: LocalStore, id: string): void {
  s.putMessage({
    id,
    vaultId: "v1",
    folderId: "f-inbox",
    threadId: "t1",
    providerIds: {},
    labelIds: [],
    tags: [],
    statusId: null,
    priority: null,
    star: null,
    flag: null,
    pinned: false,
    muted: false,
    notes: null,
    customFields: {},
    flags: { read: false, answered: false, draft: false, flagged: false },
    receivedAt: 0,
    sentAt: 0,
    fromAddr: { name: "A", email: "a@example.com" },
    toAddrs: [],
    ccAddrs: [],
    bccAddrs: [],
    subject: "Test",
    snippet: "",
    bodyRef: "hash-1",
    attachmentRefs: [],
  });
}

beforeEach(() => _resetUndoStacks());

describe("mutation provenance", () => {
  it("a source:'ai' mutation carries source on the Mutation and in history", () => {
    const s = freshStore();
    // Use SET_PINNED (undoable) so the entry lands on the undo stack.
    s.putMessage({
      id: "m-src-test",
      vaultId: "v1",
      folderId: "f-inbox",
      threadId: "t1",
      providerIds: {},
      labelIds: [],
      tags: [],
      statusId: null,
      priority: null,
      star: null,
      flag: null,
      pinned: false,
      muted: false,
      notes: null,
      customFields: {},
      flags: { read: false, answered: false, draft: false, flagged: false },
      receivedAt: 0,
      sentAt: 0,
      fromAddr: { name: "A", email: "a@example.com" },
      toAddrs: [],
      ccAddrs: [],
      bccAddrs: [],
      subject: "Test",
      snippet: "",
      bodyRef: "hash-1",
      attachmentRefs: [],
    });
    const m = recordMutation("SET_PINNED", { messageId: "m-src-test", pinned: true }, s, {
      source: "ai",
      generatedBy: "claude-x",
    });
    expect(m.source).toBe("ai");
    expect(m.generatedBy).toBe("claude-x");
    const hist = getUndoHistory();
    expect(hist[0]?.source).toBe("ai");
  });

  it("default source is 'user' and the payload is stored bare", () => {
    const s = freshStore();
    const m = recordMutation("CREATE_FOLDER", makeFolder("f2", "G"), s);
    expect(m.source).toBe("user");
    // bare payload (no envelope wrapper key)
    expect(Object.keys(m.payload as object)).not.toContain("__nexusMeta");
  });

  it("a persisted enveloped mutation replays to the bare projection (reducer sees bare payload)", () => {
    const s1 = freshStore();
    recordMutation("CREATE_FOLDER", makeFolder("f3", "H"), s1, { source: "ai" });
    // s1.mutations is a Mutation[] — grab a structural copy of what's on "disk"
    const persisted: Mutation[] = s1.mutations.map((m) => ({ ...m }));
    const s2 = freshStore();
    for (const m of persisted) applyMutation({ ...m }, s2);
    expect(s2.folders.get("f3")?.name).toBe("H");
  });

  it("undo of an AI mutation reverses it", () => {
    const s = freshStore();
    // Seed a message so SET_PINNED/_updateMessage can actually toggle the flag.
    s.putMessage({
      id: "m-pin-test",
      vaultId: "v1",
      folderId: "f-inbox",
      threadId: "t1",
      providerIds: {},
      labelIds: [],
      tags: [],
      statusId: null,
      priority: null,
      star: null,
      flag: null,
      pinned: false,
      muted: false,
      notes: null,
      customFields: {},
      flags: { read: false, answered: false, draft: false, flagged: false },
      receivedAt: 0,
      sentAt: 0,
      fromAddr: { name: "A", email: "a@example.com" },
      toAddrs: [],
      ccAddrs: [],
      bccAddrs: [],
      subject: "Test",
      snippet: "",
      bodyRef: "hash-1",
      attachmentRefs: [],
    });
    recordMutation("SET_PINNED", { messageId: "m-pin-test", pinned: true }, s, { source: "ai" });
    expect(s.messages.get("m-pin-test")?.pinned).toBe(true);
    undoLastMutation(s);
    expect(s.messages.get("m-pin-test")?.pinned).toBe(false);
  });

  it("redo of an AI mutation re-persists its provenance (source stays 'ai')", () => {
    const s = freshStore();
    seedMessage(s, "m-redo-test");
    recordMutation("SET_PINNED", { messageId: "m-redo-test", pinned: true }, s, {
      source: "ai",
      generatedBy: "claude-x",
    });
    undoLastMutation(s);
    expect(s.messages.get("m-redo-test")?.pinned).toBe(false);

    redoLastMutation(s);
    // the effect is redone
    expect(s.messages.get("m-redo-test")?.pinned).toBe(true);
    // and the re-emitted/persisted mutation kept its provenance (not downgraded to "user")
    const last = s.mutations[s.mutations.length - 1]!;
    expect(last.source).toBe("ai");
    expect(last.generatedBy).toBe("claude-x");
    // history label is still AI
    expect(getUndoHistory()[0]?.source).toBe("ai");
  });
});
