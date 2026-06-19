# Tasks Module — Stage 1 (Data Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Build the headless data layer of the `org.nexus.tasks` module — the module-inverse undo hook (the missing piece of Pillar 1), the `Task` type + store projection, the namespaced mutations + reducer + inverse builder, and replay-on-hydration wiring — fully unit-tested, no UI.

**Architecture:** Tasks are a projection of the mutation log (design P5). Namespaced mutations (`org.nexus.tasks/*`) dispatch to a module reducer that maintains `LocalStore.tasks` + a `tasksByStatus` index. A new `registerModuleInverse(namespace, builder)` lets a module declare inverses so its mutations undo through the existing undo stack; exposed to modules via `host.registerInverse`. On startup, modules register at bootstrap (before hydration), so a central `replayRegisteredModules(store)` rebuilds projections after the vault's mutation log is hydrated.

**Tech Stack:** TypeScript, Vitest (`pnpm test`). `@/` = `src/`. Builds on Phase 1 Step 1 (`src/modules/{registry,host,surfaceRegistry,surfaces}.ts`, `src/modules/tasks/`) and Phase 0 (`src/state/{mutations,moduleReducers,mutationKind}.ts`).

## Verified facts
- `MutationKind = CoreMutationKind | ModuleMutationKind` where `ModuleMutationKind = \`${string}/${string}\`` — namespaced kinds typecheck.
- `mutations.ts`: `recordMutation` captures the inverse via `_buildReverseEntry(kind,payload,store)` BEFORE `applyMutation`. `_buildReverseEntry` returns `UndoEntry | null`; `UndoEntry = { forwardSteps: Step[]; reverseSteps: Step[]; description: string; canUndo: boolean }`, `Step = { kind: MutationKind; payload: unknown }`. `kindNamespace` is already imported. `applyMutation` already dispatches namespaced kinds to `getModuleReducer(ns)?.apply(kind,payload,store)`. `replayModuleMutations(ns,store)` exists.
- `local.ts`: entities use a `Map` + index sets maintained via `_setAdd(map,key,id)`/`_setRemove(map,key,id)`; `putFolder`/`deleteFolder` are the helper pattern; `messagesByStatus` is the index precedent; `hydrate(snap)` clears + repopulates indexes and loads `snap.mutations` into `this.mutations`.
- `host.ts`: `createModuleHost(moduleId, namespace, declaredSurfaces)` returns `{ host, dispose }` collecting disposers; `ModuleHost` currently has `registerReducer` + `contribute.surface`.
- `src/modules/tasks/index.ts` (from Step 1): exports `TASKS_MODULE_ID`, `TASKS_MAIN_SURFACE_ID`, `TASKS_MAIN_PANEL_KEY`, `registerTasksModule()`; manifest has empty `entities`/`mutationKinds` and one dock surface.
- `main.tsx`: `bootstrapModules()` runs before render; `hydrateFromVault(path)` calls `localStore.hydrate(...)`; `initWeb()` seeds fixtures + OPFS.

## Out of scope (later stages)
Panel UI (Stage 2); links / create-from (Stage 3); `cancelled` status surfaced in UI; Google Tasks sync.

---

### Task 1: Module-inverse hook in `mutations.ts`

**Files:**
- Modify: `src/state/mutations.ts`
- Test: `src/state/__tests__/moduleInverse.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
// src/state/__tests__/moduleInverse.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerModuleInverse,
  recordMutation,
  undoLastMutation,
  _resetModuleInverses,
} from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { LocalStore } from "@/storage/local";

const NS = "com.acme.counter";

function setup() {
  const store = new LocalStore();
  // reducer: maintain a number under store via a side map on the store's tasks-agnostic field.
  const values = new Map<string, number>();
  registerModuleReducer(NS, {
    apply: (kind, payload) => {
      const p = payload as { id: string; value: number };
      if (kind === `${NS}/SET`) values.set(p.id, p.value);
    },
  });
  registerModuleInverse(NS, (kind, payload) => {
    const p = payload as { id: string; value: number };
    if (kind === `${NS}/SET`) {
      const prev = values.get(p.id) ?? 0;
      return { reverseSteps: [{ kind: `${NS}/SET`, payload: { id: p.id, value: prev } }], description: "Set value" };
    }
    return null;
  });
  return { store, values };
}

beforeEach(() => {
  _resetModuleReducers();
  _resetModuleInverses();
});

describe("module-inverse hook", () => {
  it("makes a module mutation undoable via the registered inverse", () => {
    const { store, values } = setup();
    recordMutation(`${NS}/SET`, { id: "a", value: 1 }, store);
    recordMutation(`${NS}/SET`, { id: "a", value: 2 }, store);
    expect(values.get("a")).toBe(2);
    const desc = undoLastMutation(store);
    expect(desc).toBe("Set value");
    expect(values.get("a")).toBe(1); // reverted to the value captured before the 2nd mutation
  });

  it("leaves a module mutation non-undoable when no inverse is registered", () => {
    const store = new LocalStore();
    registerModuleReducer(NS, { apply: () => {} });
    recordMutation(`${NS}/SET`, { id: "a", value: 1 }, store);
    // Nothing to undo (entry is non-undoable) — undo returns null.
    expect(undoLastMutation(store)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `pnpm test -- src/state/__tests__/moduleInverse.test.ts`
Expected: FAIL — `registerModuleInverse`/`_resetModuleInverses` not exported.

- [ ] **Step 3: Implement the hook in `src/state/mutations.ts`**

Add near the top-level declarations (after the undo-stack declarations, before `_buildReverseEntry`):
```ts
// ─── Module inverse registry (substrate §4.3) ────────────────────────────────
// Lets a module declare how to reverse its own namespaced mutations, so they
// participate in the undo stack like core mutations.
export interface ModuleInverseResult {
  reverseSteps: Array<{ kind: MutationKind; payload: unknown }>;
  description: string;
}
export type ModuleInverseBuilder = (
  kind: string,
  payload: unknown,
  store: LocalStore,
) => ModuleInverseResult | null;

const _moduleInverses = new Map<string, ModuleInverseBuilder>();

/** Register an inverse-builder for a module namespace. Returns a disposer. */
export function registerModuleInverse(namespace: string, builder: ModuleInverseBuilder): () => void {
  if (_moduleInverses.has(namespace)) {
    throw new Error(`A module inverse is already registered for namespace "${namespace}"`);
  }
  _moduleInverses.set(namespace, builder);
  return () => {
    if (_moduleInverses.get(namespace) === builder) _moduleInverses.delete(namespace);
  };
}

/** Test-only: clear all module inverse builders. */
export function _resetModuleInverses(): void {
  _moduleInverses.clear();
}
```

Then change `_buildReverseEntry` to consult the registry for namespaced kinds BEFORE the core path:
```ts
function _buildReverseEntry(
  kind: MutationKind,
  payload: unknown,
  store: LocalStore,
): UndoEntry | null {
  const ns = kindNamespace(kind);
  if (ns !== null) {
    const result = _moduleInverses.get(ns)?.(kind, payload, store);
    if (!result) return null; // no inverse → falls through to non-undoable
    return {
      forwardSteps: [{ kind, payload }],
      reverseSteps: result.reverseSteps,
      description: result.description,
      canUndo: true,
    };
  }
  const inner = _buildReverseEntryInner(kind, payload, store);
  return inner ? { ...inner, canUndo: true } : null;
}
```

- [ ] **Step 4: Run to verify it passes**
Run: `pnpm test -- src/state/__tests__/moduleInverse.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full check + commit**
Run: `pnpm test && pnpm typecheck && pnpm lint` (all green).
```bash
git add src/state/mutations.ts src/state/__tests__/moduleInverse.test.ts
git commit -m "feat(substrate): module-inverse hook so module mutations undo"
```

---

### Task 2: `host.registerInverse`

**Files:**
- Modify: `src/modules/host.ts`
- Test: `src/modules/__tests__/host.inverse.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
// src/modules/__tests__/host.inverse.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createModuleHost } from "@/modules/host";
import { _resetModuleInverses } from "@/state/mutations";

beforeEach(() => _resetModuleInverses());

describe("host.registerInverse", () => {
  it("registers an inverse builder under the module namespace and disposes it", () => {
    const { host, dispose } = createModuleHost("com.acme.x", "com.acme.x", new Map());
    host.registerInverse((kind, payload) => ({ reverseSteps: [{ kind, payload }], description: "x" }));
    // Registering a second time for the same namespace must throw (already registered).
    expect(() =>
      createModuleHost("com.acme.x", "com.acme.x", new Map()).host.registerInverse(() => null),
    ).toThrow(/already registered/);
    dispose();
    // After dispose the namespace is free again — re-registering does not throw.
    expect(() =>
      createModuleHost("com.acme.x", "com.acme.x", new Map()).host.registerInverse(() => null),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `pnpm test -- src/modules/__tests__/host.inverse.test.ts`
Expected: FAIL — `host.registerInverse` is not a function.

- [ ] **Step 3: Extend `src/modules/host.ts`**

Add the import:
```ts
import { registerModuleInverse, type ModuleInverseBuilder } from "@/state/mutations";
```
Add to the `ModuleHost` interface:
```ts
  /** Register an inverse-builder so this module's mutations undo (substrate §4.3). */
  registerInverse(builder: ModuleInverseBuilder): void;
```
Add to the `host` object in `createModuleHost` (alongside `registerReducer`):
```ts
    registerInverse(builder) {
      disposers.push(registerModuleInverse(namespace, builder));
    },
```

- [ ] **Step 4: Run to verify it passes**
Run: `pnpm test -- src/modules/__tests__/host.inverse.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Full check + commit**
Run: `pnpm test && pnpm typecheck && pnpm lint`.
```bash
git add src/modules/host.ts src/modules/__tests__/host.inverse.test.ts
git commit -m "feat(substrate): host.registerInverse for module undo"
```

---

### Task 3: `Task` type + store projection

**Files:**
- Modify: `src/data/types.ts`
- Modify: `src/storage/local.ts`
- Test: `src/storage/__tests__/tasksStore.test.ts`

- [ ] **Step 1: Add the types to `src/data/types.ts`**

Add (near the other entity interfaces, e.g. after `Status`):
```ts
// ─── TASK — org.nexus.tasks/task entity ──────────────────────────────────────
/** VTODO-aligned task workflow state (RFC 5545). UI labels the first three
 *  "To do" / "Doing" / "Done"; "cancelled" is reserved for a later step. */
export type TaskStatus = "needs-action" | "in-process" | "completed" | "cancelled";

export interface Task {
  id: string;
  vaultId: string;
  title: string;
  status: TaskStatus;
  dueAt: number | null;
  notes: string | null;
  priority: 1 | 2 | 3 | 4 | null;
  assignee: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 2: Write the failing store test**
```ts
// src/storage/__tests__/tasksStore.test.ts
import { describe, it, expect } from "vitest";
import { LocalStore } from "@/storage/local";
import type { Task } from "@/data/types";

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1", vaultId: "v", title: "A", status: "needs-action",
    dueAt: null, notes: null, priority: null, assignee: null,
    order: 0, createdAt: 1, updatedAt: 1, ...over,
  };
}

describe("LocalStore tasks projection", () => {
  it("putTask stores the task and indexes it by status", () => {
    const s = new LocalStore();
    s.putTask(task({ id: "t1", status: "needs-action" }));
    expect(s.tasks.get("t1")?.title).toBe("A");
    expect([...(s.tasksByStatus.get("needs-action") ?? [])]).toEqual(["t1"]);
  });

  it("putTask re-indexes when status changes", () => {
    const s = new LocalStore();
    s.putTask(task({ id: "t1", status: "needs-action" }));
    s.putTask(task({ id: "t1", status: "completed" }));
    expect(s.tasksByStatus.get("needs-action")?.has("t1") ?? false).toBe(false);
    expect(s.tasksByStatus.get("completed")?.has("t1") ?? false).toBe(true);
  });

  it("deleteTask removes the task and its index entry", () => {
    const s = new LocalStore();
    s.putTask(task({ id: "t1", status: "needs-action" }));
    s.deleteTask("t1");
    expect(s.tasks.has("t1")).toBe(false);
    expect(s.tasksByStatus.get("needs-action")?.has("t1") ?? false).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**
Run: `pnpm test -- src/storage/__tests__/tasksStore.test.ts`
Expected: FAIL — `putTask`/`tasks` missing.

- [ ] **Step 4: Add the projection to `src/storage/local.ts`**

Import `Task`, `TaskStatus` in the existing type import from `@/data/types`. Add the fields alongside the other entity maps (e.g. after `calendars`):
```ts
  tasks = new Map<string, Task>();
  tasksByStatus = new Map<TaskStatus, Set<string>>();
```
In `hydrate(snap)`, where the other indexes are cleared, add:
```ts
    this.tasks.clear();
    this.tasksByStatus.clear();
```
(Tasks are rebuilt by module replay, not from `snap`, so do not read any `snap.tasks`.)
Add the helpers near `putFolder`/`deleteFolder` (use the existing `_setAdd`/`_setRemove` helpers):
```ts
  putTask(t: Task): void {
    const prev = this.tasks.get(t.id);
    if (prev && prev.status !== t.status) this._setRemove(this.tasksByStatus, prev.status, t.id);
    this.tasks.set(t.id, t);
    this._setAdd(this.tasksByStatus, t.status, t.id);
  }

  deleteTask(id: string): void {
    const prev = this.tasks.get(id);
    if (prev) this._setRemove(this.tasksByStatus, prev.status, id);
    this.tasks.delete(id);
  }
```

- [ ] **Step 5: Run to verify it passes**
Run: `pnpm test -- src/storage/__tests__/tasksStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Full check + commit**
Run: `pnpm test && pnpm typecheck && pnpm lint`.
```bash
git add src/data/types.ts src/storage/local.ts src/storage/__tests__/tasksStore.test.ts
git commit -m "feat(tasks): Task type + LocalStore tasks projection"
```

---

### Task 4: Tasks mutations, reducer, and inverse builder

**Files:**
- Create: `src/modules/tasks/model.ts`
- Create: `src/modules/tasks/mutations.ts`
- Create: `src/modules/tasks/reducer.ts`
- Test: `src/modules/tasks/__tests__/dataLayer.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
// src/modules/tasks/__tests__/dataLayer.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { recordMutation, undoLastMutation, _resetModuleInverses } from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { tasksReducer } from "@/modules/tasks/reducer";
import { tasksInverse } from "@/modules/tasks/mutations";
import {
  createTaskMutation, setTaskStatusMutation, setTaskFieldsMutation,
  reorderTaskMutation, deleteTaskMutation, TASKS_NS,
} from "@/modules/tasks/mutations";
import { registerModuleInverse } from "@/state/mutations";

function wire(store: LocalStore) {
  registerModuleReducer(TASKS_NS, tasksReducer);
  registerModuleInverse(TASKS_NS, tasksInverse);
  return store;
}

beforeEach(() => { _resetModuleReducers(); _resetModuleInverses(); });

describe("tasks data layer", () => {
  it("createTaskMutation adds a task; undo removes it", () => {
    const s = wire(new LocalStore());
    const t = createTaskMutation({ title: "Buy milk" }, s);
    expect(s.tasks.get(t.id)?.title).toBe("Buy milk");
    expect(s.tasks.get(t.id)?.status).toBe("needs-action");
    undoLastMutation(s);
    expect(s.tasks.has(t.id)).toBe(false);
  });

  it("setTaskStatusMutation changes status; undo restores prior status", () => {
    const s = wire(new LocalStore());
    const t = createTaskMutation({ title: "X" }, s);
    setTaskStatusMutation(t.id, "completed", s);
    expect(s.tasks.get(t.id)?.status).toBe("completed");
    undoLastMutation(s);
    expect(s.tasks.get(t.id)?.status).toBe("needs-action");
  });

  it("setTaskFieldsMutation patches only given fields; undo restores them", () => {
    const s = wire(new LocalStore());
    const t = createTaskMutation({ title: "X", priority: 3 }, s);
    setTaskFieldsMutation(t.id, { title: "Y", dueAt: 999 }, s);
    expect(s.tasks.get(t.id)).toMatchObject({ title: "Y", dueAt: 999, priority: 3 });
    undoLastMutation(s);
    expect(s.tasks.get(t.id)).toMatchObject({ title: "X", dueAt: null, priority: 3 });
  });

  it("reorderTaskMutation updates order/status; undo restores", () => {
    const s = wire(new LocalStore());
    const t = createTaskMutation({ title: "X" }, s);
    reorderTaskMutation(t.id, 5, "in-process", s);
    expect(s.tasks.get(t.id)).toMatchObject({ order: 5, status: "in-process" });
    undoLastMutation(s);
    expect(s.tasks.get(t.id)).toMatchObject({ order: 0, status: "needs-action" });
  });

  it("deleteTaskMutation removes a task; undo restores the full task", () => {
    const s = wire(new LocalStore());
    const t = createTaskMutation({ title: "X", priority: 2 }, s);
    deleteTaskMutation(t.id, s);
    expect(s.tasks.has(t.id)).toBe(false);
    undoLastMutation(s);
    expect(s.tasks.get(t.id)).toMatchObject({ title: "X", priority: 2 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `pnpm test -- src/modules/tasks/__tests__/dataLayer.test.ts`
Expected: FAIL — unresolved imports.

- [ ] **Step 3: Create `src/modules/tasks/model.ts`**
```ts
import type { Task, TaskStatus } from "@/data/types";

export const TASK_STATUSES: TaskStatus[] = ["needs-action", "in-process", "completed"];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  "needs-action": "To do",
  "in-process": "Doing",
  completed: "Done",
  cancelled: "Cancelled",
};

let _seq = 0;
/** Deterministic-enough id without Date.now collisions within a tick. */
function taskId(): string {
  _seq += 1;
  return `task-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

/** Build a full Task from partial input, filling defaults. */
export function makeTask(input: Partial<Task> & { title: string }, vaultId: string, now: number): Task {
  return {
    id: input.id ?? taskId(),
    vaultId,
    title: input.title,
    status: input.status ?? "needs-action",
    dueAt: input.dueAt ?? null,
    notes: input.notes ?? null,
    priority: input.priority ?? null,
    assignee: input.assignee ?? null,
    order: input.order ?? 0,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}
```

- [ ] **Step 4: Create `src/modules/tasks/reducer.ts`**
```ts
import type { ModuleReducer } from "@/state/moduleReducers";
import type { LocalStore } from "@/storage/local";
import type { Task, TaskStatus } from "@/data/types";

type Fields = Partial<Pick<Task, "title" | "dueAt" | "notes" | "priority" | "assignee">>;

function patch(store: LocalStore, taskId: string, change: Partial<Task>): void {
  const prev = store.tasks.get(taskId);
  if (!prev) return;
  store.putTask({ ...prev, ...change, updatedAt: change.updatedAt ?? prev.updatedAt });
}

export const tasksReducer: ModuleReducer = {
  apply(kind, payload, store) {
    const local = store as LocalStore;
    switch (kind) {
      case "org.nexus.tasks/CREATE_TASK":
        local.putTask(payload as Task);
        break;
      case "org.nexus.tasks/SET_TASK_STATUS": {
        const p = payload as { taskId: string; status: TaskStatus };
        patch(local, p.taskId, { status: p.status });
        break;
      }
      case "org.nexus.tasks/SET_TASK_FIELDS": {
        const p = payload as { taskId: string; fields: Fields };
        patch(local, p.taskId, p.fields);
        break;
      }
      case "org.nexus.tasks/REORDER_TASK": {
        const p = payload as { taskId: string; order: number; status?: TaskStatus };
        patch(local, p.taskId, p.status ? { order: p.order, status: p.status } : { order: p.order });
        break;
      }
      case "org.nexus.tasks/DELETE_TASK": {
        const p = payload as { taskId: string };
        local.deleteTask(p.taskId);
        break;
      }
    }
  },
};
```

- [ ] **Step 5: Create `src/modules/tasks/mutations.ts`**
```ts
import type { Task, TaskStatus } from "@/data/types";
import type { LocalStore } from "@/storage/local";
import { recordMutation, type ModuleInverseBuilder } from "@/state/mutations";
import { makeTask } from "@/modules/tasks/model";

export const TASKS_NS = "org.nexus.tasks";
export const KIND = {
  CREATE: `${TASKS_NS}/CREATE_TASK`,
  STATUS: `${TASKS_NS}/SET_TASK_STATUS`,
  FIELDS: `${TASKS_NS}/SET_TASK_FIELDS`,
  REORDER: `${TASKS_NS}/REORDER_TASK`,
  DELETE: `${TASKS_NS}/DELETE_TASK`,
} as const;

type Fields = Partial<Pick<Task, "title" | "dueAt" | "notes" | "priority" | "assignee">>;

/** Create a task (records CREATE_TASK). Returns the created Task. */
export function createTaskMutation(input: Partial<Task> & { title: string }, store: LocalStore): Task {
  const t = makeTask(input, store.vault?.id ?? "local", Date.now());
  recordMutation(KIND.CREATE, t, store);
  return t;
}
export function setTaskStatusMutation(taskId: string, status: TaskStatus, store: LocalStore): void {
  recordMutation(KIND.STATUS, { taskId, status }, store);
}
export function setTaskFieldsMutation(taskId: string, fields: Fields, store: LocalStore): void {
  recordMutation(KIND.FIELDS, { taskId, fields }, store);
}
export function reorderTaskMutation(taskId: string, order: number, status: TaskStatus | undefined, store: LocalStore): void {
  recordMutation(KIND.REORDER, status ? { taskId, order, status } : { taskId, order }, store);
}
export function deleteTaskMutation(taskId: string, store: LocalStore): void {
  recordMutation(KIND.DELETE, { taskId }, store);
}

/** Inverse builder — captures prior state BEFORE the mutation applies (substrate §4.3). */
export const tasksInverse: ModuleInverseBuilder = (kind, payload, store) => {
  const s = store as LocalStore;
  switch (kind) {
    case KIND.CREATE: {
      const t = payload as Task;
      return { reverseSteps: [{ kind: KIND.DELETE, payload: { taskId: t.id } }], description: "Create task" };
    }
    case KIND.STATUS: {
      const p = payload as { taskId: string; status: TaskStatus };
      const prev = s.tasks.get(p.taskId);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.STATUS, payload: { taskId: p.taskId, status: prev.status } }], description: "Change task status" };
    }
    case KIND.FIELDS: {
      const p = payload as { taskId: string; fields: Fields };
      const prev = s.tasks.get(p.taskId);
      if (!prev) return null;
      const priorFields: Fields = {};
      for (const k of Object.keys(p.fields) as Array<keyof Fields>) {
        (priorFields as Record<string, unknown>)[k] = prev[k];
      }
      return { reverseSteps: [{ kind: KIND.FIELDS, payload: { taskId: p.taskId, fields: priorFields } }], description: "Edit task" };
    }
    case KIND.REORDER: {
      const p = payload as { taskId: string; order: number; status?: TaskStatus };
      const prev = s.tasks.get(p.taskId);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.REORDER, payload: { taskId: p.taskId, order: prev.order, status: prev.status } }], description: "Reorder task" };
    }
    case KIND.DELETE: {
      const p = payload as { taskId: string };
      const prev = s.tasks.get(p.taskId);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.CREATE, payload: prev }], description: "Delete task" };
    }
  }
  return null;
};
```

- [ ] **Step 6: Run to verify it passes**
Run: `pnpm test -- src/modules/tasks/__tests__/dataLayer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Full check + commit**
Run: `pnpm test && pnpm typecheck && pnpm lint`.
```bash
git add src/modules/tasks/model.ts src/modules/tasks/mutations.ts src/modules/tasks/reducer.ts src/modules/tasks/__tests__/dataLayer.test.ts
git commit -m "feat(tasks): mutations, reducer, and inverse builder"
```

---

### Task 5: Register reducer+inverse in the module; replay on hydration

**Files:**
- Modify: `src/modules/tasks/index.ts`
- Modify: `src/state/mutations.ts` (add `replayRegisteredModules`)
- Modify: `src/main.tsx`
- Test: `src/modules/tasks/__tests__/registration.test.ts`
- Test: `src/state/__tests__/replayRegistered.test.ts`

- [ ] **Step 1: Write the failing tests**
```ts
// src/modules/tasks/__tests__/registration.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { registerTasksModule, TASKS_MODULE_ID } from "@/modules/tasks";
import { getModule, _resetModules } from "@/modules/registry";
import { getModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { _resetDockSurfaces } from "@/modules/surfaceRegistry";
import { _resetModuleInverses } from "@/state/mutations";

beforeEach(() => { _resetModules(); _resetModuleReducers(); _resetDockSurfaces(); _resetModuleInverses(); });

describe("Tasks module registration", () => {
  it("declares its entity + mutation kinds and wires reducer", () => {
    registerTasksModule();
    const m = getModule(TASKS_MODULE_ID);
    expect(m?.entities).toContain("org.nexus.tasks/task");
    expect(m?.mutationKinds).toEqual(expect.arrayContaining(["org.nexus.tasks/CREATE_TASK", "org.nexus.tasks/DELETE_TASK"]));
    expect(getModuleReducer(TASKS_MODULE_ID)).toBeDefined();
  });
});
```
```ts
// src/state/__tests__/replayRegistered.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { recordMutation, replayRegisteredModules, _resetModuleInverses } from "@/state/mutations";
import { registerModuleReducer, getModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { registerModule, listModules, _resetModules } from "@/modules/registry";
import { _resetDockSurfaces } from "@/modules/surfaceRegistry";

beforeEach(() => { _resetModules(); _resetModuleReducers(); _resetDockSurfaces(); _resetModuleInverses(); });

describe("replayRegisteredModules", () => {
  it("rebuilds a module projection from the hydrated mutation log", () => {
    const store = new LocalStore();
    // Simulate a hydrated log containing a module mutation, with no reducer yet.
    store.mutations.push({ id: "m1", vaultId: "v", deviceId: "d", ts: 1, lamport: 1,
      kind: "com.acme.x/PUT", payload: { id: "a" } } as never);
    const seen: string[] = [];
    registerModule({ id: "com.acme.x", name: "X", version: "1", namespace: "com.acme.x",
      entities: [], mutationKinds: [], capabilities: {}, trust: "core" },
      (host) => host.registerReducer({ apply: (k, p) => { seen.push((p as { id: string }).id); } }));
    replayRegisteredModules(store);
    expect(seen).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**
Run: `pnpm test -- src/modules/tasks/__tests__/registration.test.ts src/state/__tests__/replayRegistered.test.ts`
Expected: FAIL — `replayRegisteredModules` missing; manifest entities/kinds empty.

- [ ] **Step 3: Add `replayRegisteredModules` to `src/state/mutations.ts`**
Add the import at the top: `import { listModules } from "@/modules/registry";`
Add the function (near `replayModuleMutations`):
```ts
/** Replay the logged mutations for every registered module, rebuilding their
 *  projections after the vault's mutation log has been hydrated. Modules
 *  register at bootstrap (before hydration), so this runs post-hydrate. */
export function replayRegisteredModules(store: LocalStore = _defaultStore): void {
  for (const m of listModules()) replayModuleMutations(m.namespace, store);
}
```
(Import-cycle note: after Task 2 there is a cycle `mutations.ts → registry.ts → host.ts → mutations.ts`. It is benign because every edge is used only inside function bodies at call-time — none at module-init/top-level — so ES module resolution handles it. Do NOT call `listModules()`/`registerModuleInverse` at module top-level. If a "cannot access before initialization" error appears, that invariant was violated.)

- [ ] **Step 4: Update `src/modules/tasks/index.ts`**
Wire the reducer + inverse and declare the manifest entity/kinds. Replace the manifest's `entities`/`mutationKinds` and `registerTasksModule` body:
```ts
import { tasksReducer } from "@/modules/tasks/reducer";
import { tasksInverse, KIND } from "@/modules/tasks/mutations";
```
In the manifest:
```ts
  entities: ["org.nexus.tasks/task"],
  mutationKinds: [KIND.CREATE, KIND.STATUS, KIND.FIELDS, KIND.REORDER, KIND.DELETE],
```
In `registerTasksModule`:
```ts
export function registerTasksModule(): () => void {
  return registerModule(manifest, (host) => {
    host.registerReducer(tasksReducer);
    host.registerInverse(tasksInverse);
    host.contribute.surface(TASKS_MAIN_SURFACE_ID, TasksPanel);
  });
}
```
(Keep the existing `TasksPanel` placeholder import for now; Stage 2 replaces it.)

- [ ] **Step 5: Wire replay into `src/main.tsx`**
Add the import: `import { replayRegisteredModules } from "@/state/mutations";`
In `hydrateFromVault`, immediately after `localStore.hydrate(payload as ...)`, add:
```ts
  replayRegisteredModules(localStore);
```
In `initWeb`, after the fixtures import + `localStore.initOpfs()` block, add (so web mode also materializes module projections from any logged mutations):
```ts
  replayRegisteredModules(localStore);
```

- [ ] **Step 6: Run to verify it passes**
Run: `pnpm test -- src/modules/tasks/__tests__/registration.test.ts src/state/__tests__/replayRegistered.test.ts`
Expected: PASS.

- [ ] **Step 7: Full check + commit**
Run: `pnpm test && pnpm typecheck && pnpm lint` (all green).
```bash
git add src/modules/tasks/index.ts src/state/mutations.ts src/main.tsx src/modules/tasks/__tests__/registration.test.ts src/state/__tests__/replayRegistered.test.ts
git commit -m "feat(tasks): register reducer+inverse and replay module projections on hydration"
```

---

## Self-Review (author)

**Spec coverage (spec §2–§4, §10 stage 1):** Task type + status (§2) → Task 3; granular mutation kinds (§3.1) → Task 4; module-inverse hook (§3.2) → Tasks 1–2; store + index + hydration replay (§4) → Tasks 3, 5; reducer → Task 4; reuse of `_setAdd`/index pattern → Task 3. Panel/links explicitly deferred to Stages 2–3.

**Placeholder scan:** none — exact code and commands in every step.

**Type consistency:** `TASKS_NS`/`KIND` constants from `mutations.ts` are used by `reducer.ts` (string-literal cases match `KIND.*` values), `index.ts`, and tests. `ModuleInverseBuilder`/`ModuleInverseResult` defined in Task 1 are imported by `host.ts` (Task 2) and `mutations.ts` (Task 4). `Task`/`TaskStatus` (Task 3) used throughout. `tasksReducer`/`tasksInverse` (Task 4) wired in Task 5. The reducer cases use literal kind strings equal to the `KIND.*` template values (`org.nexus.tasks/CREATE_TASK`, …).

**Note for executor:** the reducer's `switch` uses literal strings (not `KIND.CREATE`) because `case` needs literal types; they must stay byte-identical to the `KIND` values — a test asserts behavior so a mismatch fails loudly.

## Execution Handoff
subagent-driven-development: fresh subagent per task, spec + code-quality review each, fix loops. Five tasks, each green + committed. Then Stage 2 (panel UI).
