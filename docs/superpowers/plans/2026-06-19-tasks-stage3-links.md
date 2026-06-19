# Tasks Module — Stage 3 (Links / Create-from-Email) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** The "full dogfood" — turn an email into a linked task. Build a compound-undo helper (atomic multi-mutation, realizing design §4.4), `createTaskFromEntity` (CREATE_TASK + CREATE_LINK as one undo unit), launchers (email row context-menu + command palette), and linked-items display in the task detail.

**Architecture:** `recordMutations(steps, store, description)` applies N mutations and pushes ONE combined undo entry (reverse = each step's inverse, concatenated in reverse order). `createTaskFromEntity(entityType, entityId, title, store)` uses it to create a task and a `"tracks"` link (task → entity) atomically. The Tasks detail reads `linksFrom(task)` and renders/open the linked entities. Email is the primary flow; contact/event reuse the same `createTaskFromEntity` (noted, not built here).

**Tech Stack:** TypeScript, React, Vitest (node; UI verified live). `@/`=`src/`. Builds on the links graph (`createLink`, `linksFrom`, `Link`, `CREATE_LINK`/`DELETE_LINK` — all Phase 0) and the Tasks module.

## Verified facts
- `recordMutation(kind, payload, store)` builds ONE undo entry per call via `_buildReverseEntry` (consults module-inverse registry for namespaced kinds). `UndoEntry = { forwardSteps: Step[]; reverseSteps: Step[]; description; canUndo }` — arrays already. `undoLastMutation(store)` replays `reverseSteps` (under `_skipStack`). `_resetUndoStacks()` test helper exists.
- `createLink(store, { srcType, srcId, linkType, dstType, dstId, meta? }): Link` → records `CREATE_LINK`. `linksFrom(store, entType, entId, linkType?): Link[]` in `src/state/linksGraph.ts` (verify exact arg order — it's `(store, type, id, linkType?)` or `(type,id,...)`; check before use). `CREATE_LINK` inverse = `DELETE_LINK` (already wired).
- Tasks: `createTaskMutation(input, store): Task`, `KIND.CREATE`, `tasksInverse` registered. `Task` entity type id (design §6.3): `"org.nexus.tasks/task"`. Email entity type id: `"nexus/email.message"`.
- `EmailRowContextMenu.tsx` is the right-click menu; `selectedEmailId` is on the workspace store; `localStore.messages.get(id)` → `Message` (has `subject`). `useWorkspace.getState().setSelectedEmail(id)` selects an email (verify the action name in workspace.ts).
- Tasks detail = `src/modules/tasks/TaskDetail.tsx` (uses `useTask`).

## Out of scope (noted)
Contact/event "create task from …" launchers (reuse `createTaskFromEntity` with a different `entityType`; add later). Reverse backlinks inside the email/contact inspector (needs the inspector-section contribution point — separate). Global keyboard shortcut for create-from.

---

### Task 1: Compound-mutation helper (`recordMutations`)

**Files:** Modify `src/state/mutations.ts`; Test `src/state/__tests__/recordMutations.test.ts`.

- [ ] **Step 1: failing test** `src/state/__tests__/recordMutations.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { recordMutations, recordMutation, undoLastMutation, _resetUndoStacks } from "@/state/mutations";
import { LocalStore } from "@/storage/local";
import { FOLDER_IDS, makeSeedStore } from "@/storage/__tests__/seed";

let store: LocalStore;
beforeEach(() => { store = makeSeedStore(); _resetUndoStacks(); });

describe("recordMutations (compound undo)", () => {
  it("applies all steps and undoes them as a single unit", () => {
    // Two core mutations in one compound entry; one undo reverts BOTH.
    const before = store.messages.get("m1")!.folderId;
    recordMutations([
      { kind: "MOVE_TO_FOLDER", payload: { messageId: "m1", folderId: FOLDER_IDS.personal } },
      { kind: "SET_READ", payload: { messageId: "m1" } },
    ], store, "Compound op");
    expect(store.messages.get("m1")!.folderId).toBe(FOLDER_IDS.personal);
    const desc = undoLastMutation(store);
    expect(desc).toBe("Compound op");
    expect(store.messages.get("m1")!.folderId).toBe(before); // both reverted by one undo
  });

  it("is a single undo entry (one undo, not N)", () => {
    recordMutations([
      { kind: "SET_READ", payload: { messageId: "m1" } },
      { kind: "SET_STAR", payload: { messageId: "m1", star: "yellow" } },
    ], store, "Two things");
    expect(undoLastMutation(store)).toBe("Two things");
    expect(undoLastMutation(store)).toBeNull(); // nothing left — it was one entry
  });
});
```
(Use the actual seed-store helper + ids that exist — check `src/storage/__tests__/seed.ts` for `makeSeedStore`/`FOLDER_IDS`/message ids like `m1`, and pick valid core kinds for the test. If `SET_STAR`/`SET_READ` payload shapes differ, match `mutations.ts`. The point: two mutations, one undo entry that reverts both.)

- [ ] **Step 2: run, expect FAIL:** `pnpm test -- src/state/__tests__/recordMutations.test.ts`

- [ ] **Step 3: implement `recordMutations` in `src/state/mutations.ts`.** Add near `recordMutation`:
```ts
/**
 * Apply several mutations as ONE atomic undo unit (substrate §4.4). Each step is
 * applied + persisted + broadcast like a normal mutation, but a single combined
 * undo entry is pushed whose reverseSteps are every step's inverse, concatenated
 * in REVERSE order (so undo unwinds last-applied-first). Steps whose inverse is
 * non-undoable make the whole compound non-undoable (conservative).
 */
export function recordMutations(
  steps: Array<{ kind: MutationKind; payload: unknown }>,
  store: LocalStore = _defaultStore,
  description = "Multiple changes",
): void {
  if (steps.length === 0) return;
  const reverse: Array<{ kind: MutationKind; payload: unknown }> = [];
  let undoable = true;
  // Build each step's inverse BEFORE applying it (state must be pre-mutation),
  // applying as we go so later steps see earlier ones' effects.
  const _skip = _skipStack;
  _skipStack = true; // suppress per-step undo entries; we push one combined entry
  try {
    for (const step of steps) {
      const entry = _buildReverseEntry(step.kind, step.payload, store);
      if (entry && entry.canUndo) reverse.unshift(...entry.reverseSteps);
      else undoable = false;
      store.appendMutation(_makeMutation(step.kind, step.payload, store));
      applyMutation(_lastMutation, store);
      if (isTauri()) applyMutationIpc(step.kind, step.payload, _deviceId, _lamport).catch(() => {});
      emitBusEvent(_lastMutation);
    }
  } finally {
    _skipStack = _skip;
  }
  if (!_skipStack && undoable && reverse.length) {
    _undoStack.push({ forwardSteps: steps, reverseSteps: reverse, description, canUndo: true });
    if (_undoStack.length > UNDO_MAX) _undoStack.shift();
    _redoStack.length = 0;
  }
}
```
**IMPLEMENTATION NOTE:** the exact internals (`_makeMutation`/`_lastMutation`/`_lamport` increment/`appendMutation`/`applyMutation`/`emitBusEvent`/IPC) MUST match what `recordMutation` does today — do NOT invent helpers. Read `recordMutation`'s body and factor out a shared `_applyAndPersist(kind, payload, store)` used by BOTH `recordMutation` and `recordMutations` so they stay identical (preferred over duplicating). The test is the contract: all steps applied, one undo entry reverting all, in reverse order. If factoring is cleaner, do it; keep `recordMutation`'s behavior byte-identical (existing tests must stay green).

- [ ] **Step 4: run, expect PASS.** Then `pnpm test && pnpm typecheck && pnpm lint` (all green — the refactor must keep ALL existing mutation/undo tests passing).
- [ ] **Step 5: commit:** `git add src/state/mutations.ts src/state/__tests__/recordMutations.test.ts && git commit -m "feat(substrate): recordMutations — atomic compound undo (design §4.4)"`

---

### Task 2: `createTaskFromEntity` (atomic task + link)

**Files:** Modify `src/modules/tasks/mutations.ts`; Test `src/modules/tasks/__tests__/createFromEntity.test.ts`.

- [ ] **Step 1: failing test** `src/modules/tasks/__tests__/createFromEntity.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { undoLastMutation, _resetModuleInverses, _resetUndoStacks, registerModuleInverse } from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { tasksReducer } from "@/modules/tasks/reducer";
import { tasksInverse, TASKS_NS, createTaskFromEntity } from "@/modules/tasks/mutations";
import { linksFrom } from "@/state/linksGraph";

const TASK_ENT = "org.nexus.tasks/task";
const EMAIL_ENT = "nexus/email.message";

function wire(): LocalStore {
  const s = new LocalStore();
  registerModuleReducer(TASKS_NS, tasksReducer);
  registerModuleInverse(TASKS_NS, tasksInverse);
  return s;
}
beforeEach(() => { _resetModuleReducers(); _resetModuleInverses(); _resetUndoStacks(); });

describe("createTaskFromEntity", () => {
  it("creates a task AND a 'tracks' link to the source entity", () => {
    const s = wire();
    const t = createTaskFromEntity(EMAIL_ENT, "msg-1", "Follow up on build", s);
    expect(s.tasks.get(t.id)?.title).toBe("Follow up on build");
    const links = linksFrom(s, TASK_ENT, t.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ linkType: "tracks", dstType: EMAIL_ENT, dstId: "msg-1" });
  });

  it("one undo removes BOTH the task and the link (atomic)", () => {
    const s = wire();
    const t = createTaskFromEntity(EMAIL_ENT, "msg-1", "X", s);
    undoLastMutation(s);
    expect(s.tasks.has(t.id)).toBe(false);
    expect(linksFrom(s, TASK_ENT, t.id)).toHaveLength(0);
  });
});
```
(Verify `linksFrom`'s exact signature/arg order in `src/state/linksGraph.ts` and adjust the calls to match.)

- [ ] **Step 2: run, expect FAIL.**

- [ ] **Step 3: implement in `src/modules/tasks/mutations.ts`:**
```ts
import { recordMutations } from "@/state/mutations";
import { makeTask } from "@/modules/tasks/model";

export const TASK_ENTITY = "org.nexus.tasks/task";

/** Create a task linked to a source entity (e.g. an email), as ONE atomic undo
 *  unit. The link is task --tracks--> entity. */
export function createTaskFromEntity(
  entityType: string,
  entityId: string,
  title: string,
  store: LocalStore,
): Task {
  const task = makeTask({ title }, store.vault?.id ?? "local", Date.now());
  const link: Link = {
    id: `lnk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    vaultId: store.vault?.id ?? "local",
    srcType: TASK_ENTITY, srcId: task.id,
    linkType: "tracks", dstType: entityType, dstId: entityId,
    meta: undefined, createdAt: Date.now(),
  };
  recordMutations(
    [{ kind: KIND.CREATE, payload: task }, { kind: "CREATE_LINK", payload: link }],
    store,
    "Create task from item",
  );
  return task;
}
```
(Import `Link` type from `@/data/types`. `KIND.CREATE` is the existing namespaced task-create kind. `CREATE_LINK` is a core kind. `recordMutations` builds the combined inverse: DELETE_TASK + DELETE_LINK.)

- [ ] **Step 4: run, expect PASS.** Full check: `pnpm test && pnpm typecheck && pnpm lint`.
- [ ] **Step 5: commit:** `git add src/modules/tasks/mutations.ts src/modules/tasks/__tests__/createFromEntity.test.ts && git commit -m "feat(tasks): createTaskFromEntity (atomic task + tracks-link)"`

---

### Task 3: Launchers — email row context menu + command palette

**Files:** Modify `src/components/email/EmailRowContextMenu.tsx`, `src/components/palette/CommandPalette.tsx`. (No unit test — UI; verified live in Task 5. Keep changes minimal + matched to existing items.)

- [ ] **Step 1: Email row context menu.** Read `EmailRowContextMenu.tsx`; add a "Create task from this email" item (near other actions) that calls:
```ts
createTaskFromEntity("nexus/email.message", message.id, message.subject || "(no subject)", localStore)
```
then (optional) opens the Tasks panel via `useWorkspace.getState().openModulePanel(TASKS_MAIN_PANEL_KEY, "Tasks")` and/or toasts "Task created". Import `createTaskFromEntity` from `@/modules/tasks/mutations`, `localStore`, and `TASKS_MAIN_PANEL_KEY` + `openModulePanel` as needed. Use the message available to the context menu (check how the menu receives its target message).

- [ ] **Step 2: Command palette.** Add a "Create task from this email" command, enabled only when `selectedEmailId` is set, that resolves the message + calls `createTaskFromEntity(...)`. Place it in the "Message" group near other message actions. Use the existing `selectedEmailId` selector pattern; guard when no email is selected (omit the item, mirroring how other message-context commands gate on selection).

- [ ] **Step 3:** `pnpm typecheck && pnpm lint && pnpm test` (no behavior regressions; no new tests this task).
- [ ] **Step 4: commit:** `git add src/components/email/EmailRowContextMenu.tsx src/components/palette/CommandPalette.tsx && git commit -m "feat(tasks): create-task-from-email launchers (context menu + command)"`

---

### Task 4: Linked-items display in the task detail

**Files:** Modify `src/modules/tasks/TaskDetail.tsx`; (optional pure helper + test) `src/modules/tasks/links.ts` + `__tests__`.

- [ ] **Step 1 (recommended): a pure resolver + test.** Add `src/modules/tasks/links.ts`:
```ts
import type { LocalStore } from "@/storage/local";
import { linksFrom } from "@/state/linksGraph";
import { TASK_ENTITY } from "@/modules/tasks/mutations";

export interface LinkedItem { linkId: string; entityType: string; entityId: string; label: string; }

/** Resolve a task's outgoing "tracks" links to displayable items. */
export function taskLinkedItems(store: LocalStore, taskId: string): LinkedItem[] {
  return linksFrom(store, TASK_ENTITY, taskId).map((l) => ({
    linkId: l.id, entityType: l.dstType, entityId: l.dstId,
    label: labelFor(store, l.dstType, l.dstId),
  }));
}
function labelFor(store: LocalStore, type: string, id: string): string {
  if (type === "nexus/email.message") return store.messages.get(id)?.subject || "(email)";
  if (type === "nexus/contact") return store.contacts.get(id)?.name || "(contact)";
  if (type === "nexus/calendar.event") return store.calendarEvents.get(id)?.title || "(event)";
  return id;
}
```
Test `taskLinkedItems` in node (seed a task + a CREATE_LINK to a message in the store, assert the resolved label). Verify `linksFrom` arg order + that `store.messages`/`contacts`/`calendarEvents` are the right maps.

- [ ] **Step 2: render in `TaskDetail.tsx`.** Below the existing fields, if `taskLinkedItems(localStore, taskId).length`, render a "Linked" section listing each item's label as a button; clicking an email item calls `useWorkspace.getState().setSelectedEmail(entityId)` (verify the action), contact → `openContactsPanel(entityId)`, event → `openCalendarPanel()` (best-effort; email is the primary path). Keep it reactive via the existing `useTask`/store-version subscription (read `taskLinkedItems` inside render so it recomputes on version bump — it already re-renders via `useTask`).

- [ ] **Step 3:** `pnpm test && pnpm typecheck && pnpm lint`.
- [ ] **Step 4: commit:** `git add src/modules/tasks/links.ts src/modules/tasks/TaskDetail.tsx src/modules/tasks/__tests__/*links* && git commit -m "feat(tasks): show a task's linked items in the detail"`

---

### Task 5: Live verification

- [ ] Run the app (`pnpm dev`). Right-click an email → "Create task from this email" → open Tasks → confirm the task exists with the email linked (detail shows the email subject under "Linked"; clicking it selects the email). Press ⌘Z once → confirm BOTH the task and the link are gone (atomic undo). Confirm command-palette "Create task from this email" works with an email selected. No console errors beyond the known pre-existing ones. Screenshot. Report honestly.

---

## Self-Review (author)
**Spec coverage (design §5):** atomic create+link (§4.4) → T1 `recordMutations`; `createTaskFromEntity` → T2; create-from-email launchers → T3; linked-items display + open → T4; live check → T5. Contact/event launchers + inspector backlinks explicitly deferred.
**Placeholder scan:** logic (T1/T2/T4 helper) is exact + node-tested; T1 flags that internals MUST match `recordMutation` (factor a shared `_applyAndPersist`); UI tasks (T3, T4 render) verified live. Several "verify exact signature" notes where a sibling API's arg order must be confirmed before use — intentional, not placeholders.
**Type consistency:** `recordMutations(steps, store, description)` (T1) used by `createTaskFromEntity` (T2); `TASK_ENTITY`/`"nexus/email.message"` consistent across T2/T4; `taskLinkedItems` (T4) consumed by TaskDetail. Compound inverse = DELETE_TASK + DELETE_LINK (both already wired).

## Execution Handoff
subagent-driven-development. T1 is the substrate piece (highest care — must not regress `recordMutation`); review it thoroughly. Then resume the roadmap (Notes → AI tracer-bullet).
