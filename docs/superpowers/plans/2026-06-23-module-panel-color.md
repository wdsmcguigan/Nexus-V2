# Module Panel Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give substrate module dock panels a color (declared default + deterministic fallback + user/workspace customization), in full parity with core panels — closing panel-migration gap #3.

**Architecture:** A *parallel* color path for module panels, keyed by the dockview panel id (`componentKey`, e.g. `org.nexus.tasks:tasks.main`), leaving the core `ModuleKey`-keyed path untouched. A module dock surface declares an optional `color`; a hash fallback covers undeclared ones; pure resolvers mirror the core `resolvePanelColor` override order; `applyModuleColor` sets `--module-color` for module panels (it currently clears it); a "Module panels" subsection in the existing settings panel makes them user-customizable.

**Tech Stack:** TypeScript, React 18, Zustand (`useWorkspace`), the existing panel-color system (`src/lib/panelColors.ts`, `--module-color` CSS in `src/design-system/tokens.css`), Vitest (Node).

## Global Constraints

- **Parallel path, core untouched:** the core color path (`ModuleKey`, `PanelColorPrefs.colors`, `DEFAULT_MODULE_COLORS`, `resolvePanelColor`) is NOT modified. Module panels use a new path keyed by `componentKey` (a string).
- **Stored color form:** `"link-N"` (N in 1..21, → `var(--color-link-N)` via `toCssColor`) or a raw hex like `"#aabbcc"`. Resolvers return the `toCssColor`-wrapped CSS string.
- **`moduleColors` is optional + defaults to `{}`:** the type field is optional and all reads use optional chaining / `?? {}`, so already-persisted prefs (which lack it) load fine.
- **Resolution order (mirrors core):** workspace override → user override → manifest-declared → `moduleSurfaceFallbackColor(componentKey)`.
- **Fallback is deterministic:** same id → same `link-N`, always in `link-1..link-21`.
- **Declared colors:** Tasks `"link-11"`, Notes `"link-13"`, Timekit `"link-6"` (link-N not used by core defaults 16/4/21/18/2/7/8).
- **Settings:** a dynamic "Module panels" subsection over `listDockSurfaces()`, reusing `SwatchPopover` + Reset; "Reset all" clears `moduleColors` too; the existing workspace-override toggle + body-tint already govern it.
- **Testing** (`docs/testing-policy.md`): pure resolvers → Node (Vitest) tests mirroring `src/lib/__tests__/panelColors.test.ts`. The `applyModuleColor` flip + settings subsection are UI-layer, verified live (exactly how core panel color is covered — no e2e for color). No RTL/jsdom.
- **Gates:** `pnpm test && pnpm typecheck && pnpm lint` (lint zero-warnings).
- **Commits:** conventional, one per task. **No `Co-Authored-By` trailer.** Do not merge or push.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/modules/surfaces.ts` | Add `color?: string` to `SurfaceSpec` | 1 |
| `src/data/types.ts` | Add `moduleColors?: Record<string, string>` to `PanelColorPrefs` | 1 |
| `src/lib/appPreferences.ts` | Default `panelColors.moduleColors = {}` | 1 |
| `src/modules/surfaceRegistry.ts` | `dockSurfaceColor(componentKey)` lookup | 1 |
| `src/modules/{tasks,notes,timekit}/index.ts` | Declare each surface's `color` | 1 |
| `src/lib/panelColors.ts` | `moduleSurfaceFallbackColor` + `resolveModulePanelColor` | 2 |
| `src/lib/__tests__/panelColors.test.ts` | Node tests for the two new resolvers | 2 |
| `src/components/Workspace.tsx` | `applyModuleColor`: resolve + set (was: clear) for module ids | 3 |
| `src/components/settings/PanelColorsSettings.tsx` | "Module panels" subsection + write helpers | 4 |

---

### Task 1: Data layer — `color` on surfaces, `moduleColors` pref, registry lookup, declared colors

**Files:**
- Modify: `src/modules/surfaces.ts`, `src/data/types.ts`, `src/lib/appPreferences.ts`, `src/modules/surfaceRegistry.ts`, `src/modules/tasks/index.ts`, `src/modules/notes/index.ts`, `src/modules/timekit/index.ts`

**Interfaces:**
- Produces: `SurfaceSpec.color?: string`; `PanelColorPrefs.moduleColors?: Record<string, string>`; `dockSurfaceColor(componentKey: string): string | undefined`; the three module surfaces declare `color`.

- [ ] **Step 1: Add `color` to `SurfaceSpec`.** In `src/modules/surfaces.ts`, inside the `SurfaceSpec` interface, after the `icon?` field, add:

```ts
  /** Optional dock-surface color: a "link-N" token ref (→ var(--color-link-N)) or a hex
   *  string. Drives the panel's --module-color; falls back to a per-id hash when absent. */
  color?: string;
```

- [ ] **Step 2: Add `moduleColors` to `PanelColorPrefs`.** In `src/data/types.ts`, in the `PanelColorPrefs` interface, after the `colors` field, add:

```ts
  /** Per-module-panel color override, keyed by the dock-surface componentKey
   *  (e.g. "org.nexus.tasks:tasks.main"). Value is "link-N" or hex. Parallel to
   *  `colors` (which is for core panels). Missing keys fall through to the
   *  module's declared color, then a per-id hash fallback. */
  moduleColors?: Record<string, string>;
```

- [ ] **Step 3: Default it in app preferences.** In `src/lib/appPreferences.ts`, change the `DEFAULTS.panelColors` line (~line 39) to:

```ts
  panelColors: { colors: {}, moduleColors: {}, bodyTintLevel: "L2" },
```

- [ ] **Step 4: Add the registry lookup.** In `src/modules/surfaceRegistry.ts`, after the `dockSurfaceComponents()` function, add:

```ts
/** The declared color of a registered dock surface (its SurfaceSpec.color), or undefined. */
export function dockSurfaceColor(componentKey: string): string | undefined {
  return _dockSurfaces.get(componentKey)?.spec.color;
}
```

- [ ] **Step 5: Declare colors on the three module surfaces.** Add a `color` to each module's dock surface object:

  - `src/modules/tasks/index.ts` — the surface becomes:
    ```ts
    { type: "dock", id: TASKS_MAIN_SURFACE_ID, title: "Tasks", icon: "check", color: "link-11", detachable: false },
    ```
  - `src/modules/notes/index.ts` — the surface becomes:
    ```ts
    { type: "dock", id: NOTES_MAIN_SURFACE_ID, title: "Notes", icon: "notebook", color: "link-13", detachable: false },
    ```
  - `src/modules/timekit/index.ts` — the surface becomes:
    ```ts
    { type: "dock", id: TIMEKIT_MAIN_SURFACE_ID, title: "Clock", icon: "clock", color: "link-6", detachable: false },
    ```

- [ ] **Step 6: Verify typecheck + the existing suite.**

Run: `pnpm test && pnpm typecheck`
Expected: PASS — existing tests unaffected (registration/bootstrap tests don't assert surface color; adding an optional field is safe). If `src/storage/__tests__/benchmark.test.ts` is the only failure, re-run `pnpm test -- benchmark` (timing-flaky).

- [ ] **Step 7: Commit.**

```bash
git add src/modules/surfaces.ts src/data/types.ts src/lib/appPreferences.ts src/modules/surfaceRegistry.ts src/modules/tasks/index.ts src/modules/notes/index.ts src/modules/timekit/index.ts
git commit -m "feat(panel-color): add surface color field, moduleColors pref, registry lookup, declared colors"
```

---

### Task 2: Pure resolvers — `moduleSurfaceFallbackColor` + `resolveModulePanelColor`

**Files:**
- Modify: `src/lib/panelColors.ts`
- Test: `src/lib/__tests__/panelColors.test.ts`

**Interfaces:**
- Consumes: `toCssColor`, `PanelColorPrefs` (with the optional `moduleColors` from Task 1).
- Produces: `moduleSurfaceFallbackColor(componentKey: string): string` (returns stored form `"link-N"`); `resolveModulePanelColor(componentKey: string, declared: string | undefined, user: PanelColorPrefs, workspace?: PanelColorPrefs): string` (returns a `toCssColor`-wrapped CSS string).

- [ ] **Step 1: Write the failing tests.** Append to `src/lib/__tests__/panelColors.test.ts`:

```ts
import { moduleSurfaceFallbackColor, resolveModulePanelColor } from "@/lib/panelColors";

describe("moduleSurfaceFallbackColor", () => {
  it("is deterministic for the same id", () => {
    const a = moduleSurfaceFallbackColor("org.nexus.tasks:tasks.main");
    const b = moduleSurfaceFallbackColor("org.nexus.tasks:tasks.main");
    expect(a).toBe(b);
  });
  it("always returns a link-N in 1..21", () => {
    for (const id of ["a", "org.nexus.notes:notes.main", "x:y", "zzzzzzzz", "org.nexus.timekit:timekit.main"]) {
      const m = /^link-(\d+)$/.exec(moduleSurfaceFallbackColor(id));
      expect(m).not.toBeNull();
      const n = Number(m![1]);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(21);
    }
  });
  it("distinguishes at least some distinct ids", () => {
    const set = new Set([
      moduleSurfaceFallbackColor("org.nexus.tasks:tasks.main"),
      moduleSurfaceFallbackColor("org.nexus.notes:notes.main"),
      moduleSurfaceFallbackColor("org.nexus.timekit:timekit.main"),
    ]);
    expect(set.size).toBeGreaterThan(1);
  });
});

describe("resolveModulePanelColor", () => {
  const KEY = "org.nexus.tasks:tasks.main";
  const userOnly: PanelColorPrefs = { colors: {}, bodyTintLevel: "L2" };

  it("uses the declared color when nothing is overridden", () => {
    expect(resolveModulePanelColor(KEY, "link-11", userOnly)).toBe("var(--color-link-11)");
  });
  it("falls back to the per-id hash when no declared color and no override", () => {
    const out = resolveModulePanelColor(KEY, undefined, userOnly);
    expect(out).toBe(toCssColor(moduleSurfaceFallbackColor(KEY)));
  });
  it("user override beats the declared color", () => {
    const user: PanelColorPrefs = { colors: {}, moduleColors: { [KEY]: "link-7" }, bodyTintLevel: "L2" };
    expect(resolveModulePanelColor(KEY, "link-11", user)).toBe("var(--color-link-7)");
  });
  it("workspace override beats user override", () => {
    const user: PanelColorPrefs = { colors: {}, moduleColors: { [KEY]: "link-7" }, bodyTintLevel: "L2" };
    const ws: PanelColorPrefs = { colors: {}, moduleColors: { [KEY]: "#ff0000" }, bodyTintLevel: "L2" };
    expect(resolveModulePanelColor(KEY, "link-11", user, ws)).toBe("#ff0000");
  });
  it("workspace without this key falls through to user/declared", () => {
    const user: PanelColorPrefs = { colors: {}, moduleColors: { [KEY]: "link-7" }, bodyTintLevel: "L2" };
    const ws: PanelColorPrefs = { colors: {}, moduleColors: {}, bodyTintLevel: "L2" };
    expect(resolveModulePanelColor(KEY, "link-11", user, ws)).toBe("var(--color-link-7)");
  });
});
```

- [ ] **Step 2: Run them to confirm they fail.**

Run: `pnpm test -- panelColors`
Expected: FAIL — `moduleSurfaceFallbackColor`/`resolveModulePanelColor` are not exported.

- [ ] **Step 3: Implement the resolvers.** Append to `src/lib/panelColors.ts`:

```ts
/**
 * Deterministic, stable per-id fallback color for a module dock surface that
 * declares none. Maps the componentKey hash into the 21-color link palette.
 * Returns the stored form ("link-N"), like DEFAULT_MODULE_COLORS.
 */
export function moduleSurfaceFallbackColor(componentKey: string): string {
  let h = 0;
  for (let i = 0; i < componentKey.length; i++) {
    h = (h * 31 + componentKey.charCodeAt(i)) >>> 0;
  }
  return `link-${(h % 21) + 1}`;
}

/**
 * Resolve the effective CSS color for a module dock panel.
 * Order: workspace override → user override → manifest-declared → fallback(id).
 */
export function resolveModulePanelColor(
  componentKey: string,
  declared: string | undefined,
  user: PanelColorPrefs,
  workspace?: PanelColorPrefs,
): string {
  const stored =
    workspace?.moduleColors?.[componentKey] ??
    user.moduleColors?.[componentKey] ??
    declared ??
    moduleSurfaceFallbackColor(componentKey);
  return toCssColor(stored);
}
```

- [ ] **Step 4: Run the tests to confirm they pass.**

Run: `pnpm test -- panelColors`
Expected: PASS (existing panelColors tests + the new ones).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/panelColors.ts src/lib/__tests__/panelColors.test.ts
git commit -m "feat(panel-color): moduleSurfaceFallbackColor + resolveModulePanelColor resolvers"
```

---

### Task 3: `applyModuleColor` — resolve + set for module panels

**Files:**
- Modify: `src/components/Workspace.tsx`

**Interfaces:**
- Consumes: `resolveModulePanelColor` (Task 2), `dockSurfaceColor` (Task 1), `getAppPreferences`, `useWorkspace`.

- [ ] **Step 1: Add imports.** In `src/components/Workspace.tsx`:
  - Add `resolveModulePanelColor` to the existing import from `@/lib/panelColors` (the line that already imports `resolvePanelColor`).
  - Add `dockSurfaceColor` to the existing import from `@/modules/surfaceRegistry` (line 31, which imports `dockSurfaceComponents, isModulePanelId`).

- [ ] **Step 2: Replace the module-panel branch.** In `applyModuleColor` (around lines 169-175), replace the block that clears the var for module ids:

```ts
  // Module dock-surface panels (namespaced ids like "org.nexus.tasks:tasks.main")
  // are not core ModuleKeys; skip core color resolution and clear the var so a
  // stale color isn't left on the group.
  if (isModulePanelId(activeId)) {
    el.style.removeProperty("--module-color");
    return;
  }
```

with:

```ts
  // Module dock-surface panels (namespaced ids like "org.nexus.tasks:tasks.main")
  // resolve color on the parallel module path: workspace/user override →
  // manifest-declared → per-id hash fallback.
  if (isModulePanelId(activeId)) {
    const declared = dockSurfaceColor(activeId);
    const userPrefs = getAppPreferences().panelColors;
    const activeWs = useWorkspace.getState().workspaces.find(
      (w) => w.id === useWorkspace.getState().activeWorkspaceId,
    );
    el.style.setProperty(
      "--module-color",
      resolveModulePanelColor(activeId, declared, userPrefs, activeWs?.panelColors),
    );
    return;
  }
```

- [ ] **Step 3: Verify typecheck + lint.**

Run: `pnpm typecheck && pnpm lint`
Expected: both PASS (lint zero-warnings).

- [ ] **Step 4: Commit.**

```bash
git add src/components/Workspace.tsx
git commit -m "feat(panel-color): resolve and apply --module-color for module panels"
```

---

### Task 4: Settings UI — "Module panels" customization subsection

**Files:**
- Modify: `src/components/settings/PanelColorsSettings.tsx`

**Interfaces:**
- Consumes: `listDockSurfaces` (`@/modules/surfaceRegistry`), `moduleSurfaceFallbackColor` (`@/lib/panelColors`), the `SwatchPopover`, the existing `writePrefs`/`activePrefs`.

- [ ] **Step 1: Add imports.** In `src/components/settings/PanelColorsSettings.tsx`:
  - Add `Box` to the existing `lucide-react` import.
  - Add `moduleSurfaceFallbackColor` to the existing import from `@/lib/panelColors`.
  - Add `import { listDockSurfaces } from "@/modules/surfaceRegistry";`.

- [ ] **Step 2: Add the write helpers + extend `resetAll`.** After the existing `resetModule` function, add:

```ts
  const setModulePanelColor = (key: string, color: string) =>
    writePrefs({
      ...activePrefs,
      moduleColors: { ...(activePrefs.moduleColors ?? {}), [key]: color },
    });

  const resetModulePanelColor = (key: string) => {
    const { [key]: _omit, ...rest } = activePrefs.moduleColors ?? {};
    writePrefs({ ...activePrefs, moduleColors: rest });
  };
```

And change the existing `resetAll` to also clear module colors:

```ts
  const resetAll = () => {
    writePrefs({ ...activePrefs, colors: {}, moduleColors: {} });
  };
```

- [ ] **Step 3: Render the "Module panels" subsection.** In the returned JSX, after the closing `</div>` of the core "Module rows" block (the `<div className="rounded-md border border-border-subtle">…</div>` that maps `MODULES`), add:

```tsx
      {/* Module panel rows (substrate modules — dynamic over registered surfaces) */}
      {listDockSurfaces().length > 0 && (
        <>
          <h4 className="mb-2 mt-5 text-body-strong">Module panels</h4>
          <div className="rounded-md border border-border-subtle">
            {listDockSurfaces().map((s, idx, arr) => {
              const key = s.componentKey;
              const current =
                activePrefs.moduleColors?.[key] ?? s.spec.color ?? moduleSurfaceFallbackColor(key);
              const isOverride = !!activePrefs.moduleColors && key in activePrefs.moduleColors;
              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2",
                    idx < arr.length - 1 && "border-b border-border-subtle",
                  )}
                >
                  <span className="flex size-5 items-center justify-center rounded-xs bg-surface-2 text-text-tertiary">
                    <Box size={12} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-body-strong">{s.spec.title}</div>
                    <div className="text-caption text-text-tertiary">{s.moduleId}</div>
                  </div>
                  {isOverride && (
                    <button
                      type="button"
                      onClick={() => resetModulePanelColor(key)}
                      className="text-mono-xs text-text-tertiary hover:text-text-primary"
                    >
                      Reset
                    </button>
                  )}
                  <SwatchPopover
                    value={current}
                    label={`${s.spec.title} color`}
                    onChange={(c) => setModulePanelColor(key, c)}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
```

- [ ] **Step 4: Run the full gate.**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS. (`benchmark.test.ts` flake caveat: if it's the only unit failure, re-run `pnpm test -- benchmark`.)

- [ ] **Step 5: Commit.**

```bash
git add src/components/settings/PanelColorsSettings.tsx
git commit -m "feat(panel-color): Module panels customization subsection in settings"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-23-module-panel-color-design.md`):
- §2 pure resolvers (`moduleSurfaceFallbackColor`, `resolveModulePanelColor`) → Task 2.
- §3 types/manifest (`SurfaceSpec.color`, `PanelColorPrefs.moduleColors`, appPreferences default) → Task 1.
- §4 registry lookup (`dockSurfaceColor`) → Task 1.
- §5 `applyModuleColor` wiring → Task 3.
- §6 settings subsection (+ `setModulePanelColor`/`resetModulePanelColor`, reset-all clears module colors) → Task 4.
- §7 declared colors (Tasks link-11, Notes link-13, Timekit link-6) → Task 1 Step 5.
- §8 testing (pure resolvers Node-tested; UI live) → Task 2 tests; Tasks 3/4 typecheck+lint+live.
- §1 decisions (full parity, manifest+fallback source, separate `moduleColors` map, override order, dynamic settings subsection, shipped-module colors) → Global Constraints + tasks.
- §9 out-of-scope (multi-surface per module, core path changes, new theming channels) → not built.

**Placeholder scan:** none — every step has real code/commands.

**Type consistency:** `resolveModulePanelColor(componentKey, declared, user, workspace?)` and `moduleSurfaceFallbackColor(componentKey)` are defined in Task 2 and used identically in Task 3 (`resolveModulePanelColor(activeId, declared, userPrefs, activeWs?.panelColors)`) and Task 4 (`moduleSurfaceFallbackColor(key)`). `dockSurfaceColor(componentKey)` defined Task 1, used Task 3. `PanelColorPrefs.moduleColors?: Record<string, string>` defined Task 1, written in Task 4 (`setModulePanelColor`) and read in Tasks 2/3/4. `SurfaceSpec.color` defined Task 1, read via `dockSurfaceColor` (Task 3) and `s.spec.color` (Task 4). The stored-vs-CSS form is consistent: resolvers/`SwatchPopover` use stored `"link-N"`/hex; `--module-color` gets the `toCssColor`-wrapped value.
