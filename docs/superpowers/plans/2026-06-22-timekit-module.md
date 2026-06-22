# org.nexus.timekit Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `org.nexus.timekit` — a Clock, Time-tracker, Countdown Timers, and Alarms — as one core module on the Nexus substrate, staged so each sub-feature is independently green.

**Architecture:** Mirrors the reference modules `src/modules/tasks/` and `src/modules/notes/`. Three event-sourced entities (`TimeEntry`, `CountdownTimer`, `Alarm`) projected into `LocalStore` Maps plus a `timekitZones: string[]` config list. Every state change flows through `recordMutation`/`recordMutations` under the `org.nexus.timekit/` namespace; one `timekitReducer` and one `timekitInverse` cover the whole namespace. Running elapsed/remaining are computed **live in the UI** from timestamps — never a mutation per second. A single main-window 1s tick worker fires due timers/alarms (in-app `sonner` toast + Web-Audio chime) by emitting `COMPLETE_TIMER`/`FIRE_ALARM` tagged `source:"module"` — the first real consumer of that provenance source. One dock panel with four tabbed sections (Clock · Tracker · Timers · Alarms) and four commands.

**Tech Stack:** TypeScript, React 18, Zustand (`useWorkspace`), the substrate module API (`registerModule`/`host.contribute.*`/`recordMutation`/`linksGraph`), `sonner` toasts, Web-Audio `AudioContext`, Vitest (Node env) for pure logic, Playwright for one e2e flow.

## Global Constraints

- **Pure-frontend module — touches no Rust.** Firing is in-app toast/chime; there is no Tauri command.
- **Single write path.** Every state change goes through `recordMutation`/`recordMutations` (`@/state/mutations`). Never write the store/DB directly. Expose small mutation-helper functions to the UI (the rules/templates `*Mutation` shape), not raw `recordMutation` calls.
- **Namespace:** all mutation kinds and entity types are prefixed `org.nexus.timekit/`. `registerModule` rejects un-namespaced kinds/entities.
- **One reducer + one inverse per namespace.** `host.registerReducer(timekitReducer)` and `host.registerInverse(timekitInverse)` are each called once; both grow a `switch` as stages add kinds.
- **Reducers must be pure / replay-deterministic.** Never call `Date.now()` in `reducer.ts` or in `timekitInverse`. Stamp all timestamps at record-time inside the mutation helpers (`mutations.ts`) and pass them in the payload; restore prior values in the inverse.
- **Module state is event-sourced.** Add projection Maps to `LocalStore`; `replayRegisteredModules` rebuilds them. Do **not** add timekit data to `LocalStore.toSnapshot()`.
- **Auto-fire provenance:** `COMPLETE_TIMER` and `FIRE_ALARM`, when emitted by the tick worker, pass the trailing `opts` `{ source: "module" }` to `recordMutation`. User-initiated mutations stay default (`"user"`, stored bare). `MutationSource` already includes `"module"` (`src/data/types.ts:605`).
- **Tick worker is main-window-only AND must run in web mode.** Wire `startTimekitTicker(localStore)` in `src/main.tsx` in **both** `initWeb()` and `initTauri()`'s `if (isMain)` background block. (`initWeb` has no `isMain` concept — web mode is inherently single-window — so the Tauri-only block does not cover it; without the `initWeb` call, countdowns never fire under `pnpm dev` or Playwright.)
- **Testing policy** (`docs/testing-policy.md`): pure logic → Node (Vitest, default `node` env); critical UI flow → ONE Playwright e2e under `e2e/`. **No React Testing Library / jsdom.** Extract UI logic into pure functions and Node-test those.
- **Verification gates** for every stage: `pnpm test && pnpm typecheck && pnpm lint` (lint is `--max-warnings 0` — avoid `any`) and, for the final stage, `pnpm e2e`.
- **Commits:** conventional commits, one per task. **No `Co-Authored-By` trailer** (attribution is disabled globally). Do not merge or push.
- **Known, accepted v1 wrinkle:** auto-fire goes through `recordMutation`, which clears the redo stack; an auto-fire while the user has a pending redo wipes that redo. Accepted for v1 (auto-fire is deliberately undoable). Do not special-case it.

## File Structure

| File | Responsibility | Introduced |
|---|---|---|
| `src/data/types.ts` | Add `TimeEntry`, `CountdownTimer`, `CountdownState`, `Alarm` interfaces | Stages 2/3/4 |
| `src/storage/local.ts` | Add `timekitZones` + `timeEntries`/`countdownTimers`/`alarms` Maps; `put*`/`delete*`/`setTimekitZones` helpers; clear them in `hydrate()` | Stages 1–4 |
| `src/modules/timekit/index.ts` | Manifest + `registerTimekitModule` (reducer + inverse + dock surface + commands) | Stage 1, grows |
| `src/modules/timekit/mutations.ts` | `TIMEKIT_NS`, `KIND`, entity-id consts, mutation helpers, `timekitInverse` | Stage 1, grows |
| `src/modules/timekit/reducer.ts` | `timekitReducer.apply` → `LocalStore` projections | Stage 1, grows |
| `src/modules/timekit/model.ts` | `makeTimeEntry`/`makeTimer`/`makeAlarm` factories | Stage 2, grows |
| `src/modules/timekit/time.ts` | Pure helpers: `formatClock`, `entryElapsedMs`, `formatDuration`, `timerEndsAt`, `timerRemainingMs` | Stage 1, grows |
| `src/modules/timekit/ticker.ts` | Pure `dueTimers`/`dueAlarms` + thin `startTimekitTicker` (toast + chime) | Stage 3, grows |
| `src/modules/timekit/links.ts` | `entryTrackedTask` resolver (`tracks` link → Task) | Stage 2 |
| `src/modules/timekit/hooks.ts` | `useTimekitZones`/`useTimeEntries`/`useCountdownTimers`/`useAlarms` | Stage 1, grows |
| `src/modules/timekit/panelState.ts` | Ephemeral "which section to focus" signal (works around the no-param `openModulePanel` substrate gap) | Stage 2 |
| `src/modules/timekit/TimekitPanel.tsx` | Dock panel shell + section switcher | Stage 1, grows |
| `src/modules/timekit/ClockSection.tsx` | Live local time + saved-zone list | Stage 1 |
| `src/modules/timekit/TrackerSection.tsx` | Start/stop tracking + entry list | Stage 2 |
| `src/modules/timekit/TimersSection.tsx` | Create/control countdown timers | Stage 3 |
| `src/modules/timekit/AlarmsSection.tsx` | Create/toggle alarms | Stage 4 |
| `src/modules/timekit/__tests__/*.test.ts` | Node tests (registration, data layer, time helpers, ticker, links) | Stages 1–4 |
| `src/modules/bootstrap.ts` | Register the module at startup | Stage 1 |
| `src/modules/__tests__/bootstrap.test.ts` | Bump dock-surface count 2 → 3 | Stage 1 |
| `src/main.tsx` | Start the tick worker (both `initWeb` + `initTauri` isMain) | Stage 3 |
| `e2e/fixtures.ts` | Add `openTimekitPanel` helper | Stage 4 |
| `e2e/timekit.spec.ts` | Tracker + countdown-auto-complete e2e | Stage 4 |

> **UI class names:** the section/panel components use the same Tailwind utility tokens as `src/modules/tasks/TasksPanel.tsx` (`text-h3`, `text-text-primary`, `text-text-secondary`, `border-border-subtle`, `bg-surface-1`, `bg-surface-2`, `text-small`, `text-body`, `rounded-md`, `tabular-nums`) and `docs/UI-DESIGN-SYSTEM-SPEC.md`. Class names don't affect the build or Node tests; the e2e asserts behavior, not styling.

---

## Stage 1 — Clock

Smallest slice: prove the panel + module + a config mutation. Adds `timekitZones` to the store, the `SET_TIMEKIT_ZONES` mutation + reducer + inverse, the `formatClock` helper, the panel shell with the Clock section, module registration, and the "Open Clock" command.

### Task 1.1: Store — `timekitZones` projection

**Files:**
- Modify: `src/storage/local.ts`

**Interfaces:**
- Produces: `LocalStore.timekitZones: string[]` (default `[]`); `LocalStore.setTimekitZones(zones: string[]): void` (calls `_notify()`).

- [ ] **Step 1: Add the field.** In `src/storage/local.ts`, after the `notes = new Map<string, Note>();` line (~line 99), add:

```ts
  /** Saved IANA timezone strings for the Clock section (timekit module config). */
  timekitZones: string[] = [];
```

- [ ] **Step 2: Reset it in `hydrate()`.** In the clear block inside `hydrate()`, after `this.notes.clear();` (~line 176), add:

```ts
    this.timekitZones = [];
```

- [ ] **Step 3: Add the setter.** After the `deleteNote(id)` method (~line 440, end of the Note CRUD block), add:

```ts
  // ── Timekit projections (event-sourced; not in toSnapshot) ──────

  setTimekitZones(zones: string[]): void {
    this.timekitZones = zones;
    this._notify();
  }
```

- [ ] **Step 4: Verify it compiles.**

Run: `pnpm typecheck`
Expected: PASS (no new errors).

- [ ] **Step 5: Commit.**

```bash
git add src/storage/local.ts
git commit -m "feat(timekit): add timekitZones projection to LocalStore"
```

### Task 1.2: Mutations — `SET_TIMEKIT_ZONES` + inverse

**Files:**
- Create: `src/modules/timekit/mutations.ts`
- Test: `src/modules/timekit/__tests__/dataLayer.test.ts`

**Interfaces:**
- Consumes: `recordMutation`, `ModuleInverseBuilder` from `@/state/mutations`; `LocalStore`.
- Produces: `TIMEKIT_NS = "org.nexus.timekit"`; `KIND.SET_ZONES`; `setTimekitZonesMutation(zones, store)`; `timekitInverse`.

- [ ] **Step 1: Write the failing test.** Create `src/modules/timekit/__tests__/dataLayer.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import {
  undoLastMutation,
  _resetModuleInverses,
  _resetUndoStacks,
  registerModuleInverse,
} from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { timekitReducer } from "@/modules/timekit/reducer";
import { timekitInverse, TIMEKIT_NS, setTimekitZonesMutation } from "@/modules/timekit/mutations";

function wire(): LocalStore {
  const s = new LocalStore();
  registerModuleReducer(TIMEKIT_NS, timekitReducer);
  registerModuleInverse(TIMEKIT_NS, timekitInverse);
  return s;
}

beforeEach(() => { _resetModuleReducers(); _resetModuleInverses(); _resetUndoStacks(); });

describe("timekit clock zones", () => {
  it("SET_TIMEKIT_ZONES replaces the list", () => {
    const s = wire();
    setTimekitZonesMutation(["UTC", "America/New_York"], s);
    expect(s.timekitZones).toEqual(["UTC", "America/New_York"]);
    setTimekitZonesMutation(["Europe/London"], s);
    expect(s.timekitZones).toEqual(["Europe/London"]);
  });

  it("undo restores the prior zone list", () => {
    const s = wire();
    setTimekitZonesMutation(["UTC"], s);
    setTimekitZonesMutation(["UTC", "Asia/Tokyo"], s);
    undoLastMutation(s);
    expect(s.timekitZones).toEqual(["UTC"]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm test -- timekit`
Expected: FAIL — cannot resolve `@/modules/timekit/reducer` / `@/modules/timekit/mutations`.

- [ ] **Step 3: Create `src/modules/timekit/mutations.ts`:**

```ts
import type { LocalStore } from "@/storage/local";
import { recordMutation, type ModuleInverseBuilder } from "@/state/mutations";

export const TIMEKIT_NS = "org.nexus.timekit";

export const KIND = {
  SET_ZONES: `${TIMEKIT_NS}/SET_TIMEKIT_ZONES`,
} as const;

/** Replace the saved Clock timezone list. */
export function setTimekitZonesMutation(zones: string[], store: LocalStore): void {
  recordMutation(KIND.SET_ZONES, { zones }, store);
}

/**
 * Inverse builder for the whole timekit namespace. Captures prior state BEFORE
 * the mutation applies (substrate §4.3). Grows a case per kind across stages.
 */
export const timekitInverse: ModuleInverseBuilder = (kind, _payload, store) => {
  const s = store as LocalStore;
  switch (kind) {
    case KIND.SET_ZONES: {
      return {
        reverseSteps: [{ kind: KIND.SET_ZONES, payload: { zones: [...s.timekitZones] } }],
        description: "Set clock zones",
      };
    }
  }
  return null;
};
```

- [ ] **Step 4: Create the reducer** `src/modules/timekit/reducer.ts` (needed for the test to run; full body in Task 1.3 has nothing more for Stage 1):

```ts
import type { ModuleReducer } from "@/state/moduleReducers";
import type { LocalStore } from "@/storage/local";

/** Applies all org.nexus.timekit mutations to the in-memory projections. */
export const timekitReducer: ModuleReducer = {
  apply(kind, payload, store) {
    const s = store as LocalStore;
    switch (kind) {
      case "org.nexus.timekit/SET_TIMEKIT_ZONES": {
        const p = payload as { zones: string[] };
        s.setTimekitZones(p.zones);
        break;
      }
    }
  },
};
```

- [ ] **Step 5: Run the test to confirm it passes.**

Run: `pnpm test -- timekit`
Expected: PASS (2 passing).

- [ ] **Step 6: Commit.**

```bash
git add src/modules/timekit/mutations.ts src/modules/timekit/reducer.ts src/modules/timekit/__tests__/dataLayer.test.ts
git commit -m "feat(timekit): SET_TIMEKIT_ZONES mutation, reducer, inverse"
```

### Task 1.3: Pure helper — `formatClock`

**Files:**
- Create: `src/modules/timekit/time.ts`
- Test: `src/modules/timekit/__tests__/time.test.ts`

**Interfaces:**
- Produces: `formatClock(now: number, zone?: string): string`.

- [ ] **Step 1: Write the failing test.** Create `src/modules/timekit/__tests__/time.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatClock } from "@/modules/timekit/time";

describe("formatClock", () => {
  it("formats an epoch in a given IANA zone (UTC)", () => {
    // 1970-01-01T00:00:30Z
    expect(formatClock(30_000, "UTC")).toBe("12:00:30 AM");
  });

  it("returns a non-empty string for local time without a zone", () => {
    expect(formatClock(0).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm test -- time`
Expected: FAIL — cannot resolve `@/modules/timekit/time`.

- [ ] **Step 3: Create `src/modules/timekit/time.ts`:**

```ts
/**
 * Format an epoch (ms) as a wall clock. With `zone`, renders that IANA zone's
 * local time; without, the host's local time. Pure (caller injects `now`).
 */
export function formatClock(now: number, zone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...(zone ? { timeZone: zone } : {}),
  }).format(now);
}
```

- [ ] **Step 4: Run the test to confirm it passes.**

Run: `pnpm test -- time`
Expected: PASS.

> Note: the `"12:00:30 AM"` expectation assumes the `en-US` locale pinned in the formatter. Keep the locale literal so the test is deterministic across machines.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/timekit/time.ts src/modules/timekit/__tests__/time.test.ts
git commit -m "feat(timekit): formatClock pure helper"
```

### Task 1.4: Hook — `useTimekitZones`

**Files:**
- Create: `src/modules/timekit/hooks.ts`

**Interfaces:**
- Consumes: `localStore`, `useStoreVersion`.
- Produces: `useTimekitZones(): string[]`.

- [ ] **Step 1: Create `src/modules/timekit/hooks.ts`:**

```ts
import { useMemo } from "react";
import { localStore } from "@/storage/local";
import { useStoreVersion } from "@/storage/useStore";

/** The saved Clock timezone list (reactive). */
export function useTimekitZones(): string[] {
  const v = useStoreVersion();
  return useMemo(() => localStore.timekitZones, [v]);
}
```

- [ ] **Step 2: Verify it compiles.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add src/modules/timekit/hooks.ts
git commit -m "feat(timekit): useTimekitZones hook"
```

### Task 1.5: Clock section + panel shell

**Files:**
- Create: `src/modules/timekit/ClockSection.tsx`
- Create: `src/modules/timekit/TimekitPanel.tsx`

**Interfaces:**
- Consumes: `useTimekitZones`, `setTimekitZonesMutation`, `formatClock`, `localStore`, `IDockviewPanelProps`.
- Produces: `ClockSection` component; `TimekitPanel` component (default dock surface).

- [ ] **Step 1: Create `src/modules/timekit/ClockSection.tsx`:**

```tsx
import { useEffect, useState } from "react";
import { localStore } from "@/storage/local";
import { useTimekitZones } from "@/modules/timekit/hooks";
import { setTimekitZonesMutation } from "@/modules/timekit/mutations";
import { formatClock } from "@/modules/timekit/time";

/** Live local time plus a user-managed list of IANA timezones. */
export function ClockSection() {
  const zones = useTimekitZones();
  const [now, setNow] = useState(() => Date.now());
  const [zoneInput, setZoneInput] = useState("");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  function addZone() {
    const z = zoneInput.trim();
    if (!z) return;
    try {
      // Throws RangeError on an invalid IANA zone — reject silently.
      new Intl.DateTimeFormat("en-US", { timeZone: z });
    } catch {
      return;
    }
    if (!zones.includes(z)) setTimekitZonesMutation([...zones, z], localStore);
    setZoneInput("");
  }

  function removeZone(z: string) {
    setTimekitZonesMutation(zones.filter((x) => x !== z), localStore);
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="text-small text-text-secondary">Local time</div>
        <div className="text-h2 font-semibold tabular-nums text-text-primary">{formatClock(now)}</div>
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border-subtle bg-surface-1 px-2 py-1 text-body text-text-primary"
          placeholder="Add time zone (e.g. America/New_York)"
          aria-label="Add time zone"
          value={zoneInput}
          onChange={(e) => setZoneInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addZone(); }}
        />
        <button type="button" onClick={addZone} className="rounded-md bg-surface-2 px-3 py-1 text-small text-text-primary">
          Add
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {zones.map((z) => (
          <li key={z} className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
            <div>
              <div className="text-body text-text-primary">{z}</div>
              <div className="text-small tabular-nums text-text-secondary">{formatClock(now, z)}</div>
            </div>
            <button
              type="button"
              onClick={() => removeZone(z)}
              aria-label={`Remove ${z}`}
              className="text-small text-text-secondary hover:text-text-primary"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/modules/timekit/TimekitPanel.tsx`** (Stage 1: Clock only; the section switcher is added in Stage 2):

```tsx
import type { IDockviewPanelProps } from "dockview";
import { ClockSection } from "@/modules/timekit/ClockSection";

/** Timekit dock panel. Contributed by the org.nexus.timekit module. */
export function TimekitPanel(_: IDockviewPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <h2 className="text-h3 font-semibold text-text-primary">Clock</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <ClockSection />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/modules/timekit/ClockSection.tsx src/modules/timekit/TimekitPanel.tsx
git commit -m "feat(timekit): Clock section + panel shell"
```

### Task 1.6: Module registration + bootstrap

**Files:**
- Create: `src/modules/timekit/index.ts`
- Modify: `src/modules/bootstrap.ts`
- Modify: `src/modules/__tests__/bootstrap.test.ts`
- Test: `src/modules/timekit/__tests__/registration.test.ts`

**Interfaces:**
- Consumes: `registerModule`, `dockComponentKey`, `TimekitPanel`, `timekitReducer`, `timekitInverse`, `KIND`, `useWorkspace`.
- Produces: `TIMEKIT_MODULE_ID`, `TIMEKIT_MAIN_SURFACE_ID`, `TIMEKIT_MAIN_PANEL_KEY`, `registerTimekitModule()`.

- [ ] **Step 1: Write the failing registration test.** Create `src/modules/timekit/__tests__/registration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { registerTimekitModule, TIMEKIT_MODULE_ID } from "@/modules/timekit";
import { getModule, _resetModules } from "@/modules/registry";
import { getModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { _resetDockSurfaces } from "@/modules/surfaceRegistry";
import { _resetModuleInverses } from "@/state/mutations";
import { listModuleCommands, _resetModuleCommands } from "@/modules/commands";

beforeEach(() => {
  _resetModules(); _resetModuleReducers(); _resetDockSurfaces();
  _resetModuleInverses(); _resetModuleCommands();
});

describe("Timekit module registration", () => {
  it("registers its namespace reducer and SET_TIMEKIT_ZONES kind", () => {
    registerTimekitModule();
    const m = getModule(TIMEKIT_MODULE_ID);
    expect(m?.mutationKinds).toContain("org.nexus.timekit/SET_TIMEKIT_ZONES");
    expect(getModuleReducer(TIMEKIT_MODULE_ID)).toBeDefined();
  });

  it("contributes an 'Open Clock' command", () => {
    registerTimekitModule();
    const cmd = listModuleCommands().find((c) => c.key === "org.nexus.timekit:open");
    expect(cmd?.spec.title).toBe("Open Clock");
    expect(typeof cmd?.run).toBe("function");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm test -- registration`
Expected: FAIL — cannot resolve `@/modules/timekit`.

- [ ] **Step 3: Create `src/modules/timekit/index.ts`:**

```ts
import { registerModule, type ModuleManifest } from "@/modules/registry";
import { dockComponentKey } from "@/modules/surfaceRegistry";
import { TimekitPanel } from "@/modules/timekit/TimekitPanel";
import { timekitReducer } from "@/modules/timekit/reducer";
import { timekitInverse, KIND } from "@/modules/timekit/mutations";
import { useWorkspace } from "@/state/workspace";

export const TIMEKIT_MODULE_ID = "org.nexus.timekit";
export const TIMEKIT_MAIN_SURFACE_ID = "timekit.main";

/** The dockview component key / panel id for the Timekit main dock surface. */
export const TIMEKIT_MAIN_PANEL_KEY = dockComponentKey(TIMEKIT_MODULE_ID, TIMEKIT_MAIN_SURFACE_ID);

const manifest: ModuleManifest = {
  id: TIMEKIT_MODULE_ID,
  name: "Clock",
  version: "0.1.0",
  namespace: TIMEKIT_MODULE_ID,
  entities: [],
  mutationKinds: [KIND.SET_ZONES],
  capabilities: { "ui.contribute": ["dock", "command"] },
  trust: "core",
  contributes: {
    surfaces: [
      { type: "dock", id: TIMEKIT_MAIN_SURFACE_ID, title: "Clock", icon: "clock", detachable: false },
    ],
    commands: [{ id: "open", title: "Open Clock", icon: "clock" }],
  },
};

/** Register the Timekit module. Wires reducer, inverse, dock surface, and commands. */
export function registerTimekitModule(): () => void {
  return registerModule(manifest, (host) => {
    host.registerReducer(timekitReducer);
    host.registerInverse(timekitInverse);
    host.contribute.surface(TIMEKIT_MAIN_SURFACE_ID, TimekitPanel);
    host.contribute.command("open", () => {
      useWorkspace.getState().openModulePanel(TIMEKIT_MAIN_PANEL_KEY, "Clock");
    });
  });
}
```

- [ ] **Step 4: Register in bootstrap.** In `src/modules/bootstrap.ts`, add the import after the AI import and the call after `registerAiModule();`:

```ts
import { registerTimekitModule } from "@/modules/timekit";
```

```ts
  registerTimekitModule();
```

- [ ] **Step 5: Update the dock-surface count assertion.** In `src/modules/__tests__/bootstrap.test.ts`, change the idempotency assertion (currently expecting 2) to 3, and update the comment:

```ts
    // Tasks + Notes + Timekit each contribute one dock surface.
    expect(Object.keys(dockSurfaceComponents())).toHaveLength(3);
```

- [ ] **Step 6: Run the tests to confirm they pass.**

Run: `pnpm test -- "registration|bootstrap"`
Expected: PASS (registration + bootstrap suites green).

- [ ] **Step 7: Run the full Stage-1 gate.**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS (`benchmark.test.ts` may flake under load — if it's the only failure, re-run `pnpm test -- benchmark`).

- [ ] **Step 8: Commit.**

```bash
git add src/modules/timekit/index.ts src/modules/bootstrap.ts src/modules/__tests__/bootstrap.test.ts src/modules/timekit/__tests__/registration.test.ts
git commit -m "feat(timekit): register module + Open Clock command"
```

**Stage 1 done when:** the Clock panel opens via the command palette ("Open Clock"), shows live local time, and zones can be added/removed (persisting through the mutation log + undo). Gate green.

---

## Stage 2 — Time-tracker

Adds the `TimeEntry` entity, start/stop/note/delete mutations, the atomic `tracks`-link-to-Task path, the Tracker section, the section switcher + `panelState`, and the `start-tracking` command.

### Task 2.1: `TimeEntry` type + factory

**Files:**
- Modify: `src/data/types.ts`
- Create: `src/modules/timekit/model.ts`

**Interfaces:**
- Produces: `TimeEntry` interface; `makeTimeEntry(input: Partial<TimeEntry>, vaultId: string, now: number): TimeEntry`.

- [ ] **Step 1: Add the type.** In `src/data/types.ts`, add near the other entity interfaces (e.g. after `Note`):

```ts
export interface TimeEntry {
  id: string;
  vaultId: string;
  startedAt: number;          // epoch ms
  stoppedAt: number | null;   // null = running
  note: string | null;
  createdAt: number;
}
```

- [ ] **Step 2: Create `src/modules/timekit/model.ts`:**

```ts
import type { TimeEntry } from "@/data/types";

// Monotonic within this module instance; combined with Date.now() for unique ids.
let _seq = 0;
function tkId(prefix: string): string {
  _seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

/** Build a full TimeEntry from partial input, filling defaults. */
export function makeTimeEntry(input: Partial<TimeEntry>, vaultId: string, now: number): TimeEntry {
  return {
    id: input.id ?? tkId("te"),
    vaultId,
    startedAt: input.startedAt ?? now,
    stoppedAt: input.stoppedAt ?? null,
    note: input.note ?? null,
    createdAt: input.createdAt ?? now,
  };
}
```

- [ ] **Step 3: Verify it compiles.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/data/types.ts src/modules/timekit/model.ts
git commit -m "feat(timekit): TimeEntry type + makeTimeEntry factory"
```

### Task 2.2: Store — `timeEntries` projection

**Files:**
- Modify: `src/storage/local.ts`

**Interfaces:**
- Produces: `LocalStore.timeEntries: Map<string, TimeEntry>`; `putTimeEntry(e)`, `deleteTimeEntry(id)`.

- [ ] **Step 1: Import the type.** Add `TimeEntry` to the `@/data/types` import list in `src/storage/local.ts`.

- [ ] **Step 2: Add the Map.** After `notes = new Map<string, Note>();`:

```ts
  timeEntries = new Map<string, TimeEntry>();
```

- [ ] **Step 3: Clear it in `hydrate()`.** After `this.notes.clear();`:

```ts
    this.timeEntries.clear();
```

- [ ] **Step 4: Add CRUD** in the timekit projections block (after `setTimekitZones`):

```ts
  putTimeEntry(e: TimeEntry): void {
    this.timeEntries.set(e.id, e);
    this._notify();
  }

  deleteTimeEntry(id: string): void {
    this.timeEntries.delete(id);
    this._notify();
  }
```

- [ ] **Step 5: Verify it compiles.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/storage/local.ts
git commit -m "feat(timekit): timeEntries projection in LocalStore"
```

### Task 2.3: Tracker mutations + inverse + links

**Files:**
- Modify: `src/modules/timekit/mutations.ts`
- Modify: `src/modules/timekit/reducer.ts`
- Create: `src/modules/timekit/links.ts`
- Test: `src/modules/timekit/__tests__/dataLayer.test.ts` (extend)
- Test: `src/modules/timekit/__tests__/links.test.ts`

**Interfaces:**
- Produces: `KIND.START_TRACKING|STOP_TRACKING|SET_ENTRY_NOTE|DELETE_ENTRY`; `TIME_ENTRY_ENTITY = "org.nexus.timekit/time-entry"`; `startTrackingMutation(input, store): TimeEntry`; `startTrackingWithTask(taskId, store): TimeEntry`; `stopTrackingMutation(id, store)`; `setEntryNoteMutation(id, note, store)`; `deleteEntryMutation(id, store)`; `entryTrackedTask(store, entryId): { linkId, taskId, title } | null`.

- [ ] **Step 1: Write the failing data-layer tests.** Append to `src/modules/timekit/__tests__/dataLayer.test.ts`:

```ts
import {
  startTrackingMutation,
  stopTrackingMutation,
  setEntryNoteMutation,
  deleteEntryMutation,
} from "@/modules/timekit/mutations";

describe("timekit time entries", () => {
  it("START_TRACKING creates a running entry", () => {
    const s = wire();
    const e = startTrackingMutation({}, s);
    expect(s.timeEntries.get(e.id)?.stoppedAt).toBeNull();
  });

  it("STOP_TRACKING sets stoppedAt", () => {
    const s = wire();
    const e = startTrackingMutation({}, s);
    stopTrackingMutation(e.id, s);
    expect(s.timeEntries.get(e.id)?.stoppedAt).not.toBeNull();
  });

  it("SET_ENTRY_NOTE updates the note", () => {
    const s = wire();
    const e = startTrackingMutation({}, s);
    setEntryNoteMutation(e.id, "design review", s);
    expect(s.timeEntries.get(e.id)?.note).toBe("design review");
  });

  it("undo round-trips stop, note, and delete", () => {
    const s = wire();
    const e = startTrackingMutation({}, s);

    stopTrackingMutation(e.id, s);
    undoLastMutation(s);
    expect(s.timeEntries.get(e.id)?.stoppedAt).toBeNull();

    setEntryNoteMutation(e.id, "x", s);
    undoLastMutation(s);
    expect(s.timeEntries.get(e.id)?.note).toBeNull();

    deleteEntryMutation(e.id, s);
    undoLastMutation(s);
    expect(s.timeEntries.has(e.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Write the failing links test.** Create `src/modules/timekit/__tests__/links.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { undoLastMutation, _resetModuleInverses, _resetUndoStacks, registerModuleInverse } from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { timekitReducer } from "@/modules/timekit/reducer";
import { timekitInverse, TIMEKIT_NS, startTrackingWithTask } from "@/modules/timekit/mutations";
import { entryTrackedTask } from "@/modules/timekit/links";
import type { Task } from "@/data/types";

function wire(): LocalStore {
  const s = new LocalStore();
  registerModuleReducer(TIMEKIT_NS, timekitReducer);
  registerModuleInverse(TIMEKIT_NS, timekitInverse);
  return s;
}

function seedTask(s: LocalStore, id: string, title: string): void {
  const t: Task = {
    id, vaultId: "local", title, status: "needs-action",
    dueAt: null, notes: null, priority: null, assignee: null,
    order: 0, createdAt: 0, updatedAt: 0,
  };
  s.putTask(t);
}

beforeEach(() => { _resetModuleReducers(); _resetModuleInverses(); _resetUndoStacks(); });

describe("timekit tracks-link", () => {
  it("startTrackingWithTask creates entry + tracks link atomically", () => {
    const s = wire();
    seedTask(s, "task-1", "Ship timekit");
    const e = startTrackingWithTask("task-1", s);

    expect(s.timeEntries.has(e.id)).toBe(true);
    const tracked = entryTrackedTask(s, e.id);
    expect(tracked?.taskId).toBe("task-1");
    expect(tracked?.title).toBe("Ship timekit");

    // One undo reverts BOTH the link and the entry.
    undoLastMutation(s);
    expect(s.timeEntries.has(e.id)).toBe(false);
    expect(entryTrackedTask(s, e.id)).toBeNull();
  });
});
```

- [ ] **Step 3: Run them to confirm they fail.**

Run: `pnpm test -- "dataLayer|links"`
Expected: FAIL — missing exports `startTrackingMutation` etc. / `@/modules/timekit/links`.

- [ ] **Step 4: Extend `mutations.ts`.** Add the import and entity const at the top:

```ts
import { recordMutation, recordMutations, type ModuleInverseBuilder } from "@/state/mutations";
import { makeTimeEntry } from "@/modules/timekit/model";
import type { Link, TimeEntry } from "@/data/types";
```

Extend the `KIND` object:

```ts
export const KIND = {
  SET_ZONES: `${TIMEKIT_NS}/SET_TIMEKIT_ZONES`,
  START_TRACKING: `${TIMEKIT_NS}/START_TRACKING`,
  STOP_TRACKING: `${TIMEKIT_NS}/STOP_TRACKING`,
  SET_ENTRY_NOTE: `${TIMEKIT_NS}/SET_ENTRY_NOTE`,
  DELETE_ENTRY: `${TIMEKIT_NS}/DELETE_ENTRY`,
} as const;

/** Entity-type id for a time entry (used as srcType in links). */
export const TIME_ENTRY_ENTITY = "org.nexus.timekit/time-entry";
```

Add the helpers (after `setTimekitZonesMutation`):

```ts
/** Start a running time entry. */
export function startTrackingMutation(input: Partial<TimeEntry>, store: LocalStore): TimeEntry {
  const e = makeTimeEntry(input, store.vault?.id ?? "local", Date.now());
  recordMutation(KIND.START_TRACKING, e, store);
  return e;
}

/**
 * Start a running entry linked to a Task as ONE atomic undo unit
 * (entry --tracks--> task). Mirrors createTaskFromEntity.
 */
export function startTrackingWithTask(taskId: string, store: LocalStore): TimeEntry {
  const entry = makeTimeEntry({}, store.vault?.id ?? "local", Date.now());
  const link: Link = {
    id: `lnk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    vaultId: store.vault?.id ?? "local",
    srcType: TIME_ENTRY_ENTITY,
    srcId: entry.id,
    linkType: "tracks",
    dstType: "org.nexus.tasks/task",
    dstId: taskId,
    createdAt: Date.now(),
  };
  recordMutations(
    [
      { kind: KIND.START_TRACKING, payload: entry },
      { kind: "CREATE_LINK", payload: link },
    ],
    store,
    "Start tracking task",
  );
  return entry;
}

export function stopTrackingMutation(id: string, store: LocalStore): void {
  recordMutation(KIND.STOP_TRACKING, { id, stoppedAt: Date.now() }, store);
}

export function setEntryNoteMutation(id: string, note: string | null, store: LocalStore): void {
  recordMutation(KIND.SET_ENTRY_NOTE, { id, note }, store);
}

export function deleteEntryMutation(id: string, store: LocalStore): void {
  recordMutation(KIND.DELETE_ENTRY, { id }, store);
}
```

Extend `timekitInverse` with the new cases (inside the `switch`, before the closing `}`):

```ts
    case KIND.START_TRACKING: {
      const e = _payload as TimeEntry;
      return { reverseSteps: [{ kind: KIND.DELETE_ENTRY, payload: { id: e.id } }], description: "Start tracking" };
    }
    case KIND.STOP_TRACKING: {
      const p = _payload as { id: string };
      const prev = s.timeEntries.get(p.id);
      if (!prev) return null;
      // Restore prior stoppedAt (null ⇒ running again).
      return { reverseSteps: [{ kind: KIND.STOP_TRACKING, payload: { id: p.id, stoppedAt: prev.stoppedAt } }], description: "Stop tracking" };
    }
    case KIND.SET_ENTRY_NOTE: {
      const p = _payload as { id: string };
      const prev = s.timeEntries.get(p.id);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.SET_ENTRY_NOTE, payload: { id: p.id, note: prev.note } }], description: "Edit entry note" };
    }
    case KIND.DELETE_ENTRY: {
      const p = _payload as { id: string };
      const prev = s.timeEntries.get(p.id);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.START_TRACKING, payload: prev }], description: "Delete entry" };
    }
```

> The inverse's second param is named `_payload` in Stage 1. Now that it is read, rename the parameter to `payload` in the `timekitInverse` signature and use `payload` consistently (drop the underscore) so lint's no-unused-vars is satisfied and the new cases read cleanly. Update the existing `SET_ZONES` case to ignore it (it only reads the store) — that's fine.

- [ ] **Step 5: Extend `reducer.ts`.** Add a `patchEntry` helper above `timekitReducer` and the new cases inside the `switch`:

```ts
import type { TimeEntry } from "@/data/types";

function patchEntry(s: LocalStore, id: string, change: Partial<TimeEntry>): void {
  const prev = s.timeEntries.get(id);
  if (!prev) return;
  s.putTimeEntry({ ...prev, ...change });
}
```

```ts
      case "org.nexus.timekit/START_TRACKING":
        s.putTimeEntry(payload as TimeEntry);
        break;
      case "org.nexus.timekit/STOP_TRACKING": {
        const p = payload as { id: string; stoppedAt: number | null };
        patchEntry(s, p.id, { stoppedAt: p.stoppedAt });
        break;
      }
      case "org.nexus.timekit/SET_ENTRY_NOTE": {
        const p = payload as { id: string; note: string | null };
        patchEntry(s, p.id, { note: p.note });
        break;
      }
      case "org.nexus.timekit/DELETE_ENTRY": {
        const p = payload as { id: string };
        s.deleteTimeEntry(p.id);
        break;
      }
```

- [ ] **Step 6: Create `src/modules/timekit/links.ts`:**

```ts
import type { LocalStore } from "@/storage/local";
import { linksFrom } from "@/state/linksGraph";
import { TIME_ENTRY_ENTITY } from "@/modules/timekit/mutations";

export interface TrackedTask {
  linkId: string;
  taskId: string;
  title: string;
}

/** Resolve a time entry's outgoing "tracks" link to its Task, or null. */
export function entryTrackedTask(store: LocalStore, entryId: string): TrackedTask | null {
  const link = linksFrom(store, TIME_ENTRY_ENTITY, entryId, "tracks")[0];
  if (!link) return null;
  return {
    linkId: link.id,
    taskId: link.dstId,
    title: store.tasks.get(link.dstId)?.title ?? "(task)",
  };
}
```

- [ ] **Step 7: Run the tests to confirm they pass.**

Run: `pnpm test -- "dataLayer|links"`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add src/modules/timekit/mutations.ts src/modules/timekit/reducer.ts src/modules/timekit/links.ts src/modules/timekit/__tests__/dataLayer.test.ts src/modules/timekit/__tests__/links.test.ts
git commit -m "feat(timekit): time-entry mutations, tracks-link, inverse"
```

### Task 2.4: Time helpers — `entryElapsedMs`, `formatDuration`

**Files:**
- Modify: `src/modules/timekit/time.ts`
- Test: `src/modules/timekit/__tests__/time.test.ts` (extend)

**Interfaces:**
- Produces: `entryElapsedMs(entry: TimeEntry, now: number): number`; `formatDuration(ms: number): string`.

- [ ] **Step 1: Write the failing tests.** Append to `src/modules/timekit/__tests__/time.test.ts`:

```ts
import { entryElapsedMs, formatDuration } from "@/modules/timekit/time";
import type { TimeEntry } from "@/data/types";

function entry(startedAt: number, stoppedAt: number | null): TimeEntry {
  return { id: "te-1", vaultId: "local", startedAt, stoppedAt, note: null, createdAt: startedAt };
}

describe("entryElapsedMs", () => {
  it("uses now for a running entry", () => {
    expect(entryElapsedMs(entry(1_000, null), 4_000)).toBe(3_000);
  });
  it("uses stoppedAt for a finished entry (now ignored)", () => {
    expect(entryElapsedMs(entry(1_000, 6_000), 999_999)).toBe(5_000);
  });
  it("never returns negative", () => {
    expect(entryElapsedMs(entry(5_000, null), 1_000)).toBe(0);
  });
});

describe("formatDuration", () => {
  it("formats minutes:seconds under an hour", () => {
    expect(formatDuration(90_000)).toBe("1:30");
  });
  it("formats hours:minutes:seconds at/over an hour", () => {
    expect(formatDuration(3_661_000)).toBe("1:01:01");
  });
  it("clamps negatives to 0:00", () => {
    expect(formatDuration(-5_000)).toBe("0:00");
  });
});
```

- [ ] **Step 2: Run them to confirm they fail.**

Run: `pnpm test -- time`
Expected: FAIL — missing exports.

- [ ] **Step 3: Extend `src/modules/timekit/time.ts`:**

```ts
import type { TimeEntry } from "@/data/types";

/** Elapsed ms for an entry; running entries measure against `now`. Never negative. */
export function entryElapsedMs(entry: TimeEntry, now: number): number {
  const end = entry.stoppedAt ?? now;
  return Math.max(0, end - entry.startedAt);
}

/** Format ms as `m:ss` (under 1h) or `h:mm:ss`. Negatives clamp to "0:00". */
export function formatDuration(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
```

- [ ] **Step 4: Run the tests to confirm they pass.**

Run: `pnpm test -- time`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/timekit/time.ts src/modules/timekit/__tests__/time.test.ts
git commit -m "feat(timekit): entryElapsedMs + formatDuration helpers"
```

### Task 2.5: Tracker hook + Tracker section + section switcher + start-tracking command

**Files:**
- Modify: `src/modules/timekit/hooks.ts`
- Create: `src/modules/timekit/panelState.ts`
- Create: `src/modules/timekit/TrackerSection.tsx`
- Modify: `src/modules/timekit/TimekitPanel.tsx`
- Modify: `src/modules/timekit/index.ts`
- Modify: `src/modules/timekit/__tests__/registration.test.ts` (extend)

**Interfaces:**
- Consumes: `useTimeEntries`, `entryElapsedMs`, `formatDuration`, `entryTrackedTask`, tracker mutations, `panelState`.
- Produces: `useTimeEntries(): TimeEntry[]`; `panelState` API `{ TimekitSection, requestSection, getRequestedSection, subscribeSection }`; `TrackerSection`; updated panel with a `Clock | Tracker` switcher; `start-tracking` command.

- [ ] **Step 1: Extend hooks.** Append to `src/modules/timekit/hooks.ts`:

```ts
import type { TimeEntry } from "@/data/types";

/** All time entries, most-recently-started first. */
export function useTimeEntries(): TimeEntry[] {
  const v = useStoreVersion();
  return useMemo(
    () => Array.from(localStore.timeEntries.values()).sort((a, b) => b.startedAt - a.startedAt),
    [v],
  );
}
```

- [ ] **Step 2: Create `src/modules/timekit/panelState.ts`** (ephemeral focus signal — `openModulePanel` can't pass params yet, substrate gap #1):

```ts
export type TimekitSection = "clock" | "tracker" | "timers" | "alarms";

let _requested: TimekitSection = "clock";
const _listeners = new Set<(s: TimekitSection) => void>();

/** Ask a (possibly-already-open) Timekit panel to focus a section. */
export function requestSection(s: TimekitSection): void {
  _requested = s;
  for (const l of [..._listeners]) l(s);
}

/** The last-requested section — read as the panel's initial section on mount. */
export function getRequestedSection(): TimekitSection {
  return _requested;
}

/** Subscribe to focus requests. Returns a disposer. */
export function subscribeSection(l: (s: TimekitSection) => void): () => void {
  _listeners.add(l);
  return () => _listeners.delete(l);
}
```

- [ ] **Step 3: Create `src/modules/timekit/TrackerSection.tsx`:**

```tsx
import { useEffect, useState } from "react";
import { localStore } from "@/storage/local";
import { useTimeEntries } from "@/modules/timekit/hooks";
import { startTrackingMutation, stopTrackingMutation, deleteEntryMutation } from "@/modules/timekit/mutations";
import { entryElapsedMs, formatDuration } from "@/modules/timekit/time";
import { entryTrackedTask } from "@/modules/timekit/links";

/** Start/stop time tracking with a live-elapsed running row and a past-entry list. */
export function TrackerSection() {
  const entries = useTimeEntries();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const running = entries.find((e) => e.stoppedAt === null);
  const total = entries.reduce((sum, e) => sum + entryElapsedMs(e, now), 0);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        {running ? (
          <>
            <div className="text-h3 font-semibold tabular-nums text-text-primary">
              {formatDuration(entryElapsedMs(running, now))}
            </div>
            <button
              type="button"
              onClick={() => stopTrackingMutation(running.id, localStore)}
              className="rounded-md bg-surface-2 px-3 py-1 text-small text-text-primary"
            >
              Stop
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => startTrackingMutation({}, localStore)}
            className="rounded-md bg-surface-2 px-3 py-1 text-small text-text-primary"
          >
            Start tracking
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {entries.filter((e) => e.stoppedAt !== null).map((e) => {
          const tracked = entryTrackedTask(localStore, e.id);
          return (
            <li key={e.id} className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
              <div className="min-w-0">
                <div className="text-body tabular-nums text-text-primary">{formatDuration(entryElapsedMs(e, now))}</div>
                <div className="truncate text-small text-text-secondary">
                  {tracked ? `↳ ${tracked.title}` : (e.note ?? "—")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteEntryMutation(e.id, localStore)}
                aria-label="Delete entry"
                className="text-small text-text-secondary hover:text-text-primary"
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>

      <div className="text-small text-text-secondary">Total: <span className="tabular-nums">{formatDuration(total)}</span></div>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `TimekitPanel.tsx`** with a section switcher driven by `panelState`:

```tsx
import { useEffect, useState } from "react";
import type { IDockviewPanelProps } from "dockview";
import { cn } from "@/lib/utils";
import { ClockSection } from "@/modules/timekit/ClockSection";
import { TrackerSection } from "@/modules/timekit/TrackerSection";
import { getRequestedSection, subscribeSection, type TimekitSection } from "@/modules/timekit/panelState";

const SECTIONS: { id: TimekitSection; label: string }[] = [
  { id: "clock", label: "Clock" },
  { id: "tracker", label: "Tracker" },
];

/** Timekit dock panel: a tabbed Clock · Tracker (… Timers · Alarms in later stages). */
export function TimekitPanel(_: IDockviewPanelProps) {
  const [section, setSection] = useState<TimekitSection>(() => getRequestedSection());

  // Let commands focus a section on an already-open panel.
  useEffect(() => subscribeSection(setSection), []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <h2 className="text-h3 font-semibold text-text-primary">Clock</h2>
        <div className="flex items-center gap-1 rounded-md bg-surface-2 p-0.5">
          {SECTIONS.map((sct) => (
            <button
              key={sct.id}
              type="button"
              aria-pressed={section === sct.id}
              onClick={() => setSection(sct.id)}
              className={cn(
                "rounded-sm px-2.5 py-1 text-small font-medium transition-colors duration-fast",
                section === sct.id
                  ? "bg-surface-1 text-text-primary shadow-sm"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {sct.label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {section === "clock" && <ClockSection />}
        {section === "tracker" && <TrackerSection />}
      </div>
    </div>
  );
}
```

> The `SECTIONS` array gains `timers` and `alarms` entries in Stages 3 and 4, with matching `{section === … && <…Section />}` lines.

- [ ] **Step 5: Add the `start-tracking` command + an `openAt` helper** in `index.ts`. Add imports:

```ts
import { requestSection, type TimekitSection } from "@/modules/timekit/panelState";
```

Add the helper above `registerTimekitModule`:

```ts
function openAt(section: TimekitSection): void {
  requestSection(section);
  useWorkspace.getState().openModulePanel(TIMEKIT_MAIN_PANEL_KEY, "Clock");
}
```

Replace the `open` command body and add `start-tracking`:

```ts
    host.contribute.command("open", () => openAt("clock"));
    host.contribute.command("start-tracking", () => openAt("tracker"));
```

Add `start-tracking` to the manifest's `mutationKinds`/`commands` and `entities`:

```ts
  entities: ["org.nexus.timekit/time-entry"],
  mutationKinds: [KIND.SET_ZONES, KIND.START_TRACKING, KIND.STOP_TRACKING, KIND.SET_ENTRY_NOTE, KIND.DELETE_ENTRY],
```

```ts
    commands: [
      { id: "open", title: "Open Clock", icon: "clock" },
      { id: "start-tracking", title: "Start time tracking", icon: "clock" },
    ],
```

- [ ] **Step 6: Extend the registration test.** Append to `src/modules/timekit/__tests__/registration.test.ts` (inside the `describe`):

```ts
  it("declares the time-entry entity and a start-tracking command", () => {
    registerTimekitModule();
    const m = getModule(TIMEKIT_MODULE_ID);
    expect(m?.entities).toContain("org.nexus.timekit/time-entry");
    expect(m?.mutationKinds).toContain("org.nexus.timekit/START_TRACKING");
    const cmd = listModuleCommands().find((c) => c.key === "org.nexus.timekit:start-tracking");
    expect(cmd?.spec.title).toBe("Start time tracking");
  });
```

- [ ] **Step 7: Run the Stage-2 gate.**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS.

- [ ] **Step 8: Commit.**

```bash
git add src/modules/timekit/hooks.ts src/modules/timekit/panelState.ts src/modules/timekit/TrackerSection.tsx src/modules/timekit/TimekitPanel.tsx src/modules/timekit/index.ts src/modules/timekit/__tests__/registration.test.ts
git commit -m "feat(timekit): Tracker section, section switcher, start-tracking command"
```

**Stage 2 done when:** the Tracker section starts a live-elapsed entry, stops it into the list, supports a per-task `tracks` link (atomic, single-undo), and the `start-tracking` command focuses it. Gate green.

---

## Stage 3 — Countdown timers (brings the tick worker + `source:"module"` + chime)

Adds the `CountdownTimer` entity, its mutation lifecycle, the Timers section, the **tick worker** (`dueTimers`, `startTimekitTicker`, `main.tsx` wiring), `source:"module"` completion, toast + chime, and the `new-timer` command.

### Task 3.1: `CountdownTimer` type + factory + store projection

**Files:**
- Modify: `src/data/types.ts`
- Modify: `src/modules/timekit/model.ts`
- Modify: `src/storage/local.ts`

**Interfaces:**
- Produces: `CountdownState`, `CountdownTimer`; `makeTimer(input, vaultId, now): CountdownTimer`; `LocalStore.countdownTimers`, `putCountdownTimer`, `deleteCountdownTimer`.

- [ ] **Step 1: Add the types** to `src/data/types.ts`:

```ts
export type CountdownState = "idle" | "running" | "paused" | "done";

export interface CountdownTimer {
  id: string;
  vaultId: string;
  label: string;
  durationMs: number;
  startedAt: number | null;   // when the current run began; null when idle/paused/done
  elapsedBeforeMs: number;    // accumulated elapsed across prior runs (pause/resume)
  state: CountdownState;
  createdAt: number;
}
```

- [ ] **Step 2: Add the factory** to `src/modules/timekit/model.ts`:

```ts
import type { CountdownTimer } from "@/data/types";

/** Build a CountdownTimer from partial input (label + durationMs required). */
export function makeTimer(
  input: Partial<CountdownTimer> & { label: string; durationMs: number },
  vaultId: string,
  now: number,
): CountdownTimer {
  return {
    id: input.id ?? tkId("ct"),
    vaultId,
    label: input.label,
    durationMs: input.durationMs,
    startedAt: input.startedAt ?? null,
    elapsedBeforeMs: input.elapsedBeforeMs ?? 0,
    state: input.state ?? "idle",
    createdAt: input.createdAt ?? now,
  };
}
```

- [ ] **Step 3: Add the store projection** to `src/storage/local.ts` (import `CountdownTimer`; add Map after `timeEntries`; clear in `hydrate()`; add CRUD):

```ts
  countdownTimers = new Map<string, CountdownTimer>();
```

```ts
    this.countdownTimers.clear();
```

```ts
  putCountdownTimer(t: CountdownTimer): void {
    this.countdownTimers.set(t.id, t);
    this._notify();
  }

  deleteCountdownTimer(id: string): void {
    this.countdownTimers.delete(id);
    this._notify();
  }
```

- [ ] **Step 4: Verify it compiles.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/data/types.ts src/modules/timekit/model.ts src/storage/local.ts
git commit -m "feat(timekit): CountdownTimer type, factory, store projection"
```

### Task 3.2: Timer mutations + reducer + inverse

**Files:**
- Modify: `src/modules/timekit/mutations.ts`
- Modify: `src/modules/timekit/reducer.ts`
- Test: `src/modules/timekit/__tests__/dataLayer.test.ts` (extend)

**Interfaces:**
- Produces: `KIND.CREATE_TIMER|START_TIMER|PAUSE_TIMER|RESUME_TIMER|COMPLETE_TIMER|RESET_TIMER|DELETE_TIMER`; `createTimerMutation(label, durationMs, store): CountdownTimer`; `startTimerMutation(id, store)`; `pauseTimerMutation(id, store)`; `resumeTimerMutation(id, store)`; `completeTimerMutation(id, store, opts?)`; `resetTimerMutation(id, store)`; `deleteTimerMutation(id, store)`. `opts?: { source?: MutationSource; generatedBy?: string }`.

- [ ] **Step 1: Write the failing tests.** Append to `dataLayer.test.ts`:

```ts
import {
  createTimerMutation,
  startTimerMutation,
  pauseTimerMutation,
  resumeTimerMutation,
  completeTimerMutation,
  resetTimerMutation,
  deleteTimerMutation,
} from "@/modules/timekit/mutations";

describe("timekit countdown timers", () => {
  it("create → start → complete moves through states", () => {
    const s = wire();
    const t = createTimerMutation("Tea", 5_000, s);
    expect(s.countdownTimers.get(t.id)?.state).toBe("idle");
    startTimerMutation(t.id, s);
    expect(s.countdownTimers.get(t.id)?.state).toBe("running");
    completeTimerMutation(t.id, s);
    expect(s.countdownTimers.get(t.id)?.state).toBe("done");
  });

  it("pause accumulates elapsedBeforeMs and resume re-arms startedAt", () => {
    const s = wire();
    const t = createTimerMutation("Work", 60_000, s);
    startTimerMutation(t.id, s);
    pauseTimerMutation(t.id, s);
    const paused = s.countdownTimers.get(t.id)!;
    expect(paused.state).toBe("paused");
    expect(paused.startedAt).toBeNull();
    expect(paused.elapsedBeforeMs).toBeGreaterThanOrEqual(0);
    resumeTimerMutation(t.id, s);
    expect(s.countdownTimers.get(t.id)?.state).toBe("running");
    expect(s.countdownTimers.get(t.id)?.startedAt).not.toBeNull();
  });

  it("reset returns to idle with zero elapsed; delete removes it", () => {
    const s = wire();
    const t = createTimerMutation("X", 1_000, s);
    startTimerMutation(t.id, s);
    resetTimerMutation(t.id, s);
    const r = s.countdownTimers.get(t.id)!;
    expect(r.state).toBe("idle");
    expect(r.elapsedBeforeMs).toBe(0);
    deleteTimerMutation(t.id, s);
    expect(s.countdownTimers.has(t.id)).toBe(false);
  });

  it("undo of complete restores the running state", () => {
    const s = wire();
    const t = createTimerMutation("Y", 1_000, s);
    startTimerMutation(t.id, s);
    completeTimerMutation(t.id, s);
    undoLastMutation(s);
    expect(s.countdownTimers.get(t.id)?.state).toBe("running");
  });
});
```

- [ ] **Step 2: Run them to confirm they fail.**

Run: `pnpm test -- dataLayer`
Expected: FAIL — missing timer mutation exports.

- [ ] **Step 3: Extend `mutations.ts`.** Import `CountdownTimer` and `MutationSource`:

```ts
import type { CountdownTimer, Link, MutationSource, TimeEntry } from "@/data/types";
import { makeTimeEntry, makeTimer } from "@/modules/timekit/model";
```

Add an opts type alias near the top:

```ts
/** Provenance opts forwarded to recordMutation (e.g. the tick worker's source:"module"). */
export type TimekitOpts = { source?: MutationSource; generatedBy?: string };
```

Extend `KIND`:

```ts
  CREATE_TIMER: `${TIMEKIT_NS}/CREATE_TIMER`,
  START_TIMER: `${TIMEKIT_NS}/START_TIMER`,
  PAUSE_TIMER: `${TIMEKIT_NS}/PAUSE_TIMER`,
  RESUME_TIMER: `${TIMEKIT_NS}/RESUME_TIMER`,
  COMPLETE_TIMER: `${TIMEKIT_NS}/COMPLETE_TIMER`,
  RESET_TIMER: `${TIMEKIT_NS}/RESET_TIMER`,
  DELETE_TIMER: `${TIMEKIT_NS}/DELETE_TIMER`,
```

Add helpers:

```ts
export function createTimerMutation(label: string, durationMs: number, store: LocalStore): CountdownTimer {
  const t = makeTimer({ label, durationMs }, store.vault?.id ?? "local", Date.now());
  recordMutation(KIND.CREATE_TIMER, t, store);
  return t;
}

export function startTimerMutation(id: string, store: LocalStore): void {
  recordMutation(KIND.START_TIMER, { id, startedAt: Date.now() }, store);
}

/** Pause a running timer: fold the current run into elapsedBeforeMs (computed at record-time). */
export function pauseTimerMutation(id: string, store: LocalStore): void {
  const t = store.countdownTimers.get(id);
  if (!t || t.state !== "running" || t.startedAt == null) return;
  const elapsedBeforeMs = t.elapsedBeforeMs + (Date.now() - t.startedAt);
  recordMutation(KIND.PAUSE_TIMER, { id, elapsedBeforeMs }, store);
}

export function resumeTimerMutation(id: string, store: LocalStore): void {
  recordMutation(KIND.RESUME_TIMER, { id, startedAt: Date.now() }, store);
}

/** Mark a timer done. The tick worker passes { source: "module" }; manual calls omit it. */
export function completeTimerMutation(id: string, store: LocalStore, opts?: TimekitOpts): void {
  recordMutation(KIND.COMPLETE_TIMER, { id }, store, opts);
}

export function resetTimerMutation(id: string, store: LocalStore): void {
  recordMutation(KIND.RESET_TIMER, { id }, store);
}

export function deleteTimerMutation(id: string, store: LocalStore): void {
  recordMutation(KIND.DELETE_TIMER, { id }, store);
}
```

Extend `timekitInverse`. CREATE/DELETE are explicit; the state transitions all restore the full prior timer via `CREATE_TIMER` (the reducer's `CREATE_TIMER` overwrites the map entry, so re-putting the prior object restores every field):

```ts
    case KIND.CREATE_TIMER: {
      const t = payload as CountdownTimer;
      return { reverseSteps: [{ kind: KIND.DELETE_TIMER, payload: { id: t.id } }], description: "Create timer" };
    }
    case KIND.DELETE_TIMER: {
      const p = payload as { id: string };
      const prev = s.countdownTimers.get(p.id);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.CREATE_TIMER, payload: prev }], description: "Delete timer" };
    }
    case KIND.START_TIMER:
    case KIND.RESUME_TIMER:
    case KIND.PAUSE_TIMER:
    case KIND.COMPLETE_TIMER:
    case KIND.RESET_TIMER: {
      const p = payload as { id: string };
      const prev = s.countdownTimers.get(p.id);
      if (!prev) return null;
      const desc =
        kind === KIND.PAUSE_TIMER ? "Pause timer"
        : kind === KIND.COMPLETE_TIMER ? "Complete timer"
        : kind === KIND.RESET_TIMER ? "Reset timer"
        : "Start timer";
      return { reverseSteps: [{ kind: KIND.CREATE_TIMER, payload: { ...prev } }], description: desc };
    }
```

- [ ] **Step 4: Extend `reducer.ts`.** Add a `patchTimer` helper and the cases. Import `CountdownTimer`:

```ts
import type { CountdownTimer, TimeEntry } from "@/data/types";

function patchTimer(s: LocalStore, id: string, change: Partial<CountdownTimer>): void {
  const prev = s.countdownTimers.get(id);
  if (!prev) return;
  s.putCountdownTimer({ ...prev, ...change });
}
```

```ts
      case "org.nexus.timekit/CREATE_TIMER":
        s.putCountdownTimer(payload as CountdownTimer);
        break;
      case "org.nexus.timekit/START_TIMER":
      case "org.nexus.timekit/RESUME_TIMER": {
        const p = payload as { id: string; startedAt: number };
        patchTimer(s, p.id, { state: "running", startedAt: p.startedAt });
        break;
      }
      case "org.nexus.timekit/PAUSE_TIMER": {
        const p = payload as { id: string; elapsedBeforeMs: number };
        patchTimer(s, p.id, { state: "paused", startedAt: null, elapsedBeforeMs: p.elapsedBeforeMs });
        break;
      }
      case "org.nexus.timekit/COMPLETE_TIMER": {
        const p = payload as { id: string };
        patchTimer(s, p.id, { state: "done", startedAt: null });
        break;
      }
      case "org.nexus.timekit/RESET_TIMER": {
        const p = payload as { id: string };
        patchTimer(s, p.id, { state: "idle", startedAt: null, elapsedBeforeMs: 0 });
        break;
      }
      case "org.nexus.timekit/DELETE_TIMER": {
        const p = payload as { id: string };
        s.deleteCountdownTimer(p.id);
        break;
      }
```

- [ ] **Step 5: Run the tests to confirm they pass.**

Run: `pnpm test -- dataLayer`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/modules/timekit/mutations.ts src/modules/timekit/reducer.ts src/modules/timekit/__tests__/dataLayer.test.ts
git commit -m "feat(timekit): countdown timer mutations, reducer, inverse"
```

### Task 3.3: Timer time helpers — `timerEndsAt`, `timerRemainingMs`

**Files:**
- Modify: `src/modules/timekit/time.ts`
- Test: `src/modules/timekit/__tests__/time.test.ts` (extend)

**Interfaces:**
- Produces: `timerEndsAt(t: CountdownTimer): number | null`; `timerRemainingMs(t: CountdownTimer, now: number): number`.

- [ ] **Step 1: Write the failing tests.** Append to `time.test.ts`:

```ts
import { timerEndsAt, timerRemainingMs } from "@/modules/timekit/time";
import type { CountdownTimer } from "@/data/types";

function timer(p: Partial<CountdownTimer>): CountdownTimer {
  return {
    id: "ct-1", vaultId: "local", label: "T", durationMs: 10_000,
    startedAt: null, elapsedBeforeMs: 0, state: "idle", createdAt: 0, ...p,
  };
}

describe("timerEndsAt / timerRemainingMs", () => {
  it("running: endsAt = startedAt + (duration - elapsedBefore)", () => {
    const t = timer({ state: "running", startedAt: 1_000, durationMs: 10_000, elapsedBeforeMs: 2_000 });
    expect(timerEndsAt(t)).toBe(9_000);          // 1000 + (10000 - 2000)
    expect(timerRemainingMs(t, 4_000)).toBe(5_000);
  });
  it("idle/paused: remaining = duration - elapsedBefore (now ignored)", () => {
    expect(timerEndsAt(timer({ state: "idle" }))).toBeNull();
    expect(timerRemainingMs(timer({ state: "paused", elapsedBeforeMs: 3_000 }), 999)).toBe(7_000);
  });
  it("done: remaining is 0", () => {
    expect(timerRemainingMs(timer({ state: "done" }), 0)).toBe(0);
  });
  it("running past end clamps to 0", () => {
    const t = timer({ state: "running", startedAt: 0, durationMs: 1_000, elapsedBeforeMs: 0 });
    expect(timerRemainingMs(t, 5_000)).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to confirm they fail.**

Run: `pnpm test -- time`
Expected: FAIL — missing exports.

- [ ] **Step 3: Extend `time.ts`:**

```ts
import type { CountdownTimer } from "@/data/types";

/** When a running timer will reach zero, or null when not running. */
export function timerEndsAt(t: CountdownTimer): number | null {
  if (t.startedAt == null) return null;
  return t.startedAt + (t.durationMs - t.elapsedBeforeMs);
}

/** Remaining ms for a timer. Never negative. */
export function timerRemainingMs(t: CountdownTimer, now: number): number {
  if (t.state === "done") return 0;
  if (t.startedAt == null) return Math.max(0, t.durationMs - t.elapsedBeforeMs);
  return Math.max(0, timerEndsAt(t)! - now);
}
```

- [ ] **Step 4: Run the tests to confirm they pass.**

Run: `pnpm test -- time`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/timekit/time.ts src/modules/timekit/__tests__/time.test.ts
git commit -m "feat(timekit): timerEndsAt + timerRemainingMs helpers"
```

### Task 3.4: Tick worker — `dueTimers` + `startTimekitTicker`

**Files:**
- Create: `src/modules/timekit/ticker.ts`
- Test: `src/modules/timekit/__tests__/ticker.test.ts`

**Interfaces:**
- Consumes: `timerEndsAt`, `completeTimerMutation`, `toast` from `sonner`, `LocalStore`.
- Produces: `dueTimers(now: number, timers: Iterable<CountdownTimer>): CountdownTimer[]`; `startTimekitTicker(store: LocalStore): () => void`.

- [ ] **Step 1: Write the failing tests** (pure `dueTimers` + provenance + idempotency). Create `src/modules/timekit/__tests__/ticker.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { getUndoHistory, _resetModuleInverses, _resetUndoStacks, registerModuleInverse } from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { timekitReducer } from "@/modules/timekit/reducer";
import {
  timekitInverse, TIMEKIT_NS,
  createTimerMutation, startTimerMutation, completeTimerMutation,
} from "@/modules/timekit/mutations";
import { dueTimers } from "@/modules/timekit/ticker";

function wire(): LocalStore {
  const s = new LocalStore();
  registerModuleReducer(TIMEKIT_NS, timekitReducer);
  registerModuleInverse(TIMEKIT_NS, timekitInverse);
  return s;
}

beforeEach(() => { _resetModuleReducers(); _resetModuleInverses(); _resetUndoStacks(); });

describe("dueTimers", () => {
  it("returns running timers whose end time has passed, and excludes paused/idle/done", () => {
    const s = wire();
    const t = createTimerMutation("Due", 1_000, s);
    startTimerMutation(t.id, s);
    const startedAt = s.countdownTimers.get(t.id)!.startedAt!;
    const now = startedAt + 2_000;             // past end
    const due = dueTimers(now, s.countdownTimers.values());
    expect(due.map((x) => x.id)).toEqual([t.id]);

    // Not yet due:
    expect(dueTimers(startedAt + 1, s.countdownTimers.values())).toEqual([]);
  });

  it("provenance + idempotency: completing with source:'module' flips it out of the due set", () => {
    const s = wire();
    const t = createTimerMutation("Due", 1_000, s);
    startTimerMutation(t.id, s);
    const now = s.countdownTimers.get(t.id)!.startedAt! + 2_000;

    completeTimerMutation(t.id, s, { source: "module" });
    expect(getUndoHistory()[0]?.source).toBe("module");
    // After completion the timer is "done" → no longer returned.
    expect(dueTimers(now, s.countdownTimers.values())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to confirm they fail.**

Run: `pnpm test -- ticker`
Expected: FAIL — cannot resolve `@/modules/timekit/ticker`.

- [ ] **Step 3: Create `src/modules/timekit/ticker.ts`** (Stage 3: timers only; alarms added in Stage 4):

```ts
import type { CountdownTimer } from "@/data/types";
import type { LocalStore } from "@/storage/local";
import { toast } from "sonner";
import { timerEndsAt } from "@/modules/timekit/time";
import { completeTimerMutation } from "@/modules/timekit/mutations";

/** Running timers whose end time has passed. Pure; never returns non-running timers. */
export function dueTimers(now: number, timers: Iterable<CountdownTimer>): CountdownTimer[] {
  const out: CountdownTimer[] = [];
  for (const t of timers) {
    if (t.state !== "running" || t.startedAt == null) continue;
    const ends = timerEndsAt(t);
    if (ends != null && ends <= now) out.push(t);
  }
  return out;
}

/** Short Web-Audio beep; silently no-ops where AudioContext is unavailable. */
function chime(): void {
  try {
    const w = globalThis as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctx = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = () => void ctx.close();
  } catch {
    /* no audio available */
  }
}

/**
 * Start the 1s tick worker. Main-window-only (gated by main.tsx). Each tick fires
 * due timers: emits COMPLETE_TIMER (source:"module"), toasts, and chimes. The state
 * flip makes firing idempotent (a done timer is no longer "due"). Returns a disposer.
 */
export function startTimekitTicker(store: LocalStore): () => void {
  const id = setInterval(() => {
    const now = Date.now();
    for (const t of dueTimers(now, store.countdownTimers.values())) {
      completeTimerMutation(t.id, store, { source: "module" });
      toast(`Timer done: ${t.label}`);
      chime();
    }
  }, 1000);
  return () => clearInterval(id);
}
```

- [ ] **Step 4: Run the tests to confirm they pass.**

Run: `pnpm test -- ticker`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/timekit/ticker.ts src/modules/timekit/__tests__/ticker.test.ts
git commit -m "feat(timekit): tick worker (dueTimers + startTimekitTicker, source:module)"
```

### Task 3.5: Wire the ticker in `main.tsx`

**Files:**
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `startTimekitTicker`, `localStore`.

- [ ] **Step 1: Add the import** near the other module imports in `src/main.tsx`:

```ts
import { startTimekitTicker } from "@/modules/timekit/ticker";
```

- [ ] **Step 2: Start it in web mode.** At the end of `initWeb()` (after `replayRegisteredModules(localStore);`), add:

```ts
  // Main-window-only background workers that are also valid in web mode
  // (web mode is inherently single-window). See plan Concern A.
  startTimekitTicker(localStore);
```

- [ ] **Step 3: Start it in Tauri main window.** Inside `initTauri()`, in the `if (!isMain) return;` background block (after `startGoogleAutoSync();`), add:

```ts
    startTimekitTicker(localStore);
```

- [ ] **Step 4: Verify it compiles.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/main.tsx
git commit -m "feat(timekit): start tick worker in web + tauri main window"
```

### Task 3.6: Timers section + hook + `new-timer` command

**Files:**
- Modify: `src/modules/timekit/hooks.ts`
- Create: `src/modules/timekit/TimersSection.tsx`
- Modify: `src/modules/timekit/TimekitPanel.tsx`
- Modify: `src/modules/timekit/index.ts`
- Modify: `src/modules/timekit/__tests__/registration.test.ts` (extend)

**Interfaces:**
- Produces: `useCountdownTimers(): CountdownTimer[]`; `TimersSection`; `new-timer` command; panel `timers` tab.

- [ ] **Step 1: Extend hooks.** Append to `hooks.ts`:

```ts
import type { CountdownTimer } from "@/data/types";

/** All countdown timers, oldest-created first. */
export function useCountdownTimers(): CountdownTimer[] {
  const v = useStoreVersion();
  return useMemo(
    () => Array.from(localStore.countdownTimers.values()).sort((a, b) => a.createdAt - b.createdAt),
    [v],
  );
}
```

- [ ] **Step 2: Create `src/modules/timekit/TimersSection.tsx`:**

```tsx
import { useEffect, useState } from "react";
import { localStore } from "@/storage/local";
import { useCountdownTimers } from "@/modules/timekit/hooks";
import {
  createTimerMutation, startTimerMutation, pauseTimerMutation,
  resumeTimerMutation, resetTimerMutation, deleteTimerMutation,
} from "@/modules/timekit/mutations";
import { timerRemainingMs, formatDuration } from "@/modules/timekit/time";
import type { CountdownTimer } from "@/data/types";

/** Create and control countdown timers; remaining time ticks live in the UI. */
export function TimersSection() {
  const timers = useCountdownTimers();
  const [now, setNow] = useState(() => Date.now());
  const [label, setLabel] = useState("");
  const [seconds, setSeconds] = useState("60");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  function create() {
    const secs = Number(seconds);
    if (!Number.isFinite(secs) || secs <= 0) return;
    createTimerMutation(label.trim() || "Timer", Math.round(secs * 1000), localStore);
    setLabel("");
    setSeconds("60");
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border-subtle bg-surface-1 px-2 py-1 text-body text-text-primary"
          placeholder="Label"
          aria-label="Timer label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="w-20 rounded-md border border-border-subtle bg-surface-1 px-2 py-1 text-body tabular-nums text-text-primary"
          placeholder="sec"
          aria-label="Timer seconds"
          inputMode="numeric"
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
        />
        <button type="button" onClick={create} className="rounded-md bg-surface-2 px-3 py-1 text-small text-text-primary">
          Add timer
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {timers.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-body text-text-primary">{t.label}</div>
              <div className="text-small tabular-nums text-text-secondary">
                {t.state === "done" ? "Done" : formatDuration(timerRemainingMs(t, now))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">{controls(t)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function controls(t: CountdownTimer) {
  const btn = "rounded-sm bg-surface-1 px-2 py-1 text-small text-text-primary";
  if (t.state === "idle") {
    return <button type="button" className={btn} onClick={() => startTimerMutation(t.id, localStore)}>Start</button>;
  }
  if (t.state === "running") {
    return <button type="button" className={btn} onClick={() => pauseTimerMutation(t.id, localStore)}>Pause</button>;
  }
  if (t.state === "paused") {
    return (
      <>
        <button type="button" className={btn} onClick={() => resumeTimerMutation(t.id, localStore)}>Resume</button>
        <button type="button" className={btn} onClick={() => resetTimerMutation(t.id, localStore)}>Reset</button>
      </>
    );
  }
  // done
  return (
    <>
      <button type="button" className={btn} onClick={() => resetTimerMutation(t.id, localStore)}>Reset</button>
      <button type="button" className={btn} onClick={() => deleteTimerMutation(t.id, localStore)}>Delete</button>
    </>
  );
}
```

- [ ] **Step 3: Add the Timers tab** in `TimekitPanel.tsx`: add `{ id: "timers", label: "Timers" }` to `SECTIONS`, import `TimersSection`, and add `{section === "timers" && <TimersSection />}` in the body.

- [ ] **Step 4: Add the `new-timer` command + manifest entries** in `index.ts`:

```ts
    host.contribute.command("new-timer", () => openAt("timers"));
```

Extend the manifest `entities`, `mutationKinds`, and `commands`:

```ts
  entities: ["org.nexus.timekit/time-entry", "org.nexus.timekit/timer"],
```

```ts
  mutationKinds: [
    KIND.SET_ZONES, KIND.START_TRACKING, KIND.STOP_TRACKING, KIND.SET_ENTRY_NOTE, KIND.DELETE_ENTRY,
    KIND.CREATE_TIMER, KIND.START_TIMER, KIND.PAUSE_TIMER, KIND.RESUME_TIMER,
    KIND.COMPLETE_TIMER, KIND.RESET_TIMER, KIND.DELETE_TIMER,
  ],
```

```ts
      { id: "new-timer", title: "New timer", icon: "clock" },
```

- [ ] **Step 5: Extend the registration test.** Append:

```ts
  it("declares the timer entity and a new-timer command", () => {
    registerTimekitModule();
    const m = getModule(TIMEKIT_MODULE_ID);
    expect(m?.entities).toContain("org.nexus.timekit/timer");
    expect(m?.mutationKinds).toContain("org.nexus.timekit/COMPLETE_TIMER");
    expect(listModuleCommands().find((c) => c.key === "org.nexus.timekit:new-timer")?.spec.title).toBe("New timer");
  });
```

- [ ] **Step 6: Run the Stage-3 gate.**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/modules/timekit/hooks.ts src/modules/timekit/TimersSection.tsx src/modules/timekit/TimekitPanel.tsx src/modules/timekit/index.ts src/modules/timekit/__tests__/registration.test.ts
git commit -m "feat(timekit): Timers section + new-timer command"
```

**Stage 3 done when:** a countdown can be created, started/paused/resumed/reset, and a running timer auto-completes via the 1s worker (toast + chime), recorded as `source:"module"` and undoable. Gate green.

---

## Stage 4 — Alarms

Adds the `Alarm` entity, its mutations, the Alarms section, `dueAlarms` reusing the tick worker, the `new-alarm` command, and the module's single Playwright e2e.

### Task 4.1: `Alarm` type + factory + store projection

**Files:**
- Modify: `src/data/types.ts`
- Modify: `src/modules/timekit/model.ts`
- Modify: `src/storage/local.ts`

**Interfaces:**
- Produces: `Alarm`; `makeAlarm(input, vaultId, now): Alarm`; `LocalStore.alarms`, `putAlarm`, `deleteAlarm`.

- [ ] **Step 1: Add the type** to `src/data/types.ts`:

```ts
export interface Alarm {
  id: string;
  vaultId: string;
  label: string;
  fireAt: number;             // epoch ms
  enabled: boolean;
  firedAt: number | null;     // null = not yet fired
  createdAt: number;
}
```

- [ ] **Step 2: Add the factory** to `src/modules/timekit/model.ts`:

```ts
import type { Alarm } from "@/data/types";

/** Build an Alarm from partial input (label + fireAt required). */
export function makeAlarm(
  input: Partial<Alarm> & { label: string; fireAt: number },
  vaultId: string,
  now: number,
): Alarm {
  return {
    id: input.id ?? tkId("al"),
    vaultId,
    label: input.label,
    fireAt: input.fireAt,
    enabled: input.enabled ?? true,
    firedAt: input.firedAt ?? null,
    createdAt: input.createdAt ?? now,
  };
}
```

- [ ] **Step 3: Add the store projection** to `src/storage/local.ts` (import `Alarm`; Map after `countdownTimers`; clear in `hydrate()`; CRUD):

```ts
  alarms = new Map<string, Alarm>();
```

```ts
    this.alarms.clear();
```

```ts
  putAlarm(a: Alarm): void {
    this.alarms.set(a.id, a);
    this._notify();
  }

  deleteAlarm(id: string): void {
    this.alarms.delete(id);
    this._notify();
  }
```

- [ ] **Step 4: Verify it compiles.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/data/types.ts src/modules/timekit/model.ts src/storage/local.ts
git commit -m "feat(timekit): Alarm type, factory, store projection"
```

### Task 4.2: Alarm mutations + reducer + inverse

**Files:**
- Modify: `src/modules/timekit/mutations.ts`
- Modify: `src/modules/timekit/reducer.ts`
- Test: `src/modules/timekit/__tests__/dataLayer.test.ts` (extend)

**Interfaces:**
- Produces: `KIND.CREATE_ALARM|SET_ALARM_ENABLED|FIRE_ALARM|DELETE_ALARM`; `createAlarmMutation(label, fireAt, store): Alarm`; `setAlarmEnabledMutation(id, enabled, store)`; `fireAlarmMutation(id, store, opts?)`; `deleteAlarmMutation(id, store)`.

- [ ] **Step 1: Write the failing tests.** Append to `dataLayer.test.ts`:

```ts
import {
  createAlarmMutation, setAlarmEnabledMutation, fireAlarmMutation, deleteAlarmMutation,
} from "@/modules/timekit/mutations";

describe("timekit alarms", () => {
  it("create → toggle enabled → fire → delete", () => {
    const s = wire();
    const a = createAlarmMutation("Standup", 5_000, s);
    expect(s.alarms.get(a.id)?.enabled).toBe(true);
    setAlarmEnabledMutation(a.id, false, s);
    expect(s.alarms.get(a.id)?.enabled).toBe(false);
    fireAlarmMutation(a.id, s);
    expect(s.alarms.get(a.id)?.firedAt).not.toBeNull();
    deleteAlarmMutation(a.id, s);
    expect(s.alarms.has(a.id)).toBe(false);
  });

  it("undo of fire restores firedAt = null", () => {
    const s = wire();
    const a = createAlarmMutation("X", 1_000, s);
    fireAlarmMutation(a.id, s);
    undoLastMutation(s);
    expect(s.alarms.get(a.id)?.firedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to confirm they fail.**

Run: `pnpm test -- dataLayer`
Expected: FAIL — missing alarm mutation exports.

- [ ] **Step 3: Extend `mutations.ts`.** Import `Alarm` and `makeAlarm`; extend `KIND`:

```ts
  CREATE_ALARM: `${TIMEKIT_NS}/CREATE_ALARM`,
  SET_ALARM_ENABLED: `${TIMEKIT_NS}/SET_ALARM_ENABLED`,
  FIRE_ALARM: `${TIMEKIT_NS}/FIRE_ALARM`,
  DELETE_ALARM: `${TIMEKIT_NS}/DELETE_ALARM`,
```

Add helpers:

```ts
export function createAlarmMutation(label: string, fireAt: number, store: LocalStore): Alarm {
  const a = makeAlarm({ label, fireAt }, store.vault?.id ?? "local", Date.now());
  recordMutation(KIND.CREATE_ALARM, a, store);
  return a;
}

export function setAlarmEnabledMutation(id: string, enabled: boolean, store: LocalStore): void {
  recordMutation(KIND.SET_ALARM_ENABLED, { id, enabled }, store);
}

/** Mark an alarm fired. The tick worker passes { source: "module" }; manual calls omit it. */
export function fireAlarmMutation(id: string, store: LocalStore, opts?: TimekitOpts): void {
  recordMutation(KIND.FIRE_ALARM, { id, firedAt: Date.now() }, store, opts);
}

export function deleteAlarmMutation(id: string, store: LocalStore): void {
  recordMutation(KIND.DELETE_ALARM, { id }, store);
}
```

Extend `timekitInverse`:

```ts
    case KIND.CREATE_ALARM: {
      const a = payload as Alarm;
      return { reverseSteps: [{ kind: KIND.DELETE_ALARM, payload: { id: a.id } }], description: "Create alarm" };
    }
    case KIND.SET_ALARM_ENABLED: {
      const p = payload as { id: string };
      const prev = s.alarms.get(p.id);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.SET_ALARM_ENABLED, payload: { id: p.id, enabled: prev.enabled } }], description: "Toggle alarm" };
    }
    case KIND.FIRE_ALARM: {
      const p = payload as { id: string };
      const prev = s.alarms.get(p.id);
      if (!prev) return null;
      // Restore prior firedAt (null ⇒ un-fire).
      return { reverseSteps: [{ kind: KIND.FIRE_ALARM, payload: { id: p.id, firedAt: prev.firedAt } }], description: "Fire alarm" };
    }
    case KIND.DELETE_ALARM: {
      const p = payload as { id: string };
      const prev = s.alarms.get(p.id);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.CREATE_ALARM, payload: prev }], description: "Delete alarm" };
    }
```

- [ ] **Step 4: Extend `reducer.ts`.** Import `Alarm`; add a `patchAlarm` helper and cases:

```ts
function patchAlarm(s: LocalStore, id: string, change: Partial<Alarm>): void {
  const prev = s.alarms.get(id);
  if (!prev) return;
  s.putAlarm({ ...prev, ...change });
}
```

```ts
      case "org.nexus.timekit/CREATE_ALARM":
        s.putAlarm(payload as Alarm);
        break;
      case "org.nexus.timekit/SET_ALARM_ENABLED": {
        const p = payload as { id: string; enabled: boolean };
        patchAlarm(s, p.id, { enabled: p.enabled });
        break;
      }
      case "org.nexus.timekit/FIRE_ALARM": {
        const p = payload as { id: string; firedAt: number | null };
        patchAlarm(s, p.id, { firedAt: p.firedAt });
        break;
      }
      case "org.nexus.timekit/DELETE_ALARM": {
        const p = payload as { id: string };
        s.deleteAlarm(p.id);
        break;
      }
```

- [ ] **Step 5: Run the tests to confirm they pass.**

Run: `pnpm test -- dataLayer`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/modules/timekit/mutations.ts src/modules/timekit/reducer.ts src/modules/timekit/__tests__/dataLayer.test.ts
git commit -m "feat(timekit): alarm mutations, reducer, inverse"
```

### Task 4.3: `dueAlarms` + extend the tick worker

**Files:**
- Modify: `src/modules/timekit/ticker.ts`
- Test: `src/modules/timekit/__tests__/ticker.test.ts` (extend)

**Interfaces:**
- Produces: `dueAlarms(now: number, alarms: Iterable<Alarm>): Alarm[]`; `startTimekitTicker` also fires alarms.

- [ ] **Step 1: Write the failing tests.** Append to `ticker.test.ts`:

```ts
import { createAlarmMutation, fireAlarmMutation } from "@/modules/timekit/mutations";
import { dueAlarms } from "@/modules/timekit/ticker";

describe("dueAlarms", () => {
  it("returns enabled, unfired, past-due alarms; excludes disabled/future/fired", () => {
    const s = wire();
    const due = createAlarmMutation("Due", 1_000, s);
    const future = createAlarmMutation("Future", 10_000, s);
    const disabled = createAlarmMutation("Off", 1_000, s);
    setAlarmEnabledMutation(disabled.id, false, s);

    expect(dueAlarms(5_000, s.alarms.values()).map((a) => a.id)).toEqual([due.id]);
    expect(future).toBeDefined();
  });

  it("provenance + idempotency: firing with source:'module' sets firedAt and drops it from due", () => {
    const s = wire();
    const a = createAlarmMutation("Due", 1_000, s);
    fireAlarmMutation(a.id, s, { source: "module" });
    expect(getUndoHistory()[0]?.source).toBe("module");
    expect(dueAlarms(5_000, s.alarms.values())).toEqual([]);
  });
});
```

> `setAlarmEnabledMutation` is already imported in this file via the earlier alarm test block; if not, add it to the existing `@/modules/timekit/mutations` import.

- [ ] **Step 2: Run them to confirm they fail.**

Run: `pnpm test -- ticker`
Expected: FAIL — missing `dueAlarms`.

- [ ] **Step 3: Extend `ticker.ts`.** Add the import and the pure function, and extend the interval loop:

```ts
import type { Alarm, CountdownTimer } from "@/data/types";
import { completeTimerMutation, fireAlarmMutation } from "@/modules/timekit/mutations";
```

```ts
/** Enabled, not-yet-fired alarms whose fire time has passed. Pure. */
export function dueAlarms(now: number, alarms: Iterable<Alarm>): Alarm[] {
  const out: Alarm[] = [];
  for (const a of alarms) {
    if (a.enabled && a.firedAt == null && a.fireAt <= now) out.push(a);
  }
  return out;
}
```

In `startTimekitTicker`, after the timers loop and before the `}, 1000)`:

```ts
    for (const a of dueAlarms(now, store.alarms.values())) {
      fireAlarmMutation(a.id, store, { source: "module" });
      toast(`Alarm: ${a.label}`);
      chime();
    }
```

- [ ] **Step 4: Run the tests to confirm they pass.**

Run: `pnpm test -- ticker`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/timekit/ticker.ts src/modules/timekit/__tests__/ticker.test.ts
git commit -m "feat(timekit): dueAlarms + tick worker fires alarms (source:module)"
```

### Task 4.4: Alarms section + hook + `new-alarm` command

**Files:**
- Modify: `src/modules/timekit/hooks.ts`
- Create: `src/modules/timekit/AlarmsSection.tsx`
- Modify: `src/modules/timekit/TimekitPanel.tsx`
- Modify: `src/modules/timekit/index.ts`
- Modify: `src/modules/timekit/__tests__/registration.test.ts` (extend)

**Interfaces:**
- Produces: `useAlarms(): Alarm[]`; `AlarmsSection`; `new-alarm` command; panel `alarms` tab.

- [ ] **Step 1: Extend hooks.** Append to `hooks.ts`:

```ts
import type { Alarm } from "@/data/types";

/** All alarms, soonest fireAt first. */
export function useAlarms(): Alarm[] {
  const v = useStoreVersion();
  return useMemo(
    () => Array.from(localStore.alarms.values()).sort((a, b) => a.fireAt - b.fireAt),
    [v],
  );
}
```

- [ ] **Step 2: Create `src/modules/timekit/AlarmsSection.tsx`:**

```tsx
import { useState } from "react";
import { localStore } from "@/storage/local";
import { useAlarms } from "@/modules/timekit/hooks";
import { createAlarmMutation, setAlarmEnabledMutation, deleteAlarmMutation } from "@/modules/timekit/mutations";
import { formatClock } from "@/modules/timekit/time";

/** Create and toggle alarms. Firing happens in the tick worker. */
export function AlarmsSection() {
  const alarms = useAlarms();
  const [label, setLabel] = useState("");
  const [time, setTime] = useState(""); // "HH:MM" from <input type="time">

  function create() {
    if (!time) return;
    const [h, m] = time.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    let fireAt = d.getTime();
    if (fireAt <= Date.now()) fireAt += 24 * 60 * 60 * 1000; // next occurrence today/tomorrow
    createAlarmMutation(label.trim() || "Alarm", fireAt, localStore);
    setLabel("");
    setTime("");
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border-subtle bg-surface-1 px-2 py-1 text-body text-text-primary"
          placeholder="Label"
          aria-label="Alarm label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          type="time"
          className="rounded-md border border-border-subtle bg-surface-1 px-2 py-1 text-body text-text-primary"
          aria-label="Alarm time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <button type="button" onClick={create} className="rounded-md bg-surface-2 px-3 py-1 text-small text-text-primary">
          Add alarm
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {alarms.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-body text-text-primary">{a.label}</div>
              <div className="text-small tabular-nums text-text-secondary">
                {formatClock(a.fireAt)}{a.firedAt != null ? " · fired" : ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="rounded-sm bg-surface-1 px-2 py-1 text-small text-text-primary"
                aria-pressed={a.enabled}
                onClick={() => setAlarmEnabledMutation(a.id, !a.enabled, localStore)}
              >
                {a.enabled ? "On" : "Off"}
              </button>
              <button
                type="button"
                className="rounded-sm bg-surface-1 px-2 py-1 text-small text-text-primary"
                aria-label={`Delete ${a.label}`}
                onClick={() => deleteAlarmMutation(a.id, localStore)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Add the Alarms tab** in `TimekitPanel.tsx`: add `{ id: "alarms", label: "Alarms" }` to `SECTIONS`, import `AlarmsSection`, add `{section === "alarms" && <AlarmsSection />}`.

- [ ] **Step 4: Add the `new-alarm` command + manifest entries** in `index.ts`:

```ts
    host.contribute.command("new-alarm", () => openAt("alarms"));
```

```ts
  entities: ["org.nexus.timekit/time-entry", "org.nexus.timekit/timer", "org.nexus.timekit/alarm"],
```

Add the four alarm kinds to `mutationKinds`, and:

```ts
      { id: "new-alarm", title: "New alarm", icon: "clock" },
```

- [ ] **Step 5: Extend the registration test.** Append:

```ts
  it("declares the alarm entity and a new-alarm command", () => {
    registerTimekitModule();
    const m = getModule(TIMEKIT_MODULE_ID);
    expect(m?.entities).toContain("org.nexus.timekit/alarm");
    expect(m?.mutationKinds).toContain("org.nexus.timekit/FIRE_ALARM");
    expect(listModuleCommands().find((c) => c.key === "org.nexus.timekit:new-alarm")?.spec.title).toBe("New alarm");
  });
```

- [ ] **Step 6: Run the Stage-4 unit gate.**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/modules/timekit/hooks.ts src/modules/timekit/AlarmsSection.tsx src/modules/timekit/TimekitPanel.tsx src/modules/timekit/index.ts src/modules/timekit/__tests__/registration.test.ts
git commit -m "feat(timekit): Alarms section + new-alarm command"
```

### Task 4.5: e2e — tracker flow + countdown auto-complete

**Files:**
- Modify: `e2e/fixtures.ts`
- Create: `e2e/timekit.spec.ts`

**Interfaces:**
- Consumes: the running web app (`pnpm dev` on :1420 via `playwright.config.ts`); the command palette; the live tick worker (Concern A: started in `initWeb`).

- [ ] **Step 1: Add the panel-open helper** to `e2e/fixtures.ts` (after `openTasksPanel`):

```ts
/** Open the Timekit dock panel via the command palette. */
export async function openTimekitPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Command palette" }).click();
  const input = page.getByPlaceholder("Search mail, contacts, or type a command…");
  await input.fill("Open Clock");
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "Clock" })).toBeVisible();
}
```

- [ ] **Step 2: Create `e2e/timekit.spec.ts`:**

```ts
import { test, expect, openTimekitPanel } from "./fixtures";

test("track time: start then stop produces an entry with a duration", async ({ page }) => {
  await openTimekitPanel(page);

  // Switch to the Tracker section.
  await page.getByRole("button", { name: "Tracker", exact: true }).click();

  await page.getByRole("button", { name: "Start tracking" }).click();
  // A Stop control appears while running.
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();

  // Let at least one second of elapsed accrue, then stop.
  await page.waitForTimeout(1100);
  await stop.click();

  // A finished entry now shows a Delete control (only present on stopped rows).
  await expect(page.getByRole("button", { name: "Delete entry" }).first()).toBeVisible();
});

test("countdown: a short timer auto-completes via the tick worker", async ({ page }) => {
  await openTimekitPanel(page);

  await page.getByRole("button", { name: "Timers", exact: true }).click();

  await page.getByLabel("Timer label").fill("Quick");
  await page.getByLabel("Timer seconds").fill("1");
  await page.getByRole("button", { name: "Add timer" }).click();

  // Start it; the 1s worker should flip it to "Done" within a few ticks.
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({ timeout: 8000 });
});
```

> If `openTimekitPanel`/section buttons need disambiguation (e.g. multiple "Clock" headings), the implementer may scope queries to the panel container. Keep assertions behavior-based.

- [ ] **Step 3: Run the e2e.**

Run: `pnpm e2e -- timekit`
Expected: PASS (both specs). If Playwright browsers are missing, run `npx playwright install` first.

- [ ] **Step 4: Run the full final gate.**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm e2e`
Expected: all PASS (`benchmark.test.ts` flake caveat applies — re-run in isolation if it's the only failure).

- [ ] **Step 5: Commit.**

```bash
git add e2e/fixtures.ts e2e/timekit.spec.ts
git commit -m "test(e2e): timekit tracker + countdown auto-complete flows"
```

**Stage 4 done when:** alarms can be created/toggled, fire via the worker (toast + chime, `source:"module"`, undoable), and both e2e flows pass. Full gate green.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-22-timekit-module-design.md`):

- §1 decisions 1–6 (scope, in-app toast+chime firing, main-window tick worker, live-computed displays, one 4-tab panel, `source:"module"` auto-fire) → Stages 1–4; firing/worker = Tasks 3.4–3.5, 4.3.
- §2 entities (`TimeEntry`/`CountdownTimer`/`Alarm`; Clock has no entity, zones via `SET_TIMEKIT_ZONES`) → Tasks 1.1–1.2, 2.1, 3.1, 4.1; derived helpers → Tasks 2.4, 3.3.
- §3 store Maps + zones, rebuilt by `replayRegisteredModules`, not snapshotted, cleared in reset → Tasks 1.1, 2.2, 3.1, 4.1.
- §4 namespaced granular kinds + reducer + inverse, record-time timestamps, undoable auto-fire tagged `source:"module"` → Tasks 1.2, 2.3, 3.2, 4.2; provenance asserted Tasks 3.4, 4.3.
- §5 tick worker: pure `dueTimers`/`dueAlarms`, thin `startTimekitTicker` (setInterval 1s, toast + Web-Audio chime), main-window gating, idempotency → Tasks 3.4, 3.5, 4.3. **Web-mode wiring reconciled (Concern A) — wired in `initWeb` + `initTauri` isMain.**
- §6 one dock panel, 4 tabbed sections, 1s display interval per section (no mutations), non-detachable, commands open/start-tracking/new-timer/new-alarm → Tasks 1.5, 2.5, 3.6, 4.4 + panelState focus mechanism.
- §7 `TimeEntry --tracks--> Task` atomic start-with-task, `entryTrackedTask`, reuse `createLink`/`linksFrom` → Task 2.3.
- §8 pure helpers `entryElapsedMs`/`timerEndsAt`/`timerRemainingMs`/`formatDuration`/`formatClock`/`dueTimers`/`dueAlarms`/`entryTrackedTask`, components thin → Tasks 1.3, 2.4, 3.3, 3.4, 4.3.
- §9 module registration (manifest id/namespace/entities/kinds/capabilities/trust/surfaces/commands), `registerTimekitModule`, bootstrap, ticker started from `main.tsx` not module setup → Tasks 1.6, 2.5, 3.5, 3.6, 4.4.
- §10 staging (Clock → Tracker → Timers → Alarms), each independently green → the four stages.
- §11 tests: pure helpers, reducers/inverse round-trips, provenance via `getUndoHistory()[0].source`, links atomicity, tick-worker due/idempotency, e2e (tracker + countdown auto-complete) → tests across all stages, e2e Task 4.5.
- §12 out-of-scope (OS notifications, recurrence, ambient pill, scheduled-task contribution point, true background scheduling, rich world-clock, per-task rollups, sound settings) → not built; ticker documented as the stand-in for the deferred scheduled-task handler.

**Placeholder scan:** none — every code/test step carries complete content; no "TBD"/"similar to"/"add error handling".

**Type consistency:** `KIND.*` names are stable across stages; `startTrackingWithTask` links `srcType: TIME_ENTRY_ENTITY` → `dstType: "org.nexus.tasks/task"`; `entryTrackedTask` reads the same `"tracks"` edge; `TimekitOpts` is the single opts type used by `completeTimerMutation`/`fireAlarmMutation`; reducer string literals match `KIND` values; `timekitInverse`'s `payload` param (renamed from `_payload` in Task 2.3) is used consistently.
