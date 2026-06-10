import { describe, it, expect } from "vitest";
import { buildGroupedItems } from "@/lib/messageGrouping";
import type { Message } from "@/data/types";

function msg(id: string, over: Partial<Message> = {}): Message {
  return {
    id,
    priority: null,
    statusId: null,
    // Only the fields buildGroupedItems reads matter; the rest are filled
    // loosely since the function never inspects them.
    ...over,
  } as Message;
}

const labels = (items: ReturnType<typeof buildGroupedItems>) =>
  items.filter((i) => i.kind === "header").map((i) => (i as { label: string }).label);
const rowIds = (items: ReturnType<typeof buildGroupedItems>) =>
  items.filter((i) => i.kind === "row").map((i) => (i as { msg: Message }).msg.id);

describe("buildGroupedItems — none", () => {
  it("returns rows in input order with no headers", () => {
    const items = buildGroupedItems([msg("a"), msg("b")], "none");
    expect(items).toEqual([
      { kind: "row", msg: msg("a") },
      { kind: "row", msg: msg("b") },
    ]);
  });
});

describe("buildGroupedItems — priority", () => {
  it("orders groups Urgent → High → Normal → Low, then No Priority", () => {
    const items = buildGroupedItems(
      [msg("low", { priority: 4 }), msg("none1"), msg("urgent", { priority: 1 }), msg("normal", { priority: 3 })],
      "priority",
    );
    expect(labels(items)).toEqual(["Urgent", "Normal", "Low", "No Priority"]);
    expect(rowIds(items)).toEqual(["urgent", "normal", "low", "none1"]);
  });

  it("omits empty priority buckets", () => {
    const items = buildGroupedItems([msg("h", { priority: 2 })], "priority");
    expect(labels(items)).toEqual(["High"]);
  });

  it("keeps multiple messages within a bucket in input order", () => {
    const items = buildGroupedItems(
      [msg("u1", { priority: 1 }), msg("u2", { priority: 1 })],
      "priority",
    );
    expect(labels(items)).toEqual(["Urgent"]);
    expect(rowIds(items)).toEqual(["u1", "u2"]);
  });

  it("emits only No Priority when nothing is prioritized", () => {
    const items = buildGroupedItems([msg("a"), msg("b")], "priority");
    expect(labels(items)).toEqual(["No Priority"]);
    expect(rowIds(items)).toEqual(["a", "b"]);
  });
});

describe("buildGroupedItems — status", () => {
  const resolve = (id: string) => ({ s1: "In Progress", s2: "Done" })[id];

  it("puts No Status first, then statuses in first-seen order", () => {
    const items = buildGroupedItems(
      [msg("a", { statusId: "s2" }), msg("b"), msg("c", { statusId: "s1" }), msg("d", { statusId: "s2" })],
      "status",
      resolve,
    );
    expect(labels(items)).toEqual(["No Status", "Done", "In Progress"]);
    expect(rowIds(items)).toEqual(["b", "a", "d", "c"]);
  });

  it("falls back to the status id when no name resolves", () => {
    const items = buildGroupedItems([msg("a", { statusId: "unknown" })], "status", () => undefined);
    expect(labels(items)).toEqual(["unknown"]);
  });

  it("omits the No Status header when every message has a status", () => {
    const items = buildGroupedItems([msg("a", { statusId: "s1" })], "status", resolve);
    expect(labels(items)).toEqual(["In Progress"]);
  });
});
