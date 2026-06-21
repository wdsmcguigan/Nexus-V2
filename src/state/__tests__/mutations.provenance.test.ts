import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import {
  recordMutation,
  applyMutation,
  undoLastMutation,
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

beforeEach(() => _resetUndoStacks());

describe("mutation provenance", () => {
  it("a source:'ai' mutation carries source on the Mutation and in history", () => {
    const s = freshStore();
    const m = recordMutation("CREATE_FOLDER", makeFolder("f1", "F"), s, {
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
    recordMutation("CREATE_FOLDER", makeFolder("f4", "I"), s, { source: "ai" });
    expect(s.folders.has("f4")).toBe(true);
    undoLastMutation(s);
    expect(s.folders.has("f4")).toBe(false);
  });
});
