# Parameterized Module-Panel Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime parameters to module dock-panel launch (`openModulePanel(componentKey, title, params?)`), then refactor the Timekit module to use it and delete its `panelState.ts` workaround.

**Architecture:** Widen the single launch function in the Zustand workspace store to forward an optional `params` object into dockview — `addPanel({ params })` for a new panel, `updateParameters(params)` for an already-open one (module surfaces are singletons keyed by panel id). Panels read launch context from dockview's native `props.params`. Timekit's commands pass `{ section, nonce }`; the panel re-applies the requested section on every launch (the nonce makes each launch distinct, matching the old always-notify `panelState`).

**Tech Stack:** TypeScript, React 18, Zustand (`useWorkspace`), dockview 1.17.2 (`IDockviewPanelProps.params`, `AddPanelOptions.params`, `panel.api.updateParameters`), Playwright (e2e).

## Global Constraints

- **Backward compatible:** the new `params` arg is OPTIONAL; existing 2-arg callers (Tasks "Open Tasks", Notes "Open Notes") must remain unchanged and keep compiling.
- **Instance model = singleton + update:** one panel per surface (id === component key); re-opening reuses it and re-points it via `updateParameters`. No multi-instance, no param discriminator in the id.
- **No new host abstraction:** modules keep calling `useWorkspace.getState().openModulePanel(...)` directly (the established pattern). Do not add a `host.openPanel()`.
- **Param type at our boundary:** `Record<string, unknown>` (dockview's `Parameters` is `Record<string, any>`; the assignment is compatible — no cast needed).
- **Launch is an event, not state:** Timekit passes a monotonic `nonce` so re-firing a command for the *same* section after the user navigated away still snaps back. The panel's sync effect keys on `[params.nonce, params.section]` (both referenced → `exhaustive-deps` satisfied; lint is `--max-warnings 0`).
- **Testing policy** (`docs/testing-policy.md`): pure logic → Node (Vitest); critical UI flow → Playwright e2e; NO React Testing Library / jsdom. The `openModulePanel` store method and the panel's section sync are UI-layer (call the dockview api / React state) and are gated by the e2e, not unit tests.
- **Gates:** `pnpm test && pnpm typecheck && pnpm lint` per task; `pnpm e2e` in the final task.
- **Commits:** conventional commits, one per task. **No `Co-Authored-By` trailer** (attribution disabled globally). Do not merge or push.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/state/workspace.ts` | Widen `openModulePanel` signature + impl (forward params to dockview) | 1 |
| `docs/module-authoring.md` | Mark panel-migration gap #1 (parameterized launch) closed; update the launch reference | 1 |
| `src/modules/timekit/index.ts` | `openAt` passes `{ section, nonce }`; drop `panelState` import; import `TimekitSection` from the panel | 2 |
| `src/modules/timekit/TimekitPanel.tsx` | Own the `TimekitSection` type; read `props.params`; nonce-keyed section sync | 2 |
| `src/modules/timekit/panelState.ts` | **Deleted** | 2 |
| `e2e/timekit.spec.ts` | New spec: command → correct section (params) + nonce snap-back | 3 |

---

### Task 1: Widen `openModulePanel` to forward params

**Files:**
- Modify: `src/state/workspace.ts` (interface ~line 209; impl ~line 849)
- Modify: `docs/module-authoring.md` (the launch reference ~line 66; gap list ~line 90-96)

**Interfaces:**
- Produces: `openModulePanel(componentKey: string, title: string, params?: Record<string, unknown>): void` — when the panel is already open, re-activates it and calls `existing.api.updateParameters(params)`; otherwise `addPanel({ ..., params })`.

- [ ] **Step 1: Update the interface signature.** In `src/state/workspace.ts`, replace the `openModulePanel` line in the `WorkspaceState` interface (~line 209):

```ts
  openModulePanel: (componentKey: string, title: string, params?: Record<string, unknown>) => void;
```

- [ ] **Step 2: Update the implementation.** Replace the existing `openModulePanel` implementation (~line 849-864) with:

```ts
  openModulePanel: (componentKey, title, params) => {
    const api = getDockviewApi();
    if (!api) return;
    const existing = api.panels.find((p) => p.id === componentKey);
    if (existing) {
      existing.api.setActive();
      // Singleton surface: re-point the already-open panel at the new launch context.
      if (params) existing.api.updateParameters(params);
    } else {
      api.addPanel({
        id: componentKey,
        component: componentKey,
        title,
        params,
        minimumWidth: 360, // generic default floor for module surfaces
        position: { direction: "right" },
      });
    }
  },
```

- [ ] **Step 3: Verify it typechecks (existing 2-arg callers must still compile).**

Run: `pnpm typecheck`
Expected: PASS — no errors. (Tasks/Notes call `openModulePanel(KEY, "…")` with 2 args; the optional 3rd arg keeps them valid.)

- [ ] **Step 4: Update `docs/module-authoring.md`.** Two edits.

First, the launch reference (~line 66) — replace:

```md
- A **dock surface** is a React component (`(props: IDockviewPanelProps) => …`) bound via `host.contribute.surface(id, Component)`; `Workspace.tsx` merges it into dockview. Launch it with `openModulePanel(componentKey, title)`.
```

with:

```md
- A **dock surface** is a React component (`(props: IDockviewPanelProps) => …`) bound via `host.contribute.surface(id, Component)`; `Workspace.tsx` merges it into dockview. Launch it with `openModulePanel(componentKey, title, params?)`; the panel receives `params` via dockview's `props.params` (a singleton surface is re-pointed via `updateParameters` when already open).
```

Second, the gap list under "Out of scope until platformization" — replace the four-item block (~line 92-96) with:

```md
A Contacts-migration spike found existing panels (email/calendar/contacts) need substrate capabilities the dock point didn't originally cover, before they can become modules without regressions. **One of the original four is now closed:**
1. ✅ **Parameterized launch (DONE)** — `openModulePanel(key, title, params?)` passes runtime params; panels read `props.params` (e.g. "open Contacts on this contact"). The first consumer is the Timekit module's section-focus commands.
2. **Detachable module panels** — currently blocked (`isModulePanelId` guard); existing panels are pop-out-able.
3. **Module panel color customization** — `applyModuleColor` skips namespaced ids.
4. **Command/shortcut contribution** — command half DONE; global keyboard-shortcut binding for modules still deferred.
```

- [ ] **Step 5: Verify lint + typecheck.**

Run: `pnpm typecheck && pnpm lint`
Expected: both PASS (lint zero-warnings).

- [ ] **Step 6: Commit.**

```bash
git add src/state/workspace.ts docs/module-authoring.md
git commit -m "feat(substrate): parameterized openModulePanel (params via dockview); close migration gap #1"
```

---

### Task 2: Refactor Timekit to params; delete `panelState.ts`

**Files:**
- Modify: `src/modules/timekit/TimekitPanel.tsx`
- Modify: `src/modules/timekit/index.ts`
- Delete: `src/modules/timekit/panelState.ts`

**Interfaces:**
- Consumes: `openModulePanel(componentKey, title, params?)` from Task 1.
- Produces: `TimekitSection` is now exported from `@/modules/timekit/TimekitPanel`. The panel reads `props.params` as `{ section?: TimekitSection; nonce?: number }`.

- [ ] **Step 1: Move the type into the panel + consume `props.params`.** Replace the top of `src/modules/timekit/TimekitPanel.tsx` (the imports through the `useEffect`, lines 1-22) with:

```tsx
import { useEffect, useState } from "react";
import type { IDockviewPanelProps } from "dockview";
import { cn } from "@/lib/utils";
import { ClockSection } from "@/modules/timekit/ClockSection";
import { TrackerSection } from "@/modules/timekit/TrackerSection";
import { TimersSection } from "@/modules/timekit/TimersSection";
import { AlarmsSection } from "@/modules/timekit/AlarmsSection";

/** Which section the Timekit panel shows. Owned here now that panelState is gone. */
export type TimekitSection = "clock" | "tracker" | "timers" | "alarms";

const SECTIONS: { id: TimekitSection; label: string }[] = [
  { id: "clock", label: "Clock" },
  { id: "tracker", label: "Tracker" },
  { id: "timers", label: "Timers" },
  { id: "alarms", label: "Alarms" },
];

/** Timekit dock panel: a tabbed Clock · Tracker · Timers · Alarms. */
export function TimekitPanel(props: IDockviewPanelProps) {
  const params = (props.params ?? {}) as { section?: TimekitSection; nonce?: number };
  const [section, setSection] = useState<TimekitSection>(params.section ?? "clock");

  // Re-focus on every command launch (nonce changes each fire) and on a section
  // change; manual tab clicks set local state and are not overridden. Both deps are
  // referenced in the body, so exhaustive-deps stays satisfied.
  useEffect(() => {
    if (params.section) setSection(params.section);
  }, [params.nonce, params.section]);
```

> The rest of `TimekitPanel.tsx` (the `return (...)` JSX from line 24 down) is unchanged — `SECTIONS` and `section`/`setSection` keep the same names.

- [ ] **Step 2: Update `index.ts` — nonce-bearing `openAt`, swap the type import.** In `src/modules/timekit/index.ts`:

Replace the panel import (line 3) and remove the panelState import (line 7). The new imports:

```ts
import { TimekitPanel, type TimekitSection } from "@/modules/timekit/TimekitPanel";
```

(Delete the line `import { requestSection, type TimekitSection } from "@/modules/timekit/panelState";`.)

Replace the `openAt` function (lines 42-45) with:

```ts
let _launchNonce = 0; // module-local; makes each command launch distinct (event, not state)
function openAt(section: TimekitSection): void {
  _launchNonce += 1;
  useWorkspace.getState().openModulePanel(TIMEKIT_MAIN_PANEL_KEY, "Clock", { section, nonce: _launchNonce });
}
```

- [ ] **Step 3: Delete the workaround.**

```bash
git rm src/modules/timekit/panelState.ts
```

- [ ] **Step 4: Verify the unit suite + typecheck + lint.** (No unit test imported `panelState`; the registration test is unaffected.)

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS — same test count as before this task (the deleted file had no tests). If `src/storage/__tests__/benchmark.test.ts` is the ONLY failure, re-run `pnpm test -- benchmark` to confirm (it is timing-flaky).

- [ ] **Step 5: Commit.**

```bash
git add src/modules/timekit/TimekitPanel.tsx src/modules/timekit/index.ts
git commit -m "refactor(timekit): launch sections via openModulePanel params; delete panelState workaround"
```

---

### Task 3: e2e — params-driven focus + nonce snap-back

**Files:**
- Modify: `e2e/timekit.spec.ts`

**Interfaces:**
- Consumes: the running web app (web mode on :1420 via `playwright.config.ts`); the command palette; the Task 2 behavior.

- [ ] **Step 1: Add the e2e spec.** Append to `e2e/timekit.spec.ts`:

```ts
test("commands open the panel on their section via params, and re-focus after navigating away", async ({ page }) => {
  const palette = () => page.getByRole("button", { name: "Command palette" });
  const search = () => page.getByPlaceholder("Search mail, contacts, or type a command…");

  // "New timer" opens the panel already on the Timers section (the seconds input
  // only exists in the Timers section) — no manual tab click.
  await palette().click();
  await search().fill("New timer");
  await search().press("Enter");
  await expect(page.getByLabel("Timer seconds")).toBeVisible();

  // Navigate away to Clock, then re-fire "New timer" → snaps back to Timers.
  // A value-only effect would miss this; the launch nonce makes it work.
  await page.getByRole("button", { name: "Clock", exact: true }).click();
  await expect(page.getByLabel("Timer seconds")).toBeHidden();
  await palette().click();
  await search().fill("New timer");
  await search().press("Enter");
  await expect(page.getByLabel("Timer seconds")).toBeVisible();

  // "New alarm" lands on the Alarms section (the time input is Alarms-only).
  await palette().click();
  await search().fill("New alarm");
  await search().press("Enter");
  await expect(page.getByLabel("Alarm time")).toBeVisible();
});
```

> Selector basis (already in the shipped components): the Timers section's seconds field has `aria-label="Timer seconds"`; the Alarms section's time field has `aria-label="Alarm time"`; the section switcher renders a `Clock` `<button>`. If a selector is ambiguous against the real DOM, scope it to the panel or use `.first()` — keep assertions behavior-based; do NOT change source components to fit the test (report a real bug instead).

- [ ] **Step 2: Run the new e2e.**

Run: `pnpm e2e -- timekit`
Expected: all timekit specs PASS (the 2 existing + this new one), chromium + webkit. If browsers are missing, run `npx playwright install` first.

- [ ] **Step 3: Run the full final gate.**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm e2e`
Expected: all PASS. (`benchmark.test.ts` flake caveat: if it's the only unit failure, re-run `pnpm test -- benchmark` in isolation.)

- [ ] **Step 4: Commit.**

```bash
git add e2e/timekit.spec.ts
git commit -m "test(e2e): timekit command section-focus via launch params + nonce snap-back"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-22-parameterized-panel-launch-design.md`):
- §3 API change (signature + singleton/update impl) → Task 1.
- §4 panel-side `props.params` consumption → Task 2 Step 1.
- §5 Timekit refactor: nonce `openAt`, `props.params` + `[nonce, section]` effect, move `TimekitSection`, delete `panelState.ts` → Task 2. All four behavior-parity flows are produced by the nonce + section deps + local-state pattern.
- §6 testing: e2e for initial-focus + nonce snap-back → Task 3 (both assertions present).
- §7 docs: `module-authoring.md` gap #1 closed + launch reference → Task 1 Step 4.
- §1 decisions (singleton, widen-only, native params, persistence-default, `Record<string,unknown>`, proof+cleanup) → Global Constraints + Tasks 1-2.
- §8 out-of-scope (other gaps, multi-instance, host abstraction, real panel migration, typed schemas) → not built.

**Placeholder scan:** none — every step carries the real code/command. No "TBD"/"similar to".

**Type consistency:** `openModulePanel(componentKey, title, params?: Record<string, unknown>)` is identical in the interface (Task 1 Step 1), impl (Step 2), and Timekit's call (Task 2 Step 2). `TimekitSection` is defined+exported in `TimekitPanel.tsx` (Task 2 Step 1) and imported from there in `index.ts` (Step 2). The panel reads `params` as `{ section?: TimekitSection; nonce?: number }`, exactly the shape `openAt` emits (`{ section, nonce: _launchNonce }`).
