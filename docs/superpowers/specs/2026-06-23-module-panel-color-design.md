# Module Panel Color — Design Spec

> **Status:** Approved design (brainstorm complete).
> **Builds on:** `docs/module-authoring.md` (panel-migration gap #3 — module panel color); the core panel-color system (`src/lib/panelColors.ts`, `src/components/settings/PanelColorsSettings.tsx`, `--module-color` in `src/design-system/tokens.css`). Closes gap #3.
> **Next:** writing-plans → subagent-driven implementation.

## 0. Goal

Give substrate **module dock panels** a color, with full parity to core panels: a declared default, a deterministic fallback, and user/workspace customization. Today `applyModuleColor` (`src/components/Workspace.tsx`) *clears* `--module-color` for any namespaced module panel id, so module panels (Tasks, Notes, Timekit) render colorless — no tab-bar wash, active-tab underline, divider, or selected-row tint. This is panel-migration gap #3 (one of three remaining after gap #1 parameterized launch closed).

**Naming note:** the existing `ModuleKey` union and `PanelColorPrefs.colors` refer to **core panels** (`nav`/`list`/`viewer`/`inspector`/`contacts`/`calendar`/`settings`), NOT substrate modules. This design adds a *parallel* color path for substrate module panels, keyed by the dockview panel id (the `componentKey`, e.g. `org.nexus.tasks:tasks.main`), leaving the core path untouched.

## 1. Decisions (locked during brainstorming)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Scope | **Full parity (color + user/workspace customization)** | Migrated panels (Contacts etc.) are recolorable today; module panels should match. |
| 2 | Color source | **Manifest-declared `color` on the surface + deterministic fallback** | A declared default gives intentional colors; the fallback guarantees no panel is ever colorless even if a module omits `color`. |
| 3 | Prefs storage | **Separate `moduleColors: Record<string, string>` map** (not widening `colors`) | Leaves the `ModuleKey` type + all existing readers untouched; the two key spaces never collide (core keys vs `":"`-containing module ids). |
| 4 | Resolution order | **workspace override → user override → manifest-declared → fallback(id)** | Mirrors core `resolvePanelColor`. |
| 5 | Customization UI | **A "Module panels" subsection in the existing `PanelColorsSettings`**, dynamic over registered surfaces | Reuses `SwatchPopover` + Reset; future modules appear automatically; the existing workspace-override toggle + body-tint already govern it (it rides in the same `PanelColorPrefs`). |
| 6 | Shipped-module colors | **Declare distinct `link-N`s for Tasks/Notes/Timekit** | Intentional out-of-the-box look instead of hash-random. |

## 2. Color source + pure resolution (`src/lib/panelColors.ts`)

Stored colors use the existing convention: a token ref `"link-N"` (N in 1..21, resolved by `toCssColor` to `var(--color-link-N)`) or a raw hex. Two new pure helpers:

```ts
/** Deterministic, stable per-id fallback color for a module dock surface that
 *  declares none. Maps the componentKey hash into the 21-color link palette. */
export function moduleSurfaceFallbackColor(componentKey: string): string {
  let h = 0;
  for (let i = 0; i < componentKey.length; i++) h = (h * 31 + componentKey.charCodeAt(i)) >>> 0;
  return `link-${(h % 21) + 1}`;
}

/** Effective CSS color for a module dock panel.
 *  Order: workspace override → user override → manifest-declared → fallback(id). */
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

## 3. Manifest + types

- **`src/modules/surfaces.ts`** — add `color?: string` to `SurfaceSpec` (a `"link-N"` ref or hex; the dock surface's declared default). Doc it as optional and parallel to `icon`.
- **`src/data/types.ts`** — extend `PanelColorPrefs`:

  ```ts
  export interface PanelColorPrefs {
    colors: Partial<Record<ModuleKey, string>>;   // core panels (unchanged)
    moduleColors?: Record<string, string>;         // module panels, keyed by componentKey
    bodyTintLevel: "L2" | "L3";
  }
  ```

- **`src/lib/appPreferences.ts`** — the default `panelColors` becomes `{ colors: {}, moduleColors: {}, bodyTintLevel: "L2" }`. `moduleColors` stays optional in the type so already-persisted prefs (lacking it) load fine; all reads coalesce with `?? {}` / optional chaining.

## 4. Registry lookup (`src/modules/surfaceRegistry.ts`)

Add a small helper so `applyModuleColor` can fetch a surface's declared color by panel id:

```ts
/** The declared color of a registered dock surface, or undefined. */
export function dockSurfaceColor(componentKey: string): string | undefined {
  return _dockSurfaces.get(componentKey)?.spec.color;
}
```

(`RegisteredDockSurface` already carries `spec`, which now includes `color`.)

## 5. `applyModuleColor` wiring (`src/components/Workspace.tsx`)

Replace the module-panel branch that currently clears the var (the `if (isModulePanelId(activeId)) { el.style.removeProperty(...); return; }` block) with resolution + set:

```ts
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

All existing `--module-color` CSS (tab-bar wash, active-tab underline, top divider, selected-row tint in `tokens.css`) then applies to module panels unchanged.

## 6. Settings UI (`src/components/settings/PanelColorsSettings.tsx`)

- Two new write helpers mirroring `setModuleColor`/`resetModule`:
  ```ts
  const setModulePanelColor = (key: string, color: string) =>
    writePrefs({ ...activePrefs, moduleColors: { ...activePrefs.moduleColors, [key]: color } });
  const resetModulePanelColor = (key: string) => {
    const { [key]: _, ...rest } = activePrefs.moduleColors ?? {};
    writePrefs({ ...activePrefs, moduleColors: rest });
  };
  ```
- `resetAll` also clears module colors: `writePrefs({ ...activePrefs, colors: {}, moduleColors: {} })`.
- A new **"Module panels"** subsection (below the core rows) maps over `listDockSurfaces()`. Each row: the surface's `spec.title` as the name, a generic icon (a lucide default — `spec.icon` is currently cosmetic/unused), a Reset control when `componentKey in (activePrefs.moduleColors ?? {})`, and a `SwatchPopover` whose `value` is `activePrefs.moduleColors?.[componentKey] ?? dockSurfaceColor(componentKey) ?? moduleSurfaceFallbackColor(componentKey)` and whose `onChange` calls `setModulePanelColor(componentKey, c)`. If no module surfaces are registered, the subsection is omitted.

## 7. Declared colors for shipped modules

Add `color` to each module's dock surface in its manifest, using `link-N`s not already taken by core defaults (core uses 16/4/21/18/2/7/8):
- `src/modules/tasks/index.ts` surface → `color: "link-11"`
- `src/modules/notes/index.ts` surface → `color: "link-13"`
- `src/modules/timekit/index.ts` surface → `color: "link-6"`

(Exact hues are easily adjusted; any module that omits `color` uses the hash fallback.)

## 8. Testing (per `docs/testing-policy.md`)

Mirror the existing `src/lib/__tests__/panelColors.test.ts` (pure-resolution Node tests — the established pattern; the CSS application of core panel color is not e2e'd):
- `moduleSurfaceFallbackColor`: deterministic (same id → same value), always in `link-1..link-21`, and distinct for distinct ids (spot-check a few).
- `resolveModulePanelColor`: returns the manifest-declared color when no overrides; user override beats declared; workspace override beats user; fallback used when nothing is declared/overridden; output is `toCssColor`-wrapped (`link-N` → `var(--color-link-N)`, hex passthrough).

The `applyModuleColor` flip and the settings subsection are UI-layer wiring verified live (consistent with how core panel color is covered).

## 9. Out of scope (→ later)

- Per-surface color when a module contributes multiple dock surfaces (current modules have one each; keyed by `componentKey` already handles it if it arises).
- Any change to the core-panel color path (`ModuleKey`, `colors`, `DEFAULT_MODULE_COLORS`).
- New theming channels beyond the existing `--module-color`.
- The other two panel-migration gaps (detachable module panels; global shortcut binding) — separate sub-projects.
