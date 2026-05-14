import { describe, it, expect, beforeEach } from "vitest";
import { queryMessages } from "@/storage/query";
import { LocalStore } from "@/storage/local";
import {
  makeSeedStore,
  LABEL_IDS,
  STATUS_IDS,
  FOLDER_IDS,
  CFD_IDS,
} from "./seed";

let store: LocalStore;

beforeEach(() => {
  store = makeSeedStore();
});

describe("queryMessages — label filter", () => {
  it("returns messages with inbox label", () => {
    const { items } = queryMessages({ labelIds: [LABEL_IDS.inbox] }, store);
    const ids = items.map((m) => m.id);
    expect(ids).toContain("m1");
    expect(ids).toContain("m2");
    expect(ids).not.toContain("m5"); // personal folder, no inbox label
    expect(ids).not.toContain("m6"); // archive label only
  });

  it("AND semantics — must have ALL requested labels", () => {
    const { items } = queryMessages(
      { labelIds: [LABEL_IDS.inbox, LABEL_IDS.work] },
      store,
    );
    const ids = items.map((m) => m.id);
    expect(ids).toContain("m1");
    expect(ids).toContain("m4");
    expect(ids).not.toContain("m2"); // inbox only, not work
    expect(ids).not.toContain("m3"); // inbox + newsletter
  });
});

describe("queryMessages — folder filter", () => {
  it("returns only messages in that folder", () => {
    const { items } = queryMessages({ folderId: FOLDER_IDS.personal }, store);
    expect(items.map((m) => m.id)).toEqual(["m5"]);
  });
});

describe("queryMessages — tag filter", () => {
  it("returns messages with the tag", () => {
    const { items } = queryMessages({ tags: ["urgent"] }, store);
    expect(items.map((m) => m.id)).toContain("m2");
    expect(items.length).toBe(1);
  });
});

describe("queryMessages — status filter", () => {
  it("returns messages with the status", () => {
    const { items } = queryMessages({ statusId: STATUS_IDS.triage }, store);
    expect(items.map((m) => m.id)).toContain("m2");
  });

  it("returns messages with null status", () => {
    const { items } = queryMessages({ statusId: null }, store);
    const ids = items.map((m) => m.id);
    expect(ids).not.toContain("m2"); // has triage
    expect(ids).not.toContain("m4"); // has awaiting
    expect(ids).toContain("m1");
  });
});

describe("queryMessages — priority filter", () => {
  it("maxPriority filters correctly (1=urgent is most important)", () => {
    const { items } = queryMessages({ maxPriority: 2 }, store);
    const ids = items.map((m) => m.id);
    expect(ids).toContain("m1"); // priority 1 (urgent)
    expect(ids).toContain("m4"); // priority 2 (high)
    expect(ids).not.toContain("m3"); // priority 3 (normal)
    expect(ids).not.toContain("m2"); // no priority
  });
});

describe("queryMessages — multi-axis intersection", () => {
  it("LBL AND STA AND PRI returns only matching messages", () => {
    const { items } = queryMessages(
      {
        labelIds: [LABEL_IDS.inbox, LABEL_IDS.work],
        statusId: STATUS_IDS.awaiting,
        maxPriority: 2,
      },
      store,
    );
    expect(items.map((m) => m.id)).toEqual(["m4"]);
  });
});

describe("queryMessages — custom field filter", () => {
  it("filters by custom field value", () => {
    const { items } = queryMessages(
      { customFieldValues: { [CFD_IDS.project]: "opt-acme" } },
      store,
    );
    expect(items.map((m) => m.id)).toContain("m5");
    expect(items.length).toBe(1);
  });
});

describe("queryMessages — read / flagged / muted / pinned", () => {
  it("read filter", () => {
    const { items } = queryMessages({ read: true }, store);
    expect(items.map((m) => m.id)).toContain("m6");
  });

  it("pinned filter", () => {
    const { items } = queryMessages({ pinned: true }, store);
    expect(items.map((m) => m.id)).toEqual(["m4"]);
  });

  it("muted filter", () => {
    const { items } = queryMessages({ muted: true }, store);
    expect(items.map((m) => m.id)).toContain("m7");
    expect(items.map((m) => m.id)).not.toContain("m8");
  });
});

describe("queryMessages — sort", () => {
  it("pinned messages float to top regardless of sort", () => {
    const { items } = queryMessages({ labelIds: [LABEL_IDS.inbox] }, store);
    expect(items[0]!.id).toBe("m4"); // pinned
  });
});

describe("queryMessages — text query (pre-FTS5)", () => {
  it("matches by subject substring", () => {
    const { items } = queryMessages({ textQuery: "Subject m1" }, store);
    expect(items.map((m) => m.id)).toContain("m1");
  });

  it("matches by snippet substring", () => {
    const { items } = queryMessages({ textQuery: "Snippet for m3" }, store);
    expect(items.map((m) => m.id)).toContain("m3");
  });
});

describe("queryMessages — pagination", () => {
  it("returns correct page with cursor", () => {
    const page1 = queryMessages({ limit: 3 }, store);
    expect(page1.items.length).toBe(3);
    expect(page1.total).toBe(8);
    expect(page1.nextCursor).toBe("3");

    const page2 = queryMessages({ limit: 3, cursor: page1.nextCursor! }, store);
    expect(page2.items.length).toBe(3);

    const page3 = queryMessages({ limit: 3, cursor: page2.nextCursor! }, store);
    expect(page3.items.length).toBe(2);
    expect(page3.nextCursor).toBeNull();
  });
});

describe("queryMessages — took", () => {
  it("returns a non-negative took value", () => {
    const { took } = queryMessages({}, store);
    expect(took).toBeGreaterThanOrEqual(0);
  });
});
