# Parameterized Module-Panel Launch — Design Spec

> **Status:** Approved design (brainstorm complete).
> **Builds on:** `docs/substrate-design.md` (Pillar 4 / §7.2 contribution points); `docs/module-authoring.md` ("Out of scope until platformization" gap #1 — parameterized launch). Closes that gap.
> **Next:** writing-plans → subagent-driven implementation.

## 0. Goal

Give module dock-panel launch a way to carry **runtime parameters**. Today `openModulePanel(componentKey, title)` can only say *which* panel to open, not *in what state* — so a command can open the Timekit panel but not "focused on the Timers tab," and a future Contacts module could not "open on this contact." This is the first of the four substrate gaps that block migrating the existing rich panels (Email/Calendar/Contacts) to modules.

Closing it also **retires the `panelState.ts` workaround** the Timekit module had to build: an ephemeral module-local pub/sub side-channel that exists only because launch couldn't pass a target section.

## 1. Decisions (locked during brainstorming)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Instance model | **Singleton + update** | A module surface is already a singleton (panel `id` === component key). Re-opening reuses the one panel and re-points it via `updateParameters`. Covers Timekit's need and the common "open X focused on Y" case. Multi-instance (option B) deferred — no module needs two live copies (YAGNI). |
| 2 | API surface | **Widen `openModulePanel` only** | Modules already call `useWorkspace.getState().openModulePanel(...)` directly (the established pattern). Add an optional 3rd `params` arg; no new `host.openPanel()` abstraction (scope creep). |
| 3 | Params channel to panels | **dockview-native `props.params`** | dockview already passes `params` into every panel via `IDockviewPanelProps`. No host machinery — this is exactly what `panelState` was hand-rolling. |
| 4 | Persistence | **dockview default (params serialized in `toJSON`)** | A parameterized panel restores with its last params after a workspace switch / app restart. For Timekit: reopens on the last-launched section. Acceptable/desirable; no special handling. |
| 5 | Param type | **`Record<string, unknown>` at our boundary** | dockview's `Parameters` is `Record<string, any>`; we expose `Record<string, unknown>` and each panel casts to its own shape. Matches the generic-host philosophy. |
| 6 | Proof + cleanup | **Refactor Timekit to use params; delete `panelState.ts`** | Proves the new capability with a real consumer and removes the workaround in the same change. |

## 2. Verified platform facts (dockview 1.17.2)

- `IDockviewPanelProps<T>` exposes `params: T` to the React panel component (`props.params`).
- `addPanel({ ..., params })` accepts launch params (`AddPanelOptions.params: Parameters`).
- `panel.api.updateParameters(params: Parameters)` pushes new params to an already-open panel; the React content part re-renders with the new `props.params`.
- `toJSON()` serializes params into the layout snapshot (so persistence is automatic).

## 3. The API change (`src/state/workspace.ts`)

Signature (in the `WorkspaceState` interface, ~line 209) gains an optional third arg:

```ts
openModulePanel: (componentKey: string, title: string, params?: Record<string, unknown>) => void;
```

Implementation (~line 849) — singleton + update:

```ts
openModulePanel: (componentKey, title, params) => {
  const api = getDockviewApi();
  if (!api) return;
  const existing = api.panels.find((p) => p.id === componentKey);
  if (existing) {
    existing.api.setActive();
    if (params) existing.api.updateParameters(params);
  } else {
    api.addPanel({
      id: componentKey,
      component: componentKey,
      title,
      params,
      minimumWidth: 360,
      position: { direction: "right" },
    });
  }
},
```

The 3rd arg is optional, so existing 2-arg callers (Tasks "Open Tasks", Notes "Open Notes") are unchanged.

## 4. Panel-side consumption

A panel reads its launch context from `props.params` with a typed cast:

```tsx
const { section } = (props.params ?? {}) as { section?: TimekitSection };
```

No host-side change — `DockSurfaceComponent = FunctionComponent<IDockviewPanelProps>` already carries `params`.

## 5. Timekit refactor (retire `panelState.ts`)

A launch is an **event** ("focus this section now"), not durable state, so it carries a monotonic **nonce** — this preserves the old `panelState` behavior, which notified listeners on *every* `requestSection` call regardless of whether the value changed. Without a nonce, re-firing a command for the *same* section after the user manually navigated away would not snap back (the param value is unchanged, so a value-keyed effect skips).

- **`src/modules/timekit/index.ts`:** drop the `panelState` import and the `requestSection(...)` call; `openAt` becomes:

  ```ts
  let _launchNonce = 0; // module-local; distinguishes each command launch
  function openAt(section: TimekitSection): void {
    _launchNonce += 1;
    useWorkspace.getState().openModulePanel(TIMEKIT_MAIN_PANEL_KEY, "Clock", { section, nonce: _launchNonce });
  }
  ```

- **`src/modules/timekit/TimekitPanel.tsx`:** drop `getRequestedSection`/`subscribeSection`; derive the active section from `props.params`, re-applying on each launch (nonce change) while user tab-clicks persist via local state:

  ```tsx
  const params = (props.params ?? {}) as { section?: TimekitSection; nonce?: number };
  const [section, setSection] = useState<TimekitSection>(params.section ?? "clock");
  // Re-focus on every command launch (nonce changes each fire) and on a section
  // change; manual tab clicks set local state and are not overridden. Both deps are
  // referenced in the body, so `exhaustive-deps` stays satisfied (lint is zero-warnings).
  useEffect(() => {
    if (params.section) setSection(params.section);
  }, [params.nonce, params.section]);
  ```

- **Move the `TimekitSection` type** out of `panelState.ts` into `TimekitPanel.tsx` (exported); `index.ts` imports it from there.
- **Delete `src/modules/timekit/panelState.ts`.**

Behavior parity (matches the old `panelState` exactly):
- Closed → command → opens on the requested section (`addPanel` with `params`; initial `useState` seed).
- Open on section X → command for section Y → switches (nonce + section both change → effect fires).
- Open on Y via command → user clicks X → **same** command re-fired → snaps back to Y (nonce changes even though section is unchanged).
- Manual tab clicks set local state and are never overridden by a stale param.

Persistence note: the nonce is serialized into the layout snapshot like any param; on restore the mount-time effect simply re-applies the saved section once — harmless.

## 6. Testing (per `docs/testing-policy.md`)

- **e2e (the gate):** extend `e2e/timekit.spec.ts` so the params path is asserted end-to-end:
  1. Running **"New timer"** opens the panel **already on the Timers section**, and **"New alarm"** lands on **Alarms** (without manually clicking the tab) — proves params drive initial focus.
  2. **Snap-back / nonce:** with the panel open and focused on Timers, click the **Clock** tab, then re-run **"New timer"** → the panel returns to **Timers**. This is the flow a value-only effect would miss, so it directly validates the launch nonce (the `panelState` parity behavior).
- **Pure unit:** the section-resolution is a one-line `requested ?? "clock"`; extract a tiny pure helper only if the plan finds it worthwhile. No RTL/jsdom. The `openModulePanel` store method itself calls the dockview api and is covered by the e2e, not a unit test.

## 7. Docs

- `docs/module-authoring.md`: in "Out of scope until platformization," mark gap **#1 (parameterized launch)** as **done**, noting `openModulePanel(key, title, params?)` + `props.params` and that the remaining migration blockers are #2 detachable module panels, #3 panel color, #4 global-shortcut binding.

## 8. Out of scope (→ later)

- The other three panel-migration gaps: detachable module panels (`isModulePanelId` guard), module panel color (`applyModuleColor`), global keyboard-shortcut binding for module commands.
- Multi-instance panels (decision #1 option B): a param discriminator in the panel id to allow two live copies of one surface.
- A `host.openPanel()` abstraction over `useWorkspace`.
- Actually migrating Email/Calendar/Contacts to modules (needs the other gaps too).
- Typed/validated params schemas per surface (params stay generic `Record<string, unknown>` in v1).
