import { describe, it, expect } from "vitest";
import { sortNotesByUpdated, noteSnippet } from "@/modules/notes/noteSort";
import type { Note } from "@/data/types";

function note(p: Partial<Note>): Note {
  return { id: p.id ?? "n", vaultId: "v", title: p.title ?? "", body: p.body ?? "", createdAt: p.createdAt ?? 0, updatedAt: p.updatedAt ?? 0 };
}

describe("sortNotesByUpdated", () => {
  it("orders by updatedAt desc, then createdAt desc", () => {
    const a = note({ id: "a", updatedAt: 100, createdAt: 1 });
    const b = note({ id: "b", updatedAt: 200, createdAt: 2 });
    const c = note({ id: "c", updatedAt: 100, createdAt: 5 });
    expect(sortNotesByUpdated([a, b, c]).map((n) => n.id)).toEqual(["b", "c", "a"]);
  });
  it("does not mutate the input", () => {
    const arr = [note({ id: "a", updatedAt: 1 }), note({ id: "b", updatedAt: 2 })];
    sortNotesByUpdated(arr);
    expect(arr.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("noteSnippet", () => {
  it("strips tags and collapses whitespace", () => {
    expect(noteSnippet("<p>Hello   <b>world</b></p>")).toBe("Hello world");
  });
  it("decodes common entities", () => {
    expect(noteSnippet("<p>a &amp; b &lt;c&gt;</p>")).toBe("a & b <c>");
  });
  it("decodes quote entities", () => {
    expect(noteSnippet("<p>&quot;quoted&quot; it&#39;s</p>")).toBe("\"quoted\" it's");
  });
  it("truncates with an ellipsis", () => {
    expect(noteSnippet("<p>" + "x".repeat(200) + "</p>", 10)).toBe("xxxxxxxxxx…");
  });
  it("returns empty string for empty body", () => {
    expect(noteSnippet("")).toBe("");
    expect(noteSnippet("<p></p>")).toBe("");
  });
});
