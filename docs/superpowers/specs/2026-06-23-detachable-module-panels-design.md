# Detachable Module Panels — Design Spec

> **Status:** Approved design (proceeding under the user's standing "continue through to completion" instruction; build-now / **user live-verifies before merge**).
> **Builds on:** `docs/module-authoring.md` (panel-migration gap #2 — detachable module panels); the popout system (`src-tauri/src/popout.rs`, `src/windows/PopoutHost.tsx`/`PopoutPanelHost.tsx`, `src/storage/tauri.ts`) and detached-window persistence (`src/state/workspace.ts`, `src/storage/workspaceManager.ts`). Closes gap #2 — the **last** of the four.
> **Next:** writing-plans → subagent-driven implementation.

## 0. Goal

Let a substrate module dock panel (Tasks / Notes / Timekit) **detach into its own OS window** like the core panels (viewer/inspector/list/contacts/calendar) already can, and **restore** across workspace switch / app restart. Today two guards block it: `detachPanelToWindow` returns early for module panel ids, and the per-tab `detachable` flag excludes them (`Workspace.tsx`), because a module's namespaced componentKey (`org.nexus.tasks:tasks.main`) isn't a valid `PopoutKind`.

## ⚠️ Verification note (read first)

This feature is **entirely Tauri-only** — `detachable` is gated on `isTauri()`, and popout windows are real OS windows created by Rust. **The web test/e2e harness cannot exercise it.** Automatable gates here are: Node unit tests for the pure payload helpers, plus `pnpm test && pnpm typecheck && pnpm lint` (regression). The actual behavior (detach → window renders the panel → restore) is verified by the **user running `pnpm tauri:dev`**. This branch is **not merged until that live verification passes.**

## 1. Key architectural fact (why this is TS-only)

`open_popout_window(kind, target_id, payload, geometry)` in `popout.rs` already accepts an **arbitrary `kind` string** and an **opaque `payload` string**; `default_size` has a catch-all arm, and the `capabilities/default.json` `popout-*` glob already covers `popout-module-*`. So a module popout is just `kind: "module"` with the module's componentKey carried in `payload`. **No Rust change is required.** All work is TypeScript.

## 2. Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Popout kind for modules | **`"module"`** (widen `PopoutKind`) | Single new kind; the componentKey rides in the opaque `payload`, not the kind. |
| 2 | What the payload carries | **`{ componentKey }` only** | Identifies which registered surface to render. (Params deliberately not carried in v1 — see §7.) |
| 3 | Render path | **A `"module"` case in `PopoutPanelHost`** that looks up `dockSurfaceComponents()[componentKey]` and renders it with a minimal stub `IDockviewPanelProps` (`{ params: {} }`) | Reuses the registry; current modules use only `props.params` (Timekit) or ignore props (Tasks/Notes). |
| 4 | Persistence | **`DetachedWindowSnapshot.componentKey?: string`** + `trackDetachedWindow` carries it; `restoreDetachedWindows` re-opens module windows | Parity with core detached panels (which restore). |
| 5 | No Rust change | Confirmed (§1) | Avoids building/verifying Rust blind. |

## 3. `PopoutKind` + payload helpers (`src/storage/tauri.ts`)

Widen the union:
```ts
export type PopoutKind =
  | "composer" | "viewer" | "inspector" | "list" | "contacts" | "calendar" | "settings"
  | "module";
```

Add pure helpers (Node-tested):
```ts
/** The shape carried in a "module" popout's opaque payload. */
export interface ModulePopoutPayload { componentKey: string; }

export function encodeModulePopoutPayload(p: ModulePopoutPayload): string {
  return JSON.stringify(p);
}

/** Parse a module popout payload; null on absent/invalid input. */
export function decodeModulePopoutPayload(payload: string | null | undefined): ModulePopoutPayload | null {
  if (!payload) return null;
  try {
    const v = JSON.parse(payload) as Partial<ModulePopoutPayload>;
    return typeof v?.componentKey === "string" && v.componentKey ? { componentKey: v.componentKey } : null;
  } catch {
    return null;
  }
}
```

## 4. Detach + the detachable flag (`src/components/Workspace.tsx`)

In `detachPanelToWindow(id)`, add a module branch **before** the existing core logic:
```ts
  if (isModulePanelId(id)) {
    const payload = encodeModulePopoutPayload({ componentKey: id });
    const label = await openPopoutWindow("module", { payload });
    useWorkspace.getState().trackDetachedWindow(label, "module", null, null, true, id);
    getDockviewApi()?.getPanel(id)?.api.close();
    return;
  }
```
(The existing `if (!moduleKey || moduleKey === "nav" || isModulePanelId(id)) return;` keeps its `isModulePanelId` clause as a safety net for the core path below — the new branch returns first, so it is never reached for module ids; leaving it avoids a behavior change to the core path.)

In `DockviewTab`, allow module panels to show the detach affordance — drop the `!isModulePanelId(...)` exclusion:
```ts
  const detachable = isTauri() && props.api.id.split("-")[0] !== "nav";
```
(Navigation stays non-detachable; module panels become detachable. `isModulePanelId` is no longer needed for this flag — remove it from the import if it becomes unused, otherwise leave it.)

## 5. Render the module panel in the popout (`src/windows/PopoutPanelHost.tsx`)

Add a `"module"` case to the `switch (kind)`:
```tsx
    case "module": {
      const env = /* the already-pulled PopoutEnvelope from takePopoutPayload */;
      const parsed = decodeModulePopoutPayload(env?.payload);
      const Comp = parsed ? dockSurfaceComponents()[parsed.componentKey] : undefined;
      if (!Comp) return <div className="flex h-full w-full items-center justify-center text-text-muted">Unsupported window type</div>;
      // Module surfaces are typed as dockview panel components; outside dockview we
      // supply a minimal stub (params only — current modules don't use the api).
      return <Comp {...({ params: {} } as unknown as IDockviewPanelProps)} />;
    }
```

> The component already pulls `env` via `takePopoutPayload(label)` in its mount effect; the `targetId` path stays for viewer/inspector. For `"module"` the host reads `env.payload`. The implementer wires the `env` into the render (e.g. store the pulled envelope in state alongside `ready`, or read `env.payload` where `targetId` is read). `dockSurfaceComponents` is imported from `@/modules/surfaceRegistry`; `decodeModulePopoutPayload` from `@/storage/tauri`; `IDockviewPanelProps` from `dockview`.

## 6. Persistence + restore

`src/storage/workspaceManager.ts` — extend the snapshot:
```ts
export interface DetachedWindowSnapshot {
  kind: PopoutKind;
  targetId: string | null;
  geometry: WindowGeometry | null;
  /** For kind "module": the dock-surface componentKey to re-open. */
  componentKey?: string;
}
```

`src/state/workspace.ts`:
- `trackDetachedWindow` gains a trailing optional `componentKey?: string`, stored in the snapshot:
  ```ts
  trackDetachedWindow: (label, kind, targetId, geometry = null, persist = true, componentKey) => {
    set((s) => ({ detachedWindows: { ...s.detachedWindows, [label]: { kind, targetId, geometry, componentKey } } }));
    if (persist) get().saveWorkspace();
  },
  ```
  (Update the interface signature at ~line 251 to match.)
- `restoreDetachedWindows` handles the module kind:
  ```ts
  for (const d of list) {
    if (d.kind === "composer") continue;
    const opts = d.kind === "module"
      ? { payload: encodeModulePopoutPayload({ componentKey: d.componentKey ?? "" }), geometry: d.geometry ?? undefined }
      : { targetId: d.targetId ?? undefined, geometry: d.geometry ?? undefined };
    if (d.kind === "module" && !d.componentKey) continue; // skip a corrupt module entry
    const label = await openPopoutWindow(d.kind, opts).catch(() => null);
    if (label) get().trackDetachedWindow(label, d.kind, d.targetId, d.geometry, persist, d.componentKey);
  }
  ```
  Import `encodeModulePopoutPayload` from `@/storage/tauri`.

## 7. Testing

- **Node** (`src/storage/__tests__/`, new or existing): `encodeModulePopoutPayload`/`decodeModulePopoutPayload` round-trip; `decode` returns null for `null`/`undefined`/`""`/non-JSON/JSON-without-componentKey.
- **Regression:** `pnpm test && pnpm typecheck && pnpm lint` green (the persistence/render wiring is typecheck-verified).
- **No web e2e** (Tauri-only; the web harness can't open OS windows — consistent with the testing policy's Tauri-only carve-out).
- **Live (user, `pnpm tauri:dev`) — the load-bearing check:** (a) the detach (⤢) affordance now shows on a module panel tab; (b) clicking it opens an OS window that renders the module panel; (c) the docked copy closes; (d) closing the popout untracks it (no ghost on restore); (e) with a detached module window open, switch workspaces and back / restart the app → the module window restores. Document these steps in the branch hand-off.

## 8. Out of scope (→ later)

- **Carrying live params** (e.g. detaching Timekit on its current section): v1 opens the module panel at default state. The payload is structured (`ModulePopoutPayload`) so a `params` field can be added later, threaded through persistence and the stub props.
- **Live dockview api in the popout:** the stub provides `params` only; a module that reads `props.api`/`containerApi` won't work detached (no current module does).
- **`--module-color` in the popout:** the popout host doesn't apply the group color wash; the detached module panel renders without it. Minor; deferred.
- No changes to core-panel detaching, the Rust popout layer, or capabilities.
