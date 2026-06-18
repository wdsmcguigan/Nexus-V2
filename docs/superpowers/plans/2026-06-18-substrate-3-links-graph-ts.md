# Substrate Plan 3 — Links / Relations Graph: TypeScript layer (Pillar 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Add the typed relations graph on the frontend — a generic `links` store with `CREATE_LINK`/`DELETE_LINK` core mutations and a traversal API (`linksFrom`/`linksTo`/`neighbors`) — so any module can connect its entities to core entities (an email ↔ a task ↔ a timer). This is the substrate the AI layer will later traverse.

**Architecture:** Links are first-class entities created/removed through the existing mutation pipeline (so they sync, undo, and broadcast for free). `CREATE_LINK`/`DELETE_LINK` are core mutation kinds with reducer cases that put/delete a `Link` in the in-memory `LocalStore`. A pure-function module `src/state/linksGraph.ts` queries the store both directions. Undo is supported via reverse entries. Rust persistence + hydration of the `links` table is **Plan 4** — until then, link mutations are recorded in the Rust mutations log (the write path records every kind) and live in the in-memory store for the session. (substrate-design.md Pillar 3, §6.)

**Tech Stack:** TypeScript, Vitest (`pnpm test`). Pure frontend. `@/` maps to `src/`. Builds on Plans 1–2.

---

## Verified current patterns (mirror these)

- `LocalStore` (`src/storage/local.ts`) holds each entity in a `Map<string, T>` (e.g. `savedViews = new Map<string, SavedView>()` at `:80`), with `putX`/`deleteX` methods (e.g. `putSavedView`/`deleteSavedView` at `:674`/`:679`), a snapshot type whose fields are optional arrays (e.g. `savedViews?: SavedView[]` at `:43`), a `hydrate(snap)` method that `.clear()`s each Map then ingests (e.g. `for (const v of (snap.savedViews ?? [])) this.savedViews.set(v.id, v);` at `:172`), and a snapshot serializer (e.g. `savedViews: Array.from(this.savedViews.values()),` at `:230`).
- `src/state/mutations.ts`: reducer `applyMutation` `switch (m.kind)` (core cases); `_buildReverseEntryInner` (`:142`) returns undo steps per kind; typed helpers near `:1103` (`saveView`/`deleteView`) call `recordMutation`.
- `MutationKind` is `CoreMutationKind | ModuleMutationKind` (`src/data/types.ts:449`+, after Plan 1). Add new core kinds to the `CoreMutationKind` union.
- `SavedView` interface at `src/data/types.ts:434` — mirror its export style.

## Out of scope (Plan 4)

- Rust `links` table, `CREATE_LINK`/`DELETE_LINK` SQL arms, `load_links` hydration.
- The reusable `VaultDb` test harness + Rust regression tests.

---

## File Structure

- **Modify** `src/data/types.ts` — add `Link` interface; add `"CREATE_LINK"` and `"DELETE_LINK"` to `CoreMutationKind`.
- **Modify** `src/storage/local.ts` — `links` Map, `putLink`/`deleteLink`, snapshot type field, clear, hydrate ingest, snapshot serialize.
- **Modify** `src/state/mutations.ts` — reducer cases, undo entries, `createLink`/`deleteLink` helpers.
- **Create** `src/state/linksGraph.ts` — traversal API.
- **Create** tests: `src/state/__tests__/links.test.ts`, `src/state/__tests__/linksGraph.test.ts`.

---

### Task 1: `Link` type + `CREATE_LINK`/`DELETE_LINK` kinds

**Files:**
- Modify: `src/data/types.ts`
- Test: `src/data/__tests__/linkType.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/data/__tests__/linkType.test.ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm typecheck`
Expected: FAIL — `Link` not exported and `"CREATE_LINK"`/`"DELETE_LINK"` not assignable to `MutationKind`.

- [ ] **Step 3: Edit `src/data/types.ts`**

(a) In the `CoreMutationKind` union, find the "Saved view ops" group:
```ts
  // Saved view ops (EP-1)
  | "SAVE_VIEW"
  | "DELETE_VIEW"
  | "RENAME_VIEW"
```
Immediately after the `| "RENAME_VIEW"` line, add:
```ts
  // Link / relations graph ops (substrate Pillar 3)
  | "CREATE_LINK"
  | "DELETE_LINK"
```

(b) Immediately after the `export interface SavedView { ... }` block (find its closing `}`), add:
```ts

// ─── LNK — Link (substrate Pillar 3) ─────────────────────────────────────────
// A typed edge between two entities. Either endpoint may be a core entity
// (e.g. "nexus/email.message") or a module entity (e.g. "org.nexus.tasks/task").

export interface Link {
  id: string;
  vaultId: string;
  /** ENT type of the source, e.g. "nexus/email.message". */
  srcType: string;
  srcId: string;
  /** Edge label, e.g. "derived-from", "tracks", "mentions". */
  linkType: string;
  /** ENT type of the destination. */
  dstType: string;
  dstId: string;
  /** Optional edge metadata. */
  meta?: unknown;
  /** Unix ms. */
  createdAt: number;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm typecheck && pnpm test -- src/data/__tests__/linkType.test.ts`
Expected: 0 type errors; test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/types.ts src/data/__tests__/linkType.test.ts
git commit -m "feat(substrate): add Link type and link mutation kinds"
```

---

### Task 2: `links` storage in `LocalStore`

**Files:**
- Modify: `src/storage/local.ts`
- Test: `src/storage/__tests__/links.store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/storage/__tests__/links.store.test.ts
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
    } as Parameters<typeof store.hydrate>[0]);
    expect(store.links.get("stale")).toBeUndefined();
    expect(store.links.get("lnk-2")?.dstId).toBe("t-1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/storage/__tests__/links.store.test.ts`
Expected: FAIL — `store.putLink is not a function`.

- [ ] **Step 3: Edit `src/storage/local.ts`**

(a) Ensure `Link` is imported from `@/data/types` (add it to the existing type import list from that module).

(b) In the snapshot/hydrate input type (the interface/type that has `savedViews?: SavedView[];`), add alongside it:
```ts
  links?: Link[];
```

(c) Near the other `Map` field declarations (where `savedViews = new Map<string, SavedView>();` is), add:
```ts
  links = new Map<string, Link>();
```

(d) In the `hydrate` method's clear section (where `this.savedViews.clear();` and the other `.clear()` calls are — add it next to the cleared Maps; if `savedViews` is cleared implicitly elsewhere, add `this.links.clear();` with the block of `.clear()` calls near `this.calendars.clear();`):
```ts
    this.links.clear();
```

(e) In the `hydrate` ingest section, next to `for (const v of (snap.savedViews ?? [])) this.savedViews.set(v.id, v);`, add:
```ts
    for (const lk of (snap.links ?? [])) this.links.set(lk.id, lk);
```

(f) In the snapshot serializer object (where `savedViews: Array.from(this.savedViews.values()),` is), add:
```ts
      links: Array.from(this.links.values()),
```

(g) Near `putSavedView`/`deleteSavedView`, add:
```ts
  putLink(link: Link): void {
    this.links.set(link.id, link);
  }

  deleteLink(id: string): void {
    this.links.delete(id);
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/storage/__tests__/links.store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full check + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint` (all green). Then:
```bash
git add src/storage/local.ts src/storage/__tests__/links.store.test.ts
git commit -m "feat(substrate): add links storage to LocalStore"
```

---

### Task 3: Reducer cases, undo, and `createLink`/`deleteLink` helpers

**Files:**
- Modify: `src/state/mutations.ts`
- Test: `src/state/__tests__/links.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/state/__tests__/links.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import {
  createLink,
  deleteLink,
  undoLastMutation,
} from "@/state/mutations";

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
      srcType: "a",
      srcId: "1",
      linkType: "rel",
      dstType: "b",
      dstId: "2",
    });
    deleteLink(store, link.id);
    expect(store.links.get(link.id)).toBeUndefined();
  });

  it("undo of createLink removes the link", () => {
    const link = createLink(store, {
      srcType: "a",
      srcId: "1",
      linkType: "rel",
      dstType: "b",
      dstId: "2",
    });
    undoLastMutation(store);
    expect(store.links.get(link.id)).toBeUndefined();
  });

  it("undo of deleteLink restores the link", () => {
    const link = createLink(store, {
      srcType: "a",
      srcId: "1",
      linkType: "rel",
      dstType: "b",
      dstId: "2",
    });
    deleteLink(store, link.id);
    undoLastMutation(store);
    expect(store.links.get(link.id)?.linkType).toBe("rel");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/state/__tests__/links.test.ts`
Expected: FAIL — `createLink` is not exported.

- [ ] **Step 3: Add reducer cases in `applyMutation`**

In `src/state/mutations.ts`, inside the `applyMutation` `switch (m.kind)`, add two cases near the saved-view cases (`case "SAVE_VIEW":`):

```ts
    case "CREATE_LINK": {
      store.putLink(m.payload as Link);
      break;
    }
    case "DELETE_LINK": {
      const { linkId } = m.payload as { linkId: string };
      store.deleteLink(linkId);
      break;
    }
```

(Ensure `Link` is imported in this file from `@/data/types` — add it to the existing type import if absent.)

- [ ] **Step 4: Add undo entries in `_buildReverseEntryInner`**

In `_buildReverseEntryInner` (`src/state/mutations.ts:142`), add two cases before the `default: return null;`:

```ts
    case "CREATE_LINK": {
      const link = payload as Link;
      return {
        forwardSteps: forward,
        reverseSteps: [{ kind: "DELETE_LINK", payload: { linkId: link.id } }],
        description: "Link",
      };
    }

    case "DELETE_LINK": {
      const { linkId } = payload as { linkId: string };
      const existing = store.links.get(linkId);
      if (!existing) return null;
      return {
        forwardSteps: forward,
        reverseSteps: [{ kind: "CREATE_LINK", payload: existing }],
        description: "Unlink",
      };
    }
```

- [ ] **Step 5: Add the `createLink`/`deleteLink` helpers**

In the typed-mutation-helpers section (near `saveView`/`deleteView`, around `:1103`), add:

```ts
/**
 * Create a typed edge between two entities. Returns the full Link (with a
 * generated id). Flows through recordMutation so it syncs, undoes, and
 * broadcasts. (substrate Pillar 3)
 */
export function createLink(
  store: LocalStore,
  spec: {
    srcType: string;
    srcId: string;
    linkType: string;
    dstType: string;
    dstId: string;
    meta?: unknown;
  },
): Link {
  const link: Link = {
    id: `lnk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    vaultId: store.vault?.id ?? "local",
    srcType: spec.srcType,
    srcId: spec.srcId,
    linkType: spec.linkType,
    dstType: spec.dstType,
    dstId: spec.dstId,
    meta: spec.meta,
    createdAt: Date.now(),
  };
  recordMutation("CREATE_LINK", link, store);
  return link;
}

/** Remove a link by id. */
export function deleteLink(store: LocalStore, linkId: string): void {
  recordMutation("DELETE_LINK", { linkId }, store);
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm test -- src/state/__tests__/links.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Full check + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint` (all green). Then:
```bash
git add src/state/mutations.ts src/state/__tests__/links.test.ts
git commit -m "feat(substrate): link mutations with undo support"
```

---

### Task 4: Graph traversal API

**Files:**
- Create: `src/state/linksGraph.ts`
- Test: `src/state/__tests__/linksGraph.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/state/__tests__/linksGraph.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { createLink } from "@/state/mutations";
import { linksFrom, linksTo, neighbors } from "@/state/linksGraph";

let store: LocalStore;

beforeEach(() => {
  store = new LocalStore();
  // email m-1 --derived-from--> task t-1
  createLink(store, {
    srcType: "nexus/email.message",
    srcId: "m-1",
    linkType: "derived-from",
    dstType: "org.nexus.tasks/task",
    dstId: "t-1",
  });
  // timer w-1 --tracks--> task t-1
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/state/__tests__/linksGraph.test.ts`
Expected: FAIL — `Failed to resolve import "@/state/linksGraph"`.

- [ ] **Step 3: Create `src/state/linksGraph.ts`**

```ts
import type { LocalStore } from "@/storage/local";
import type { Link } from "@/data/types";

/** A graph neighbor: the entity on the other end of a link. */
export interface Neighbor {
  type: string;
  id: string;
  via: Link;
}

/** Outgoing links from (srcType, srcId), optionally filtered by linkType. */
export function linksFrom(
  store: LocalStore,
  srcType: string,
  srcId: string,
  linkType?: string,
): Link[] {
  const out: Link[] = [];
  for (const l of store.links.values()) {
    if (l.srcType === srcType && l.srcId === srcId && (linkType === undefined || l.linkType === linkType)) {
      out.push(l);
    }
  }
  return out;
}

/** Incoming links to (dstType, dstId), optionally filtered by linkType. */
export function linksTo(
  store: LocalStore,
  dstType: string,
  dstId: string,
  linkType?: string,
): Link[] {
  const out: Link[] = [];
  for (const l of store.links.values()) {
    if (l.dstType === dstType && l.dstId === dstId && (linkType === undefined || l.linkType === linkType)) {
      out.push(l);
    }
  }
  return out;
}

/**
 * All entities directly linked to (entType, id), in either direction. The
 * `via` link is included so callers can see the edge label. (substrate Pillar 3)
 */
export function neighbors(
  store: LocalStore,
  entType: string,
  id: string,
  linkType?: string,
): Neighbor[] {
  const result: Neighbor[] = [];
  for (const l of linksFrom(store, entType, id, linkType)) {
    result.push({ type: l.dstType, id: l.dstId, via: l });
  }
  for (const l of linksTo(store, entType, id, linkType)) {
    result.push({ type: l.srcType, id: l.srcId, via: l });
  }
  return result;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/state/__tests__/linksGraph.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Full check + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint` (all green). Then:
```bash
git add src/state/linksGraph.ts src/state/__tests__/linksGraph.test.ts
git commit -m "feat(substrate): links graph traversal API"
```

---

## Self-Review (completed by author)

**Spec coverage** (design §6): generic typed edges (§6.1) → Task 1 `Link`; links-are-mutations + undo (§6.2) → Task 3; entity-type-agnostic traversal (§6.3) → Task 4 (`linksFrom`/`linksTo`/`neighbors` take arbitrary `entType` strings, so a module links to a core entity it can't read). Rust persistence/hydration (§6.2 durability) → Plan 4, explicitly out of scope.

**Placeholder scan:** none — full code in every step. The store edits (Task 2 b–g) are anchored on the existing `savedViews` lines so the implementer can locate them without absolute line numbers.

**Type consistency:** `Link` fields (`id`, `vaultId`, `srcType`, `srcId`, `linkType`, `dstType`, `dstId`, `meta?`, `createdAt`) are identical across Task 1 (definition), Task 2 (`putLink`), Task 3 (reducer cast `m.payload as Link`, `createLink` builder, undo `CREATE_LINK` payload = the `Link`, `DELETE_LINK` payload = `{ linkId }`), and Task 4 (traversal). `createLink`'s `spec` omits `id`/`vaultId`/`createdAt` (generated) — matches the reducer/undo which use the full `Link`. `DELETE_LINK` payload is `{ linkId }` everywhere (helper, reducer, undo reverse-step for `CREATE_LINK`).

---

## Execution Handoff

Execute with superpowers:subagent-driven-development or inline. Four tasks, pure frontend, each green + committed. After this, Plan 4 adds Rust persistence + hydration + the deferred test harness.
