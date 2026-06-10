import { describe, it, expect } from "vitest";
import { resolveColumnOrder, reorderColumn } from "@/lib/tableColumns";

describe("resolveColumnOrder", () => {
  it("uses the default order when nothing is saved", () => {
    expect(resolveColumnOrder([], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("honors the saved order", () => {
    expect(resolveColumnOrder(["c", "a", "b"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
  });

  it("appends newly-added columns (absent from saved order) at the end", () => {
    expect(resolveColumnOrder(["b", "a"], ["a", "b", "c", "d"])).toEqual(["b", "a", "c", "d"]);
  });

  it("drops saved keys that no longer exist", () => {
    expect(resolveColumnOrder(["gone", "a", "also-gone", "b"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("returns a fresh array (no aliasing of the inputs)", () => {
    const allKeys = ["a", "b"];
    const out = resolveColumnOrder([], allKeys);
    expect(out).not.toBe(allKeys);
    expect(out).toEqual(allKeys);
  });
});

describe("reorderColumn", () => {
  it("moves a column leftward to the target's slot", () => {
    expect(reorderColumn(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("moves a column rightward, landing just after the target (splice semantics)", () => {
    // target index 'c'=2 is captured before 'a' is removed; after removal the
    // remaining list is [b,c,d] and 'a' is inserted at index 2 → after 'c'.
    expect(reorderColumn(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("is a no-op copy when src === target", () => {
    const order = ["a", "b", "c"];
    const out = reorderColumn(order, "b", "b");
    expect(out).toEqual(order);
    expect(out).not.toBe(order);
  });

  it("returns an unchanged copy when a key is missing", () => {
    expect(reorderColumn(["a", "b"], "x", "a")).toEqual(["a", "b"]);
    expect(reorderColumn(["a", "b"], "a", "y")).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const order = ["a", "b", "c"];
    reorderColumn(order, "c", "a");
    expect(order).toEqual(["a", "b", "c"]);
  });
});
