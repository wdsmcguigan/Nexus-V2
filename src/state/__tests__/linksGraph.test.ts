import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { createLink } from "@/state/mutations";
import { linksFrom, linksTo, neighbors } from "@/state/linksGraph";

let store: LocalStore;

beforeEach(() => {
  store = new LocalStore();
  createLink(store, {
    srcType: "nexus/email.message",
    srcId: "m-1",
    linkType: "derived-from",
    dstType: "org.nexus.tasks/task",
    dstId: "t-1",
  });
  createLink(store, {
    srcType: "com.acme.timer/timer",
    srcId: "w-1",
    linkType: "tracks",
    dstType: "org.nexus.tasks/task",
    dstId: "t-1",
  });
});

describe("links graph traversal", () => {
  it("linksFrom returns outgoing edges of a source", () => {
    const out = linksFrom(store, "nexus/email.message", "m-1");
    expect(out.map((l) => l.dstId)).toEqual(["t-1"]);
  });

  it("linksTo returns incoming edges of a destination", () => {
    const incoming = linksTo(store, "org.nexus.tasks/task", "t-1");
    expect(incoming.map((l) => l.srcId).sort()).toEqual(["m-1", "w-1"]);
  });

  it("linksTo filters by linkType", () => {
    const tracked = linksTo(store, "org.nexus.tasks/task", "t-1", "tracks");
    expect(tracked.map((l) => l.srcId)).toEqual(["w-1"]);
  });

  it("neighbors returns both directions as {type,id} entries", () => {
    const n = neighbors(store, "org.nexus.tasks/task", "t-1");
    const ids = n.map((e) => e.id).sort();
    expect(ids).toEqual(["m-1", "w-1"]);
  });
});
