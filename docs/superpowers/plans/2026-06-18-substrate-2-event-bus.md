# Substrate Plan 2 — In-Process Event Bus (Pillar 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give modules a public pub/sub bus so they can react to applied mutations (their own or others') without compile-time knowledge of each other — "Calendar wakes up when a `com.x/CREATE_TASK` with a due date lands" — built as a thin generalization of the existing write path.

**Architecture:** A standalone `src/state/eventBus.ts` with `subscribe(glob, handler)` and an `emit(mutation)` the write path calls. `applyMutation` is the choke point for *all* mutation application (live record, sibling-window remote, and replay), but events must fire only for **live** mutations, not during state-reconstruction replay. So we emit from the two live callers — `recordMutation` and `applyRemoteMutation` — and NOT from `replayMutations`/`replayModuleMutations`. Handlers are observers (they react by emitting their own mutations, never veto). Reaction cascades are bounded by a depth cap. Bus subscribers register in the main window only (consistent with existing worker gating); popout windows have no subscribers, so emit there is a harmless no-op. (substrate-design.md Pillar 2, §5.)

**Tech Stack:** TypeScript, Vitest (`pnpm test`). Pure frontend. `@/` maps to `src/`. Builds directly on Plan 1 (`src/state/mutationKind.ts`, the namespaced write path).

---

## Verified current code

- `src/state/mutations.ts`:
  - `recordMutation(kind, payload, store)` (`:261`) — builds the `Mutation`, `store.appendMutation`, `applyMutation`, undo handling, fire-and-forget `applyMutationIpc`, then `return mutation;` (`:299`).
  - `replayMutations(mutations, store)` (`:306`) — loops `applyMutation` over historical mutations. **Must NOT fire the bus.**
  - `applyRemoteMutation(kind, payload, lamport, store)` (`:321`) — builds a `Mutation`, calls `applyMutation(mutation, store)` (`:337`), then returns. **Live — must fire the bus.**
  - `replayModuleMutations(namespace, store)` (added in Plan 1) — loops `applyMutation`. **Must NOT fire the bus.**
- `Mutation` interface: `src/data/types.ts:542` — `{ id, vaultId, deviceId, ts, lamport, kind: MutationKind, payload }`.
- Test fixtures: `makeSeedStore`, `VAULT_ID` from `@/storage/__tests__/seed`. In test mode `isTauri()` is false (no IPC).

## Out of scope (later plans)

- Capability enforcement for `bus.subscribe` (vocabulary lives in the design doc; runtime gating is the module-model plan).
- Cross-window event delivery semantics beyond "main window only" (popouts already receive projected state via `applyRemoteMutation`).
- Links graph, module manifest/contribution points.

---

## File Structure

- **Create** `src/state/eventBus.ts` — the bus: `BusHandler` type, `matchesGlob`, `subscribe`, `emit`, `_resetEventBus`, `MAX_REACTION_DEPTH`. One responsibility: in-process pub/sub over applied mutations.
- **Modify** `src/state/mutations.ts` — one import; one `emit(mutation)` call in `recordMutation`; one in `applyRemoteMutation`.
- **Create** tests: `src/state/__tests__/eventBus.test.ts`, `src/state/__tests__/eventBusWiring.test.ts`.

---

### Task 1: The event bus module

**Files:**
- Create: `src/state/eventBus.ts`
- Test: `src/state/__tests__/eventBus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/state/__tests__/eventBus.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  subscribe,
  emit,
  matchesGlob,
  _resetEventBus,
  MAX_REACTION_DEPTH,
} from "@/state/eventBus";
import type { Mutation } from "@/data/types";

function mut(kind: string): Mutation {
  return { id: "m", vaultId: "v", deviceId: "d", ts: 0, lamport: 1, kind, payload: {} };
}

beforeEach(() => {
  _resetEventBus();
});

describe("eventBus matchesGlob", () => {
  it("matches all with '*'", () => {
    expect(matchesGlob("*", "READ")).toBe(true);
    expect(matchesGlob("*", "com.acme.timer/START")).toBe(true);
  });

  it("matches a namespace prefix with 'ns/*'", () => {
    expect(matchesGlob("com.acme.timer/*", "com.acme.timer/START")).toBe(true);
    expect(matchesGlob("com.acme.timer/*", "com.other/START")).toBe(false);
  });

  it("matches an exact kind", () => {
    expect(matchesGlob("READ", "READ")).toBe(true);
    expect(matchesGlob("READ", "UNREAD")).toBe(false);
  });
});

describe("eventBus subscribe/emit", () => {
  it("delivers a matching mutation to a subscriber", () => {
    const got: string[] = [];
    subscribe("com.acme.timer/*", (m) => got.push(m.kind));
    emit(mut("com.acme.timer/START"));
    emit(mut("com.other/NOPE"));
    expect(got).toEqual(["com.acme.timer/START"]);
  });

  it("stops delivering after unsubscribe", () => {
    const got: string[] = [];
    const dispose = subscribe("*", (m) => got.push(m.kind));
    emit(mut("READ"));
    dispose();
    emit(mut("UNREAD"));
    expect(got).toEqual(["READ"]);
  });

  it("bounds reaction cascades at MAX_REACTION_DEPTH", () => {
    let calls = 0;
    // A handler that re-emits on every event would recurse forever without the cap.
    subscribe("*", () => {
      calls += 1;
      emit(mut("com.loop/AGAIN"));
    });
    emit(mut("com.loop/START"));
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThanOrEqual(MAX_REACTION_DEPTH);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/state/__tests__/eventBus.test.ts`
Expected: FAIL — `Failed to resolve import "@/state/eventBus"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/state/eventBus.ts
import type { Mutation } from "@/data/types";

/** A handler invoked when an applied mutation matches the subscription. */
export type BusHandler = (mutation: Mutation) => void;

interface Subscription {
  glob: string;
  handler: BusHandler;
}

/** Max reaction-cascade depth before the bus stops dispatching and logs. (substrate §5.2) */
export const MAX_REACTION_DEPTH = 8;

const _subscriptions = new Set<Subscription>();
let _depth = 0;

/**
 * True if `kind` matches `glob`: "*" (all), "ns/*" (namespace prefix), or an
 * exact kind string.
 */
export function matchesGlob(glob: string, kind: string): boolean {
  if (glob === "*") return true;
  if (glob.endsWith("/*")) return kind.startsWith(glob.slice(0, -1));
  return glob === kind;
}

/**
 * Subscribe to applied mutations whose kind matches `glob`. Returns a disposer.
 * Handlers are observers — they react by emitting their own mutations, they
 * cannot veto the triggering mutation. (substrate Pillar 2, §5)
 */
export function subscribe(glob: string, handler: BusHandler): () => void {
  const sub: Subscription = { glob, handler };
  _subscriptions.add(sub);
  return () => {
    _subscriptions.delete(sub);
  };
}

/**
 * Notify subscribers of an applied mutation. Called by the write path after a
 * *live* mutation commits (not during replay). Bounded against runaway reaction
 * cascades by MAX_REACTION_DEPTH. Not intended to be called by modules.
 */
export function emit(mutation: Mutation): void {
  if (_depth >= MAX_REACTION_DEPTH) {
    console.warn(
      `[eventBus] reaction cascade hit depth ${MAX_REACTION_DEPTH} at "${mutation.kind}" — dropping further reactions`,
    );
    return;
  }
  _depth += 1;
  try {
    for (const sub of [..._subscriptions]) {
      if (matchesGlob(sub.glob, mutation.kind)) sub.handler(mutation);
    }
  } finally {
    _depth -= 1;
  }
}

/** Test-only: clear all subscriptions and reset cascade depth. */
export function _resetEventBus(): void {
  _subscriptions.clear();
  _depth = 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/state/__tests__/eventBus.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/state/eventBus.ts src/state/__tests__/eventBus.test.ts
git commit -m "feat(substrate): add in-process event bus"
```

---

### Task 2: Emit on live mutations only

**Files:**
- Modify: `src/state/mutations.ts` (one import; emit in `recordMutation` and `applyRemoteMutation`)
- Test: `src/state/__tests__/eventBusWiring.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/state/__tests__/eventBusWiring.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type { LocalStore } from "@/storage/local";
import { makeSeedStore } from "@/storage/__tests__/seed";
import {
  recordMutation,
  replayMutations,
  applyRemoteMutation,
} from "@/state/mutations";
import { subscribe, _resetEventBus } from "@/state/eventBus";
import type { Mutation } from "@/data/types";

let store: LocalStore;

beforeEach(() => {
  store = makeSeedStore();
  _resetEventBus();
});

describe("event bus wiring", () => {
  it("fires the bus for a live recorded mutation", () => {
    const got: string[] = [];
    subscribe("*", (m) => got.push(m.kind));
    recordMutation("com.test/PING", { x: 1 }, store);
    expect(got).toEqual(["com.test/PING"]);
  });

  it("fires the bus for a remote (sibling-window) mutation", () => {
    const got: string[] = [];
    subscribe("com.test/*", (m) => got.push(m.kind));
    applyRemoteMutation("com.test/REMOTE", { x: 1 }, 99, store);
    expect(got).toEqual(["com.test/REMOTE"]);
  });

  it("does NOT fire the bus during replay (state reconstruction)", () => {
    let count = 0;
    subscribe("*", () => {
      count += 1;
    });
    const m: Mutation = {
      id: "m1",
      vaultId: "v",
      deviceId: "d",
      ts: 0,
      lamport: 1,
      kind: "com.test/PING",
      payload: {},
    };
    replayMutations([m], store);
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/state/__tests__/eventBusWiring.test.ts`
Expected: FAIL — first test fails (`got` is empty; the write path doesn't emit yet).

- [ ] **Step 3: Add the import**

Near the other imports at the top of `src/state/mutations.ts`, add:

```ts
import { emit as emitBusEvent } from "@/state/eventBus";
```

- [ ] **Step 4: Emit in `recordMutation`**

In `src/state/mutations.ts`, find the end of `recordMutation` where it currently reads:

```ts
  // Fire-and-forget persistence to SQLite in Tauri mode
  if (isTauri()) {
    applyMutationIpc(kind, payload, mutation.deviceId, mutation.lamport).catch((e) =>
      console.warn("IPC mutation persist failed:", e),
    );
  }

  return mutation;
}
```

Insert the bus emit immediately before `return mutation;`:

```ts
  // Fire-and-forget persistence to SQLite in Tauri mode
  if (isTauri()) {
    applyMutationIpc(kind, payload, mutation.deviceId, mutation.lamport).catch((e) =>
      console.warn("IPC mutation persist failed:", e),
    );
  }

  // Notify the in-process event bus (live mutation only — replay does not emit).
  emitBusEvent(mutation);

  return mutation;
}
```

- [ ] **Step 5: Emit in `applyRemoteMutation`**

In `src/state/mutations.ts`, find the end of `applyRemoteMutation` where it currently reads:

```ts
  applyMutation(mutation, store);
}
```

(the closing brace of `applyRemoteMutation`, immediately after the `applyMutation(mutation, store);` call near line 337). Change it to:

```ts
  applyMutation(mutation, store);
  emitBusEvent(mutation);
}
```

Leave `replayMutations` and `replayModuleMutations` unchanged (they must not emit).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test -- src/state/__tests__/eventBusWiring.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Full verification**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green (no regression in the Plan 1 mutation/replay tests, 0 type errors, 0 lint warnings).

- [ ] **Step 8: Commit**

```bash
git add src/state/mutations.ts src/state/__tests__/eventBusWiring.test.ts
git commit -m "feat(substrate): emit bus events on live mutations"
```

---

### Task 3: Cross-module reaction through the real pipeline

**Files:**
- Test only: `src/state/__tests__/eventBusWiring.test.ts` (append)

- [ ] **Step 1: Append the failing test**

Add this test inside the existing `describe("event bus wiring", ...)` block in `src/state/__tests__/eventBusWiring.test.ts`:

```ts
  it("delivers a reaction mutation a handler emits, bounded against loops", () => {
    const reacted: string[] = [];

    // Module A reacts to its trigger by recording a Module B mutation.
    subscribe("com.a/*", () => {
      recordMutation("com.b/REACT", {}, store);
    });
    // Module B observes.
    subscribe("com.b/*", (m) => reacted.push(m.kind));

    recordMutation("com.a/GO", {}, store);

    expect(reacted).toEqual(["com.b/REACT"]);
  });

  it("bounds an infinite reaction loop without throwing", () => {
    // A handler that re-records its own trigger would loop forever.
    subscribe("com.loop/*", () => {
      recordMutation("com.loop/AGAIN", {}, store);
    });

    expect(() => recordMutation("com.loop/AGAIN", {}, store)).not.toThrow();

    const loops = store.mutations.filter((m) => m.kind === "com.loop/AGAIN").length;
    expect(loops).toBeGreaterThan(1); // it did cascade
    expect(loops).toBeLessThan(50); // but the depth cap stopped it
  });
```

- [ ] **Step 2: Run test to verify it passes**

These exercise behavior already implemented in Tasks 1-2 (the bus fires from `recordMutation`, and `emit`'s depth cap bounds reentrancy). Run: `pnpm test -- src/state/__tests__/eventBusWiring.test.ts`
Expected: PASS (5 tests total). If the loop test instead hangs or throws a stack-overflow, the depth cap in `src/state/eventBus.ts` is not protecting reentrant `recordMutation` → STOP and report BLOCKED (the cap may need to guard at emit-entry, which it does — re-read `emit`).

- [ ] **Step 3: Full verification**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/state/__tests__/eventBusWiring.test.ts
git commit -m "test(substrate): cover cross-module reactions and loop bounding"
```

---

## Self-Review (completed by author)

**Spec coverage** (design §5): pub/sub by kind glob → Task 1; emit on live mutations only (not replay) → Task 2 (the three-way test: record fires, remote fires, replay doesn't); observer-not-interceptor + reaction cascades + loop bound → Tasks 1 & 3; main-window-only → satisfied structurally (subscribers register in main; popouts have none) and noted, no code needed; capability `bus.subscribe` → deferred (out of scope).

**Placeholder scan:** none — every step shows full code and exact commands.

**Type consistency:** `BusHandler = (mutation: Mutation) => void` is used by `subscribe` and every test handler. `emit(mutation: Mutation)` is imported into `mutations.ts` as `emitBusEvent` and called with the local `mutation: Mutation` in both `recordMutation` and `applyRemoteMutation`. `matchesGlob(glob, kind)` and `MAX_REACTION_DEPTH` are exported and exercised by Task 1 tests.

---

## Execution Handoff

Execute with superpowers:subagent-driven-development (fresh subagent per task + review) or inline. Three tasks; pure frontend; each ends green + committed.
