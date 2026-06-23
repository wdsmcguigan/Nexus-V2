# Module Command Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a module command's declared single-key `spec.shortcut` fire globally (close panel-migration gap #4).

**Architecture:** A pure resolution layer (`isReservedShortcutKey` + `moduleCommandForKey`) decides which registered module command a key triggers (core keys win), and a thin window-`keydown` handler in `Workspace.tsx` invokes the matched command's `run` — guarded exactly like the existing global handlers. The Tasks "open" command gets `shortcut: "t"` to demonstrate.

**Tech Stack:** TypeScript, React 18, the shortcut registry (`src/lib/shortcuts.ts`), the module command registry (`src/modules/commands.ts`), Vitest (Node), Playwright (e2e).

## Global Constraints

- **Fixed (declared) shortcuts, not rebindable** in v1 (consistent with the existing non-rebindable nav `g…` / selection `*…` chords).
- **Core wins:** a module shortcut is ignored if its key is a `DEFAULT_SHORTCUTS` default key or a chord prefix (`g` = `NAV_PREFIX`, `*` = `SELECTION_PREFIX`). `isReservedShortcutKey` is the single source of that rule.
- **Firing guards:** the global handler does nothing when `meta`/`ctrl`/`alt` is held, when an editable element (`INPUT`/`TEXTAREA`/`contentEditable`) is focused (checked on both `document.activeElement` and `e.target`), or while a nav sequence is pending (`isNavSequencePending()`).
- **Case-insensitive** key matching throughout.
- **Resolution is pure / Node-tested;** only the `addEventListener` wrapper is UI (mirrors the nav-chord handler), verified by e2e.
- **Demo:** Tasks "open" → `shortcut: "t"` (`t` is not a reserved key).
- **Testing** (`docs/testing-policy.md`): pure logic → Node (Vitest); critical UI flow → Playwright e2e; no RTL/jsdom.
- **Gates:** `pnpm test && pnpm typecheck && pnpm lint` per task; `pnpm e2e` in the final task.
- **Commits:** conventional, one per task. **No `Co-Authored-By` trailer.** Do not merge or push.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/shortcuts.ts` | `isReservedShortcutKey(key)` | 1 |
| `src/lib/__tests__/shortcuts.test.ts` | Node tests for `isReservedShortcutKey` (new file) | 1 |
| `src/modules/commands.ts` | `moduleCommandForKey(key, commands)` + `shortcut` doc update | 1 |
| `src/modules/__tests__/commands.test.ts` | Node tests for `moduleCommandForKey` (extend) | 1 |
| `src/components/Workspace.tsx` | Global keydown handler invoking the matched command | 2 |
| `src/modules/tasks/index.ts` | Tasks "open" gets `shortcut: "t"` | 2 |
| `docs/module-authoring.md` | Mark gap #4 closed | 2 |
| `e2e/*` | Press-`t`-opens-Tasks + editable-guard e2e | 3 |

---

### Task 1: Pure resolution layer — `isReservedShortcutKey` + `moduleCommandForKey`

**Files:**
- Modify: `src/lib/shortcuts.ts`
- Create: `src/lib/__tests__/shortcuts.test.ts`
- Modify: `src/modules/commands.ts`
- Test: `src/modules/__tests__/commands.test.ts`

**Interfaces:**
- Produces: `isReservedShortcutKey(key: string): boolean` (`@/lib/shortcuts`); `moduleCommandForKey(key: string, commands: RegisteredCommand[]): RegisteredCommand | null` (`@/modules/commands`).

- [ ] **Step 1: Write the failing `isReservedShortcutKey` tests.** Create `src/lib/__tests__/shortcuts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isReservedShortcutKey } from "@/lib/shortcuts";

describe("isReservedShortcutKey", () => {
  it("reserves DEFAULT_SHORTCUTS default keys", () => {
    expect(isReservedShortcutKey("r")).toBe(true); // reply
    expect(isReservedShortcutKey("c")).toBe(true); // compose
    expect(isReservedShortcutKey("e")).toBe(true); // archive
  });
  it("reserves the chord prefixes", () => {
    expect(isReservedShortcutKey("g")).toBe(true); // NAV_PREFIX
    expect(isReservedShortcutKey("*")).toBe(true); // SELECTION_PREFIX
  });
  it("is case-insensitive", () => {
    expect(isReservedShortcutKey("R")).toBe(true);
    expect(isReservedShortcutKey("G")).toBe(true);
  });
  it("does not reserve a free key", () => {
    expect(isReservedShortcutKey("t")).toBe(false);
    expect(isReservedShortcutKey("q")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm test -- shortcuts`
Expected: FAIL — `isReservedShortcutKey` is not exported.

- [ ] **Step 3: Implement `isReservedShortcutKey`.** Append to `src/lib/shortcuts.ts`:

```ts
/** True if `key` is claimed by a built-in shortcut (a DEFAULT_SHORTCUTS default
 *  key or a chord prefix). Module command shortcuts may not shadow these. */
export function isReservedShortcutKey(key: string): boolean {
  const k = key.toLowerCase();
  if (k === NAV_PREFIX || k === SELECTION_PREFIX) return true;
  return DEFAULT_SHORTCUTS.some((s) => s.defaultKey.toLowerCase() === k);
}
```

- [ ] **Step 4: Run to confirm `isReservedShortcutKey` passes.**

Run: `pnpm test -- shortcuts`
Expected: PASS.

- [ ] **Step 5: Write the failing `moduleCommandForKey` tests.** Append to `src/modules/__tests__/commands.test.ts`:

```ts
import { moduleCommandForKey } from "@/modules/commands";

describe("moduleCommandForKey", () => {
  beforeEach(() => _resetModuleCommands());

  it("matches a command's declared shortcut (case-insensitive)", () => {
    registerModuleCommand("org.nexus.tasks", { id: "open", title: "Open Tasks", shortcut: "t" }, run);
    const cmds = listModuleCommands();
    expect(moduleCommandForKey("t", cmds)?.key).toBe("org.nexus.tasks:open");
    expect(moduleCommandForKey("T", cmds)?.key).toBe("org.nexus.tasks:open");
  });
  it("returns null for a reserved key even if a command declares it (core wins)", () => {
    registerModuleCommand("org.nexus.tasks", { id: "x", title: "X", shortcut: "c" }, run); // c = compose
    expect(moduleCommandForKey("c", listModuleCommands())).toBeNull();
  });
  it("returns null when no command declares the key", () => {
    registerModuleCommand("org.nexus.tasks", { id: "open", title: "Open Tasks", shortcut: "t" }, run);
    expect(moduleCommandForKey("q", listModuleCommands())).toBeNull();
  });
  it("returns null when a command has no shortcut", () => {
    registerModuleCommand("org.nexus.notes", { id: "open", title: "Open Notes" }, run);
    expect(moduleCommandForKey("t", listModuleCommands())).toBeNull();
  });
  it("first registration wins on a module-vs-module collision", () => {
    registerModuleCommand("org.nexus.tasks", { id: "open", title: "Open Tasks", shortcut: "y" }, run);
    registerModuleCommand("org.nexus.notes", { id: "open", title: "Open Notes", shortcut: "y" }, run);
    expect(moduleCommandForKey("y", listModuleCommands())?.key).toBe("org.nexus.tasks:open");
  });
});
```

- [ ] **Step 6: Run it to confirm it fails.**

Run: `pnpm test -- commands`
Expected: FAIL — `moduleCommandForKey` is not exported.

- [ ] **Step 7: Implement `moduleCommandForKey` + update the doc comment.** In `src/modules/commands.ts`:

Add the import at the top:
```ts
import { isReservedShortcutKey } from "@/lib/shortcuts";
```

Change the `shortcut` field doc comment in `ModuleCommandSpec` from:
```ts
  /** Optional display-only shortcut hint (e.g. "T"); not yet bound to a key. */
  shortcut?: string;
```
to:
```ts
  /** Optional single-key global shortcut (e.g. "t"). Bound by the global handler
   *  via moduleCommandForKey (fixed; not rebindable yet). Reserved core keys are ignored. */
  shortcut?: string;
```

Add the resolver (after `listModuleCommands`):
```ts
/** The registered module command bound to `key` via its declared `spec.shortcut`,
 *  or null. Case-insensitive. Reserved (core) keys never match — core wins.
 *  First registration wins on a module-vs-module collision. */
export function moduleCommandForKey(key: string, commands: RegisteredCommand[]): RegisteredCommand | null {
  if (isReservedShortcutKey(key)) return null;
  const k = key.toLowerCase();
  return commands.find((c) => c.spec.shortcut?.toLowerCase() === k) ?? null;
}
```

- [ ] **Step 8: Run to confirm all pass.**

Run: `pnpm test -- "shortcuts|commands"`
Expected: PASS (existing + new in both files).

- [ ] **Step 9: Commit.**

```bash
git add src/lib/shortcuts.ts src/lib/__tests__/shortcuts.test.ts src/modules/commands.ts src/modules/__tests__/commands.test.ts
git commit -m "feat(shortcuts): isReservedShortcutKey + moduleCommandForKey resolution layer"
```

---

### Task 2: Global handler + demo shortcut + docs

**Files:**
- Modify: `src/components/Workspace.tsx`, `src/modules/tasks/index.ts`, `docs/module-authoring.md`

**Interfaces:**
- Consumes: `moduleCommandForKey`, `listModuleCommands` (`@/modules/commands`); `isNavSequencePending` (`@/lib/shortcuts`).

- [ ] **Step 1: Add imports.** In `src/components/Workspace.tsx`:
  - Add `isNavSequencePending` to the existing `@/lib/shortcuts` import (currently `{ NAV_PREFIX, navTargetForKey, setNavSequencePending }`).
  - Add a new import: `import { moduleCommandForKey, listModuleCommands } from "@/modules/commands";`

- [ ] **Step 2: Add the global handler.** In the component body, alongside the other global keydown `useEffect`s (e.g. right after the `z`/`Z` undo/redo effect), add:

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

- [ ] **Step 3: Add the demo shortcut.** In `src/modules/tasks/index.ts`, change the commands line to:

```ts
    commands: [{ id: "open", title: "Open Tasks", icon: "check", shortcut: "t" }],
```

- [ ] **Step 4: Update the docs.** In `docs/module-authoring.md`, replace gap item 4 (~line 96):

```md
4. **Command/shortcut contribution** — command half DONE; global keyboard-shortcut binding for modules still deferred.
```

with:

```md
4. ✅ **Command/shortcut contribution (DONE)** — command palette + global single-key binding: a command's `ModuleCommandSpec.shortcut` fires from anywhere via `moduleCommandForKey` (fixed; rebinding deferred). Reserved core keys (`DEFAULT_SHORTCUTS` + the `g`/`*` chord prefixes) always win.
```

- [ ] **Step 5: Verify typecheck + lint.**

Run: `pnpm typecheck && pnpm lint`
Expected: both PASS (lint zero-warnings).

- [ ] **Step 6: Commit.**

```bash
git add src/components/Workspace.tsx src/modules/tasks/index.ts docs/module-authoring.md
git commit -m "feat(shortcuts): global module-command shortcut handler + Tasks 't'; close migration gap #4"
```

---

### Task 3: e2e — press `t` opens Tasks; input guard

**Files:**
- Modify: `e2e/tasks.spec.ts`

**Interfaces:**
- Consumes: the running web app; the Task 2 handler + the Tasks `t` shortcut.

- [ ] **Step 1: Add the e2e spec.** Append to `e2e/tasks.spec.ts`:

```ts
test("global shortcut: pressing 't' opens the Tasks panel; typing 't' in an input does not", async ({ page }) => {
  // Body is focused on load — the module shortcut fires.
  await page.locator("body").click();
  await page.keyboard.press("t");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();

  // Typing 't' inside the command-palette search input must NOT re-trigger it
  // (the editable-element guard). Open the palette, type, and confirm no error /
  // the input received the character rather than the shortcut firing.
  await page.getByRole("button", { name: "Command palette" }).click();
  const input = page.getByPlaceholder("Search mail, contacts, or type a command…");
  await input.fill("");
  await input.press("t");
  await expect(input).toHaveValue("t");
});
```

> If the Tasks heading selector is ambiguous against other panels, scope it to the dock panel. Keep assertions behavior-based; do not change source to fit the test (report a real bug instead).

- [ ] **Step 2: Run the e2e.**

Run: `pnpm e2e -- tasks`
Expected: PASS (existing tasks specs + the new one), chromium + webkit. If browsers are missing, `npx playwright install` first; if a stale preview build interferes, rebuild.

- [ ] **Step 3: Run the full final gate.**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm e2e`
Expected: all PASS. (`benchmark.test.ts` flake caveat: if it's the only unit failure, re-run `pnpm test -- benchmark` in isolation.)

- [ ] **Step 4: Commit.**

```bash
git add e2e/tasks.spec.ts
git commit -m "test(e2e): global module-command shortcut opens Tasks; input guard"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-23-module-command-shortcuts-design.md`):
- §2 `isReservedShortcutKey` + `moduleCommandForKey` (+ doc update) → Task 1.
- §3 global handler → Task 2.
- §4 Tasks demo shortcut → Task 2.
- §5 docs gap #4 closed → Task 2.
- §6 testing (Node for both resolvers; e2e positive + input-guard) → Tasks 1 + 3.
- §1 decisions (fixed binding, global plain key, guards, core-wins, pure resolution, demo) → Global Constraints + tasks.
- §7 out-of-scope (rebindable shortcuts, chords, `*`-overlap, core changes) → not built.

**Placeholder scan:** none — real code/commands throughout.

**Type consistency:** `isReservedShortcutKey(key: string): boolean` defined Task 1 Step 3, consumed by `moduleCommandForKey` (Task 1 Step 7) and imported into `Workspace.tsx` (Task 2). `moduleCommandForKey(key, commands: RegisteredCommand[]): RegisteredCommand | null` defined Task 1, called in Task 2 as `moduleCommandForKey(e.key, listModuleCommands())` and the result's `.run()` invoked (`RegisteredCommand` has `run: () => void`, `key`, `spec`). `ModuleCommandSpec.shortcut?: string` is the existing field, now read by `moduleCommandForKey` and set on Tasks' command (Task 2). The handler's guards match the Global Constraints exactly.
