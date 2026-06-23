# Detachable Module Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a substrate module dock panel detach into its own OS window (kind `"module"`, componentKey in the opaque payload) and restore across workspace switch / restart — closing panel-migration gap #2.

**Architecture:** Pure TypeScript (the Rust `open_popout_window` already takes an arbitrary `kind` + opaque `payload`; the `popout-*` capability covers `popout-module-*`). Widen `PopoutKind` with `"module"`; carry `{ componentKey }` in the payload (pure encode/decode helpers); `PopoutPanelHost` renders the registered surface for that componentKey; `detachPanelToWindow` + the per-tab `detachable` flag allow module ids; `DetachedWindowSnapshot.componentKey` + `restoreDetachedWindows` persist/restore.

**Tech Stack:** TypeScript, React 18, Tauri popout layer (`src/storage/tauri.ts` wrappers; `popout.rs` unchanged), dockview, Zustand (`useWorkspace`), Vitest (Node).

## ⚠️ Verification model (read first)

This feature is **Tauri-only** — the web test/e2e harness cannot open OS windows or exercise it. Automatable gates: **Node unit tests** for the payload helpers + `pnpm test && pnpm typecheck && pnpm lint` (regression). **No web e2e.** The behavior (detach → window renders the panel → restore) is verified by the **user running `pnpm tauri:dev`** after the build. **Do NOT merge or push** — this branch ends ready-for-live-verification.

## Global Constraints

- **No Rust change** (`popout.rs`, capabilities untouched). Pure TypeScript.
- **Module popout = `kind: "module"`**; the module's componentKey rides in the opaque `payload` (not the kind/label).
- **Payload helpers are pure / Node-tested**: `encodeModulePopoutPayload({ componentKey })` / `decodeModulePopoutPayload(payload)` (null on absent/invalid).
- **v1 carries no params** — a detached module panel opens at default state; the stub `IDockviewPanelProps` provides `params: {}` only (current modules use only `props.params` or ignore props).
- **Restore parity**: `DetachedWindowSnapshot.componentKey?` persists; `restoreDetachedWindows` re-opens module windows (and skips a module entry with no componentKey).
- **Navigation stays non-detachable;** module panels become detachable.
- **Testing** (`docs/testing-policy.md`): pure helpers → Node; Tauri-only UI → live (no web e2e). No RTL/jsdom.
- **Gates:** `pnpm test && pnpm typecheck && pnpm lint`. **Do not merge or push.**
- **Commits:** conventional, one per task. **No `Co-Authored-By` trailer.**

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/storage/tauri.ts` | Widen `PopoutKind`; `ModulePopoutPayload` + encode/decode | 1 |
| `src/storage/__tests__/popoutPayload.test.ts` | Node tests for the helpers (new) | 1 |
| `src/windows/PopoutPanelHost.tsx` | Render the `"module"` surface from the payload | 2 |
| `src/components/Workspace.tsx` | `detachPanelToWindow` module branch + `detachable` flag | 2 |
| `src/storage/workspaceManager.ts` | `DetachedWindowSnapshot.componentKey?` | 3 |
| `src/state/workspace.ts` | `trackDetachedWindow` carries componentKey; `restoreDetachedWindows` module branch | 3 |

---

### Task 1: `PopoutKind` + payload helpers

**Files:**
- Modify: `src/storage/tauri.ts`
- Create: `src/storage/__tests__/popoutPayload.test.ts`

**Interfaces:**
- Produces: `PopoutKind` includes `"module"`; `ModulePopoutPayload { componentKey: string }`; `encodeModulePopoutPayload(p): string`; `decodeModulePopoutPayload(payload: string | null | undefined): ModulePopoutPayload | null`.

- [ ] **Step 1: Write the failing tests.** Create `src/storage/__tests__/popoutPayload.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encodeModulePopoutPayload, decodeModulePopoutPayload } from "@/storage/tauri";

describe("module popout payload", () => {
  it("round-trips a componentKey", () => {
    const enc = encodeModulePopoutPayload({ componentKey: "org.nexus.tasks:tasks.main" });
    expect(decodeModulePopoutPayload(enc)).toEqual({ componentKey: "org.nexus.tasks:tasks.main" });
  });
  it("returns null for absent payloads", () => {
    expect(decodeModulePopoutPayload(null)).toBeNull();
    expect(decodeModulePopoutPayload(undefined)).toBeNull();
    expect(decodeModulePopoutPayload("")).toBeNull();
  });
  it("returns null for non-JSON", () => {
    expect(decodeModulePopoutPayload("not json")).toBeNull();
  });
  it("returns null for JSON without a string componentKey", () => {
    expect(decodeModulePopoutPayload(JSON.stringify({ foo: 1 }))).toBeNull();
    expect(decodeModulePopoutPayload(JSON.stringify({ componentKey: "" }))).toBeNull();
    expect(decodeModulePopoutPayload(JSON.stringify({ componentKey: 5 }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm test -- popoutPayload`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Widen `PopoutKind`.** In `src/storage/tauri.ts`, change the `PopoutKind` union to add `"module"`:

```ts
export type PopoutKind =
  | "composer"
  | "viewer"
  | "inspector"
  | "list"
  | "contacts"
  | "calendar"
  | "settings"
  | "module";
```

- [ ] **Step 4: Add the helpers.** In `src/storage/tauri.ts`, after the `PopoutEnvelope` interface / `takePopoutPayload`, add:

```ts
/** The shape carried in a "module" popout's opaque payload. */
export interface ModulePopoutPayload {
  componentKey: string;
}

export function encodeModulePopoutPayload(p: ModulePopoutPayload): string {
  return JSON.stringify(p);
}

/** Parse a module popout payload; null on absent/invalid input. */
export function decodeModulePopoutPayload(
  payload: string | null | undefined,
): ModulePopoutPayload | null {
  if (!payload) return null;
  try {
    const v = JSON.parse(payload) as Partial<ModulePopoutPayload>;
    return typeof v?.componentKey === "string" && v.componentKey
      ? { componentKey: v.componentKey }
      : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run to confirm pass.**

Run: `pnpm test -- popoutPayload`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/storage/tauri.ts src/storage/__tests__/popoutPayload.test.ts
git commit -m "feat(popout): PopoutKind 'module' + module payload encode/decode helpers"
```

---

### Task 2: Detach a module panel + render it in the popout

**Files:**
- Modify: `src/components/Workspace.tsx`, `src/windows/PopoutPanelHost.tsx`

**Interfaces:**
- Consumes: `encodeModulePopoutPayload`, `decodeModulePopoutPayload` (`@/storage/tauri`); `dockSurfaceComponents` (`@/modules/surfaceRegistry`); `isModulePanelId` (already imported in both files); `trackDetachedWindow` (workspace store).

- [ ] **Step 1: Allow module detach in `Workspace.tsx`.** In `detachPanelToWindow(id)`, add a module branch at the top of the function body (before `const moduleKey = id.split("-")[0];`):

```ts
  if (isModulePanelId(id)) {
    const payload = encodeModulePopoutPayload({ componentKey: id });
    const label = await openPopoutWindow("module", { payload });
    useWorkspace.getState().trackDetachedWindow(label, "module", null, null, true, id);
    getDockviewApi()?.getPanel(id)?.api.close();
    return;
  }
```

Add `encodeModulePopoutPayload` to the existing `@/storage/tauri` import (currently `{ isTauri, openPopoutWindow, type PopoutKind }`).

- [ ] **Step 2: Make module tabs detachable.** In `DockviewTab`, change the `detachable` flag to drop the module exclusion (keep nav excluded):

```ts
  const detachable = isTauri() && props.api.id.split("-")[0] !== "nav";
```

(If `isModulePanelId` becomes unused in `Workspace.tsx` after this, leave the import — it is still used by `applyModuleColor` and `detachPanelToWindow`. Do not remove a still-used import.)

- [ ] **Step 3: Render the module surface in the popout.** In `src/windows/PopoutPanelHost.tsx`:

Add imports:
```ts
import type { IDockviewPanelProps } from "dockview";
import { dockSurfaceComponents } from "@/modules/surfaceRegistry";
```
and add `decodeModulePopoutPayload` to the existing `@/storage/tauri` import (currently `{ takePopoutPayload, type PopoutKind }`).

Add payload state next to `ready` (after `const [ready, setReady] = React.useState(false);`):
```ts
  const [modulePayload, setModulePayload] = React.useState<string | null>(null);
```

In the mount effect, capture the payload (after `const targetId = env?.targetId ?? null;`):
```ts
      setModulePayload(env?.payload ?? null);
```

Add a `"module"` case to the `switch (kind)` (before `default:`):
```tsx
    case "module": {
      const parsed = decodeModulePopoutPayload(modulePayload);
      const Comp = parsed ? dockSurfaceComponents()[parsed.componentKey] : undefined;
      if (!Comp) {
        return (
          <div className="flex h-full w-full items-center justify-center text-text-muted">
            Unsupported window type
          </div>
        );
      }
      // Module surfaces are dockview panel components; outside dockview we supply a
      // minimal stub (params only — current modules don't read the dockview api).
      return <Comp {...({ params: {} } as unknown as IDockviewPanelProps)} />;
    }
```

- [ ] **Step 4: Verify typecheck + lint.**

Run: `pnpm typecheck && pnpm lint`
Expected: both PASS (lint zero-warnings).

- [ ] **Step 5: Commit.**

```bash
git add src/components/Workspace.tsx src/windows/PopoutPanelHost.tsx
git commit -m "feat(popout): detach module panels into a window and render the surface"
```

---

### Task 3: Persist + restore detached module windows

**Files:**
- Modify: `src/storage/workspaceManager.ts`, `src/state/workspace.ts`

**Interfaces:**
- Consumes: `encodeModulePopoutPayload` (`@/storage/tauri`).
- Produces: `DetachedWindowSnapshot.componentKey?: string`; `trackDetachedWindow(label, kind, targetId, geometry?, persist?, componentKey?)`.

- [ ] **Step 1: Extend the snapshot type.** In `src/storage/workspaceManager.ts`, add the field to `DetachedWindowSnapshot`:

```ts
export interface DetachedWindowSnapshot {
  kind: PopoutKind;
  /** Message id for viewer/inspector windows; null for the rest. */
  targetId: string | null;
  /** Last-known window geometry (physical px) + monitor; null until captured. */
  geometry: WindowGeometry | null;
  /** For kind "module": the dock-surface componentKey to re-open. */
  componentKey?: string;
}
```

- [ ] **Step 2: Carry componentKey through `trackDetachedWindow`.** In `src/state/workspace.ts`:

Update the interface signature (~line 251-257):
```ts
  trackDetachedWindow: (
    label: string,
    kind: PopoutKind,
    targetId: string | null,
    geometry?: WindowGeometry | null,
    persist?: boolean,
    componentKey?: string,
  ) => void;
```

Update the implementation (~line 965):
```ts
  trackDetachedWindow: (label, kind, targetId, geometry = null, persist = true, componentKey) => {
    set((s) => ({
      detachedWindows: { ...s.detachedWindows, [label]: { kind, targetId, geometry, componentKey } },
    }));
    if (persist) get().saveWorkspace();
  },
```

- [ ] **Step 3: Restore module windows.** Replace the body of the `for (const d of list)` loop in `restoreDetachedWindows` (~line 1001-1008) with:

```ts
    for (const d of list) {
      if (d.kind === "composer") continue; // transient — never restored
      if (d.kind === "module" && !d.componentKey) continue; // corrupt module entry
      const opts = d.kind === "module"
        ? { payload: encodeModulePopoutPayload({ componentKey: d.componentKey! }), geometry: d.geometry ?? undefined }
        : { targetId: d.targetId ?? undefined, geometry: d.geometry ?? undefined };
      const label = await openPopoutWindow(d.kind, opts).catch(() => null);
      if (label) get().trackDetachedWindow(label, d.kind, d.targetId, d.geometry, persist, d.componentKey);
    }
```

Add `encodeModulePopoutPayload` to the existing `@/storage/tauri` import in `workspace.ts` (currently includes `openPopoutWindow`, `closePopoutWindow`, `type PopoutKind`, …).

- [ ] **Step 3b: Pass the componentKey at the detach call site.** Task 2 had to drop the (then-nonexistent) 6th arg from the module detach call. Now that `trackDetachedWindow` accepts `componentKey`, update the module branch in `detachPanelToWindow` (`src/components/Workspace.tsx`, ~line 70) to pass it:

```ts
    useWorkspace.getState().trackDetachedWindow(label, "module", null, null, true, id);
```

(So a freshly-detached module window persists its componentKey and can be restored. Without this, the snapshot's `componentKey` is undefined and restore skips it.)

- [ ] **Step 4: Run the full regression gate.**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS (the persistence/restore is typecheck-verified; behavior is live-verified by the user). If `src/storage/__tests__/benchmark.test.ts` is the only unit failure, re-run `pnpm test -- benchmark` (timing-flaky).

- [ ] **Step 5: Commit.**

```bash
git add src/storage/workspaceManager.ts src/state/workspace.ts
git commit -m "feat(popout): persist + restore detached module windows by componentKey"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-23-detachable-module-panels-design.md`):
- §3 `PopoutKind` + payload helpers → Task 1.
- §4 detach branch + detachable flag → Task 2 Steps 1-2.
- §5 render the module surface → Task 2 Step 3.
- §6 persistence/restore (snapshot field, trackDetachedWindow, restoreDetachedWindows) → Task 3.
- §7 testing (Node helpers; regression; no web e2e; live steps) → Task 1 tests + Task 3 gate; live verification is the hand-off.
- §1/§2 decisions (no Rust, kind "module", payload {componentKey}, stub props, restore parity) → Global Constraints + tasks.
- §8 out-of-scope (params, live api, color, core/Rust) → not built.

**Placeholder scan:** none — every step has exact code/commands. (The spec's §5 prose pointer is resolved here into the concrete `modulePayload` state + effect capture + render case.)

**Type consistency:** `PopoutKind` (with `"module"`) is the type used by `openPopoutWindow`, `DetachedWindowSnapshot.kind`, and `trackDetachedWindow` — consistent. `encodeModulePopoutPayload({ componentKey })`/`decodeModulePopoutPayload(payload)` defined Task 1, used in Task 2 (encode in detach, decode in render) and Task 3 (encode in restore). `DetachedWindowSnapshot.componentKey?: string` defined Task 3 Step 1, written by `trackDetachedWindow` (Step 2) and read by `restoreDetachedWindows` (Step 3). `trackDetachedWindow`'s 6-arg signature matches its three call sites (detach in Task 2; two in Task 3's restore + the existing core-panel restore which passes 5 args — the 6th is optional, so unchanged callers still compile).
