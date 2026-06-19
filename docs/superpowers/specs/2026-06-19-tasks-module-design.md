# Tasks Module (`org.nexus.tasks`) — Design Spec

> **Status:** Approved design (brainstorm complete). Phase 1, Step 2.
> **Builds on:** `docs/substrate-design.md` (the 4-pillar contract) and Phase 1 Step 1 (the dock contribution point, already on `main`).
> **Next:** writing-plans → subagent-driven implementation.

## 0. Goal

Ship the first real, full-dogfood module on the substrate (design P2 — core modules use the same public API a third party would). It exercises all four pillars in anger: namespaced mutations + a reducer (Pillar 1), a dock surface (Pillar 4), the links graph (Pillar 3), and — by completing a genuinely missing piece — module-mutation **undo**.

The Tasks module replaces the Step-1 placeholder `TasksPanel` with a working list + kanban task manager, and lets a user turn an email/contact/event into a linked task.

## 1. Decisions (locked during brainstorming)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Task entity richness | **Rich** | Enables kanban + future sync; fields below. |
| 2 | Mutation granularity | **Granular** | Status change is its own undo unit and a precise event-bus/AI hook; low-frequency field edits batch. |
| 3 | Status vocabulary | **VTODO-aligned** (RFC 5545) | Free interop insurance toward Google Tasks / CalDAV; UI shows friendly labels. |
| 4 | Panel view | **List + Kanban toggle** | Adapts existing `KanbanView`; list fits the narrow dock and proves the full loop. |
| 5 | Links scope | **Model + show + create-from** | Real dogfood (email→linked task) on the dock surface we already wired; reverse backlinks deferred. |
| 6 | Module undo | **Add a module-inverse hook** | Module mutations currently sync/broadcast but do **not** undo (no inverse mechanism exists). This completes Pillar 1 for modules; reused by Notes/AI. |

## 2. Data model (`src/data/types.ts`)

```ts
/** VTODO-aligned task workflow state (RFC 5545). UI exposes the first three as
 *  "To do" / "Doing" / "Done"; "cancelled" is reserved for a later step. */
export type TaskStatus = "needs-action" | "in-process" | "completed" | "cancelled";

export interface Task {
  id: string;
  vaultId: string;
  title: string;
  status: TaskStatus;
  dueAt: number | null;        // epoch ms, optional
  notes: string | null;
  priority: 1 | 2 | 3 | 4 | null;  // reuse the email priority encoding (1 = urgent)
  assignee: string | null;     // freeform string for v1 (contact-link is a later refinement)
  order: number;               // manual sort key within a status column
  createdAt: number;
  updatedAt: number;
}
```

`vaultId` mirrors every other entity. Optional fields are explicit `| null` (not absent) for stable serialization, consistent with `Message`.

## 3. Mutations + undo

### 3.1 Kinds (namespaced under `org.nexus.tasks/`)

| Kind | Payload | Notes |
|------|---------|-------|
| `CREATE_TASK` | `Task` (full) | inverse → `DELETE_TASK` |
| `SET_TASK_STATUS` | `{ taskId, status }` | inverse → `SET_TASK_STATUS` with prior status; the headline event-bus/AI hook |
| `SET_TASK_FIELDS` | `{ taskId, fields: Partial<Pick<Task,"title"\|"dueAt"\|"notes"\|"priority"\|"assignee">> }` | inverse → `SET_TASK_FIELDS` with prior values of exactly those keys |
| `REORDER_TASK` | `{ taskId, order, status? }` | inverse → `REORDER_TASK` with prior `order`(+`status`) |
| `DELETE_TASK` | `{ taskId }` | inverse → `CREATE_TASK` with the full task captured before delete |

Links use the existing core `CREATE_LINK` / `DELETE_LINK` — no task-specific link kind.

`MutationKind` already accepts namespaced strings (Phase 0 write path); module helpers call `recordMutation("org.nexus.tasks/…", payload)`.

### 3.2 Module-inverse hook (the missing Pillar 1 piece)

`src/state/mutations.ts` today builds inverses via `_buildReverseEntryInner`, a switch over **core** kinds; namespaced kinds fall through to non-undoable. Add:

```ts
type ModuleInverseBuilder = (kind: string, payload: unknown, store: LocalStore)
  => { reverseSteps: Step[] } | null;
export function registerModuleInverse(namespace: string, builder: ModuleInverseBuilder): () => void;
```

`_buildReverseEntry` consults the registry when `kindNamespace(kind) !== null`, before falling back to non-undoable. The inverse is captured **before** `applyMutation` (the existing pattern), so prior state is available. Tasks registers one builder for its namespace covering the five kinds (§3.1). Atomic inline links (§5) reverse together via the existing provenance-envelope mechanism.

This hook is registered through the module host (extend the host with `registerInverse`, or register inside `registerTasksModule` setup) so it disposes with the module.

## 4. Store & hydration

- **`src/storage/local.ts`:** add `tasks = new Map<string, Task>()` and a `tasksByStatus = new Map<TaskStatus, Set<string>>()` index (mirrors `messagesByStatus`), with `putTask`/`deleteTask` helpers maintaining both. Tasks are **not** a separate hydrate payload — they are a projection of the mutation log.
- **Hydration:** modules register at bootstrap (before vault hydration), so add `replayRegisteredModules(store)` — iterates `listModules()` and calls the existing `replayModuleMutations(ns, store)` — invoked **after** `localStore.hydrate(...)` in `src/main.tsx` (both `initTauri` hydrate paths and `initWeb`, and on the re-hydrate event). Plan-time check: confirm `load_vault_data` returns the full mutation log (not a bounded window); if bounded, projection-snapshot persistence is a follow-up.

## 5. Links / create-from

- `createTaskFromEntity(srcType, srcId, title)` emits `CREATE_TASK` **plus** a `CREATE_LINK` (`link_type: "tracks"`, task → source entity) atomically via the inline-links envelope, so one undo reverts both.
- **Launchers:** a command-palette command "Create task from this email" and an email-row context-menu action; equivalents for a contact and a calendar event.
- **Display:** the Tasks detail view lists the task's linked items via `linksGraph.linksFrom(task)` and opens them (email → select message, contact → contacts panel, event → calendar).
- **Deferred to next step:** reverse backlinks (a "Tasks" section *inside* the email/contact inspector) — requires wiring the inspector-section contribution point.

## 6. Panel UI (`src/modules/tasks/`)

Replaces the Step-1 placeholder. `TasksPanel` holds a list/kanban view toggle.
- **List** (`TaskListView`): rows grouped by status (To do / Doing / Done), each `TaskRow` = status checkbox + title + due chip + priority dot; an `AddTaskRow` inline composer at the top of each group; clicking a row opens `TaskDetail` (edit fields + linked items).
- **Kanban** (`TaskKanbanView`): adapted from `src/components/views/KanbanView.tsx` (dnd-kit + virtualizer already wired) — columns = statuses, drag card across columns → `SET_TASK_STATUS`, reorder within a column → `REORDER_TASK`.

The panel is non-detachable (module panels, per Step 1) and launches from the existing "Open Tasks" command.

## 7. Reuse (research-and-reuse, verified in-repo)

KanbanView (board mechanics); rules/templates `save*/delete*Mutation` shape (CRUD helper pattern); the `1|2|3|4|null` priority encoding; the `Status`/`messagesByStatus` index pattern; `linksGraph` + `CREATE_LINK`/`DELETE_LINK` (Phase 0); and the entire `recordMutation → reducer → relay → undo → multi-window broadcast` pipeline.

## 8. File structure

```
src/data/types.ts            (+ Task, TaskStatus)
src/storage/local.ts         (+ tasks map, tasksByStatus index, putTask/deleteTask)
src/state/mutations.ts       (+ registerModuleInverse hook; consult it in _buildReverseEntry)
src/main.tsx                 (+ replayRegisteredModules after hydration)
src/modules/tasks/
  model.ts                   (Task helpers, status labels/order, factory)
  mutations.ts               (kind constants, payload types, helper fns, inverse builder)
  reducer.ts                 (ModuleReducer.apply → store.tasks + index)
  hooks.ts                   (useTasks / useTasksByStatus / useTaskLinks)
  index.ts                   (manifest w/ entities+mutationKinds+dock surface; registerTasksModule wiring reducer + inverse + surface)
  TasksPanel.tsx · TaskListView.tsx · TaskKanbanView.tsx · TaskRow.tsx · TaskDetail.tsx · AddTaskRow.tsx
  __tests__/...
src/components/palette/CommandPalette.tsx  (+ "Create task from this email" + create-from commands)
<email row context menu>     (+ "Create task from this email" action)
```

## 9. Testing (TDD throughout)

- **Reducer:** each kind applies correctly to `tasks` + `tasksByStatus`.
- **Undo/redo:** every inverse round-trips (create→delete→undo restores; status toggle; field patch restores exactly the patched keys; reorder; delete restores full task). Inline-link create undoes both task and link.
- **Replay/hydration:** replaying a logged mutation sequence rebuilds the identical task projection; a module not registered still stores rows and materializes on replay.
- **Hooks:** return correct projections and update on mutation.
- **Panel:** list add/complete/reorder; kanban drag→status and reorder.
- **Create-from:** `createTaskFromEntity` produces task + link atomically.
- **In-app verification pass** (preview MCP) like Step 1: open Tasks, add/complete/reorder, create-from-email, confirm console clean.

## 10. Staging (single spec, staged plan)

The implementation plan sequences three independently-green stages:
1. **Data layer (headless):** inverse hook → Task type → store + index → mutations + reducer → inverse builder → replay wiring. Fully unit-tested, no UI.
2. **Panel UI:** list + kanban toggle consuming stage 1.
3. **Links:** `createTaskFromEntity` + launchers + linked-items display.

## 11. Out of scope (→ later steps)

Inspector-section reverse backlinks; Google Tasks / CalDAV sync; recurring tasks; subtasks/checklists; reminders & notifications; assignee-as-contact-link; cross-entity unified "due" views.
