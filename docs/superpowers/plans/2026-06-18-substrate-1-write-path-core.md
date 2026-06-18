# Substrate Plan 1 — Namespaced Write Path & Module Reducer Registry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Nexus's single mutation write path namespace-aware so a module can register a reducer for its own `namespace/KIND` mutations, those mutations persist/sync/broadcast through the existing pipeline unchanged, and mutations from a not-yet-installed module are stored harmlessly and replayed when the module registers.

**Architecture:** Pure extension of the existing write path. `recordMutation` → `applyMutation` (a `switch (m.kind)` in `src/state/mutations.ts`) currently silently no-ops on unknown kinds. We add: (1) a kind-namespace helper, (2) a `MutationKind` type that admits `namespace/KIND` strings, (3) an in-memory reducer registry, (4) a dispatch branch in `applyMutation` that routes namespaced kinds to the registry, and (5) a `replayModuleMutations` helper for late registration. The undo machinery is untouched — `_buildReverseEntry`/`_buildNonUndoableEntry` already default to `null`, so module mutations are non-undoable for now (by design; module-supplied inverses come in a later plan). The Rust path is **already namespace-safe** (verified — see "Verified invariants" below), so this plan is frontend-only.

**Tech Stack:** TypeScript, Vitest (`pnpm test`), Zustand-backed `LocalStore`. Test fixtures: `makeSeedStore` from `@/storage/__tests__/seed`.

---

## Verified invariants (already true in `main` — do not re-implement)

- **Rust records any kind unconditionally.** `VaultDb::apply_mutation` (`src-tauri/src/db/queries.rs:1196`) always `INSERT`s the mutation row before any per-kind handling, so namespaced kinds persist and sync via the relay.
- **Rust skips table side-effects gracefully.** `apply_mutation_to_tables` (`src-tauri/src/db/queries.rs:1221`) ends in a catch-all arm `other => log::debug!("apply_mutation: unhandled kind '{other}' (recorded in log only)")` (~line 1840) — unknown kinds no-op, never error.
- **The IPC command is kind-generic.** `commands::apply_mutation` (`src-tauri/src/commands/mod.rs:142`) takes `kind: String`, only branches on specific core kinds for local-first FS effects, and broadcasts every kind via `vault:mutation-applied`.
- **Module mutations are non-undoable today, for free.** `_buildReverseEntry` (`src/state/mutations.ts:133`) and `_buildNonUndoableEntry` (`:121`) both `return null` in their `default` arm, so a namespaced kind produces `undoEntry = null` and is never pushed to the undo stack.

## Out of scope (deferred to later substrate plans)

- Rust regression test locking the catch-all behavior (deferred to Plan 2, which builds a reusable `VaultDb` test harness once — `VaultDb::open(path, key)` exists at `src-tauri/src/db/mod.rs:15`).
- Module-supplied undo inverses (`buildReverse`).
- Event bus, links graph, manifest/capabilities/contribution points, namespaced storage.

---

## File Structure

- **Create** `src/state/mutationKind.ts` — pure helpers: `NAMESPACE_SEP`, `isNamespacedKind`, `kindNamespace`. One responsibility: parse a kind's namespace. No imports.
- **Create** `src/state/moduleReducers.ts` — the in-memory reducer registry: `ModuleApply`, `ModuleReducer`, `registerModuleReducer`, `getModuleReducer`, `_resetModuleReducers`. Type-only import of `LocalStore`.
- **Modify** `src/data/types.ts:449` — split the `MutationKind` union into `CoreMutationKind` + add `ModuleMutationKind` + re-form `MutationKind`.
- **Modify** `src/state/mutations.ts` — add two imports; add the dispatch branch at the top of `applyMutation` (`:343`); add `replayModuleMutations` near `replayMutations` (`:306`).
- **Create** tests: `src/state/__tests__/mutationKind.test.ts`, `src/state/__tests__/moduleReducers.test.ts`, `src/state/__tests__/moduleMutations.test.ts`, `src/data/__tests__/mutationKindType.test.ts`.

---

### Task 1: Kind-namespace helpers

**Files:**
- Create: `src/state/mutationKind.ts`
- Test: `src/state/__tests__/mutationKind.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/state/__tests__/mutationKind.test.ts
import { describe, it, expect } from "vitest";
import { isNamespacedKind, kindNamespace, NAMESPACE_SEP } from "@/state/mutationKind";

describe("mutationKind helpers", () => {
  it("treats a bare core kind as non-namespaced", () => {
    expect(isNamespacedKind("MOVE_TO_FOLDER")).toBe(false);
    expect(kindNamespace("MOVE_TO_FOLDER")).toBeNull();
  });

  it("treats a slash-delimited kind as namespaced", () => {
    expect(isNamespacedKind("com.acme.timer/START")).toBe(true);
    expect(kindNamespace("com.acme.timer/START")).toBe("com.acme.timer");
  });

  it("ignores a leading separator (no namespace before it)", () => {
    expect(isNamespacedKind("/START")).toBe(false);
    expect(kindNamespace("/START")).toBeNull();
  });

  it("splits on the first separator only", () => {
    expect(kindNamespace("a.b/c/d")).toBe("a.b");
  });

  it("exposes the separator constant", () => {
    expect(NAMESPACE_SEP).toBe("/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/state/__tests__/mutationKind.test.ts`
Expected: FAIL — `Failed to resolve import "@/state/mutationKind"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/state/mutationKind.ts
/**
 * Helpers for mutation-kind namespacing (substrate Pillar 1).
 *
 * Core kinds are bare identifiers (e.g. "MOVE_TO_FOLDER"). Module kinds carry a
 * reverse-DNS namespace and a separator (e.g. "com.acme.timer/START").
 * See docs/substrate-design.md §4.
 */

/** Separator between a module namespace and its kind. */
export const NAMESPACE_SEP = "/";

/** True when `kind` carries a module namespace (a separator with text before it). */
export function isNamespacedKind(kind: string): boolean {
  return kind.indexOf(NAMESPACE_SEP) > 0;
}

/**
 * Returns the module namespace for a namespaced kind, or `null` for a bare core
 * kind. Splits on the first separator: "a.b/c/d" -> "a.b".
 */
export function kindNamespace(kind: string): string | null {
  const idx = kind.indexOf(NAMESPACE_SEP);
  return idx > 0 ? kind.slice(0, idx) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/state/__tests__/mutationKind.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/state/mutationKind.ts src/state/__tests__/mutationKind.test.ts
git commit -m "feat(substrate): add mutation-kind namespace helpers"
```

---

### Task 2: Admit namespaced kinds in the `MutationKind` type

**Files:**
- Modify: `src/data/types.ts:449`
- Test: `src/data/__tests__/mutationKindType.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/data/__tests__/mutationKindType.test.ts
import { describe, it, expect } from "vitest";
import type { MutationKind } from "@/data/types";

describe("MutationKind type", () => {
  it("admits both core and module-namespaced kinds", () => {
    const core: MutationKind = "MOVE_TO_FOLDER";
    const mod: MutationKind = "com.acme.timer/START";
    expect(core).toBe("MOVE_TO_FOLDER");
    expect(mod).toBe("com.acme.timer/START");
  });
});
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `pnpm typecheck`
Expected: FAIL — `Type '"com.acme.timer/START"' is not assignable to type 'MutationKind'`.

- [ ] **Step 3: Edit `src/data/types.ts`**

Change the union declaration on line 449 from `export type MutationKind =` to `export type CoreMutationKind =` (leave every `| "..."` member and the closing `;` on line 540 exactly as-is). Then immediately after line 540 (before `export interface Mutation`), insert:

```ts
/**
 * A module-contributed mutation kind: a namespace, a "/" separator, and a kind,
 * e.g. "com.acme.timer/START". See docs/substrate-design.md §4.
 */
export type ModuleMutationKind = `${string}/${string}`;

/** Any mutation kind — a core kind or a module-namespaced one. */
export type MutationKind = CoreMutationKind | ModuleMutationKind;
```

- [ ] **Step 4: Run typecheck and the type test to verify they pass**

Run: `pnpm typecheck && pnpm test -- src/data/__tests__/mutationKindType.test.ts`
Expected: typecheck passes (0 errors); test PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/data/types.ts src/data/__tests__/mutationKindType.test.ts
git commit -m "feat(substrate): admit module-namespaced MutationKind values"
```

---

### Task 3: Module reducer registry

**Files:**
- Create: `src/state/moduleReducers.ts`
- Test: `src/state/__tests__/moduleReducers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/state/__tests__/moduleReducers.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerModuleReducer,
  getModuleReducer,
  _resetModuleReducers,
} from "@/state/moduleReducers";

beforeEach(() => {
  _resetModuleReducers();
});

describe("module reducer registry", () => {
  it("registers and retrieves a reducer by namespace", () => {
    const reducer = { apply: () => {} };
    registerModuleReducer("com.acme.timer", reducer);
    expect(getModuleReducer("com.acme.timer")).toBe(reducer);
  });

  it("returns undefined for an unregistered namespace", () => {
    expect(getModuleReducer("com.unknown")).toBeUndefined();
  });

  it("unregisters via the returned disposer", () => {
    const dispose = registerModuleReducer("com.acme.timer", { apply: () => {} });
    dispose();
    expect(getModuleReducer("com.acme.timer")).toBeUndefined();
  });

  it("rejects the reserved core namespace", () => {
    expect(() => registerModuleReducer("nexus", { apply: () => {} })).toThrow(/reserved/);
  });

  it("rejects double registration of the same namespace", () => {
    registerModuleReducer("com.acme.timer", { apply: () => {} });
    expect(() => registerModuleReducer("com.acme.timer", { apply: () => {} })).toThrow(/already/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/state/__tests__/moduleReducers.test.ts`
Expected: FAIL — `Failed to resolve import "@/state/moduleReducers"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/state/moduleReducers.ts
import type { LocalStore } from "@/storage/local";

/** Applies a module-namespaced mutation to the in-memory store (substrate Pillar 1). */
export type ModuleApply = (kind: string, payload: unknown, store: LocalStore) => void;

/** A module's reducer for the kinds in its namespace. */
export interface ModuleReducer {
  apply: ModuleApply;
}

/** Namespaces modules may not claim — reserved for the core write path. */
const RESERVED_NAMESPACES = new Set<string>(["nexus"]);

const _registry = new Map<string, ModuleReducer>();

/**
 * Register a reducer for a module namespace. Returns a disposer that
 * unregisters it. Throws on a reserved or already-registered namespace.
 */
export function registerModuleReducer(namespace: string, reducer: ModuleReducer): () => void {
  if (RESERVED_NAMESPACES.has(namespace)) {
    throw new Error(`Cannot register a reducer for reserved namespace "${namespace}"`);
  }
  if (_registry.has(namespace)) {
    throw new Error(`A reducer is already registered for namespace "${namespace}"`);
  }
  _registry.set(namespace, reducer);
  return () => {
    if (_registry.get(namespace) === reducer) _registry.delete(namespace);
  };
}

/** Returns the reducer registered for `namespace`, or `undefined`. */
export function getModuleReducer(namespace: string): ModuleReducer | undefined {
  return _registry.get(namespace);
}

/** Test-only: clear all registered reducers. */
export function _resetModuleReducers(): void {
  _registry.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/state/__tests__/moduleReducers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/state/moduleReducers.ts src/state/__tests__/moduleReducers.test.ts
git commit -m "feat(substrate): add module reducer registry"
```

---

### Task 4: Dispatch namespaced mutations in `applyMutation`

**Files:**
- Modify: `src/state/mutations.ts:343` (add imports near top + dispatch branch)
- Test: `src/state/__tests__/moduleMutations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/state/__tests__/moduleMutations.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { makeSeedStore } from "@/storage/__tests__/seed";
import { recordMutation } from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";

let store: LocalStore;

beforeEach(() => {
  store = makeSeedStore();
  _resetModuleReducers();
});

describe("module mutation dispatch", () => {
  it("routes a namespaced mutation to the registered module reducer", () => {
    const seen: Array<{ kind: string; payload: unknown }> = [];
    registerModuleReducer("com.acme.timer", {
      apply: (kind, payload) => seen.push({ kind, payload }),
    });

    recordMutation("com.acme.timer/START", { id: "t1" }, store);

    expect(seen).toEqual([{ kind: "com.acme.timer/START", payload: { id: "t1" } }]);
  });

  it("records an unknown namespaced mutation without throwing and without a reducer", () => {
    expect(() => recordMutation("com.unknown/PING", { x: 1 }, store)).not.toThrow();
    const last = store.mutations[store.mutations.length - 1];
    expect(last.kind).toBe("com.unknown/PING");
  });

  it("logs module mutations so they sync and can replay", () => {
    registerModuleReducer("com.acme.timer", { apply: () => {} });
    recordMutation("com.acme.timer/START", { id: "t1" }, store);
    expect(store.mutations.map((m) => m.kind)).toContain("com.acme.timer/START");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/state/__tests__/moduleMutations.test.ts`
Expected: FAIL — first test fails (`seen` is empty), because `applyMutation` does not yet dispatch to the registry.

- [ ] **Step 3: Add the imports**

Near the other imports at the top of `src/state/mutations.ts` (the file already imports from `@/storage/tauri`), add:

```ts
import { kindNamespace } from "@/state/mutationKind";
import { getModuleReducer } from "@/state/moduleReducers";
```

- [ ] **Step 4: Add the dispatch branch**

In `src/state/mutations.ts`, change the start of `applyMutation` (line 343) from:

```ts
export function applyMutation(m: Mutation, store: LocalStore): void {
  switch (m.kind) {
```

to:

```ts
export function applyMutation(m: Mutation, store: LocalStore): void {
  const ns = kindNamespace(m.kind);
  if (ns !== null) {
    // Module-namespaced mutation: dispatch to the registered module reducer.
    // If the module isn't registered in this window, the mutation is still
    // recorded in the log (appendMutation / SQLite) and will be replayed when
    // the module registers — see replayModuleMutations. (substrate §4.2)
    getModuleReducer(ns)?.apply(m.kind, m.payload, store);
    return;
  }
  switch (m.kind) {
```

(The existing `switch` body and its closing braces are unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- src/state/__tests__/moduleMutations.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full mutation suite to confirm no regression**

Run: `pnpm test -- src/state/__tests__`
Expected: PASS (all existing mutation/replay/remote-mutation tests still green).

- [ ] **Step 7: Commit**

```bash
git add src/state/mutations.ts src/state/__tests__/moduleMutations.test.ts
git commit -m "feat(substrate): dispatch namespaced mutations to module reducers"
```

---

### Task 5: `replayModuleMutations` for late registration

**Files:**
- Modify: `src/state/mutations.ts` (add function near `replayMutations` at `:306`)
- Test: `src/state/__tests__/moduleMutations.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to the existing describe block)**

Add this `import` to the top of `src/state/__tests__/moduleMutations.test.ts`:

```ts
import { recordMutation, replayModuleMutations } from "@/state/mutations";
```

(Replace the existing `import { recordMutation } from "@/state/mutations";` line — do not add a duplicate import.)

Then add this test inside the `describe("module mutation dispatch", ...)` block:

```ts
  it("replays logged namespaced mutations when a module registers late", () => {
    // Mutations arrive before the module is registered (e.g. synced from another
    // device). With no reducer, recordMutation logs them and no-ops on apply.
    recordMutation("com.acme.timer/START", { id: "t1" }, store);
    recordMutation("com.acme.timer/STOP", { id: "t1" }, store);

    const seen: string[] = [];
    registerModuleReducer("com.acme.timer", { apply: (kind) => seen.push(kind) });

    replayModuleMutations("com.acme.timer", store);

    expect(seen).toEqual(["com.acme.timer/START", "com.acme.timer/STOP"]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/state/__tests__/moduleMutations.test.ts`
Expected: FAIL — `replayModuleMutations is not a function` / import unresolved.

- [ ] **Step 3: Implement `replayModuleMutations`**

In `src/state/mutations.ts`, immediately after the `replayMutations` function (ends at `:312`), add:

```ts
/**
 * Replay all logged mutations for a module namespace onto the store. A module
 * calls this when it registers (often after hydration) to rebuild its
 * projection from the mutation log — including mutations that arrived from other
 * devices while the module was not installed. (substrate §4.2, P5)
 */
export function replayModuleMutations(namespace: string, store: LocalStore): void {
  for (const m of store.mutations) {
    if (kindNamespace(m.kind) === namespace) applyMutation(m, store);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/state/__tests__/moduleMutations.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Full verification**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green (tests pass, 0 type errors, 0 lint warnings).

- [ ] **Step 6: Commit**

```bash
git add src/state/mutations.ts src/state/__tests__/moduleMutations.test.ts
git commit -m "feat(substrate): replay module mutations on late registration"
```

---

## Self-Review (completed by author)

**Spec coverage** (against `docs/substrate-design.md` §4):
- §4.1 namespacing convention → Tasks 1, 2 (helpers + type).
- §4.2 reducer registry + dispatch → Tasks 3, 4.
- §4.2 unknown-kind handling (stored, not reduced) → Task 4 test 2 (frontend) + "Verified invariants" (Rust, by inspection; Rust test deferred to Plan 2 — recorded as deliberate scope, not a gap).
- §4.2 late-registration replay → Task 5.
- §4.3 undo/sync/multi-window unchanged → untouched by design (see "Verified invariants"); the Task 4 Step 6 full-suite run guards regression.
- Provenance envelope (§4.4), links (Pillar 3), event bus (Pillar 2), manifest/capabilities (Pillar 4) → later plans, listed under "Out of scope".

**Placeholder scan:** none — every code/edit step shows complete content and exact run commands.

**Type consistency:** `ModuleReducer.apply` signature `(kind, payload, store)` is identical in Task 3 (definition), Task 4 (`getModuleReducer(ns)?.apply(m.kind, m.payload, store)`), and all test fakes. `kindNamespace` returns `string | null` and is compared with `!== null` (Task 4) and `=== namespace` (Task 5). `MutationKind = CoreMutationKind | ModuleMutationKind` is used by `Mutation.kind` (unchanged interface) and accepted by `recordMutation`/`applyMutation` without signature changes.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-18-substrate-1-write-path-core.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
