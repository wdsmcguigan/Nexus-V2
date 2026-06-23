# Module Command Shortcuts — Design Spec

> **Status:** Approved design (proceeding under the user's standing "continue through to completion" instruction).
> **Builds on:** `docs/module-authoring.md` (panel-migration gap #4 — global keyboard-shortcut binding for module commands); the existing shortcut registry (`src/lib/shortcuts.ts`) and the module command registry (`src/modules/commands.ts`, `ModuleCommandSpec.shortcut`). Closes gap #4.
> **Next:** writing-plans → subagent-driven implementation.

## 0. Goal

Make a module command's declared keyboard shortcut actually fire. `ModuleCommandSpec.shortcut` already exists but is "display-only, not yet bound to a key" (`src/modules/commands.ts:12`) — no handler invokes a command when its key is pressed, and no shipped module declares one. This is panel-migration gap #4 (one of two remaining after gaps #1 parameterized launch and #3 module panel color closed). When done, pressing a module command's single-key shortcut anywhere in the app runs the command — the same way `c` composes and `z` undoes today.

## 1. Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Binding source | **Declared `spec.shortcut` (fixed, not rebindable in v1)** | The existing nav (`g…`) and selection (`*…`) chords are also fixed/non-rebindable. Rebinding module shortcuts would need the closed-`ShortcutAction` rebinding system + settings UI — deferred. The gap is "shortcuts don't fire," which a fixed binding closes. |
| 2 | Firing context | **Global, plain single key** (no modifier), like `c`/`z` | Module commands are app-level (open a panel / start an action). |
| 3 | Guards | Not when an editable element is focused, not with `meta`/`ctrl`/`alt`, not while a nav (`g`) sequence is pending | Matches every other global handler in `Workspace.tsx`. |
| 4 | Core wins on conflict | **Core keys are reserved**: a module shortcut is ignored if its key is a `DEFAULT_SHORTCUTS` default key or a chord prefix (`g`/`*`) | Modules can't shadow built-in email/nav shortcuts. |
| 5 | Resolution | **Pure `moduleCommandForKey(key, commands)`** + a thin window-keydown wrapper | Logic is Node-tested; only the `addEventListener` is the UI wrapper (mirrors the nav-chord handler). |
| 6 | Demonstrate | **Tasks "open" command gets `shortcut: "t"`** | Proves the mechanism end-to-end (press `t` → Tasks opens); mnemonic, and `t` is free of core single-key actions. |

## 2. Pure helpers

### `src/lib/shortcuts.ts` — `isReservedShortcutKey`

```ts
/** True if `key` is claimed by a built-in shortcut (a DEFAULT_SHORTCUTS default
 *  key or a chord prefix). Module command shortcuts may not shadow these. */
export function isReservedShortcutKey(key: string): boolean {
  const k = key.toLowerCase();
  if (k === NAV_PREFIX || k === SELECTION_PREFIX) return true;
  return DEFAULT_SHORTCUTS.some((s) => s.defaultKey.toLowerCase() === k);
}
```

### `src/modules/commands.ts` — `moduleCommandForKey`

```ts
import { isReservedShortcutKey } from "@/lib/shortcuts";

/** The registered module command bound to `key` via its declared `spec.shortcut`,
 *  or null. Case-insensitive. Reserved (core) keys never match — core wins.
 *  First registration wins on a module-vs-module collision. */
export function moduleCommandForKey(key: string, commands: RegisteredCommand[]): RegisteredCommand | null {
  if (isReservedShortcutKey(key)) return null;
  const k = key.toLowerCase();
  return commands.find((c) => c.spec.shortcut?.toLowerCase() === k) ?? null;
}
```

Also retitle the `ModuleCommandSpec.shortcut` doc comment from "display-only, not yet bound to a key" to note it is now bound globally (fixed; not rebindable yet).

## 3. The global handler (`src/components/Workspace.tsx`)

A new `useEffect` adding a window `keydown` listener, placed alongside the existing global handlers (the `?`/`⌘⇧N`/`z`/nav-chord effects):

```tsx
// Global module command shortcuts: a module command's declared single-key
// `spec.shortcut` runs the command from anywhere (e.g. "t" → Open Tasks).
React.useEffect(() => {
  function isEditable(el: EventTarget | null): boolean {
    const node = el as HTMLElement | null;
    return !!node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable);
  }
  function onKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isEditable(document.activeElement) || isEditable(e.target)) return;
    if (isNavSequencePending()) return; // let "g…" chords win
    const cmd = moduleCommandForKey(e.key, listModuleCommands());
    if (cmd) {
      e.preventDefault();
      cmd.run();
    }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```

Imports to add: `moduleCommandForKey`, `listModuleCommands` from `@/modules/commands`; `isNavSequencePending` from `@/lib/shortcuts` (the latter is likely already imported alongside `NAV_PREFIX`/`navTargetForKey`).

## 4. Demonstrate — Tasks "open" shortcut

`src/modules/tasks/index.ts`: the command becomes
```ts
commands: [{ id: "open", title: "Open Tasks", icon: "check", shortcut: "t" }],
```

## 5. Docs

`docs/module-authoring.md` — mark gap **#4** done: "Command/shortcut contribution — DONE: command palette + global single-key binding (`ModuleCommandSpec.shortcut`, fixed; rebinding deferred)." After this, the only remaining migration gap is **#2 detachable module panels**.

## 6. Testing (per `docs/testing-policy.md`)

- **Node** (`src/lib/__tests__/shortcuts.test.ts`, new): `isReservedShortcutKey` — true for a `DEFAULT_SHORTCUTS` key (e.g. `"r"`, `"c"`), true for `"g"`/`"*"`, case-insensitive, false for a free key (e.g. `"t"`, `"q"`).
- **Node** (`src/modules/__tests__/commands.test.ts`, extend): `moduleCommandForKey` — matches a command's declared `shortcut` (case-insensitive); returns null when the key is reserved even if a command declares it (core wins); returns null when no command matches; first-registration wins on a module-vs-module collision.
- **e2e** (`e2e/`, extend or new spec): on a fresh load, pressing `t` (body focused) opens the Tasks panel; and typing `t` inside a focused text input (e.g. the command-palette search box) does **not** open Tasks (the editable guard). Behavior-based.

The window-keydown wrapper itself is UI-layer (verified by the e2e); the resolution + guard predicates are the Node-tested pure pieces.

## 7. Out of scope (→ later)

- Rebindable module shortcuts (extending the `keyBindings` system + settings UI to module command ids).
- Multi-key / chord shortcuts for module commands (v1 is single-key only).
- Resolving the rare overlap between a module single-key shortcut and a `*`-selection second key (selection sequences are list-local with no global pending flag; a module key equal to a selection second-key may also fire mid-`*`-sequence — modules should avoid the selection letters a/n/r/u/s/t if they care). Documented limitation, not fixed in v1.
- Changes to the core shortcut actions, nav chords, or selection sequences.
