import { describe, it, expect } from "vitest";
import type { Link, MutationKind } from "@/data/types";

describe("Link type and link mutation kinds", () => {
  it("constructs a Link and admits the link mutation kinds", () => {
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
    const create: MutationKind = "CREATE_LINK";
    const del: MutationKind = "DELETE_LINK";
    expect(link.linkType).toBe("derived-from");
    expect(create).toBe("CREATE_LINK");
    expect(del).toBe("DELETE_LINK");
  });
});
