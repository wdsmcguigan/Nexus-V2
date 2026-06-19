# Phase 1 Step 1 — Dock Contribution Point Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the substrate's `dock` surface contribution point into the live dockview UI so a registered module's declared dock surface renders as a real, openable panel — proven end-to-end by a skeleton `org.nexus.tasks` module.

**Architecture:** A module declares its surfaces in its manifest (declarative, gateable, serializable — the security source of truth, gated *before* any module code runs). At registration, `registerModule(manifest, setup)` hands the module a capability-scoped **host handle** whose `host.contribute.surface(surfaceId, component)` binds a React component to an already-declared surface (Appendix B shape, dogfooding the real third-party API per design P2). Dock surfaces land in a `surfaceRegistry`, which `Workspace.tsx` merges into dockview's component map; a generic `openModulePanel` launches one, mirroring the existing `openCalendarPanel`. The host carries only `registerReducer` + `contribute.surface` for now and grows as Tasks/Notes/AI need it (P6/YAGNI).

**Tech Stack:** TypeScript, React 18, dockview, Zustand, Vitest (`pnpm test`). Pure frontend. `@/` maps to `src/`. Builds on the Phase 0 substrate (`src/modules/{registry,surfaces}.ts`, `src/state/moduleReducers.ts`, `src/state/mutationKind.ts`).

---

## Context the engineer needs

- **`registerModule` currently has ZERO production callers** — only its definition (`src/modules/registry.ts`) and `src/modules/__tests__/registry.test.ts`. Changing its signature now costs only a test rewrite (Task 2). No module registers at startup yet.
- **Existing reducer registry** (`src/state/moduleReducers.ts`): `registerModuleReducer(namespace, reducer): () => void` (throws on reserved `"nexus"` namespace or duplicate); `ModuleReducer = { apply: (kind, payload, store) => void }`; `getModuleReducer(ns)`; `_resetModuleReducers()`.
- **Existing surface vocabulary** (`src/modules/surfaces.ts`): `SURFACE_TYPES`, `SurfaceType`, `TrustTier`, `canContributeSurface(tier, type)`. Do NOT remove these.
- **Existing live panel pattern** (`src/state/workspace.ts:804` `openCalendarPanel`): `const api = getDockviewApi(); if (!api) return; const existing = api.panels.find(p => p.id === ID); existing ? existing.api.setActive() : api.addPanel({ id, component, title, minimumWidth, position: { direction: "right" } });`
- **Live dockview wiring** (`src/components/Workspace.tsx:47`): `DV_COMPONENTS: Record<string, FC<IDockviewPanelProps>>` is passed to `<DockviewReact components={DV_COMPONENTS} />`. Panel components are written as `(props: IDockviewPanelProps) => <Panel />` (props may be ignored).
- **`setDockviewApi(api: DockviewApi): void`** takes a non-null api (no null reset) — workspace tests set a fresh fake api per case.
- **Startup** (`src/main.tsx`): top-level module code runs once; `createRoot().render(<App/>)` is synchronous, then `initTauri()/initWeb()` run async. StrictMode double-invokes renders/effects, NOT top-level module code.
- **Rust note (repo-wide):** none of this touches Rust. Frontend only.

## Out of scope (deferred per design P6 / sequence)

- Non-`dock` surface *rendering* (rail, inspector-section, overlay, …) — declarable + gated, but `contribute.surface` throws for them in v1.
- The `command` contribution point (the launcher is a hardcoded palette item; Tasks will add a real nav entry in step 2).
- Detaching module panels into OS windows (module panels stay non-detachable — design open-Q #7; `applyModuleColor`/`detachPanelToWindow` keep their existing `id.split("-")[0]` behavior and module panels simply fall through to a default color).
- Real Tasks domain logic (entities, mutation kinds, reducer, task UI) — that is Phase 1 step 2; this step ships only the module shell.
- Dynamic module load *after* mount (modules are bootstrapped before render; the component map is read once).

---

## File Structure

- **Create** `src/modules/surfaceRegistry.ts` — stores dock surfaces paired with components; the seam `Workspace.tsx` consumes.
- **Create** `src/modules/host.ts` — `ModuleHost` interface + `createModuleHost` (the host handed to a module at registration).
- **Modify** `src/modules/registry.ts` — add `contributes` to manifest; `registerModule(manifest, setup?)` gates declared surfaces then runs setup with the host.
- **Modify** `src/state/workspace.ts` — add generic `openModulePanel(componentKey, title)`.
- **Create** `src/modules/tasks/TasksPanel.tsx` — placeholder dock panel (step 2 fills the body).
- **Create** `src/modules/tasks/index.ts` — Tasks manifest + `registerTasksModule()`.
- **Create** `src/modules/bootstrap.ts` — `bootstrapModules()` registers core modules at startup.
- **Modify** `src/main.tsx` — call `bootstrapModules()` before render.
- **Modify** `src/components/Workspace.tsx` — merge module dock components into the dockview component map.
- **Modify** `src/components/palette/CommandPalette.tsx` — add an "Open Tasks" command.
- **Tests** alongside each, under `src/modules/__tests__/` and `src/modules/tasks/__tests__/`, plus `src/state/__tests__/` for `openModulePanel`.

---

### Task 1: Dock surface registry

**Files:**
- Modify: `src/modules/surfaces.ts`
- Create: `src/modules/surfaceRegistry.ts`
- Test: `src/modules/__tests__/surfaceRegistry.test.ts`

- [ ] **Step 1: Add the `SurfaceSpec` type to `src/modules/surfaces.ts`**

Append to the END of the existing file (do not modify existing exports):

```ts
/**
 * A UI surface a module declares in its manifest (substrate §7.2). v1 renders
 * `dock`; other types are declarable + trust-gated but not yet wired.
 */
export interface SurfaceSpec {
  type: SurfaceType;
  /** Module-local surface id, unique within the module (e.g. "tasks.main"). */
  id: string;
  title: string;
  /** Optional icon hint (lucide name); host decides how to render it. */
  icon?: string;
  /** Dock only: may the panel detach into its own OS window? Default false. */
  detachable?: boolean;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/modules/__tests__/surfaceRegistry.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  dockComponentKey,
  registerDockSurface,
  listDockSurfaces,
  dockSurfaceComponents,
  _resetDockSurfaces,
} from "@/modules/surfaceRegistry";
import type { SurfaceSpec } from "@/modules/surfaces";

const spec: SurfaceSpec = { type: "dock", id: "tasks.main", title: "Tasks" };
const Comp = () => null;

beforeEach(() => _resetDockSurfaces());

describe("dock surface registry", () => {
  it("builds a namespaced component key", () => {
    expect(dockComponentKey("org.nexus.tasks", "tasks.main")).toBe("org.nexus.tasks:tasks.main");
  });

  it("registers a dock surface and lists it", () => {
    registerDockSurface("org.nexus.tasks", spec, Comp);
    const all = listDockSurfaces();
    expect(all).toHaveLength(1);
    expect(all[0]!.componentKey).toBe("org.nexus.tasks:tasks.main");
    expect(all[0]!.component).toBe(Comp);
  });

  it("exposes a dockview-ready component map keyed by component key", () => {
    registerDockSurface("org.nexus.tasks", spec, Comp);
    expect(dockSurfaceComponents()).toEqual({ "org.nexus.tasks:tasks.main": Comp });
  });

  it("rejects a duplicate surface key", () => {
    registerDockSurface("org.nexus.tasks", spec, Comp);
    expect(() => registerDockSurface("org.nexus.tasks", spec, Comp)).toThrow(/already registered/);
  });

  it("disposer removes the surface", () => {
    const dispose = registerDockSurface("org.nexus.tasks", spec, Comp);
    dispose();
    expect(listDockSurfaces()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test -- src/modules/__tests__/surfaceRegistry.test.ts`
Expected: FAIL — `Failed to resolve import "@/modules/surfaceRegistry"`.

- [ ] **Step 4: Create `src/modules/surfaceRegistry.ts`**

```ts
/**
 * Host-side registry of dock surfaces contributed by modules. A JSON manifest
 * can't carry a React component, so the component is paired with its declared
 * spec here at registration time. `Workspace.tsx` merges these into dockview's
 * component map; `openModulePanel` launches one. (substrate §7.2, Pillar 4.)
 */
import type { FunctionComponent } from "react";
import type { IDockviewPanelProps } from "dockview";
import type { SurfaceSpec } from "@/modules/surfaces";

/** A dock surface's React component — rendered by dockview as panel content. */
export type DockSurfaceComponent = FunctionComponent<IDockviewPanelProps>;

/** A registered dock surface: its spec, owning module, and rendering component. */
export interface RegisteredDockSurface {
  moduleId: string;
  spec: SurfaceSpec;
  /** The dockview component key and panel id: `${moduleId}:${spec.id}`. */
  componentKey: string;
  component: DockSurfaceComponent;
}

const _dockSurfaces = new Map<string, RegisteredDockSurface>();

/** The dockview component key / panel id for a module surface. */
export function dockComponentKey(moduleId: string, surfaceId: string): string {
  return `${moduleId}:${surfaceId}`;
}

/**
 * Register a dock surface paired with its component. Returns a disposer.
 * Throws if a surface is already registered under the same key.
 */
export function registerDockSurface(
  moduleId: string,
  spec: SurfaceSpec,
  component: DockSurfaceComponent,
): () => void {
  const componentKey = dockComponentKey(moduleId, spec.id);
  if (_dockSurfaces.has(componentKey)) {
    throw new Error(`A dock surface is already registered for "${componentKey}"`);
  }
  _dockSurfaces.set(componentKey, { moduleId, spec, componentKey, component });
  return () => {
    _dockSurfaces.delete(componentKey);
  };
}

/** All registered dock surfaces. */
export function listDockSurfaces(): RegisteredDockSurface[] {
  return [..._dockSurfaces.values()];
}

/** A dockview-ready map of componentKey → component for the current surfaces. */
export function dockSurfaceComponents(): Record<string, DockSurfaceComponent> {
  const out: Record<string, DockSurfaceComponent> = {};
  for (const s of _dockSurfaces.values()) out[s.componentKey] = s.component;
  return out;
}

/** Test-only: clear all registered dock surfaces. */
export function _resetDockSurfaces(): void {
  _dockSurfaces.clear();
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test -- src/modules/__tests__/surfaceRegistry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/surfaces.ts src/modules/surfaceRegistry.ts src/modules/__tests__/surfaceRegistry.test.ts
git commit -m "feat(substrate): dock surface registry + SurfaceSpec"
```

---

### Task 2: Module host handle + registry wiring

**Files:**
- Create: `src/modules/host.ts`
- Modify: `src/modules/registry.ts`
- Test: `src/modules/__tests__/registry.test.ts` (full rewrite of the existing file)

- [ ] **Step 1: Rewrite the test `src/modules/__tests__/registry.test.ts`**

Replace the ENTIRE file contents with:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerModule,
  getModule,
  listModules,
  _resetModules,
} from "@/modules/registry";
import { getModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { listDockSurfaces, _resetDockSurfaces } from "@/modules/surfaceRegistry";
import type { ModuleManifest } from "@/modules/registry";

function manifest(over: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    id: "com.acme.timer",
    name: "Timer",
    version: "1.0.0",
    namespace: "com.acme.timer",
    entities: ["com.acme.timer/timer"],
    mutationKinds: ["com.acme.timer/START", "com.acme.timer/STOP"],
    capabilities: { "mutations.emit": ["com.acme.timer/*"] },
    trust: "third-party",
    ...over,
  };
}

beforeEach(() => {
  _resetModules();
  _resetModuleReducers();
  _resetDockSurfaces();
});

describe("module registry", () => {
  it("registers a module and exposes it", () => {
    registerModule(manifest());
    expect(getModule("com.acme.timer")?.name).toBe("Timer");
    expect(listModules().map((m) => m.id)).toEqual(["com.acme.timer"]);
  });

  it("wires the module's reducer under its namespace via the host", () => {
    registerModule(manifest(), (host) => host.registerReducer({ apply: () => {} }));
    expect(getModuleReducer("com.acme.timer")).toBeDefined();
  });

  it("rejects a mutationKind outside the module namespace", () => {
    expect(() => registerModule(manifest({ mutationKinds: ["com.other/HACK"] }))).toThrow(/namespace/);
  });

  it("rejects an entity type outside the module namespace", () => {
    expect(() => registerModule(manifest({ entities: ["com.other/thing"] }))).toThrow(/namespace/);
  });

  it("disposer unregisters the module and its reducer", () => {
    const dispose = registerModule(manifest(), (host) => host.registerReducer({ apply: () => {} }));
    dispose();
    expect(getModule("com.acme.timer")).toBeUndefined();
    expect(getModuleReducer("com.acme.timer")).toBeUndefined();
  });

  it("binds a declared dock surface to a component via the host", () => {
    registerModule(
      manifest({ contributes: { surfaces: [{ type: "dock", id: "timer.main", title: "Timer" }] } }),
      (host) => host.contribute.surface("timer.main", () => null),
    );
    expect(listDockSurfaces().map((s) => s.componentKey)).toEqual(["com.acme.timer:timer.main"]);
  });

  it("throws when binding a surface the manifest did not declare", () => {
    expect(() =>
      registerModule(manifest(), (host) => host.contribute.surface("ghost", () => null)),
    ).toThrow(/not declared/);
  });

  it("rejects a manifest declaring a surface its trust tier may not contribute", () => {
    expect(() =>
      registerModule(manifest({ contributes: { surfaces: [{ type: "rail", id: "side", title: "Side" }] } })),
    ).toThrow(/may not contribute/);
  });

  it("disposer also removes the module's dock surfaces", () => {
    const dispose = registerModule(
      manifest({ contributes: { surfaces: [{ type: "dock", id: "timer.main", title: "Timer" }] } }),
      (host) => host.contribute.surface("timer.main", () => null),
    );
    dispose();
    expect(listDockSurfaces()).toHaveLength(0);
  });

  it("allows a headless module with no setup", () => {
    registerModule(manifest({ id: "com.acme.headless", namespace: "com.acme.headless", entities: [], mutationKinds: [] }));
    expect(getModule("com.acme.headless")?.name).toBe("Timer");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/modules/__tests__/registry.test.ts`
Expected: FAIL — `host.registerReducer is not a function` / type errors (the host param does not exist yet).

- [ ] **Step 3: Create `src/modules/host.ts`**

```ts
/**
 * The host handle a module receives at registration (substrate Appendix B, P2).
 * In the eventual sandboxed world a third-party module talks to the host ONLY
 * through a handle like this; core modules dogfood the same shape. The set of
 * surfaces it can bind is fixed by the manifest (gated before this runs) — the
 * handle only binds implementations. Carries `registerReducer` +
 * `contribute.surface` for now; grows with real consumers (P6/YAGNI).
 */
import { registerModuleReducer, type ModuleReducer } from "@/state/moduleReducers";
import { registerDockSurface, type DockSurfaceComponent } from "@/modules/surfaceRegistry";
import type { SurfaceSpec } from "@/modules/surfaces";

export interface ModuleHost {
  /** Register this module's reducer under its namespace (substrate Pillar 1). */
  registerReducer(reducer: ModuleReducer): void;
  contribute: {
    /**
     * Bind a React component to a surface the manifest already declared.
     * Throws if `surfaceId` was not declared, or its type is not yet wired.
     */
    surface(surfaceId: string, component: DockSurfaceComponent): void;
  };
}

/**
 * Build a host scoped to one module, collecting disposers so the registry can
 * tear down everything the module contributed. `declaredSurfaces` is the
 * manifest's surfaces, already trust-gated by the caller.
 */
export function createModuleHost(
  moduleId: string,
  namespace: string,
  declaredSurfaces: Map<string, SurfaceSpec>,
): { host: ModuleHost; dispose: () => void } {
  const disposers: Array<() => void> = [];

  const host: ModuleHost = {
    registerReducer(reducer) {
      disposers.push(registerModuleReducer(namespace, reducer));
    },
    contribute: {
      surface(surfaceId, component) {
        const spec = declaredSurfaces.get(surfaceId);
        if (!spec) {
          throw new Error(`Surface "${surfaceId}" is not declared in module "${moduleId}" manifest`);
        }
        if (spec.type !== "dock") {
          throw new Error(`Surface type "${spec.type}" is not wired yet (only "dock" in v1)`);
        }
        disposers.push(registerDockSurface(moduleId, spec, component));
      },
    },
  };

  const dispose = () => {
    for (const d of disposers.reverse()) d();
  };
  return { host, dispose };
}
```

- [ ] **Step 4: Rewrite `src/modules/registry.ts`**

Replace the ENTIRE file contents with:

```ts
import { kindNamespace } from "@/state/mutationKind";
import { canContributeSurface, type SurfaceSpec, type TrustTier } from "@/modules/surfaces";
import { createModuleHost, type ModuleHost } from "@/modules/host";

/** A module's declared manifest (substrate §7.1). */
export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  /** Reverse-DNS namespace owning this module's kinds, entities, and storage. */
  namespace: string;
  /** ENT types this module owns, each prefixed with `${namespace}/`. */
  entities: string[];
  /** Mutation kinds this module emits, each prefixed with `${namespace}/`. */
  mutationKinds: string[];
  /** Capability requests (vocabulary now, enforced later — substrate §7.3). */
  capabilities: Record<string, unknown>;
  trust: TrustTier;
  /**
   * UI surfaces this module declares (substrate §7.2). The manifest is the
   * gateable, serializable declaration; components are bound at registration
   * via the host (gate-before-run security posture).
   */
  contributes?: { surfaces?: SurfaceSpec[] };
}

interface RegisteredModule {
  manifest: ModuleManifest;
  dispose: () => void;
}

const _modules = new Map<string, RegisteredModule>();

function assertNamespaced(items: string[], namespace: string, label: string): void {
  const prefix = `${namespace}/`;
  for (const item of items) {
    if (kindNamespace(item) !== namespace || !item.startsWith(prefix)) {
      throw new Error(`${label} "${item}" is outside module namespace "${namespace}"`);
    }
  }
}

/**
 * Register a module from its manifest. The optional `setup` callback receives a
 * capability-scoped host (substrate Appendix B) to register its reducer and
 * bind components to the surfaces the manifest declared. Validates namespacing
 * and trust×surface gating BEFORE running setup (gate-before-run). Returns a
 * disposer that unregisters the module, its reducer, and its surfaces.
 * (substrate Pillar 4, §7)
 */
export function registerModule(
  manifest: ModuleManifest,
  setup?: (host: ModuleHost) => void,
): () => void {
  if (_modules.has(manifest.id)) {
    throw new Error(`A module is already registered with id "${manifest.id}"`);
  }
  assertNamespaced(manifest.mutationKinds, manifest.namespace, "mutationKind");
  assertNamespaced(manifest.entities, manifest.namespace, "entity");

  const declared = new Map<string, SurfaceSpec>();
  for (const spec of manifest.contributes?.surfaces ?? []) {
    if (!canContributeSurface(manifest.trust, spec.type)) {
      throw new Error(
        `Module "${manifest.id}" (${manifest.trust}) may not contribute a "${spec.type}" surface`,
      );
    }
    declared.set(spec.id, spec);
  }

  const { host, dispose: disposeHost } = createModuleHost(
    manifest.id,
    manifest.namespace,
    declared,
  );
  if (setup) setup(host);

  const dispose = () => {
    disposeHost();
    _modules.delete(manifest.id);
  };
  _modules.set(manifest.id, { manifest, dispose });
  return dispose;
}

/** Returns the manifest of the registered module with `id`, or undefined. */
export function getModule(id: string): ModuleManifest | undefined {
  return _modules.get(id)?.manifest;
}

/** All registered module manifests. */
export function listModules(): ModuleManifest[] {
  return [..._modules.values()].map((m) => m.manifest);
}

/** Test-only: unregister all modules, disposing each module's reducer + surfaces. */
export function _resetModules(): void {
  for (const m of [..._modules.values()]) m.dispose();
  _modules.clear();
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test -- src/modules/__tests__/registry.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Full check + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green (0 errors, 0 warnings).

```bash
git add src/modules/host.ts src/modules/registry.ts src/modules/__tests__/registry.test.ts
git commit -m "feat(substrate): module host handle + manifest surface declaration"
```

---

### Task 3: `openModulePanel` workspace action

**Files:**
- Modify: `src/state/workspace.ts`
- Test: `src/state/__tests__/openModulePanel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/state/__tests__/openModulePanel.test.ts
import { describe, it, expect, vi } from "vitest";
import { useWorkspace, setDockviewApi } from "@/state/workspace";
import type { DockviewApi } from "dockview";

describe("openModulePanel", () => {
  it("adds a new panel when none exists with that key", () => {
    const addPanel = vi.fn();
    setDockviewApi({ panels: [], addPanel } as unknown as DockviewApi);
    useWorkspace.getState().openModulePanel("org.nexus.tasks:tasks.main", "Tasks");
    expect(addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "org.nexus.tasks:tasks.main",
        component: "org.nexus.tasks:tasks.main",
        title: "Tasks",
      }),
    );
  });

  it("focuses an existing panel instead of adding a duplicate", () => {
    const setActive = vi.fn();
    const addPanel = vi.fn();
    setDockviewApi({
      panels: [{ id: "org.nexus.tasks:tasks.main", api: { setActive } }],
      addPanel,
    } as unknown as DockviewApi);
    useWorkspace.getState().openModulePanel("org.nexus.tasks:tasks.main", "Tasks");
    expect(setActive).toHaveBeenCalled();
    expect(addPanel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/state/__tests__/openModulePanel.test.ts`
Expected: FAIL — `openModulePanel is not a function`.

- [ ] **Step 3: Add `openModulePanel` to the store interface**

In `src/state/workspace.ts`, locate the line `  openSettingsPanel: () => void;` (the action declaration in the store interface). Insert immediately AFTER it:

```ts

  // Module dock surfaces (substrate Pillar 4)
  openModulePanel: (componentKey: string, title: string) => void;
```

- [ ] **Step 4: Add the `openModulePanel` implementation**

In `src/state/workspace.ts`, locate the END of the `openSettingsPanel: () => { ... },` implementation block (it ends with `},` right before the `// ── Panel focus ──` comment). Insert the new implementation immediately AFTER `openSettingsPanel`'s closing `},`:

```ts

  openModulePanel: (componentKey, title) => {
    const api = getDockviewApi();
    if (!api) return;
    const existing = api.panels.find((p) => p.id === componentKey);
    if (existing) {
      existing.api.setActive();
    } else {
      api.addPanel({
        id: componentKey,
        component: componentKey,
        title,
        minimumWidth: 360,
        position: { direction: "right" },
      });
    }
  },
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test -- src/state/__tests__/openModulePanel.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Full check + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green.

```bash
git add src/state/workspace.ts src/state/__tests__/openModulePanel.test.ts
git commit -m "feat(workspace): openModulePanel launches a module dock surface"
```

---

### Task 4: Skeleton Tasks module + bootstrap + live UI wiring

**Files:**
- Create: `src/modules/tasks/TasksPanel.tsx`
- Create: `src/modules/tasks/index.ts`
- Create: `src/modules/bootstrap.ts`
- Modify: `src/main.tsx`
- Modify: `src/components/Workspace.tsx`
- Modify: `src/components/palette/CommandPalette.tsx`
- Test: `src/modules/tasks/__tests__/tasks.test.ts`
- Test: `src/modules/__tests__/bootstrap.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/modules/tasks/__tests__/tasks.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { registerTasksModule, TASKS_MODULE_ID, TASKS_MAIN_PANEL_KEY } from "@/modules/tasks";
import { getModule, _resetModules } from "@/modules/registry";
import { listDockSurfaces, _resetDockSurfaces } from "@/modules/surfaceRegistry";
import { _resetModuleReducers } from "@/state/moduleReducers";

beforeEach(() => {
  _resetModules();
  _resetModuleReducers();
  _resetDockSurfaces();
});

describe("Tasks module (skeleton)", () => {
  it("registers under the org.nexus.tasks namespace", () => {
    registerTasksModule();
    expect(getModule(TASKS_MODULE_ID)?.name).toBe("Tasks");
  });

  it("contributes a dock surface whose key matches TASKS_MAIN_PANEL_KEY", () => {
    registerTasksModule();
    expect(listDockSurfaces().map((s) => s.componentKey)).toEqual([TASKS_MAIN_PANEL_KEY]);
    expect(TASKS_MAIN_PANEL_KEY).toBe("org.nexus.tasks:tasks.main");
  });
});
```

```ts
// src/modules/__tests__/bootstrap.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { bootstrapModules, _resetBootstrapForTests } from "@/modules/bootstrap";
import { getModule, _resetModules } from "@/modules/registry";
import { _resetDockSurfaces } from "@/modules/surfaceRegistry";
import { _resetModuleReducers } from "@/state/moduleReducers";

beforeEach(() => {
  _resetModules();
  _resetModuleReducers();
  _resetDockSurfaces();
  _resetBootstrapForTests();
});

describe("bootstrapModules", () => {
  it("registers the core Tasks module", () => {
    bootstrapModules();
    expect(getModule("org.nexus.tasks")).toBeDefined();
  });

  it("is idempotent — a second call does not throw", () => {
    bootstrapModules();
    expect(() => bootstrapModules()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test -- src/modules/tasks/__tests__/tasks.test.ts src/modules/__tests__/bootstrap.test.ts`
Expected: FAIL — unresolved imports `@/modules/tasks`, `@/modules/bootstrap`.

- [ ] **Step 3: Create `src/modules/tasks/TasksPanel.tsx`**

```tsx
import type { IDockviewPanelProps } from "dockview";

/**
 * Placeholder Tasks panel. Step 1 uses it to prove the dock contribution point
 * renders a real panel; Phase 1 step 2 replaces this body with the task UI.
 */
export function TasksPanel(_: IDockviewPanelProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-text-muted">
      <p className="text-body font-medium text-text-primary">Tasks</p>
      <p className="text-small">Contributed by the org.nexus.tasks module.</p>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/modules/tasks/index.ts`**

```ts
import { registerModule, type ModuleManifest } from "@/modules/registry";
import { dockComponentKey } from "@/modules/surfaceRegistry";
import { TasksPanel } from "@/modules/tasks/TasksPanel";

export const TASKS_MODULE_ID = "org.nexus.tasks";
export const TASKS_MAIN_SURFACE_ID = "tasks.main";

/** The dockview component key / panel id for the Tasks main dock surface. */
export const TASKS_MAIN_PANEL_KEY = dockComponentKey(TASKS_MODULE_ID, TASKS_MAIN_SURFACE_ID);

const manifest: ModuleManifest = {
  id: TASKS_MODULE_ID,
  name: "Tasks",
  version: "0.1.0",
  namespace: TASKS_MODULE_ID,
  entities: [],
  mutationKinds: [],
  capabilities: { "ui.contribute": ["dock"] },
  trust: "core",
  contributes: {
    surfaces: [
      { type: "dock", id: TASKS_MAIN_SURFACE_ID, title: "Tasks", icon: "check", detachable: false },
    ],
  },
};

/**
 * Register the Tasks module (skeleton). Step 2 adds entities, mutation kinds, a
 * reducer, and the real panel body. Returns the registry disposer.
 */
export function registerTasksModule(): () => void {
  return registerModule(manifest, (host) => {
    host.contribute.surface(TASKS_MAIN_SURFACE_ID, TasksPanel);
  });
}
```

- [ ] **Step 5: Create `src/modules/bootstrap.ts`**

```ts
/**
 * Register all in-tree (core) modules at startup. Called synchronously from
 * main.tsx BEFORE React renders so dockview can resolve module panel components
 * during initial layout restore. Idempotent (guards against HMR / double eval).
 */
import { registerTasksModule } from "@/modules/tasks";

let _bootstrapped = false;

export function bootstrapModules(): void {
  if (_bootstrapped) return;
  _bootstrapped = true;
  registerTasksModule();
}

/** Test-only: allow re-bootstrapping after a registry reset. */
export function _resetBootstrapForTests(): void {
  _bootstrapped = false;
}
```

- [ ] **Step 6: Run to verify the module + bootstrap tests pass**

Run: `pnpm test -- src/modules/tasks/__tests__/tasks.test.ts src/modules/__tests__/bootstrap.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Wire bootstrap into `src/main.tsx`**

Add this import alongside the existing top-of-file imports (e.g. after the `import { startGoogleAutoSync } ...` line):

```ts
import { bootstrapModules } from "@/modules/bootstrap";
```

Then locate `const rootEl = document.getElementById("root");` and insert the bootstrap call on the line immediately BEFORE it:

```ts
// Register core modules before first render so dockview can resolve module
// panel components during initial layout restore.
bootstrapModules();

const rootEl = document.getElementById("root");
```

- [ ] **Step 8: Merge module dock components into dockview in `src/components/Workspace.tsx`**

Add the import alongside the existing imports (after the `import { getAppPreferences ... }` line):

```ts
import { dockSurfaceComponents } from "@/modules/surfaceRegistry";
```

Inside the `Workspace()` component body, add this near the other top-level hooks (e.g. just after `const [historyOpen, setHistoryOpen] = React.useState(false);`):

```ts
  // Merge core dockview panels with module-contributed dock surfaces. Modules
  // are bootstrapped before render, so reading once is correct for step 1
  // (dynamic post-mount module load is out of scope).
  const dvComponents = React.useMemo(
    () => ({ ...DV_COMPONENTS, ...dockSurfaceComponents() }),
    [],
  );
```

Then change the `<DockviewReact ... />` prop from `components={DV_COMPONENTS}` to:

```tsx
            components={dvComponents}
```

- [ ] **Step 9: Add the "Open Tasks" command to `src/components/palette/CommandPalette.tsx`**

Add the import alongside the existing imports (after `import type { StarStyle } from "@/data/types";`):

```ts
import { TASKS_MAIN_PANEL_KEY } from "@/modules/tasks";
```

Add the store selector next to the other panel-open selectors. Locate `const openCalendarPanel = useWorkspace((s) => s.openCalendarPanel);` and insert immediately after it:

```ts
  const openModulePanel = useWorkspace((s) => s.openModulePanel);
```

Add the command item. Locate the line that pushes the calendar command (`all.push({ id: "calendar", label: "Open Calendar", ... });`) and insert immediately after it:

```ts
    all.push({ id: "open-tasks", label: "Open Tasks", group: "Workspace", icon: CheckCircle2, perform: () => openModulePanel(TASKS_MAIN_PANEL_KEY, "Tasks") });
```

(`CheckCircle2` is already imported; `openModulePanel`, like `openCalendarPanel`, is a stable Zustand selector and intentionally not added to the `items` useMemo dependency array, matching the existing pattern.)

- [ ] **Step 10: Full check**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green.

- [ ] **Step 11: MANUAL verification (not automated — observe the real app)**

Run the app (`pnpm tauri:dev`, or `pnpm dev` for the web-only shell). Open the command palette (⌘K), run **"Open Tasks"**, and confirm a "Tasks" panel docks to the right and renders the placeholder ("Contributed by the org.nexus.tasks module."). Confirm running it again focuses the existing panel rather than adding a duplicate. Report what you observed (do not claim success without observing the panel render).

- [ ] **Step 12: Commit**

```bash
git add src/modules/tasks src/modules/bootstrap.ts src/modules/__tests__/bootstrap.test.ts src/main.tsx src/components/Workspace.tsx src/components/palette/CommandPalette.tsx
git commit -m "feat(modules): skeleton Tasks module renders via dock contribution point"
```

---

## Self-Review (completed by author)

**Spec coverage** (substrate §7.2 dock contribution point + Phase 1 step 1 brief):
- "A registered module's `contributes.surfaces` of type 'dock' must render as a real panel" → Task 1 (registry), Task 2 (manifest `contributes` + host binding), Task 4 (Workspace merge + visible skeleton Tasks panel + manual render check).
- Host-handle `contribute.surface` (confirmed design fork) → Task 2 `host.ts`.
- Skeleton-Tasks visible proof (confirmed design fork) → Task 4.
- Trust×surface gating enforced before run → Task 2 (`canContributeSurface` loop) + registry test "rejects a manifest declaring a surface its trust tier may not contribute".
- Launch mechanism → Task 3 `openModulePanel` + Task 4 palette command.
- Lifecycle/disposal of surfaces → Task 2 host disposer + test "disposer also removes the module's dock surfaces".

**Placeholder scan:** none — full code and exact commands in every step. The only non-automated step (4.11) is explicitly labeled MANUAL with an honesty instruction.

**Type consistency:** `SurfaceSpec` (Task 1) is imported by `surfaceRegistry.ts`, `host.ts`, and `registry.ts`. `DockSurfaceComponent` (Task 1) is the component type used by `registerDockSurface`, `host.contribute.surface`, and `dockSurfaceComponents`. `dockComponentKey` (Task 1) is reused by `registry`/`host` (indirectly) and by `tasks/index.ts` to derive `TASKS_MAIN_PANEL_KEY`. `ModuleHost` (Task 2) is the param of the `setup` callback in `registerModule` and the return of `createModuleHost`. `ModuleManifest.contributes` (Task 2) is consumed by the gating loop and produced by `tasks/index.ts`. `openModulePanel(componentKey, title)` (Task 3) is called by the palette command (Task 4) with `TASKS_MAIN_PANEL_KEY` + `"Tasks"`. `_resetDockSurfaces`/`_resetModules`/`_resetModuleReducers`/`_resetBootstrapForTests` are the reset helpers used consistently across test `beforeEach` blocks.

---

## Execution Handoff

Execute with **superpowers:subagent-driven-development** (per the session's non-negotiable convention): a fresh subagent per task, two-stage review, with the user reviewing between tasks. Four tasks, pure frontend, each green + committed. Nothing pushed/merged without the user asking. Optional convergence gate after Task 4: run `santa-loop` adversarial dual-review on the assembled step.
