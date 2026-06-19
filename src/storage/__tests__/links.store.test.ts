import { describe, it, expect } from "vitest";
import { LocalStore } from "@/storage/local";
import type { Link } from "@/data/types";

function link(id: string, over: Partial<Link> = {}): Link {
  return {
    id,
    vaultId: "v",
    srcType: "nexus/email.message",
    srcId: "m-1",
    linkType: "derived-from",
    dstType: "org.nexus.tasks/task",
    dstId: "t-1",
    createdAt: 0,
    ...over,
  };
}

describe("LocalStore links", () => {
  it("puts and deletes a link", () => {
    const store = new LocalStore();
    store.putLink(link("lnk-1"));
    expect(store.links.get("lnk-1")?.linkType).toBe("derived-from");
    store.deleteLink("lnk-1");
    expect(store.links.get("lnk-1")).toBeUndefined();
  });

  it("hydrates links from a snapshot and clears prior ones", () => {
    const store = new LocalStore();
    store.putLink(link("stale"));
    store.hydrate({
      accounts: [],
      folders: [],
      labels: [],
      statuses: [],
      customFieldDefs: [],
      messages: [],
      tagUsage: [],
      mutations: [],
      links: [link("lnk-2")],
    } as unknown as Parameters<typeof store.hydrate>[0]);
    expect(store.links.get("stale")).toBeUndefined();
    expect(store.links.get("lnk-2")?.dstId).toBe("t-1");
  });
});
