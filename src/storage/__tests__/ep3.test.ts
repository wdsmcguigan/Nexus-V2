/**
 * EP-3 tests: body store, FTS index, OPFS-less query integration.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { BodyStore } from "@/storage/bodyStore";
import { FTSIndex } from "@/storage/fts";
import { LocalStore } from "@/storage/local";
import { queryMessages } from "@/storage/query";
import type { Label, Message } from "@/data/types";

// ─── Shared fixture ───────────────────────────────────────────────────────────

const VAULT = "local";

function makeMsg(id: string, subject: string, notes: string | null = null): Message {
  return {
    id,
    vaultId: VAULT,
    folderId: "fld-1",
    threadId: `thr-${id}`,
    providerIds: {},
    labelIds: ["inbox"],
    tags: [],
    statusId: null,
    priority: null,
    star: null,
    flag: null,
    pinned: false,
    muted: false,
    notes,
    customFields: {},
    flags: { read: false, answered: false, draft: false, flagged: false },
    receivedAt: Date.now(),
    sentAt: Date.now(),
    fromAddr: { name: "Alice", email: "alice@test.com" },
    toAddrs: [],
    ccAddrs: [],
    bccAddrs: [],
    subject,
    snippet: subject.slice(0, 40),
    bodyRef: `hash-${id}`,
    attachmentRefs: [],
  };
}

// ─── BodyStore ────────────────────────────────────────────────────────────────

describe("BodyStore", () => {
  let bs: BodyStore;

  beforeEach(() => { bs = new BodyStore(); });

  it("stores and retrieves html by bodyRef", () => {
    bs.set("hash-1", "<p>Hello world</p>");
    expect(bs.get("hash-1")).toBe("<p>Hello world</p>");
  });

  it("returns null for unknown bodyRef", () => {
    expect(bs.get("nonexistent")).toBeNull();
  });

  it("overwrites on duplicate set", () => {
    bs.set("hash-1", "<p>old</p>");
    bs.set("hash-1", "<p>new</p>");
    expect(bs.get("hash-1")).toBe("<p>new</p>");
  });

  it("size() reflects stored count", () => {
    bs.set("a", "body-a");
    bs.set("b", "body-b");
    expect(bs.size()).toBe(2);
  });
});

// ─── FTS index ────────────────────────────────────────────────────────────────

describe("FTSIndex", () => {
  let fts: FTSIndex;
  let bs: BodyStore;
  const msgs = [
    makeMsg("m1", "Invoice from Stripe", null),
    makeMsg("m2", "Q2 review notes — please skim before Tuesday", "check this carefully"),
    makeMsg("m3", "Pull request #312 was merged", null),
    makeMsg("m4", "Lunch tomorrow?", "confirm with Mae"),
  ];

  beforeEach(() => {
    bs = new BodyStore();
    bs.set("hash-m1", "<p>Your payment of $20.00 is confirmed. Receipt attached.</p>");
    bs.set("hash-m2", "<p>Planning session recap. Timeline shift to mid-June.</p>");
    bs.set("hash-m3", "<p>feat(panels): contextual ghosting merged by alice-chen.</p>");
    bs.set("hash-m4", "<p>Want to grab lunch at the Thai place?</p>");
    fts = new FTSIndex();
    fts.indexMessages(msgs, bs);
  });

  it("finds message by subject keyword", () => {
    const results = fts.search("invoice");
    expect(results.some((r) => r.id === "m1")).toBe(true);
  });

  it("finds message by body content", () => {
    const results = fts.search("payment");
    expect(results.some((r) => r.id === "m1")).toBe(true);
  });

  it("finds message by notes content", () => {
    const results = fts.search("carefully");
    expect(results.some((r) => r.id === "m2")).toBe(true);
  });

  it("subject matches rank higher than body matches", () => {
    // "review" appears in m2 subject; not in other subjects
    const results = fts.search("review");
    expect(results[0]?.id).toBe("m2");
  });

  it("prefix search works", () => {
    const results = fts.search("plan"); // matches "Planning" in body
    expect(results.some((r) => r.id === "m2")).toBe(true);
  });

  it("empty query returns empty array", () => {
    expect(fts.search("")).toEqual([]);
    expect(fts.search("   ")).toEqual([]);
  });

  it("searchIds returns a Set of matching IDs", () => {
    const ids = fts.searchIds("merged");
    expect(ids.has("m3")).toBe(true);
    expect(ids.has("m1")).toBe(false);
  });

  it("removeMessage removes from index", () => {
    fts.removeMessage("m1");
    const ids = fts.searchIds("invoice");
    expect(ids.has("m1")).toBe(false);
  });

  it("addMessage updates existing document", () => {
    const updated = makeMsg("m1", "Invoice from Stripe UPDATED", null);
    fts.addMessage(updated, "<p>Updated body content for testing supersede.</p>");
    const ids = fts.searchIds("supersede");
    expect(ids.has("m1")).toBe(true);
  });
});

// ─── queryMessages + FTS integration ─────────────────────────────────────────

describe("queryMessages with textQuery (FTS integration)", () => {
  let store: LocalStore;
  let fts: FTSIndex;
  let bs: BodyStore;

  const inboxLabel: Label = {
    id: "inbox", vaultId: VAULT, name: "Inbox", color: 1,
    kind: "system", systemKind: "inbox", position: 0,
  };

  const qMsgs = [
    makeMsg("q1", "Project Nexus kickoff meeting"),
    makeMsg("q2", "Stripe payment receipt"),
    makeMsg("q3", "GitHub pull request notification"),
  ];

  beforeEach(() => {
    store = new LocalStore();
    store.hydrate({
      vault: { id: VAULT, path: "/", createdAt: Date.now() },
      accounts: [],
      folders: [{ id: "fld-1", vaultId: VAULT, parentId: null, name: "Inbox", diskSlug: "inbox", diskPath: "inbox" }],
      labels: [inboxLabel],
      statuses: [],
      customFieldDefs: [],
      tagUsage: [],
      mutations: [],
      messages: qMsgs,
    });

    bs = new BodyStore();
    bs.set("hash-q1", "<p>Nexus project kickoff — agenda and attendees inside.</p>");
    bs.set("hash-q2", "<p>Thanks for your payment. Receipt attached.</p>");
    bs.set("hash-q3", "<p>PR #312 feat(panels) merged by alice-chen.</p>");
    fts = new FTSIndex();
    fts.indexMessages(qMsgs, bs);
  });

  it("returns all messages when no textQuery", () => {
    const { items } = queryMessages({ labelIds: ["inbox"], limit: 100 }, store, fts);
    expect(items).toHaveLength(3);
  });

  it("FTS textQuery narrows results to matching messages", () => {
    const { items } = queryMessages({ labelIds: ["inbox"], textQuery: "payment", limit: 100 }, store, fts);
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("q2");
  });

  it("FTS combined with label filter returns intersection", () => {
    const { items } = queryMessages({ labelIds: ["inbox"], textQuery: "nexus", limit: 100 }, store, fts);
    expect(items.every((m) => m.labelIds.includes("inbox"))).toBe(true);
    expect(items.some((m) => m.id === "q1")).toBe(true);
  });

  it("zero results when no FTS match", () => {
    const { items } = queryMessages({ textQuery: "qqqqqqqqqqqqqqqq", limit: 100 }, store, fts);
    expect(items).toHaveLength(0);
  });

  it("total reflects FTS-filtered count", () => {
    const { total } = queryMessages({ textQuery: "receipt", limit: 100 }, store, fts);
    expect(total).toBe(1);
  });
});
