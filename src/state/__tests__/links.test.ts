import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { createLink, deleteLink, undoLastMutation } from "@/state/mutations";

let store: LocalStore;

beforeEach(() => {
  store = new LocalStore();
});

describe("link mutations", () => {
  it("createLink records a link the store can see", () => {
    const link = createLink(store, {
      srcType: "nexus/email.message",
      srcId: "m-1",
      linkType: "derived-from",
      dstType: "org.nexus.tasks/task",
      dstId: "t-1",
    });
    expect(store.links.get(link.id)?.dstId).toBe("t-1");
  });

  it("deleteLink removes it", () => {
    const link = createLink(store, {
      srcType: "a", srcId: "1", linkType: "rel", dstType: "b", dstId: "2",
    });
    deleteLink(store, link.id);
    expect(store.links.get(link.id)).toBeUndefined();
  });

  it("undo of createLink removes the link", () => {
    const link = createLink(store, {
      srcType: "a", srcId: "1", linkType: "rel", dstType: "b", dstId: "2",
    });
    undoLastMutation(store);
    expect(store.links.get(link.id)).toBeUndefined();
  });

  it("undo of deleteLink restores the link", () => {
    const link = createLink(store, {
      srcType: "a", srcId: "1", linkType: "rel", dstType: "b", dstId: "2",
    });
    deleteLink(store, link.id);
    undoLastMutation(store);
    expect(store.links.get(link.id)?.linkType).toBe("rel");
  });
});
