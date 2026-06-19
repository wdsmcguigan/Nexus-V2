# Command Contribution Point Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Let modules declare **commands** (manifest) and bind their handlers (host), consumed by the command palette — so the palette is no longer hardcoded per module. Dogfood it by migrating the Tasks module's currently-hardcoded "Open Tasks" command onto the new API. (Substrate §7.2 `command` contribution point.)

**Architecture:** Mirror the dock-surface contribution point exactly. Manifest declares `contributes.commands: ModuleCommandSpec[]` (serializable metadata — id/title/shortcut?/icon?); the un-serializable `run` handler is bound at registration via `host.contribute.command(commandId, run)`. A `src/modules/commands.ts` registry stores `{moduleId, spec, run}`; `CommandPalette` reads `listModuleCommands()` and renders them as palette items. Module commands register at bootstrap (before the palette mounts), so the palette reads once.

**Tech Stack:** TypeScript, React, Vitest (`node` env — no RTL; palette verified live). `@/`=`src/`. Builds on the module model (`src/modules/{registry,host,surfaceRegistry}.ts`) and the Tasks module.

## Verified facts
- `CommandPalette.tsx`: builds `const items: CmdItemDef[]` in a `useMemo`, where `CmdItemDef = { id; label; group; icon: LucideIcon; shortcut?: string; perform: () => void }`; items are grouped by `group` and rendered. The current hardcoded Tasks entry: `all.push({ id: "open-tasks", label: "Open Tasks", group: "Workspace", icon: CheckCircle2, perform: () => openModulePanel(TASKS_MAIN_PANEL_KEY, "Tasks") });` plus `const openModulePanel = useWorkspace((s) => s.openModulePanel);` selector and `import { TASKS_MAIN_PANEL_KEY } from "@/modules/tasks";`.
- Host pattern (`host.ts`): `createModuleHost(moduleId, namespace, declaredSurfaces)` returns `{host, dispose}`; `host.contribute.surface(surfaceId, component)` looks up a manifest-declared surface and registers it, collecting a disposer. `registerModule` gates declared surfaces via `canContributeSurface` before running `setup`.
- `registerModule(manifest, setup?)`: manifest has `contributes?: { surfaces?: SurfaceSpec[] }`. Reset helpers exist for every registry.
- Tasks module (`src/modules/tasks/index.ts`): manifest + `registerTasksModule()` wires reducer/inverse/surface; exports `TASKS_MODULE_ID`, `TASKS_MAIN_PANEL_KEY`. `openModulePanel(componentKey, title)` is a workspace action (`useWorkspace.getState().openModulePanel`).

## Out of scope (noted)
Actual module **global keyboard-shortcut binding** (the `shortcuts.ts` engine is a closed registry; dynamic module shortcuts are a separate, larger change). The `shortcut` field here is a **display hint** shown in the palette only. Also: context-menu/settings contribution points; third-party command gating beyond the existing trust model.

---

### Task 1: Command registry

**Files:** Create `src/modules/commands.ts`; Test `src/modules/__tests__/commands.test.ts`.

- [ ] **Step 1: failing test** `src/modules/__tests__/commands.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  moduleCommandKey, registerModuleCommand, listModuleCommands, _resetModuleCommands,
} from "@/modules/commands";
import type { ModuleCommandSpec } from "@/modules/commands";

const spec: ModuleCommandSpec = { id: "open", title: "Open Tasks" };
const run = () => {};

beforeEach(() => _resetModuleCommands());

describe("module command registry", () => {
  it("builds a namespaced command key", () => {
    expect(moduleCommandKey("org.nexus.tasks", "open")).toBe("org.nexus.tasks:open");
  });
  it("registers a command and lists it", () => {
    registerModuleCommand("org.nexus.tasks", spec, run);
    const all = listModuleCommands();
    expect(all).toHaveLength(1);
    expect(all[0]!.key).toBe("org.nexus.tasks:open");
    expect(all[0]!.spec.title).toBe("Open Tasks");
    expect(all[0]!.run).toBe(run);
  });
  it("rejects a duplicate command key", () => {
    registerModuleCommand("org.nexus.tasks", spec, run);
    expect(() => registerModuleCommand("org.nexus.tasks", spec, run)).toThrow(/already registered/);
  });
  it("disposer removes the command", () => {
    const dispose = registerModuleCommand("org.nexus.tasks", spec, run);
    dispose();
    expect(listModuleCommands()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: run, expect FAIL:** `pnpm test -- src/modules/__tests__/commands.test.ts`

- [ ] **Step 3: create `src/modules/commands.ts`:**
```ts
/**
 * Host-side registry of commands contributed by modules (substrate §7.2). The
 * manifest declares command metadata (serializable); the un-serializable `run`
 * handler is bound at registration. The command palette renders these.
 */

/** A command a module declares in its manifest. */
export interface ModuleCommandSpec {
  /** Module-local command id, unique within the module (e.g. "open"). */
  id: string;
  title: string;
  /** Optional display-only shortcut hint (e.g. "T"); not yet bound to a key. */
  shortcut?: string;
  /** Optional icon name hint; the palette maps it or uses a default. */
  icon?: string;
  /** Optional palette group label; defaults to the module's name at render. */
  group?: string;
}

/** A registered command: its spec, owning module, key, and run handler. */
export interface RegisteredCommand {
  moduleId: string;
  spec: ModuleCommandSpec;
  /** Palette command id: `${moduleId}:${spec.id}`. */
  key: string;
  run: () => void;
}

const _commands = new Map<string, RegisteredCommand>();

/** The palette command id for a module command. */
export function moduleCommandKey(moduleId: string, commandId: string): string {
  return `${moduleId}:${commandId}`;
}

/** Register a command with its run handler. Returns a disposer. Throws on duplicate key. */
export function registerModuleCommand(
  moduleId: string,
  spec: ModuleCommandSpec,
  run: () => void,
): () => void {
  const key = moduleCommandKey(moduleId, spec.id);
  if (_commands.has(key)) {
    throw new Error(`A module command is already registered for "${key}"`);
  }
  _commands.set(key, { moduleId, spec, key, run });
  return () => {
    _commands.delete(key);
  };
}

/** All registered module commands. */
export function listModuleCommands(): RegisteredCommand[] {
  return [..._commands.values()];
}

/** Test-only: clear all registered module commands. */
export function _resetModuleCommands(): void {
  _commands.clear();
}
```

- [ ] **Step 4: run, expect PASS (4 tests).**
- [ ] **Step 5: full check + commit:** `pnpm test && pnpm typecheck && pnpm lint`; `git add src/modules/commands.ts src/modules/__tests__/commands.test.ts && git commit -m "feat(substrate): module command registry"`

---

### Task 2: manifest `contributes.commands` + `host.contribute.command`

**Files:** Modify `src/modules/registry.ts`, `src/modules/host.ts`; Test `src/modules/__tests__/host.command.test.ts`.

- [ ] **Step 1: failing test** `src/modules/__tests__/host.command.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { registerModule, _resetModules } from "@/modules/registry";
import type { ModuleManifest } from "@/modules/registry";
import { listModuleCommands, _resetModuleCommands } from "@/modules/commands";
import { _resetModuleReducers } from "@/state/moduleReducers";
import { _resetDockSurfaces } from "@/modules/surfaceRegistry";
import { _resetModuleInverses } from "@/state/mutations";

function manifest(over: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    id: "com.acme.x", name: "X", version: "1", namespace: "com.acme.x",
    entities: [], mutationKinds: [], capabilities: {}, trust: "core", ...over,
  };
}

beforeEach(() => {
  _resetModules(); _resetModuleReducers(); _resetDockSurfaces();
  _resetModuleInverses(); _resetModuleCommands();
});

describe("host.contribute.command", () => {
  it("binds a run handler to a manifest-declared command", () => {
    let ran = false;
    registerModule(
      manifest({ contributes: { commands: [{ id: "go", title: "Go" }] } }),
      (host) => host.contribute.command("go", () => { ran = true; }),
    );
    const cmds = listModuleCommands();
    expect(cmds.map((c) => c.key)).toEqual(["com.acme.x:go"]);
    cmds[0]!.run();
    expect(ran).toBe(true);
  });

  it("throws binding a command the manifest did not declare", () => {
    expect(() =>
      registerModule(manifest(), (host) => host.contribute.command("ghost", () => {})),
    ).toThrow(/not declared/);
  });

  it("disposer removes the command", () => {
    const dispose = registerModule(
      manifest({ contributes: { commands: [{ id: "go", title: "Go" }] } }),
      (host) => host.contribute.command("go", () => {}),
    );
    dispose();
    expect(listModuleCommands()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: run, expect FAIL.**

- [ ] **Step 3: extend `src/modules/registry.ts`:** import the command spec type and add to the manifest's `contributes`:
```ts
import type { ModuleCommandSpec } from "@/modules/commands";
```
Change the `contributes` field type to:
```ts
  contributes?: { surfaces?: SurfaceSpec[]; commands?: ModuleCommandSpec[] };
```
In `registerModule`, build a declared-commands map alongside the declared-surfaces map and pass it to `createModuleHost` (commands need no trust gating beyond the existing model for now — all tiers may contribute commands):
```ts
  const declaredCommands = new Map<string, ModuleCommandSpec>();
  for (const c of manifest.contributes?.commands ?? []) declaredCommands.set(c.id, c);
```
Pass `declaredCommands` as a new 4th arg to `createModuleHost(manifest.id, manifest.namespace, declared, declaredCommands)`.

- [ ] **Step 4: extend `src/modules/host.ts`:** add imports + the `contribute.command` method.
```ts
import { registerModuleCommand, type ModuleCommandSpec } from "@/modules/commands";
```
Add to the `ModuleHost` interface's `contribute` object:
```ts
    /** Bind a run handler to a command the manifest declared. Throws if undeclared. */
    command(commandId: string, run: () => void): void;
```
Change `createModuleHost`'s signature to accept the declared commands:
```ts
export function createModuleHost(
  moduleId: string,
  namespace: string,
  declaredSurfaces: Map<string, SurfaceSpec>,
  declaredCommands: Map<string, ModuleCommandSpec> = new Map(),
): { host: ModuleHost; dispose: () => void } {
```
Add the `command` method to the `host.contribute` object (alongside `surface`):
```ts
      command(commandId, run) {
        const spec = declaredCommands.get(commandId);
        if (!spec) {
          throw new Error(`Command "${commandId}" is not declared in module "${moduleId}" manifest`);
        }
        disposers.push(registerModuleCommand(moduleId, spec, run));
      },
```

- [ ] **Step 5: run, expect PASS (3 tests):** `pnpm test -- src/modules/__tests__/host.command.test.ts`
- [ ] **Step 6: full check + commit:** `pnpm test && pnpm typecheck && pnpm lint`; `git add src/modules/registry.ts src/modules/host.ts src/modules/__tests__/host.command.test.ts && git commit -m "feat(substrate): host.contribute.command + manifest commands"`

---

### Task 3: Palette consumes module commands; migrate Tasks "Open Tasks" onto the API

**Files:** Modify `src/components/palette/CommandPalette.tsx`, `src/modules/tasks/index.ts`; Test: extend `src/modules/tasks/__tests__/registration.test.ts`.

- [ ] **Step 1: failing test** — extend `registration.test.ts` to assert Tasks declares + binds its command. Add `_resetModuleCommands` to the imports + `beforeEach`, and a new test:
```ts
import { listModuleCommands, _resetModuleCommands } from "@/modules/commands";
// add _resetModuleCommands() to beforeEach
it("contributes an 'Open Tasks' command", () => {
  registerTasksModule();
  const cmd = listModuleCommands().find((c) => c.key === "org.nexus.tasks:open");
  expect(cmd?.spec.title).toBe("Open Tasks");
  expect(typeof cmd?.run).toBe("function");
});
```
Run `pnpm test -- src/modules/tasks/__tests__/registration.test.ts` → FAIL.

- [ ] **Step 2: update `src/modules/tasks/index.ts`:** declare the command in the manifest's `contributes` and bind it in `registerTasksModule`. Add to `contributes`:
```ts
    commands: [{ id: "open", title: "Open Tasks", icon: "check" }],
```
In `registerTasksModule`'s setup, add (the run opens the panel via the workspace action):
```ts
    host.contribute.command("open", () => {
      useWorkspace.getState().openModulePanel(TASKS_MAIN_PANEL_KEY, "Tasks");
    });
```
Add the import: `import { useWorkspace } from "@/state/workspace";`
(Keep the surface + reducer + inverse wiring.) Run the test → PASS.

- [ ] **Step 3: CommandPalette consumes module commands.** In `src/components/palette/CommandPalette.tsx`:
  - Add import: `import { listModuleCommands } from "@/modules/commands";` and an icon for module commands, e.g. reuse an existing import like `LayoutPanelTop` (already imported) as the default.
  - REMOVE the hardcoded Tasks entry (`all.push({ id: "open-tasks", ... })`), the `const openModulePanel = useWorkspace((s) => s.openModulePanel);` selector if now unused, and the `import { TASKS_MAIN_PANEL_KEY } from "@/modules/tasks";` if now unused. (Verify they're unused before removing — `openModulePanel` may be used only by that entry.)
  - In the `items` useMemo, after the existing `all.push(...)` calls, append module commands:
```ts
    // Module-contributed commands (substrate §7.2). Modules register at bootstrap.
    for (const c of listModuleCommands()) {
      all.push({
        id: c.key,
        label: c.spec.title,
        group: c.spec.group ?? "Workspace",
        icon: LayoutPanelTop,
        shortcut: c.spec.shortcut,
        perform: c.run,
      });
    }
```
  - The `items` useMemo dep array: module commands are stable after bootstrap; no new reactive dep needed (consistent with how `openCalendarPanel` etc. are omitted). Leave deps as-is.

- [ ] **Step 4: full check.** `pnpm test && pnpm typecheck && pnpm lint` (green; known-flaky benchmark — re-run alone if only it fails). Confirm the Tasks `registration.test.ts` passes and nothing else broke.

- [ ] **Step 5: commit.**
```bash
git add src/components/palette/CommandPalette.tsx src/modules/tasks/index.ts src/modules/tasks/__tests__/registration.test.ts
git commit -m "feat(substrate): command palette renders module-contributed commands; Tasks dogfoods it"
```

---

### Task 4: Live verification

- [ ] Run the app (`pnpm dev`, :1420). Open the command palette (⌘K), confirm **"Open Tasks"** still appears (now sourced from the module command registry, not hardcoded) and running it opens the Tasks panel. Confirm no console errors beyond the known pre-existing NavigationPanel/PanelHeader warnings. Report honestly what was observed.

---

## Self-Review (author)
**Spec coverage:** command registry (§7.2) → T1; manifest `contributes.commands` + host binding → T2; palette consumption + Tasks dogfood (de-hardcode) → T3; live check → T4. Module global-shortcut *binding* explicitly deferred (display-only `shortcut` field).
**Placeholder scan:** exact code + commands throughout; T3's removal step says to verify unused-before-removing.
**Type consistency:** `ModuleCommandSpec`/`RegisteredCommand` (T1) consumed by host (T2), registry manifest (T2), and palette (T3); `moduleCommandKey` format `${moduleId}:${id}` matches the Tasks test's `"org.nexus.tasks:open"`. Mirrors the surface-contribution pattern (manifest declares spec, host binds the impl by id, registry stores it, gate-before-run).

## Execution Handoff
subagent-driven-development: fresh subagent per task, review each, fix loops. Then resume the roadmap (Tasks Stage 3 → Notes → AI tracer-bullet).
