# Tasks Module — Stage 2 (Panel UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Replace the Step-1 placeholder `TasksPanel` with a working task manager: reactive hooks, a grouped **list view** (add / complete / edit / delete), a **kanban view** (drag card → status), and a **list/kanban toggle**. Consumes the Stage-1 data layer.

**Architecture:** Hooks read `LocalStore` reactively via `useStoreVersion()` + `useMemo` (the established `useStore.ts` idiom). All writes go through the Stage-1 mutation helpers (`createTaskMutation`, `setTaskStatusMutation`, `setTaskFieldsMutation`, `deleteTaskMutation`) — never direct store writes. The kanban adapts `src/components/views/KanbanView.tsx` (dnd-kit). The panel owns local view-mode + selected-task state (`useState`), independent of the email panel's `viewMode`.

**Tech Stack:** React 18, TypeScript, dnd-kit (`@dnd-kit/core`), Vitest (`node` env). `@/`=`src/`. Builds on Stage 1 (`src/modules/tasks/{model,mutations,reducer,index}.ts`, `LocalStore.tasks`).

> **TESTING APPROACH (revised):** This project does NOT use React Testing Library (an early attempt to add it was reverted — the codebase tests pure logic in the `node` env and verifies UI by running the app). So the RTL/`renderHook` test snippets in Tasks 2–5 below are SUPERSEDED. Instead: extract pure logic into testable functions and unit-test those in `node` (Task 1's `sort.ts`, Task 4's `resolveStatusDrag`), and verify component behavior LIVE via the preview MCP (Task 6). Build the components per the structure specs; skip the RTL test steps.

## Verified facts
- Hook idiom (`useStore.ts`): `const v = useStoreVersion(); return useMemo(() => Array.from(localStore.X.values())…, [v]);`. `useStoreVersion()` is exported from `@/storage/useStore`. `localStore.version` bumps on every task mutation (putTask/deleteTask call `_notify()`).
- Mutation helpers (`@/modules/tasks/mutations`): `createTaskMutation(input, store): Task`, `setTaskStatusMutation(id, status, store)`, `setTaskFieldsMutation(id, fields, store)`, `reorderTaskMutation(id, order, status|undefined, store)`, `deleteTaskMutation(id, store)`. Pass `localStore` as `store`.
- Model (`@/modules/tasks/model`): `TASK_STATUSES` (`["needs-action","in-process","completed"]`), `TASK_STATUS_LABEL` (incl. "cancelled"), `TaskFields`.
- KanbanView pattern: `DndContext`(sensors=PointerSensor distance 8, onDragStart/onDragEnd) → columns map → `KanbanColumn`(`useDroppable({id})`) containing `KanbanCard`(`useDraggable`); `handleDragEnd` reads `event.over.id` (target column) and `event.active.data.current` (the dragged item) → fires the status mutation. `DragOverlay` renders the active card.
- Test env: RTL is available; sibling component tests exist. Use behavior assertions (role/text queries, `userEvent`), not snapshots. Tests that touch `localStore` should reset module state in `beforeEach` (`_resetModules`, `_resetModuleReducers`, `_resetDockSurfaces`, `_resetModuleInverses`, `_resetUndoStacks`) and `registerTasksModule()` to wire the reducer/inverse, OR construct a `LocalStore` and register the reducer directly — match whichever the data-layer tests use.

## Out of scope (Stage 3 / later)
Linked-items display + "create task from email" (Stage 3); drag-to-reorder within a column (manual `REORDER_TASK` UI — kanban does cross-column status drag only this stage; list sorts by `order` then `createdAt`); cancelled-status UI; virtualization (KanbanView already virtualizes — reuse if trivial, else plain map is fine for v1).

---

### Task 1: Tasks hooks

**Files:** Create `src/modules/tasks/hooks.ts`; Test `src/modules/tasks/__tests__/hooks.test.ts`.

- [ ] **Step 1: failing test** `src/modules/tasks/__tests__/hooks.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { localStore } from "@/storage/local";
import { useTasks, useTasksByStatus, useTask } from "@/modules/tasks/hooks";
import { registerTasksModule } from "@/modules/tasks";
import { createTaskMutation, setTaskStatusMutation } from "@/modules/tasks/mutations";
import { _resetModules } from "@/modules/registry";
import { _resetModuleReducers } from "@/state/moduleReducers";
import { _resetDockSurfaces } from "@/modules/surfaceRegistry";
import { _resetModuleInverses, _resetUndoStacks } from "@/state/mutations";

beforeEach(() => {
  _resetModules(); _resetModuleReducers(); _resetDockSurfaces();
  _resetModuleInverses(); _resetUndoStacks();
  localStore.tasks.clear(); localStore.tasksByStatus.clear();
  registerTasksModule();
});

describe("tasks hooks", () => {
  it("useTasks returns all tasks and updates on create", () => {
    const { result } = renderHook(() => useTasks());
    expect(result.current).toHaveLength(0);
    act(() => { createTaskMutation({ title: "A" }, localStore); });
    expect(result.current).toHaveLength(1);
    expect(result.current[0]!.title).toBe("A");
  });

  it("useTasksByStatus groups and reflects status changes", () => {
    const { result } = renderHook(() => useTasksByStatus());
    let id = "";
    act(() => { id = createTaskMutation({ title: "A" }, localStore).id; });
    expect(result.current.get("needs-action")?.map((t) => t.id)).toEqual([id]);
    act(() => { setTaskStatusMutation(id, "completed", localStore); });
    expect(result.current.get("needs-action") ?? []).toHaveLength(0);
    expect(result.current.get("completed")?.map((t) => t.id)).toEqual([id]);
  });

  it("useTask returns one task by id, or undefined", () => {
    let id = "";
    const { result, rerender } = renderHook(({ tid }) => useTask(tid), { initialProps: { tid: "missing" } });
    expect(result.current).toBeUndefined();
    act(() => { id = createTaskMutation({ title: "A" }, localStore).id; });
    rerender({ tid: id });
    expect(result.current?.title).toBe("A");
  });
});
```

- [ ] **Step 2: run, expect FAIL** (unresolved import): `pnpm test -- src/modules/tasks/__tests__/hooks.test.ts`

- [ ] **Step 3: create `src/modules/tasks/hooks.ts`:**
```ts
import { useMemo } from "react";
import { localStore } from "@/storage/local";
import { useStoreVersion } from "@/storage/useStore";
import { TASK_STATUSES } from "@/modules/tasks/model";
import type { Task, TaskStatus } from "@/data/types";

/** All tasks, sorted by order then createdAt. */
export function useTasks(): Task[] {
  const v = useStoreVersion();
  return useMemo(
    () => Array.from(localStore.tasks.values()).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
    [v],
  );
}

/** Tasks grouped by status (every status in TASK_STATUSES has an entry, possibly empty), each list sorted. */
export function useTasksByStatus(): Map<TaskStatus, Task[]> {
  const v = useStoreVersion();
  return useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const s of TASK_STATUSES) map.set(s, []);
    for (const t of localStore.tasks.values()) {
      if (!map.has(t.status)) map.set(t.status, []);
      map.get(t.status)!.push(t);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    return map;
  }, [v]);
}

/** A single task by id (reactive), or undefined. */
export function useTask(id: string): Task | undefined {
  const v = useStoreVersion();
  return useMemo(() => localStore.tasks.get(id), [v, id]);
}
```

- [ ] **Step 4: run, expect PASS (3 tests):** `pnpm test -- src/modules/tasks/__tests__/hooks.test.ts`
- [ ] **Step 5: full check + commit:** `pnpm test && pnpm typecheck && pnpm lint`; then `git add src/modules/tasks/hooks.ts src/modules/tasks/__tests__/hooks.test.ts && git commit -m "feat(tasks): reactive hooks (useTasks/useTasksByStatus/useTask)"`

---

### Task 2: List view (TaskRow, AddTaskRow, TaskListView)

**Files:** Create `src/modules/tasks/TaskRow.tsx`, `src/modules/tasks/AddTaskRow.tsx`, `src/modules/tasks/TaskListView.tsx`; Test `src/modules/tasks/__tests__/TaskListView.test.tsx`.

**Design/structure** (match existing token usage — read `src/components/views/KanbanView.tsx` and the placeholder `src/modules/tasks/TasksPanel.tsx` for classes like `text-text-primary`, `text-text-muted`, `text-small`, surface/border tokens; use `@/lib/utils` `cn`; reuse `@/components/ui/Tag` for priority/status chips if it fits):
- `TaskRow({ task, onSelect })`: a row with a leading **status checkbox** (checked when `task.status === "completed"`; toggling fires `setTaskStatusMutation(task.id, checked ? "completed" : "needs-action", localStore)`), the title (strikethrough when completed), an optional due chip (`formatRelativeTime`-style; only if `task.dueAt`), and a priority dot when `task.priority != null`. Clicking the row body (not the checkbox) calls `onSelect(task.id)`.
- `AddTaskRow({ status })`: an inline text input + submit (Enter); on submit with non-empty trimmed text, calls `createTaskMutation({ title, status }, localStore)` and clears the input.
- `TaskListView({ onSelect })`: uses `useTasksByStatus()`; renders a section per `TASK_STATUSES` entry with the `TASK_STATUS_LABEL` heading, the tasks as `TaskRow`s, and an `AddTaskRow` for that status. Empty statuses still render their heading + AddTaskRow.

- [ ] **Step 1: failing behavior test** `src/modules/tasks/__tests__/TaskListView.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { localStore } from "@/storage/local";
import { TaskListView } from "@/modules/tasks/TaskListView";
import { registerTasksModule } from "@/modules/tasks";
import { createTaskMutation } from "@/modules/tasks/mutations";
import { _resetModules } from "@/modules/registry";
import { _resetModuleReducers } from "@/state/moduleReducers";
import { _resetDockSurfaces } from "@/modules/surfaceRegistry";
import { _resetModuleInverses, _resetUndoStacks } from "@/state/mutations";

beforeEach(() => {
  _resetModules(); _resetModuleReducers(); _resetDockSurfaces();
  _resetModuleInverses(); _resetUndoStacks();
  localStore.tasks.clear(); localStore.tasksByStatus.clear();
  registerTasksModule();
});

describe("TaskListView", () => {
  it("renders status group headings", () => {
    render(<TaskListView onSelect={() => {}} />);
    expect(screen.getByText("To do")).toBeInTheDocument();
    expect(screen.getByText("Doing")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("adds a task via the inline add row", async () => {
    const user = userEvent.setup();
    render(<TaskListView onSelect={() => {}} />);
    const input = screen.getAllByPlaceholderText(/add task/i)[0]!;
    await user.type(input, "Buy milk{Enter}");
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
    expect([...localStore.tasks.values()].some((t) => t.title === "Buy milk")).toBe(true);
  });

  it("completing a task via its checkbox sets status to completed", async () => {
    const user = userEvent.setup();
    const t = createTaskMutation({ title: "Task X" }, localStore);
    render(<TaskListView onSelect={() => {}} />);
    const checkbox = screen.getByRole("checkbox", { name: /task x/i });
    await user.click(checkbox);
    expect(localStore.tasks.get(t.id)?.status).toBe("completed");
  });
});
```
(If a `getByRole("checkbox", { name: /task x/i })` accessible-name match is impractical given the row layout, give the checkbox an `aria-label={`Toggle ${task.title}`}` so the query works — add that aria-label in `TaskRow`.)

- [ ] **Step 2: run, expect FAIL** (unresolved imports): `pnpm test -- src/modules/tasks/__tests__/TaskListView.test.tsx`
- [ ] **Step 3: implement** the three components per the design above. Keep each file focused (<150 lines). Use the mutation helpers with `localStore`. Add the `aria-label` on the checkbox.
- [ ] **Step 4: run, expect PASS (3 tests):** `pnpm test -- src/modules/tasks/__tests__/TaskListView.test.tsx`
- [ ] **Step 5: full check + commit:** `pnpm test && pnpm typecheck && pnpm lint`; then `git add src/modules/tasks/TaskRow.tsx src/modules/tasks/AddTaskRow.tsx src/modules/tasks/TaskListView.tsx src/modules/tasks/__tests__/TaskListView.test.tsx && git commit -m "feat(tasks): list view with inline add and status toggle"`

---

### Task 3: Task detail (edit + delete)

**Files:** Create `src/modules/tasks/TaskDetail.tsx`; Test `src/modules/tasks/__tests__/TaskDetail.test.tsx`.

**Structure:** `TaskDetail({ taskId, onClose })` uses `useTask(taskId)`. If undefined → render nothing (or a "select a task" hint). Otherwise an editable form:
- Title: text input; on blur or Enter, `setTaskFieldsMutation(taskId, { title }, localStore)` if changed.
- Status: a select/segmented control over `TASK_STATUSES` (labels from `TASK_STATUS_LABEL`); change → `setTaskStatusMutation`.
- Priority: select over `[null,1,2,3,4]` → `setTaskFieldsMutation(taskId, { priority }, localStore)`.
- Due: a date input (epoch ms ↔ `<input type="date">` value) → `setTaskFieldsMutation(taskId, { dueAt }, localStore)`.
- Notes: textarea → on blur, `setTaskFieldsMutation(taskId, { notes }, localStore)`.
- Delete button → `deleteTaskMutation(taskId, localStore)` then `onClose()`.

- [ ] **Step 1: failing behavior test** `src/modules/tasks/__tests__/TaskDetail.test.tsx` (same beforeEach reset+register as Task 2):
```tsx
// imports as in TaskListView.test.tsx, plus:
import { TaskDetail } from "@/modules/tasks/TaskDetail";
import { setTaskFieldsMutation } from "@/modules/tasks/mutations";

describe("TaskDetail", () => {
  it("edits the title via the title field", async () => {
    const user = userEvent.setup();
    const t = createTaskMutation({ title: "Old" }, localStore);
    render(<TaskDetail taskId={t.id} onClose={() => {}} />);
    const title = screen.getByDisplayValue("Old");
    await user.clear(title);
    await user.type(title, "New");
    await user.tab(); // blur
    expect(localStore.tasks.get(t.id)?.title).toBe("New");
  });

  it("deletes the task and calls onClose", async () => {
    const user = userEvent.setup();
    let closed = false;
    const t = createTaskMutation({ title: "X" }, localStore);
    render(<TaskDetail taskId={t.id} onClose={() => { closed = true; }} />);
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(localStore.tasks.has(t.id)).toBe(false);
    expect(closed).toBe(true);
  });
});
```

- [ ] **Step 2: run, expect FAIL.**
- [ ] **Step 3: implement `TaskDetail.tsx`** per the design (keep <200 lines; use controlled inputs seeded from the task, committing on blur/change via the mutation helpers).
- [ ] **Step 4: run, expect PASS (2 tests).**
- [ ] **Step 5: full check + commit:** `git add src/modules/tasks/TaskDetail.tsx src/modules/tasks/__tests__/TaskDetail.test.tsx && git commit -m "feat(tasks): task detail editor"`

---

### Task 4: Kanban view (drag → status)

**Files:** Create `src/modules/tasks/TaskKanbanView.tsx`; Test `src/modules/tasks/__tests__/TaskKanbanView.test.tsx`.

**Structure:** Adapt `src/components/views/KanbanView.tsx` (read it). Columns = `TASK_STATUSES` (labels from `TASK_STATUS_LABEL`); cards from `useTasksByStatus()`. `DndContext` with `PointerSensor` (distance 8). `handleDragEnd`: read dragged task from `event.active.data.current`, target column from `event.over.id`; if target differs from the task's status, fire `setTaskStatusMutation(task.id, targetStatus, localStore)`. A `TaskCard` (draggable) shows title + due/priority; clicking a card calls `onSelect(task.id)`. Use `DragOverlay` for the active card. (No "No Status" column — every task always has a status.)

- [ ] **Step 1: failing test** `src/modules/tasks/__tests__/TaskKanbanView.test.tsx` — drag is impractical to simulate in jsdom, so test the **rendering + column membership** (the drag→mutation wiring is verified live):
```tsx
// imports + beforeEach as Task 2, plus TaskKanbanView
describe("TaskKanbanView", () => {
  it("renders a column per status with the tasks in it", () => {
    createTaskMutation({ title: "Todo task", status: "needs-action" }, localStore);
    createTaskMutation({ title: "Doing task", status: "in-process" }, localStore);
    render(<TaskKanbanView onSelect={() => {}} />);
    expect(screen.getByText("To do")).toBeInTheDocument();
    expect(screen.getByText("Doing")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Todo task")).toBeInTheDocument();
    expect(screen.getByText("Doing task")).toBeInTheDocument();
  });
});
```
Additionally, if you extract the drag-end logic into a pure helper `resolveStatusDrag(activeTask, overColumnId): TaskStatus | null` (returns the new status or null when unchanged/invalid), add a unit test for it (recommended — makes the core wiring testable without simulating DnD).

- [ ] **Step 2: run, expect FAIL.**
- [ ] **Step 3: implement `TaskKanbanView.tsx`.** Prefer extracting `resolveStatusDrag` as a pure exported function used by `handleDragEnd`, and unit-test it.
- [ ] **Step 4: run, expect PASS.**
- [ ] **Step 5: full check + commit:** `git add src/modules/tasks/TaskKanbanView.tsx src/modules/tasks/__tests__/TaskKanbanView.test.tsx && git commit -m "feat(tasks): kanban view (drag card to change status)"`

---

### Task 5: TasksPanel — view toggle + selection (replace placeholder)

**Files:** Rewrite `src/modules/tasks/TasksPanel.tsx`; Test `src/modules/tasks/__tests__/TasksPanel.test.tsx`.

**Structure:** `TasksPanel(_: IDockviewPanelProps)` (keep the dockview prop signature — `registerTasksModule` still binds this component). Local state: `const [view, setView] = useState<"list"|"kanban">("list")` and `const [selectedId, setSelectedId] = useState<string|null>(null)`. Header with a list/kanban toggle (two buttons; active one styled). Body: `view === "list" ? <TaskListView onSelect={setSelectedId} /> : <TaskKanbanView onSelect={setSelectedId} />`. When `selectedId` is set, render `<TaskDetail taskId={selectedId} onClose={() => setSelectedId(null)} />` (as a side panel or overlay within the dock panel — a simple right-side column or a slide-over is fine; keep it in-panel, not an OS modal).

- [ ] **Step 1: failing behavior test** `src/modules/tasks/__tests__/TasksPanel.test.tsx` (beforeEach reset+register as Task 2; render `<TasksPanel {...({} as never)} />` since the dockview props are unused):
```tsx
describe("TasksPanel", () => {
  it("defaults to list view and toggles to kanban", async () => {
    const user = userEvent.setup();
    render(<TasksPanel {...({} as never)} />);
    expect(screen.getByText("To do")).toBeInTheDocument(); // list groups visible
    await user.click(screen.getByRole("button", { name: /kanban/i }));
    // both views show status labels; assert the kanban-specific affordance or that toggle is active.
    expect(screen.getByRole("button", { name: /kanban/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("selecting a task opens its detail", async () => {
    const user = userEvent.setup();
    const t = createTaskMutation({ title: "Pick me" }, localStore);
    render(<TasksPanel {...({} as never)} />);
    await user.click(screen.getByText("Pick me"));
    expect(screen.getByDisplayValue("Pick me")).toBeInTheDocument(); // detail title field
  });
});
```
(Use `aria-pressed` on the toggle buttons so the test + accessibility are sound.)

- [ ] **Step 2: run, expect FAIL** (placeholder panel has no toggle).
- [ ] **Step 3: rewrite `TasksPanel.tsx`** per the design. Keep the existing export name `TasksPanel` so `src/modules/tasks/index.ts` keeps working unchanged.
- [ ] **Step 4: run, expect PASS.**
- [ ] **Step 5: full check + commit:** `pnpm test && pnpm typecheck && pnpm lint`; then `git add src/modules/tasks/TasksPanel.tsx src/modules/tasks/__tests__/TasksPanel.test.tsx && git commit -m "feat(tasks): panel with list/kanban toggle and task detail"`

---

### Task 6: Live verification (preview MCP)

- [ ] Run the app (`pnpm dev`, :1420). Open command palette → "Open Tasks". Verify: list view shows To do/Doing/Done groups; add a task via the inline row; toggle its checkbox (moves to Done); click it → detail opens, edit the title; switch to kanban → columns render with the task; (drag is manual) confirm no console errors beyond the known pre-existing NavigationPanel/PanelHeader warnings. Screenshot. Report HONESTLY what was observed.

---

## Self-Review (author)
**Spec coverage (design §6 panel):** hooks → T1; list (rows/add/complete) → T2; detail (edit/delete) → T3; kanban (drag→status) → T4; toggle + selection + replace placeholder → T5; live check → T6. Links/create-from + linked-items + reorder DnD explicitly deferred to Stage 3.
**Placeholder scan:** data wiring + tests are exact; presentational styling delegated to implementers with explicit pattern references (KanbanView, existing tokens) — acceptable for adaptive UI.
**Type consistency:** hooks return `Task[]` / `Map<TaskStatus,Task[]>` / `Task|undefined`; components consume them and call the Stage-1 mutation helpers with `localStore`; `TasksPanel` keeps the `IDockviewPanelProps` signature so `index.ts` binding is unchanged.

## Execution Handoff
subagent-driven-development: fresh subagent per task, spec + code-quality review each, fix loops. Then Stage 3 (links).
