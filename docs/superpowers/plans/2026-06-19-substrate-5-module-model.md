# Substrate Plan 5 — Module Model: manifest, capabilities, surfaces, storage (Pillar 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Land the module/extension *contract* in code — manifest type, capability vocabulary parser, surface-type taxonomy with trust gating, a module registry that ties a module's namespace to its reducer (Plan 1), and host-mediated namespaced storage. This is "vocabulary + registry now; enforcement/sandbox/UI-wiring later" (design P4, P6).

**Architecture:** Four small, pure-TS modules under `src/modules/`. `capabilities.ts` parses capability strings into structured form. `surfaces.ts` defines the 9-type surface taxonomy and the trust×surface gating matrix. `registry.ts` defines `ModuleManifest` and `registerModule`, which validates that a module's declared kinds/entities live in its namespace and wires its reducer through `registerModuleReducer` (Plan 1). `storage.ts` is a host-mediated namespaced key-value store. No enforcement runtime, no sandbox, no UI contribution wiring — those are deferred until a real second module exists (P6). (substrate-design.md §7.)

**Tech Stack:** TypeScript, Vitest (`pnpm test`). Pure frontend. `@/` maps to `src/`. Builds on Plan 1 (`src/state/moduleReducers.ts`, `src/state/mutationKind.ts`).

---

## Verified dependencies

- `src/state/moduleReducers.ts` (Plan 1) exports `registerModuleReducer(namespace, reducer): () => void` (throws on reserved/duplicate namespace) and `ModuleReducer` (`{ apply: (kind, payload, store) => void }`).
- `src/state/mutationKind.ts` (Plan 1) exports `isNamespacedKind`, `kindNamespace`.

## Out of scope (deferred per design P6)

- Capability *enforcement* (this plan only parses + represents capabilities).
- Sandbox runtime, module signing, marketplace, external/untrusted module loading.
- Actual UI contribution wiring into dockview/inspector/command-palette (registry records contributions; the app consumes them later).

---

## File Structure

- **Create** `src/modules/capabilities.ts` — capability vocabulary + `parseCapability`.
- **Create** `src/modules/surfaces.ts` — `SurfaceType`, `TrustTier`, `canContributeSurface`.
- **Create** `src/modules/registry.ts` — `ModuleManifest`, `registerModule`, `getModule`, `listModules`, `_resetModules`.
- **Create** `src/modules/storage.ts` — `moduleStorage`, `_resetModuleStorage`.
- **Create** tests alongside each in `src/modules/__tests__/`.

---

### Task 1: Capability vocabulary parser

**Files:**
- Create: `src/modules/capabilities.ts`
- Test: `src/modules/__tests__/capabilities.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/__tests__/capabilities.test.ts
import { describe, it, expect } from "vitest";
import { parseCapability } from "@/modules/capabilities";

describe("parseCapability", () => {
  it("parses data.read with an entity type and no group", () => {
    expect(parseCapability("data.read:nexus/contact")).toEqual({
      action: "data.read",
      target: "nexus/contact",
      entType: "nexus/contact",
      group: undefined,
    });
  });

  it("parses data.read with a projection group", () => {
    expect(parseCapability("data.read:nexus/email.message#body")).toEqual({
      action: "data.read",
      target: "nexus/email.message#body",
      entType: "nexus/email.message",
      group: "body",
    });
  });

  it("parses a targetless capability", () => {
    expect(parseCapability("data.write.own")).toEqual({
      action: "data.write.own",
      target: undefined,
      entType: undefined,
      group: undefined,
    });
  });

  it("parses an emit glob", () => {
    expect(parseCapability("mutations.emit:com.acme.timer/*")).toEqual({
      action: "mutations.emit",
      target: "com.acme.timer/*",
      entType: undefined,
      group: undefined,
    });
  });

  it("flags a sensitive read group", () => {
    expect(parseCapability("data.read:nexus/email.message#body").group).toBe("body");
    expect(parseCapability("data.read:nexus/email.message#envelope").group).toBe("envelope");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/modules/__tests__/capabilities.test.ts`
Expected: FAIL — `Failed to resolve import "@/modules/capabilities"`.

- [ ] **Step 3: Create `src/modules/capabilities.ts`**

```ts
/**
 * Capability vocabulary for the module model (substrate §7.3). This module
 * PARSES and REPRESENTS capabilities; enforcement is deferred (design P4, P6).
 */

/** The known capability actions a module may request. */
export type CapabilityAction =
  | "data.read"
  | "data.write.own"
  | "mutations.emit"
  | "bus.subscribe"
  | "ui.contribute"
  | "graph.read"
  | "graph.write"
  | "net"
  | "email.send";

/** Read projection groups for an entity (substrate §7.3.1). */
export type ReadGroup =
  | "envelope"
  | "flags"
  | "preview"
  | "body"
  | "attachments"
  | "raw";

/** The sensitive read groups — never granted to third-party modules. */
export const SENSITIVE_READ_GROUPS: ReadGroup[] = ["body", "attachments", "raw"];

/** A parsed capability string. */
export interface ParsedCapability {
  action: string;
  /** Everything after the first ":", or undefined if the capability is targetless. */
  target?: string;
  /** For `data.read`, the entity type (target before "#"). */
  entType?: string;
  /** For `data.read`, the projection group (target after "#"), if present. */
  group?: string;
}

/**
 * Parse a capability string like "data.read:nexus/email.message#body" or
 * "mutations.emit:com.acme.timer/*" or "data.write.own".
 */
export function parseCapability(cap: string): ParsedCapability {
  const colon = cap.indexOf(":");
  if (colon < 0) {
    return { action: cap, target: undefined, entType: undefined, group: undefined };
  }
  const action = cap.slice(0, colon);
  const target = cap.slice(colon + 1);
  if (action === "data.read") {
    const hash = target.indexOf("#");
    if (hash >= 0) {
      return { action, target, entType: target.slice(0, hash), group: target.slice(hash + 1) };
    }
    return { action, target, entType: target, group: undefined };
  }
  return { action, target, entType: undefined, group: undefined };
}

/** True if `group` is a sensitive read group (never granted to third-party). */
export function isSensitiveGroup(group: string | undefined): boolean {
  return group !== undefined && (SENSITIVE_READ_GROUPS as string[]).includes(group);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/modules/__tests__/capabilities.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/capabilities.ts src/modules/__tests__/capabilities.test.ts
git commit -m "feat(substrate): capability vocabulary parser"
```

---

### Task 2: Surface taxonomy + trust gating

**Files:**
- Create: `src/modules/surfaces.ts`
- Test: `src/modules/__tests__/surfaces.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/__tests__/surfaces.test.ts
import { describe, it, expect } from "vitest";
import { SURFACE_TYPES, canContributeSurface } from "@/modules/surfaces";

describe("surface taxonomy + trust gating", () => {
  it("declares the nine surface types", () => {
    expect(SURFACE_TYPES).toEqual([
      "dock",
      "rail",
      "inspector-section",
      "embedded-widget",
      "overlay",
      "headless",
      "full-window",
      "ambient-indicator",
      "canvas",
    ]);
  });

  it("lets core and first-party contribute every surface", () => {
    for (const t of SURFACE_TYPES) {
      expect(canContributeSurface("core", t)).toBe(true);
      expect(canContributeSurface("first-party", t)).toBe(true);
    }
  });

  it("restricts third-party to safe surfaces", () => {
    expect(canContributeSurface("third-party", "dock")).toBe(true);
    expect(canContributeSurface("third-party", "inspector-section")).toBe(true);
    expect(canContributeSurface("third-party", "overlay")).toBe(true);
    expect(canContributeSurface("third-party", "ambient-indicator")).toBe(true);
    expect(canContributeSurface("third-party", "canvas")).toBe(true);
    expect(canContributeSurface("third-party", "headless")).toBe(true);
  });

  it("denies third-party the high-risk surfaces", () => {
    expect(canContributeSurface("third-party", "rail")).toBe(false);
    expect(canContributeSurface("third-party", "embedded-widget")).toBe(false);
    expect(canContributeSurface("third-party", "full-window")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/modules/__tests__/surfaces.test.ts`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Create `src/modules/surfaces.ts`**

```ts
/**
 * Surface taxonomy and trust×surface gating (substrate §7.2). Vocabulary +
 * gating only; actual UI wiring of contributed surfaces is deferred.
 */

/** The nine surface types a module may contribute UI through. */
export const SURFACE_TYPES = [
  "dock",
  "rail",
  "inspector-section",
  "embedded-widget",
  "overlay",
  "headless",
  "full-window",
  "ambient-indicator",
  "canvas",
] as const;

export type SurfaceType = (typeof SURFACE_TYPES)[number];

/** Module trust tiers. */
export type TrustTier = "core" | "first-party" | "third-party";

/** Surfaces a third-party module is allowed to contribute (substrate §7.2 matrix). */
const THIRD_PARTY_ALLOWED: ReadonlySet<SurfaceType> = new Set([
  "dock",
  "inspector-section",
  "overlay",
  "ambient-indicator",
  "canvas",
  "headless",
]);

/**
 * True if a module of `tier` may contribute a surface of `type`. Core and
 * first-party may contribute any; third-party is restricted to the safe set
 * (never rail, embedded-widget, or full-window — anti-spoofing).
 */
export function canContributeSurface(tier: TrustTier, type: SurfaceType): boolean {
  if (tier === "core" || tier === "first-party") return true;
  return THIRD_PARTY_ALLOWED.has(type);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/modules/__tests__/surfaces.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/surfaces.ts src/modules/__tests__/surfaces.test.ts
git commit -m "feat(substrate): surface taxonomy and trust gating"
```

---

### Task 3: Module manifest + registry

**Files:**
- Create: `src/modules/registry.ts`
- Test: `src/modules/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/__tests__/registry.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerModule,
  getModule,
  listModules,
  _resetModules,
} from "@/modules/registry";
import { getModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
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
});

describe("module registry", () => {
  it("registers a module and exposes it", () => {
    registerModule(manifest(), { apply: () => {} });
    expect(getModule("com.acme.timer")?.name).toBe("Timer");
    expect(listModules().map((m) => m.id)).toEqual(["com.acme.timer"]);
  });

  it("wires the module's reducer under its namespace", () => {
    registerModule(manifest(), { apply: () => {} });
    expect(getModuleReducer("com.acme.timer")).toBeDefined();
  });

  it("rejects a mutationKind outside the module namespace", () => {
    expect(() =>
      registerModule(manifest({ mutationKinds: ["com.other/HACK"] }), { apply: () => {} }),
    ).toThrow(/namespace/);
  });

  it("rejects an entity type outside the module namespace", () => {
    expect(() =>
      registerModule(manifest({ entities: ["com.other/thing"] }), { apply: () => {} }),
    ).toThrow(/namespace/);
  });

  it("disposer unregisters the module and its reducer", () => {
    const dispose = registerModule(manifest(), { apply: () => {} });
    dispose();
    expect(getModule("com.acme.timer")).toBeUndefined();
    expect(getModuleReducer("com.acme.timer")).toBeUndefined();
  });

  it("allows a headless module with no reducer", () => {
    registerModule(manifest({ id: "com.acme.headless", namespace: "com.acme.headless", entities: [], mutationKinds: [] }));
    expect(getModule("com.acme.headless")?.name).toBe("Timer");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/modules/__tests__/registry.test.ts`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Create `src/modules/registry.ts`**

```ts
import { registerModuleReducer, type ModuleReducer } from "@/state/moduleReducers";
import { kindNamespace } from "@/state/mutationKind";
import type { TrustTier } from "@/modules/surfaces";

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
 * Register a module from its manifest, optionally wiring its reducer under the
 * module namespace. Validates that all declared kinds and entities live in the
 * module's namespace. Returns a disposer that unregisters the module and its
 * reducer. (substrate Pillar 4, §7)
 */
export function registerModule(manifest: ModuleManifest, reducer?: ModuleReducer): () => void {
  if (_modules.has(manifest.id)) {
    throw new Error(`A module is already registered with id "${manifest.id}"`);
  }
  assertNamespaced(manifest.mutationKinds, manifest.namespace, "mutationKind");
  assertNamespaced(manifest.entities, manifest.namespace, "entity");

  const disposeReducer = reducer
    ? registerModuleReducer(manifest.namespace, reducer)
    : () => {};

  const dispose = () => {
    disposeReducer();
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

/** Test-only: unregister all modules (does not clear the reducer registry). */
export function _resetModules(): void {
  for (const m of [..._modules.values()]) m.dispose();
  _modules.clear();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/modules/__tests__/registry.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full check + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint` (all green). Then:
```bash
git add src/modules/registry.ts src/modules/__tests__/registry.test.ts
git commit -m "feat(substrate): module manifest and registry"
```

---

### Task 4: Host-mediated namespaced storage

**Files:**
- Create: `src/modules/storage.ts`
- Test: `src/modules/__tests__/storage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/__tests__/storage.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { moduleStorage, _resetModuleStorage } from "@/modules/storage";

beforeEach(() => {
  _resetModuleStorage();
});

describe("host-mediated namespaced storage", () => {
  it("stores and retrieves a value scoped to a namespace", () => {
    const s = moduleStorage("com.acme.timer");
    s.set("running", true);
    expect(s.get("running")).toBe(true);
  });

  it("isolates namespaces from each other", () => {
    moduleStorage("com.a").set("k", 1);
    moduleStorage("com.b").set("k", 2);
    expect(moduleStorage("com.a").get("k")).toBe(1);
    expect(moduleStorage("com.b").get("k")).toBe(2);
  });

  it("returns undefined for an unset key", () => {
    expect(moduleStorage("com.a").get("missing")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/modules/__tests__/storage.test.ts`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Create `src/modules/storage.ts`**

```ts
/**
 * Host-mediated, namespace-scoped key-value storage for modules (substrate
 * §7.4). A module never gets raw DB access; it reads/writes through this scoped
 * handle. In-memory for now; durable backing is a later concern.
 */

/** A storage handle scoped to one module namespace. */
export interface ModuleStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

const _store = new Map<string, unknown>();

function scopedKey(namespace: string, key: string): string {
  return `${namespace} ${key}`;
}

/** Returns a storage handle scoped to `namespace`. */
export function moduleStorage(namespace: string): ModuleStorage {
  return {
    get(key: string): unknown {
      return _store.get(scopedKey(namespace, key));
    },
    set(key: string, value: unknown): void {
      _store.set(scopedKey(namespace, key), value);
    },
  };
}

/** Test-only: clear all module storage. */
export function _resetModuleStorage(): void {
  _store.clear();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/modules/__tests__/storage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full check + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint` (all green). Then:
```bash
git add src/modules/storage.ts src/modules/__tests__/storage.test.ts
git commit -m "feat(substrate): host-mediated namespaced module storage"
```

---

## Self-Review (completed by author)

**Spec coverage** (design §7): manifest (§7.1) → Task 3; contribution surface taxonomy + trust gating (§7.2) → Task 2; capability vocabulary + read projection groups (§7.3/§7.3.1) → Task 1; host-mediated namespaced storage (§7.4) → Task 4; first-party-as-modules / dogfood (P2) → enabled by the registry tying reducers in via Plan 1. Deferred per P6: enforcement runtime, sandbox, signing, marketplace, external loading, actual UI contribution wiring — all explicitly out of scope.

**Placeholder scan:** none — full code + exact commands in every step.

**Type consistency:** `TrustTier` is defined in `surfaces.ts` (Task 2) and imported by `registry.ts` (Task 3). `ModuleReducer` from Plan 1 is the reducer type used by `registerModule`. `kindNamespace` (Plan 1) is used to validate manifest namespacing. `ParsedCapability` fields (`action`/`target`/`entType`/`group`) are consistent across Task 1's tests and implementation. `SurfaceType` is the element type of `SURFACE_TYPES` and the param of `canContributeSurface`.

---

## Execution Handoff

Execute with superpowers:subagent-driven-development or inline. Four tasks, pure frontend, each green + committed. After this, **all four substrate pillars exist in code** — the foundation for panels (Tasks/Notes) and the AI layer.
