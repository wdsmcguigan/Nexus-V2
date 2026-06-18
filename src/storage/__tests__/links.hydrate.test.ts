import { describe, it, expect } from "vitest";
import { LocalStore } from "@/storage/local";
import type { HydratePayload } from "@/storage/tauri";
import type { Link } from "@/data/types";

describe("links in the hydrate payload", () => {
  it("hydrates a store from a payload carrying links", () => {
    const link: Link = {
      id: "lnk-1",
      vaultId: "v",
      srcType: "nexus/email.message",
      srcId: "m-1",
      linkType: "derived-from",
      dstType: "org.nexus.tasks/task",
      dstId: "t-1",
      createdAt: 0,
    };
    // Partial<HydratePayload> proves at compile time that `links` is a declared
    // field on HydratePayload.  The cast to Parameters<hydrate>[0] bypasses the
    // StorageSnapshot shape; we supply the required iteration fields as empty
    // arrays so the runtime loop (`for (const a of snap.accounts)`) doesn't throw.
    const payload: Partial<HydratePayload> = {
      links: [link],
      accounts: [],
      folders: [],
      labels: [],
      statuses: [],
      customFieldDefs: [],
      tagUsage: [],
      mutations: [],
      messages: [],
      vault: null,
    } as Partial<HydratePayload>;
    const store = new LocalStore();
    store.hydrate(payload as Parameters<typeof store.hydrate>[0]);
    expect(store.links.get("lnk-1")?.dstId).toBe("t-1");
  });
});
