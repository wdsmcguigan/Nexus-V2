# Authoring a Module

> How to build a first-party module on the substrate. **Read `docs/substrate-design.md` first** (the contract). The **`org.nexus.tasks` module (`src/modules/tasks/`) is the reference implementation** — copy its shape.

Core principle (design P2): we ship our own panels as modules through the **same public API a third party would use** (`registerModule`, `host.contribute.*`, `recordMutation`, `linksGraph`) — never via internal shortcuts.

## The shape of a module

A module is a manifest + a `setup` callback that wires its pieces through a capability-scoped `host`.

```ts
// src/modules/<name>/index.ts
import { registerModule, type ModuleManifest } from "@/modules/registry";
import { dockComponentKey } from "@/modules/surfaceRegistry";
import { MyPanel } from "@/modules/<name>/MyPanel";
import { myReducer } from "@/modules/<name>/reducer";
import { myInverse, KIND } from "@/modules/<name>/mutations";

const manifest: ModuleManifest = {
  id: "org.nexus.<name>",
  name: "<Name>",
  version: "0.1.0",
  namespace: "org.nexus.<name>",          // reverse-DNS; owns the module's kinds/entities/storage
  entities: ["org.nexus.<name>/<entity>"], // ENT types it owns (namespaced)
  mutationKinds: [KIND.CREATE, /* … */],   // all namespaced under the module
  capabilities: { "ui.contribute": ["dock", "command"] },
  trust: "core",
  contributes: {
    surfaces: [{ type: "dock", id: "main", title: "<Name>", icon: "…", detachable: false }],
    commands: [{ id: "open", title: "Open <Name>" }],
  },
};

export const MAIN_PANEL_KEY = dockComponentKey(manifest.id, "main"); // "org.nexus.<name>:main"

export function register<Name>Module(): () => void {
  return registerModule(manifest, (host) => {
    host.registerReducer(myReducer);                       // Pillar 1: apply this module's mutations
    host.registerInverse(myInverse);                       // undo support for its mutations
    host.contribute.surface("main", MyPanel);              // the dock panel (declared in manifest)
    host.contribute.command("open", () =>                  // command palette entry (declared in manifest)
      useWorkspace.getState().openModulePanel(MAIN_PANEL_KEY, "<Name>"));
  });
}
```

Register it at startup in **`src/modules/bootstrap.ts`** (runs before render so dockview/replay can resolve it).

## Where module state lives

Module state is an **event-sourced projection of the mutation log** (design P5). Add a `Map` (+ any index) to `LocalStore` (`src/storage/local.ts`) and have your reducer maintain it via `putX`/`deleteX` helpers that call `this._notify()` (so the UI re-renders). On hydration, `replayRegisteredModules` (called in `main.tsx` after `localStore.hydrate`) replays the module's logged mutations to rebuild the projection — so its data persists + syncs for free. Do **not** add module data to the vault snapshot; it's rebuilt from the log.

## Mutations + undo (Pillar 1)

- Every state change is a **namespaced mutation** through `recordMutation("org.nexus.<name>/KIND", payload, store)`. Never write the store/DB directly. Module mutations sync (relay), broadcast (multi-window), and persist for free.
- **Undo:** declare a `ModuleInverseBuilder` (registered via `host.registerInverse`) that, for each kind, returns the inverse steps captured from pre-mutation state. See `src/modules/tasks/mutations.ts` `tasksInverse`.
- **Atomic compound actions** (e.g. "create X *and* link it"): use `recordMutations([step1, step2], store, "description")` — one undo reverts all steps. See `createTaskFromEntity`.
- Mutation helpers follow the rules/templates `save*/delete*Mutation` shape — expose small functions, not raw `recordMutation` calls, to UI.

## Links / the graph (Pillar 3)

Cross-entity edges use the core `createLink(store, { srcType, srcId, linkType, dstType, dstId })` / `deleteLink` + `linksFrom`/`linksTo`/`neighbors` (`src/state/linksGraph.ts`). Pattern for "create a task from an email" (atomic task + `tracks` link): `createTaskFromEntity` in `src/modules/tasks/mutations.ts`. Display a thing's links by resolving `linksFrom(...)` to labels (see `src/modules/tasks/links.ts`).

## UI (Pillar 4 — dock + command contribution points)

- A **dock surface** is a React component (`(props: IDockviewPanelProps) => …`) bound via `host.contribute.surface(id, Component)`; `Workspace.tsx` merges it into dockview. Launch it with `openModulePanel(componentKey, title, params?)`; the panel receives `params` via dockview's `props.params` (a singleton surface is re-pointed via `updateParameters` when already open).
- A **command** is bound via `host.contribute.command(id, run)`; the command palette renders all module commands automatically.
- Module panels are currently **non-detachable** and don't get a customizable panel color (those are part of the deferred panel-migration gaps below).

## Testing

Follow **`docs/testing-policy.md`**: pure logic → Node unit tests (extract helpers like `sort.ts`/`links.ts`/`resolveStatusDrag`); critical UI flow → Playwright e2e (once set up); **no RTL**. Verify the panel live (run the app) until Playwright exists.

## Tasks module — file map (the reference)

```
src/modules/tasks/
  index.ts          manifest + registerTasksModule (reducer + inverse + surface + command)
  model.ts          entity helpers, status labels, makeTask factory
  mutations.ts      KIND constants, mutation helpers, tasksInverse, createTaskFromEntity
  reducer.ts        ModuleReducer.apply → LocalStore.tasks + index
  sort.ts           pure sort/group helpers (Node-tested)
  hooks.ts          useTasks/useTasksByStatus/useTask (useStoreVersion + useMemo)
  links.ts          taskLinkedItems resolver (Node-tested)
  TasksPanel.tsx    list/kanban toggle + selection + detail
  TaskListView.tsx · TaskRow.tsx · AddTaskRow.tsx · TaskDetail.tsx · TaskKanbanView.tsx
  __tests__/        Node tests (data layer, hooks logic, registration, create-from-entity, links)
```

## Out of scope until "platformization" (migrating EXISTING panels to modules)

A Contacts-migration spike found existing panels (email/calendar/contacts) need substrate capabilities the dock point didn't originally cover, before they can become modules without regressions. **One of the original four is now closed:**
1. ✅ **Parameterized launch (DONE)** — `openModulePanel(key, title, params?)` passes runtime params; panels read `props.params` (e.g. "open Contacts on this contact"). The first consumer is the Timekit module's section-focus commands.
2. **Detachable module panels** — currently blocked (`isModulePanelId` guard); existing panels are pop-out-able.
3. **Module panel color customization** — `applyModuleColor` skips namespaced ids.
4. **Command/shortcut contribution** — command half DONE; global keyboard-shortcut binding for modules still deferred.

Build greenfield modules (Notes, Timer, …) first to keep proving/stabilizing the API (design P6); migrate existing panels later as a deliberate epic once these gaps are closed.
