# `org.nexus.timekit` Module — Clock / Time-tracker / Timer / Alarms — Design Spec

> **Status:** Approved design (brainstorm complete). Phase 1, substrate §11.3 (the Clock/Timer/Time-tracker module, after the AI tracer-bullet).
> **Builds on:** `docs/substrate-design.md` (§11.3 the module; §7.2 the headless + dock surfaces and the deferred "scheduled-task handler" contribution point; §4.4 provenance — first consumer of `source:"module"`). Mirrors the Tasks/Notes module pattern (`src/modules/{tasks,notes}/`).
> **Next:** writing-plans → subagent-driven implementation (staged).

## 0. Goal

Ship the time module as the next greenfield consumer of the substrate. It carries two pieces of real substrate value: **time entries `tracks`-linked to Tasks** (dogfoods the links graph across modules), and **auto-fire mutations tagged `source:"module"`** (the first consumer of that provenance source — system-generated state changes the user didn't initiate). It also exercises the **headless + dock** combination (a background tick worker plus a panel) within a single module.

Scope (the "fuller suite" chosen at brainstorm): a Clock, a Time-tracker, Countdown Timers, and Alarms — in one module, **staged** so each sub-feature is independently shippable.

## 1. Decisions (locked during brainstorming)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Scope | **Clock + Time-tracker + Countdown timers + Alarms** (one module) | The user chose the fuller suite; built staged. |
| 2 | Firing (timer-done / alarm-due) | **In-app toast (sonner) + chime**, emitted by a main-window tick worker; the state change is a mutation tagged `source:"module"` | Deterministic, testable, works in web/e2e, no new Tauri/OS infra. OS-notification upgrade deferred. |
| 3 | Tick worker location | **Main-window-only**, wired via `main.tsx`'s `isMain` block (`startTimekitTicker(store)`), gated like `startWatcher` | The deferred "scheduled-task handler" contribution point (§7.2) is its proper future home; documented, not built. |
| 4 | Running displays | **Computed live in the UI** from timestamps; only start/stop/pause/complete/fire are mutations | No per-second mutation flooding; a running entry survives restart for free (event-sourced). |
| 5 | Panel shape | **One dock panel with four tabbed sections** (Clock · Tracker · Timers · Alarms) | Cohesive; one "Open Clock" command + quick commands. |
| 6 | Provenance of auto-fire | **`source:"module"`** on `COMPLETE_TIMER`/`FIRE_ALARM` | First real consumer of the §4.4 `"module"` source; user actions stay default `"user"`. |

## 2. Entities (`src/data/types.ts`)

```ts
export interface TimeEntry {
  id: string;
  vaultId: string;
  startedAt: number;          // epoch ms
  stoppedAt: number | null;   // null = running
  note: string | null;
  createdAt: number;
}

export type CountdownState = "idle" | "running" | "paused" | "done";
export interface CountdownTimer {
  id: string;
  vaultId: string;
  label: string;
  durationMs: number;
  startedAt: number | null;   // when the current run began; null when idle/paused
  elapsedBeforeMs: number;    // accumulated elapsed across prior runs (for pause/resume)
  state: CountdownState;
  createdAt: number;
}

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

Derived (pure helpers, never stored): a running `TimeEntry`'s elapsed = `now − startedAt`; a running `CountdownTimer`'s `endsAt = startedAt + (durationMs − elapsedBeforeMs)` and `remainingMs = endsAt − now`. **Clock** has no entity — the panel shows live local time plus a user-managed list of IANA timezone strings (saved via a small `SET_TIMEKIT_ZONES` mutation; the zone list is module config, not an entity).

## 3. Store & hydration

`src/storage/local.ts`: add `timeEntries`, `countdownTimers`, `alarms` Maps (+ `putX`/`deleteX` helpers calling `_notify()`), and a `timekitZones: string[]` (default `[]`). All event-sourced projections rebuilt by the existing `replayRegisteredModules`. No vault-snapshot persistence. Clear them in the reset path alongside the existing maps.

## 4. Mutations + undo (Pillar 1)

Namespaced `org.nexus.timekit/`. Per entity, granular kinds with reducer + inverse (mirrors Tasks/Notes); helpers stamp timestamps at record-time.

| Area | Kinds | Notes |
|---|---|---|
| Tracker | `START_TRACKING` (creates a running TimeEntry, optional `taskId` → atomic `tracks` link), `STOP_TRACKING` ({id, stoppedAt}), `SET_ENTRY_NOTE`, `DELETE_ENTRY` | `START_TRACKING` with a `taskId` uses `recordMutations([CREATE, CREATE_LINK])` (atomic, like `createTaskFromEntity`). |
| Timer | `CREATE_TIMER`, `START_TIMER`, `PAUSE_TIMER`, `RESUME_TIMER`, `COMPLETE_TIMER`, `RESET_TIMER`, `DELETE_TIMER` | `COMPLETE_TIMER` emitted by the tick worker with `source:"module"`; also reachable manually. |
| Alarm | `CREATE_ALARM`, `SET_ALARM_ENABLED`, `FIRE_ALARM`, `DELETE_ALARM` | `FIRE_ALARM` ({id, firedAt}) emitted by the worker with `source:"module"`. |
| Clock | `SET_TIMEKIT_ZONES` ({zones}) | Replaces the saved-zone list; inverse restores the prior list. |

Inverses captured pre-mutation (the established pattern). `COMPLETE_TIMER`/`FIRE_ALARM` are undoable (inverse restores prior state) so a mis-fire can be reverted; they're tagged `source:"module"` so history shows them as system-generated.

## 5. The tick worker (`src/modules/timekit/ticker.ts`)

- **Pure core (Node-tested):** `dueTimers(now, timers): CountdownTimer[]` (running timers whose `endsAt ≤ now`), `dueAlarms(now, alarms): Alarm[]` (enabled, `firedAt null`, `fireAt ≤ now`).
- **Thin wrapper:** `startTimekitTicker(store): () => void` sets a `setInterval(1000)` that, each tick, computes due timers/alarms (with `now = Date.now()`) and for each emits the completion/fire mutation (`source:"module"`) then fires a toast (`sonner`) + a chime (a short Web-Audio beep via `AudioContext`; guarded for environments without it). Returns a disposer.
- **Gating:** invoked from `src/main.tsx` inside the existing `isMain` background-workers block (alongside `startWatcher`/`startGoogleAutoSync`), so it runs once, in the main window only. Not started in pop-outs or web-mode-without-main (it's safe in web mode — `isMain` is true there).
- **Idempotency:** firing emits a state mutation that flips the item out of the "due" set (timer→done, alarm→firedAt set), so the next tick won't re-fire. The pure due-functions must therefore only return not-yet-fired items.

## 6. Panel UI (`src/modules/timekit/`)

One dock panel `TimekitPanel` with a section switcher (Clock · Tracker · Timers · Alarms):
- **Clock:** live local time (a 1s UI interval) + a list of saved zones (each showing that zone's current time via `Intl.DateTimeFormat`); add/remove zone.
- **Tracker:** a Start control (optional Task picker) → running entry with live elapsed + Stop; a list of past entries (duration, note, tracked task) with total.
- **Timers:** create a timer (label + duration); each shows live remaining + start/pause/resume/reset; a done timer shows a completed state.
- **Alarms:** create an alarm (label + time); toggle enabled; fired alarms show a fired state.

Live displays use a single 1s UI interval per mounted section (display only — never emits mutations). The panel is non-detachable (module panels). Commands: `open` ("Open Clock"), `start-tracking`, `new-timer`, `new-alarm`.

## 7. Links / cross-module

`TimeEntry` → Task via `linkType:"tracks"` (`TIME_ENTRY_ENTITY = "org.nexus.timekit/time-entry"`). The Tracker shows the tracked Task (`linksFrom(entry)`); a Task's tracked entries are the reverse (`linksTo(TASK_ENTITY, taskId, "tracks")`) — surfaced minimally in the Tracker (a "tracked time" total per task is a later refinement). Reuses `createLink`/`linksFrom`/`linksTo`.

## 8. Pure helpers (Node-tested, per testing policy)

`src/modules/timekit/time.ts`: `entryElapsedMs(entry, now)`, `timerEndsAt(t)`, `timerRemainingMs(t, now)`, `formatDuration(ms)` (h:mm:ss), `formatClock(now, zone?)`. `src/modules/timekit/ticker.ts`: `dueTimers`/`dueAlarms`. `src/modules/timekit/links.ts`: `entryTrackedTask(store, entryId)`. Components stay thin wrappers.

## 9. Module registration

`src/modules/timekit/index.ts`: manifest `id`/`namespace` `org.nexus.timekit`, `entities: ["org.nexus.timekit/time-entry", ".../timer", ".../alarm"]`, `mutationKinds: [...all]`, `capabilities: { "ui.contribute": ["dock", "command"] }`, `trust: "core"`, `contributes.surfaces: [{ type:"dock", id:"timekit.main", title:"Clock", icon:"clock", detachable:false }]`, `contributes.commands: [open, start-tracking, new-timer, new-alarm]`. `registerTimekitModule()` wires reducer + inverse + surface + commands. Registered in `src/modules/bootstrap.ts`. The ticker is started separately from `main.tsx` (§5), not from module setup (which runs in every window).

## 10. Staging (single spec, staged plan)

Each stage independently green (mirrors Tasks' staging):
1. **Clock** — store zones + `SET_TIMEKIT_ZONES` + the panel shell with the Clock section + module registration + the "Open Clock" command. Smallest; proves the panel + module.
2. **Time-tracker** — `TimeEntry` + start/stop/note/delete + the `tracks` link (atomic start-with-task) + the Tracker section + `start-tracking` command.
3. **Countdown timers** — `CountdownTimer` + its mutations + the Timers section + **the tick worker** (`dueTimers`, `startTimekitTicker`, `main.tsx` wiring) + `source:"module"` completion + toast/chime + `new-timer` command.
4. **Alarms** — `Alarm` + its mutations + the Alarms section + `dueAlarms` reusing the tick worker + `new-alarm` command.

## 11. Testing (per `docs/testing-policy.md`)

- **Pure helpers (Node):** `entryElapsedMs`/`timerRemainingMs`/`formatDuration`/`formatClock`; `dueTimers`/`dueAlarms` (with injected `now` — due when `≤ now`, not-due otherwise, never returns already-fired items); `entryTrackedTask`.
- **Reducers/inverse (Node):** each kind applies; undo round-trips (start→stop→undo; timer state transitions; alarm fire→undo restores `firedAt null`; zone-list set/undo); record-time timestamps applied from payload.
- **Provenance (Node):** a worker-emitted `COMPLETE_TIMER`/`FIRE_ALARM` carries `source:"module"` (assert via `getUndoHistory()[0].source`).
- **Links (Node):** `START_TRACKING` with a `taskId` creates entry + `tracks` link atomically (one undo reverts both); `entryTrackedTask` resolves it.
- **Tick worker (Node):** drive `dueTimers`/`dueAlarms` against fixture state at controlled `now`; assert the right items fire; assert idempotency (a fired item isn't returned again after its state flips).
- **e2e (web mode):** start tracking → stop → an entry appears with a duration; create a short countdown (e.g. set `durationMs` small) → it auto-completes via the ticker and shows done (the ticker runs in web mode since `isMain` is true). Runtime-derived assertions.

## 12. Out of scope (→ later)

OS desktop notifications (toast→OS upgrade); alarm/timer **recurrence**; the **ambient-indicator** status-bar running pill (needs the status-bar micro-surface contribution point); a formal **scheduled-task contribution point** (the ticker is wired via `main.tsx` for now); true OS background scheduling (the app must be running); rich world-clock UI beyond the saved-zone list; per-task "tracked time" rollups; sound/volume settings.
