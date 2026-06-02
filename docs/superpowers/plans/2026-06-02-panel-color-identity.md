# Panel Color Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each Nexus module type a glanceable color identity that travels with its tab, with user- and per-workspace-level customization, without changing typography or existing accent treatments.

**Architecture:**
- Pure resolver in `src/lib/panelColors.ts` reads workspace override → user preference → system default and returns a CSS color string.
- `Workspace.tsx` sets a `--module-color` CSS custom property on each dockview group's outer element based on the active tab's resolved color, and sets `data-body-tint-level` on the workspace root.
- New CSS rules in `src/design-system/tokens.css` consume those properties to render the tab-bar wash, active-tab underline, top divider, selected-row tint, and (when L3 is active) atmospheric body wash + hover state.
- Settings UI lives under Settings → Preferences → Panel Colors, with a 21-color palette + custom-hex picker.

**Tech Stack:** TypeScript, React 18, Zustand, vitest, Tailwind (via cn helper), dockview, Radix Popover (for the picker), the existing 21-color `--color-link-*` palette.

**Reference spec:** [docs/superpowers/specs/2026-06-02-panel-color-identity-design.md](../specs/2026-06-02-panel-color-identity-design.md)

---

## Task 1: Add ModuleKey and PanelColorPrefs types

**Files:**
- Modify: `src/data/types.ts` (append at the end of the file)

- [ ] **Step 1: Add the types to `src/data/types.ts`**

Append at the end of the file:

```ts
// ─── Panel Color Identity ────────────────────────────────────────────────────
// Identifies a Nexus dockview module type. Values MUST match the keys in
// DV_COMPONENTS in src/components/Workspace.tsx — if you add a new module,
// add it here too and add a default in DEFAULT_MODULE_COLORS in
// src/lib/panelColors.ts.
export type ModuleKey =
  | "nav"
  | "list"
  | "viewer"
  | "inspector"
  | "contacts"
  | "calendar"
  | "settings";

export interface PanelColorPrefs {
  /**
   * Per-module color override. Value is either a token reference like
   * "link-4" (resolves to var(--color-link-4)) or a hex string like
   * "#aabbcc". Missing keys fall through to the system default.
   */
  colors: Partial<Record<ModuleKey, string>>;
  /** Body-tint intensity. L2 = selected row + divider only. L3 = adds wash + hover. */
  bodyTintLevel: "L2" | "L3";
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/data/types.ts
git commit -m "$(cat <<'EOF'
types: add ModuleKey and PanelColorPrefs for panel color identity

Foundation types for the panel-color-identity feature. ModuleKey mirrors
the dockview component registry keys; PanelColorPrefs holds the per-module
color override map and body-tint level.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extend AppPreferences with panelColors

**Files:**
- Modify: `src/lib/appPreferences.ts` (interface + DEFAULTS)

- [ ] **Step 1: Add the import + extend the interface + extend DEFAULTS**

Edit `src/lib/appPreferences.ts`:

At the top of the file, replace the opening JSDoc + add an import:

```ts
/**
 * App-global preferences — settings that apply across all workspaces.
 * Stored in a separate localStorage key so they survive workspace switches.
 */
import type { PanelColorPrefs } from "@/data/types";
```

Inside the `AppPreferences` interface, add this field at the bottom of the interface:

```ts
  /** Panel color identity preferences (defaults + body-tint level). */
  panelColors: PanelColorPrefs;
```

In the `DEFAULTS` const, add at the bottom:

```ts
  panelColors: { colors: {}, bodyTintLevel: "L2" },
```

- [ ] **Step 2: Verify the merge in `getAppPreferences` is backward-compatible**

Inspect the existing `getAppPreferences` body — it merges `{ ...DEFAULTS, ...JSON.parse(raw) }`. This means an old stored payload missing `panelColors` will receive the default `{ colors: {}, bodyTintLevel: "L2" }` automatically. Confirm this by reading the function. No code change needed.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/appPreferences.ts
git commit -m "$(cat <<'EOF'
prefs: add panelColors field to AppPreferences

Adds the user-level PanelColorPrefs to app-global preferences. Existing
stored preferences load with the default empty override map and L2 body
tint via the existing { ...DEFAULTS, ...stored } merge.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extend WorkspaceSnapshot with optional panelColors

**Files:**
- Modify: `src/storage/workspaceManager.ts:15-46` (interface) and `:73-97` (makeDefaultWorkspace — no change needed, optional field)

- [ ] **Step 1: Extend the WorkspaceSnapshot interface**

In `src/storage/workspaceManager.ts`, add an import at the top:

```ts
import type { PanelColorPrefs } from "@/data/types";
```

Inside the `WorkspaceSnapshot` interface (right after the `keyBindings` line), add:

```ts
  /** Per-workspace panel color override. Absent means inherit user-level prefs. */
  panelColors?: PanelColorPrefs;
```

- [ ] **Step 2: Confirm `makeDefaultWorkspace` does NOT set panelColors**

Read `makeDefaultWorkspace` — `panelColors` is optional and should remain unset so new workspaces inherit user defaults by default. No edit needed.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/storage/workspaceManager.ts
git commit -m "$(cat <<'EOF'
workspace: add optional panelColors override to WorkspaceSnapshot

When present, the workspace overrides user-level panel colors. When
absent (default for new workspaces), the workspace inherits user prefs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create the resolver with vitest tests (TDD)

**Files:**
- Create: `src/lib/panelColors.ts`
- Create: `src/lib/__tests__/panelColors.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/panelColors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_MODULE_COLORS,
  toCssColor,
  resolvePanelColor,
  resolveBodyTintLevel,
} from "@/lib/panelColors";
import type { PanelColorPrefs } from "@/data/types";

const userOnly: PanelColorPrefs = { colors: {}, bodyTintLevel: "L2" };

describe("DEFAULT_MODULE_COLORS", () => {
  it("has an entry for every ModuleKey", () => {
    expect(DEFAULT_MODULE_COLORS).toEqual({
      nav: "link-16",
      list: "link-4",
      viewer: "link-21",
      inspector: "link-18",
      contacts: "link-2",
      calendar: "link-7",
      settings: "link-8",
    });
  });
});

describe("toCssColor", () => {
  it("converts a link-N token reference to var(--color-link-N)", () => {
    expect(toCssColor("link-4")).toBe("var(--color-link-4)");
    expect(toCssColor("link-21")).toBe("var(--color-link-21)");
  });

  it("passes a hex string through unchanged", () => {
    expect(toCssColor("#aabbcc")).toBe("#aabbcc");
    expect(toCssColor("#1a2b3c")).toBe("#1a2b3c");
  });
});

describe("resolvePanelColor", () => {
  it("returns the system default when neither user nor workspace overrides", () => {
    expect(resolvePanelColor("list", userOnly)).toBe("var(--color-link-4)");
    expect(resolvePanelColor("inspector", userOnly)).toBe("var(--color-link-18)");
  });

  it("returns the user override when set", () => {
    const user: PanelColorPrefs = { colors: { list: "link-7" }, bodyTintLevel: "L2" };
    expect(resolvePanelColor("list", user)).toBe("var(--color-link-7)");
  });

  it("workspace override beats user override", () => {
    const user: PanelColorPrefs = { colors: { list: "link-7" }, bodyTintLevel: "L2" };
    const ws: PanelColorPrefs = { colors: { list: "#ff0000" }, bodyTintLevel: "L2" };
    expect(resolvePanelColor("list", user, ws)).toBe("#ff0000");
  });

  it("workspace falls through to user pref when the module isn't overridden", () => {
    const user: PanelColorPrefs = { colors: { inspector: "link-9" }, bodyTintLevel: "L2" };
    const ws: PanelColorPrefs = { colors: { list: "#ff0000" }, bodyTintLevel: "L2" };
    expect(resolvePanelColor("inspector", user, ws)).toBe("var(--color-link-9)");
  });

  it("falls all the way through to system default when neither layer covers it", () => {
    const user: PanelColorPrefs = { colors: { list: "link-7" }, bodyTintLevel: "L2" };
    const ws: PanelColorPrefs = { colors: {}, bodyTintLevel: "L2" };
    expect(resolvePanelColor("calendar", user, ws)).toBe("var(--color-link-7)");
  });
});

describe("resolveBodyTintLevel", () => {
  it("returns the user level when no workspace override", () => {
    expect(resolveBodyTintLevel({ colors: {}, bodyTintLevel: "L2" })).toBe("L2");
    expect(resolveBodyTintLevel({ colors: {}, bodyTintLevel: "L3" })).toBe("L3");
  });

  it("workspace overrides user", () => {
    const result = resolveBodyTintLevel(
      { colors: {}, bodyTintLevel: "L2" },
      { colors: {}, bodyTintLevel: "L3" },
    );
    expect(result).toBe("L3");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm test src/lib/__tests__/panelColors.test.ts`
Expected: FAIL — `Cannot find module '@/lib/panelColors'`.

- [ ] **Step 3: Implement the resolver**

Create `src/lib/panelColors.ts`:

```ts
import type { ModuleKey, PanelColorPrefs } from "@/data/types";

/**
 * System defaults. Each value is a token reference (link-N) that resolves
 * to a CSS custom property in src/design-system/tokens.css. If a new
 * ModuleKey is added, add a default here too.
 */
export const DEFAULT_MODULE_COLORS: Record<ModuleKey, string> = {
  nav: "link-16",
  list: "link-4",
  viewer: "link-21",
  inspector: "link-18",
  contacts: "link-2",
  calendar: "link-7",
  settings: "link-8",
};

/**
 * Convert a stored color value to a CSS-usable color string.
 * - "link-N" → "var(--color-link-N)"
 * - "#rrggbb" or "#rgb" → passed through unchanged
 */
export function toCssColor(value: string): string {
  if (value.startsWith("link-")) return `var(--color-${value})`;
  return value;
}

/**
 * Resolve the effective color for a module.
 * Order: workspace override → user preference → system default.
 */
export function resolvePanelColor(
  module: ModuleKey,
  user: PanelColorPrefs,
  workspace?: PanelColorPrefs,
): string {
  const stored =
    workspace?.colors[module] ??
    user.colors[module] ??
    DEFAULT_MODULE_COLORS[module];
  return toCssColor(stored);
}

/**
 * Resolve the effective body-tint level for the active workspace.
 * Workspace override beats user preference.
 */
export function resolveBodyTintLevel(
  user: PanelColorPrefs,
  workspace?: PanelColorPrefs,
): "L2" | "L3" {
  return workspace?.bodyTintLevel ?? user.bodyTintLevel;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm test src/lib/__tests__/panelColors.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/panelColors.ts src/lib/__tests__/panelColors.test.ts
git commit -m "$(cat <<'EOF'
lib: panel-color resolver (workspace → user → default)

Pure functions that resolve a module's effective color string from a
PanelColorPrefs layer stack, plus toCssColor that converts "link-N"
token references to var(--color-link-N) and passes hex strings through.
Fully unit tested.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add panel-color CSS rules to tokens.css

**Files:**
- Modify: `src/design-system/tokens.css` (append after the existing `.dv-theme-nexus` block — currently ends around line 264)

- [ ] **Step 1: Find the insertion point**

Open `src/design-system/tokens.css` and locate the line `cursor: grab;` followed by its closing `}` inside `.dv-theme-nexus .tab`. Insert the new rules immediately after that block.

- [ ] **Step 2: Append the new rules**

Add this block:

```css
/* ─── Panel color identity ────────────────────────────────────────────────
 * Reads --module-color set per dockview group by Workspace.tsx (the active
 * tab's color) and --body-tint-level set on the workspace root.
 * ───────────────────────────────────────────────────────────────────────── */

/* Tab-bar wash — unfocused panel: 8% */
.dv-theme-nexus .dv-tabs-and-actions-container {
  background: color-mix(
    in oklch,
    var(--module-color, transparent) 8%,
    var(--color-surface-1)
  );
  transition: background-color 120ms ease-out;
}

/* Focused panel bumps to 14% — keyed off Panel.tsx's data-panel-focused */
.dv-theme-nexus [data-panel-focused="true"] .dv-tabs-and-actions-container {
  background: color-mix(
    in oklch,
    var(--module-color, transparent) 14%,
    var(--color-surface-1)
  );
}

/* Active-tab underline */
.dv-theme-nexus .tab.active::after {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 0;
  height: 2px;
  background: var(--module-color, var(--color-accent));
  opacity: 0.75;
}

/* 1 px top divider on the panel body (Level 2 + Level 3) */
.dv-theme-nexus .panel-body::before {
  content: "";
  display: block;
  height: 1px;
  background: color-mix(
    in oklch,
    var(--module-color, transparent) 25%,
    transparent
  );
}

/* Level 2 + Level 3: selected-row tint + 2 px module-color side strip */
.dv-theme-nexus [data-selected="true"] {
  background: color-mix(
    in oklch,
    var(--module-color, transparent) 14%,
    var(--color-surface-2)
  );
  box-shadow: inset 2px 0 0 var(--module-color, transparent);
}

/* Level 3 only — atmospheric body wash */
[data-body-tint-level="L3"] .dv-theme-nexus .panel-body {
  background: color-mix(
    in oklch,
    var(--module-color, transparent) 3%,
    var(--color-surface-1)
  );
}

/* Level 3 only — tinted row hover */
[data-body-tint-level="L3"]
  .dv-theme-nexus
  [data-list-row]:hover:not([data-selected="true"]) {
  background: color-mix(
    in oklch,
    var(--module-color, transparent) 8%,
    transparent
  );
}
```

- [ ] **Step 3: Verify no other CSS rules conflict with the new selectors**

Run: `grep -n "panel-body\|data-list-row\|data-selected\|module-color\|body-tint-level" src/design-system/tokens.css`
Expected output: only the new rules above (no pre-existing rules with the same selectors).

- [ ] **Step 4: Commit**

```bash
git add src/design-system/tokens.css
git commit -m "$(cat <<'EOF'
css: panel-color identity rules (chrome + body L2 + body L3)

Adds tab-bar wash (8% unfocused, 14% focused), active-tab underline,
1px top divider, selected-row tint + side strip, and Level-3-gated
atmospheric body wash + tinted hover. All keyed off --module-color and
the data-body-tint-level attribute that Workspace.tsx will set.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add panel-body class + top-divider hook to Panel.tsx

**Files:**
- Modify: `src/components/panel/Panel.tsx:96` (the inner content div)

- [ ] **Step 1: Add the `panel-body` class to the children wrapper**

In `src/components/panel/Panel.tsx`, find the line:

```tsx
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
```

Replace it with:

```tsx
      <div className="panel-body flex min-h-0 flex-1 flex-col">{children}</div>
```

The `::before` pseudo-element from Task 5's CSS will render the 1 px top divider automatically — no extra JSX or runtime cost.

- [ ] **Step 2: Verify TypeScript + lint pass**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/panel/Panel.tsx
git commit -m "$(cat <<'EOF'
panel: add panel-body class for module-color body styling

Pure className addition so the CSS rules from tokens.css can attach a
1px top divider, selected-row tint, and (when L3 is active) the body
background wash. No behavioral change.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Set --module-color on each dockview group from Workspace.tsx

**Files:**
- Modify: `src/components/Workspace.tsx:120-160` (initLayout body)

- [ ] **Step 1: Add imports near the existing imports at the top of the file**

In `src/components/Workspace.tsx`, add to the existing import block at the top:

```ts
import type { ModuleKey } from "@/data/types";
import { resolvePanelColor } from "@/lib/panelColors";
import { getAppPreferences } from "@/lib/appPreferences";
```

- [ ] **Step 2: Add a helper that applies the active tab's color to a group element**

Add this helper above `function initLayout`:

```ts
/**
 * Set --module-color on a dockview group element based on its active panel.
 * The CSS rules in tokens.css consume this property to render the tab-bar
 * wash, active-tab underline, top divider, and selected-row tint.
 */
function applyModuleColor(group: { activePanel?: { id: string } | null; element?: HTMLElement }) {
  const el = group.element;
  if (!el) return;
  const activeId = group.activePanel?.id;
  if (!activeId) {
    el.style.removeProperty("--module-color");
    return;
  }
  // Active panel ids in our layout match DV_COMPONENTS keys, with optional
  // "viewer-2" / "inspector-abc123" disambiguation suffixes. Strip the suffix
  // to get the module key.
  const moduleKey = activeId.split("-")[0] as ModuleKey;
  const userPrefs = getAppPreferences().panelColors;
  const activeWs = useWorkspace.getState().workspaces.find(
    (w) => w.id === useWorkspace.getState().activeWorkspaceId,
  );
  const wsPrefs = activeWs?.panelColors;
  el.style.setProperty("--module-color", resolvePanelColor(moduleKey, userPrefs, wsPrefs));
}
```

- [ ] **Step 3: Wire up subscriptions inside `initLayout`**

In `initLayout`, find the existing block:

```ts
  // Trigger auto-save on any dockview layout change (resize, rearrange, float).
  api.onDidLayoutChange(() => {
    scheduleAutoSave();
  });
```

Add the following immediately after it:

```ts
  // Apply --module-color to every existing group on initial load.
  api.groups.forEach(applyModuleColor);

  // Re-apply when the active panel inside any group changes (user clicks a tab
  // or drags one in/out).
  api.onDidActivePanelChange(() => {
    api.groups.forEach(applyModuleColor);
  });

  // Re-apply when groups are added (new tab dropped into a new column).
  api.onDidAddGroup((group) => {
    applyModuleColor(group);
  });
```

- [ ] **Step 4: Verify TypeScript + lint pass**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Manual visual check**

Run: `pnpm dev` and open `http://localhost:1420` in a browser.
Expected: each panel's tab bar should show a subtle color wash (Mail = emerald, Inspector = grape, etc.). When you click into a panel, that panel's wash should slightly intensify.

Note: this won't yet show the body-tint level since Task 8 sets it.

- [ ] **Step 6: Commit**

```bash
git add src/components/Workspace.tsx
git commit -m "$(cat <<'EOF'
workspace: apply --module-color to each dockview group

Reads the resolved color for each group's active panel via
resolvePanelColor() and writes it as a CSS custom property on the
group's outer element. Subscribes to onDidActivePanelChange and
onDidAddGroup to keep the color in sync as the user drags tabs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Set data-body-tint-level on the workspace root

**Files:**
- Modify: `src/components/Workspace.tsx` (the JSX returned by the Workspace component, around the DockviewReact element)

- [ ] **Step 1: Add the resolver import (if not already added in Task 7)**

Confirm the top of `src/components/Workspace.tsx` includes:

```ts
import { getAppPreferences } from "@/lib/appPreferences";
import { resolveBodyTintLevel } from "@/lib/panelColors";
```

If `resolveBodyTintLevel` is missing, add it to the same import line as `resolvePanelColor`.

- [ ] **Step 2: Compute the active body-tint level inside the Workspace component**

Find the Workspace component (around line 169 — `export function Workspace()`). Add this hook call near the top of the function body, before the JSX return:

```ts
  // Subscribe to workspace changes so the data attribute updates when the
  // user toggles per-workspace tint or switches workspaces.
  const activeWs = useWorkspace((s) =>
    s.workspaces.find((w) => w.id === s.activeWorkspaceId),
  );
  // Note: app preferences change very rarely (only via Settings panel), and
  // SettingsPanel already triggers a re-render when it edits prefs via the
  // existing pattern. So reading directly here is safe.
  const bodyTintLevel = resolveBodyTintLevel(
    getAppPreferences().panelColors,
    activeWs?.panelColors,
  );
```

- [ ] **Step 3: Set `data-body-tint-level` on the workspace root element**

Find the wrapper `<div>` that contains `<DockviewReact … />` (the existing layout root). It should be a `<div>` immediately surrounding `<DockviewReact>`. Add the attribute to it:

```tsx
    <div className="… (existing classes)" data-body-tint-level={bodyTintLevel}>
```

If there is no wrapper div (DockviewReact is rendered directly), wrap it:

```tsx
    <div data-body-tint-level={bodyTintLevel} className="h-full">
      <DockviewReact … />
    </div>
```

The exact placement: identify the JSX element that already establishes the workspace shell (the one rendering DockviewReact). It must remain the root of the workspace shell so the `[data-body-tint-level]` selector reaches into the dockview subtree.

- [ ] **Step 4: Verify TypeScript + lint pass**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Manual visual check**

Run: `pnpm dev`.
Expected: by default `data-body-tint-level="L2"` is set on the workspace root. Inspect the DOM in devtools to confirm. No visible change yet (Level 3 isn't activated, and the L2 selected-row tint requires Task 9).

- [ ] **Step 6: Commit**

```bash
git add src/components/Workspace.tsx
git commit -m "$(cat <<'EOF'
workspace: emit data-body-tint-level on root for L2/L3 CSS gating

Reads the effective body-tint level via resolveBodyTintLevel() and
writes it as a data attribute on the workspace shell root so the CSS
rules in tokens.css can opt panel bodies into the Level-3 wash and
hover state.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Add data-selected and data-list-row to row components

**Files:**
- Modify: `src/components/email/EmailRow.tsx` (the outermost `<button>` or `<div>` element of the row)
- Modify: `src/components/nav/NavigationPanel.tsx` (SystemLabelRow `<button>` around line 286, FolderTreeNode row `<button>`, UserLabelRow `<button>`)
- Modify: `src/components/contacts/ContactsPanel.tsx` (ContactRow `<button>` around line 44)
- Modify: `src/components/calendar/AgendaView.tsx` (or whatever the agenda row container is — search for `selectedEventId` to find it)

For each row, add **two** attributes to the outermost element:
- `data-list-row` (always, no value — boolean presence)
- `data-selected={active ? "true" : undefined}` where `active` is the existing variable already controlling the selected styling.

- [ ] **Step 1: EmailRow.tsx**

In `src/components/email/EmailRow.tsx`, find the outermost wrapper element of the row (the one currently styled with the row hover/selected classes). Add the two attributes. Example: if the wrapper is

```tsx
    <div
      role="row"
      aria-selected={inSelectionSet}
      …
```

add `data-list-row data-selected={inSelectionSet ? "true" : undefined}` alongside the existing attributes.

- [ ] **Step 2: NavigationPanel.tsx — SystemLabelRow**

Find the `<button>` opening tag for `SystemLabelRow` (around line 286). Add the attributes:

```tsx
    <button
      type="button"
      data-list-row
      data-selected={active ? "true" : undefined}
      onClick={() => setFolder(label.id)}
      …
```

- [ ] **Step 3: NavigationPanel.tsx — FolderTreeNode and UserLabelRow**

Find the equivalent `<button>` opening tags for FolderTreeNode (around line 509+) and UserLabelRow (around line 359+). Add the same two attributes to each, using their respective `active` variables.

- [ ] **Step 4: ContactsPanel.tsx — ContactRow**

In `src/components/contacts/ContactsPanel.tsx` around line 44, add the attributes to the row `<button>`:

```tsx
    <button
      onClick={onSelect}
      data-list-row
      data-selected={isSelected ? "true" : undefined}
      …
```

- [ ] **Step 5: Calendar agenda rows**

In `src/components/calendar/AgendaView.tsx`, find the inline `function EventRow({ event })` definition (around line 37) and the outermost element of its return. Add the two attributes. The selected-event id is held in the workspace store — find the existing `selectedEventId` (or similar) usage to compute the boolean. If the row has no selection concept yet, omit `data-selected` and only add `data-list-row` (the L3 hover still works; the L2 selected-row tint just doesn't apply to agenda items).

- [ ] **Step 6: Verify TypeScript + lint pass**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 7: Manual visual check — Level 2 selected rows**

Run: `pnpm dev`. Click on different rows in each panel.
Expected: the selected row in each panel should now show a tinted background in that panel's module color, plus a 2 px module-color side strip on the left edge. Unselected rows remain unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/components/email/EmailRow.tsx src/components/nav/NavigationPanel.tsx src/components/contacts/ContactsPanel.tsx src/components/calendar/AgendaView.tsx
git commit -m "$(cat <<'EOF'
rows: add data-list-row + data-selected attributes for module-color tint

Tags every list-row container in the major panels (mail, nav, folder
tree, user labels, contacts, agenda) with two data attributes that the
CSS rules in tokens.css use to render the selected-row tint and the
Level-3 hover state. No behavior change — pure markup.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Create the SwatchPopover component

**Files:**
- Create: `src/components/settings/SwatchPopover.tsx`

- [ ] **Step 1: Read an existing Radix Popover usage to match the project's style**

Run: `grep -rn "@radix-ui/react-popover" src/components | head -3`
Read one of the matched files briefly to confirm the import shape and trigger/content pattern used in this codebase.

- [ ] **Step 2: Implement SwatchPopover**

Create `src/components/settings/SwatchPopover.tsx`:

```tsx
import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toCssColor } from "@/lib/panelColors";

interface SwatchPopoverProps {
  /** Current stored value: "link-N" or "#rrggbb". */
  value: string;
  /** Called when the user commits a new color (palette click or valid hex). */
  onChange: (next: string) => void;
  /** ARIA label for the trigger chip. */
  label: string;
}

const PALETTE: Array<{ id: string; name: string }> = [
  { id: "link-1", name: "coral" },
  { id: "link-2", name: "amber" },
  { id: "link-3", name: "lime" },
  { id: "link-4", name: "emerald" },
  { id: "link-5", name: "teal" },
  { id: "link-6", name: "violet" },
  { id: "link-7", name: "rose" },
  { id: "link-8", name: "slate" },
  { id: "link-9", name: "crimson" },
  { id: "link-10", name: "orange" },
  { id: "link-11", name: "yellow" },
  { id: "link-12", name: "sage" },
  { id: "link-13", name: "forest" },
  { id: "link-14", name: "seafoam" },
  { id: "link-15", name: "sky" },
  { id: "link-16", name: "blue" },
  { id: "link-17", name: "indigo" },
  { id: "link-18", name: "grape" },
  { id: "link-19", name: "fuchsia" },
  { id: "link-20", name: "blush" },
  { id: "link-21", name: "steel" },
];

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function SwatchPopover({ value, onChange, label }: SwatchPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [customHex, setCustomHex] = React.useState("");
  const [hexError, setHexError] = React.useState(false);

  const isCustom = !value.startsWith("link-");

  React.useEffect(() => {
    // Reset custom-hex input whenever the popover opens, showing the current
    // hex if applicable.
    if (open) {
      setCustomHex(isCustom ? value : "");
      setHexError(false);
    }
  }, [open, value, isCustom]);

  const commitHex = () => {
    const trimmed = customHex.trim();
    if (!HEX_RE.test(trimmed)) {
      setHexError(true);
      return;
    }
    onChange(trimmed);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "size-[22px] rounded-xs border border-border-default",
            "focus-visible:outline-none focus-visible:shadow-focus",
          )}
          style={{ background: toCssColor(value) }}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 rounded-md border border-border-default bg-surface-2 p-2.5 shadow-l2"
        >
          <div className="grid grid-cols-7 gap-1.5">
            {PALETTE.map((p) => {
              const selected = p.id === value;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-label={p.name}
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "size-[22px] rounded-xs border border-border-subtle",
                    "relative focus-visible:outline-none focus-visible:shadow-focus",
                  )}
                  style={{ background: toCssColor(p.id) }}
                >
                  {selected && (
                    <Check
                      size={12}
                      className="absolute inset-0 m-auto text-white drop-shadow"
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-2 border-t border-border-subtle pt-2">
            <label className="flex items-center gap-2 text-mono-xs text-text-tertiary">
              <span className="shrink-0">+ Custom hex</span>
              <input
                value={customHex}
                onChange={(e) => {
                  setCustomHex(e.target.value);
                  setHexError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitHex();
                  }
                }}
                placeholder="#aabbcc"
                className={cn(
                  "h-6 flex-1 rounded-xs border bg-surface-3 px-1.5 font-mono text-mono-xs",
                  hexError ? "border-danger" : "border-border-subtle",
                )}
              />
              <button
                type="button"
                onClick={commitHex}
                className="rounded-xs border border-border-subtle px-1.5 py-px text-mono-xs hover:bg-surface-3"
              >
                Set
              </button>
            </label>
            {hexError && (
              <div className="mt-1 text-caption text-danger">
                Use 3- or 6-digit hex like #aabbcc
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

- [ ] **Step 3: Verify TypeScript + lint pass**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/SwatchPopover.tsx
git commit -m "$(cat <<'EOF'
settings: SwatchPopover — 21-color palette + custom hex picker

Reusable color picker used by PanelColorsSettings. Trigger is a 22px
chip showing the current color; popover shows the 21 named link-*
swatches in a 7×3 grid (with ✓ on the current selection) plus a
"+ Custom hex" input that accepts 3- or 6-digit hex. Invalid hex
shows an inline error and does not commit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Create the PanelColorsSettings component

**Files:**
- Create: `src/components/settings/PanelColorsSettings.tsx`
- Modify: `src/state/workspace.ts` (add a setter for `activeWorkspace.panelColors`)
- Modify: `src/lib/appPreferences.ts` (no change if already exposing saveAppPreferences)

- [ ] **Step 1: Add a workspace mutation in `src/state/workspace.ts`**

Find the existing action shape in `src/state/workspace.ts` (look for an existing setter like `setListPanelState` or `setDensity`). Add a new action that updates the active workspace's `panelColors`:

```ts
  setActiveWorkspacePanelColors: (next: PanelColorPrefs | undefined) =>
    set((s) => {
      const updatedWorkspaces = s.workspaces.map((w) =>
        w.id === s.activeWorkspaceId
          ? { ...w, panelColors: next, updatedAt: Date.now() }
          : w,
      );
      saveWorkspacesToStorage({
        workspaces: updatedWorkspaces,
        activeId: s.activeWorkspaceId,
      });
      return { workspaces: updatedWorkspaces };
    }),
```

Add the matching action signature to the `WorkspaceState` interface where the other actions are typed:

```ts
  setActiveWorkspacePanelColors: (next: PanelColorPrefs | undefined) => void;
```

Add the import for `PanelColorPrefs` at the top of the file if not already there:

```ts
import type { PanelColorPrefs } from "@/data/types";
```

- [ ] **Step 2: Implement PanelColorsSettings**

Create `src/components/settings/PanelColorsSettings.tsx`:

```tsx
import * as React from "react";
import {
  Compass,
  Mail,
  MessageSquare,
  Info,
  Users,
  Calendar,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ModuleKey, PanelColorPrefs } from "@/data/types";
import {
  DEFAULT_MODULE_COLORS,
  toCssColor,
} from "@/lib/panelColors";
import {
  getAppPreferences,
  saveAppPreferences,
} from "@/lib/appPreferences";
import { useWorkspace } from "@/state/workspace";
import { SwatchPopover } from "@/components/settings/SwatchPopover";

interface ModuleMeta {
  key: ModuleKey;
  name: string;
  description: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}

const MODULES: ModuleMeta[] = [
  { key: "nav", name: "Navigation", description: "Sidebar with folders, labels, calendars", Icon: Compass },
  { key: "list", name: "Mail", description: "Message list", Icon: Mail },
  { key: "viewer", name: "Message", description: "Reader / thread viewer", Icon: MessageSquare },
  { key: "inspector", name: "Inspector", description: "Per-message metadata sidebar", Icon: Info },
  { key: "contacts", name: "Contacts", description: "Address book", Icon: Users },
  { key: "calendar", name: "Calendar", description: "Agenda, week, month views", Icon: Calendar },
  { key: "settings", name: "Settings", description: "This panel", Icon: SettingsIcon },
];

export function PanelColorsSettings() {
  // Re-render trigger: bump on every save so reads of getAppPreferences are fresh.
  const [, bump] = React.useReducer((x: number) => x + 1, 0);

  const activeWs = useWorkspace((s) =>
    s.workspaces.find((w) => w.id === s.activeWorkspaceId),
  );
  const setActiveWorkspacePanelColors = useWorkspace(
    (s) => s.setActiveWorkspacePanelColors,
  );

  const userPrefs = getAppPreferences().panelColors;
  const wsPrefs = activeWs?.panelColors;
  const editingWorkspace = !!wsPrefs;
  const activePrefs: PanelColorPrefs = wsPrefs ?? userPrefs;

  const writePrefs = (next: PanelColorPrefs) => {
    if (editingWorkspace) {
      setActiveWorkspacePanelColors(next);
    } else {
      saveAppPreferences({ panelColors: next });
    }
    bump();
  };

  const toggleWorkspaceOverride = (checked: boolean) => {
    if (checked) {
      // Seed the workspace override from the current user prefs (so the user
      // sees the same colors they had before opting in).
      setActiveWorkspacePanelColors({ ...userPrefs });
    } else {
      // Drop the workspace override entirely.
      setActiveWorkspacePanelColors(undefined);
    }
    bump();
  };

  const setModuleColor = (module: ModuleKey, color: string) => {
    writePrefs({
      ...activePrefs,
      colors: { ...activePrefs.colors, [module]: color },
    });
  };

  const resetModule = (module: ModuleKey) => {
    const { [module]: _, ...rest } = activePrefs.colors;
    writePrefs({ ...activePrefs, colors: rest });
  };

  const resetAll = () => {
    writePrefs({ ...activePrefs, colors: {} });
  };

  const setBodyTintLevel = (level: "L2" | "L3") => {
    writePrefs({ ...activePrefs, bodyTintLevel: level });
  };

  return (
    <section>
      <h3 className="mb-3 flex items-center text-h3 font-semibold">
        Panel Colors
        <button
          type="button"
          onClick={resetAll}
          className="ml-auto rounded-xs border border-border-subtle px-2 py-0.5 text-mono-xs text-text-tertiary hover:bg-surface-2"
        >
          Reset all to defaults
        </button>
      </h3>

      {/* Workspace override toggle */}
      <label className="mb-4 flex items-center gap-2 text-body">
        <input
          type="checkbox"
          checked={editingWorkspace}
          onChange={(e) => toggleWorkspaceOverride(e.target.checked)}
        />
        <span>Use custom colors for this workspace</span>
        {editingWorkspace && (
          <span className="ml-1 text-caption text-text-tertiary">
            (editing &ldquo;{activeWs?.name}&rdquo;)
          </span>
        )}
      </label>

      {/* Body-tint level */}
      <div className="mb-4 flex items-center gap-3 text-body">
        <span>Body tint:</span>
        {(["L2", "L3"] as const).map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => setBodyTintLevel(level)}
            className={cn(
              "rounded-xs border px-2 py-0.5 text-mono-xs",
              activePrefs.bodyTintLevel === level
                ? "border-accent bg-accent-soft text-text-primary"
                : "border-border-subtle text-text-tertiary hover:bg-surface-2",
            )}
          >
            {level === "L2" ? "Level 2 (default)" : "Level 3 (immersive)"}
          </button>
        ))}
      </div>

      {/* Module rows */}
      <div className="rounded-md border border-border-subtle">
        {MODULES.map((m, idx) => {
          const current =
            activePrefs.colors[m.key] ?? DEFAULT_MODULE_COLORS[m.key];
          const isOverride = m.key in activePrefs.colors;
          return (
            <div
              key={m.key}
              className={cn(
                "flex items-center gap-3 px-3 py-2",
                idx < MODULES.length - 1 && "border-b border-border-subtle",
              )}
            >
              <span
                className="flex size-5 items-center justify-center rounded-xs bg-surface-2 text-text-tertiary"
              >
                <m.Icon size={12} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-body-strong">{m.name}</div>
                <div className="text-caption text-text-tertiary">
                  {m.description}
                </div>
              </div>
              {isOverride && (
                <button
                  type="button"
                  onClick={() => resetModule(m.key)}
                  className="text-mono-xs text-text-tertiary hover:text-text-primary"
                >
                  Reset
                </button>
              )}
              <SwatchPopover
                value={current}
                label={`${m.name} color`}
                onChange={(c) => setModuleColor(m.key, c)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Verify TypeScript + lint pass**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/PanelColorsSettings.tsx src/state/workspace.ts
git commit -m "$(cat <<'EOF'
settings: PanelColorsSettings — module rows + workspace toggle + L2/L3

User-facing UI for the panel-color identity system. One row per module
(icon + name + description + per-row Reset + swatch chip), a workspace
override toggle that switches edits between user-level and
workspace-level, a body-tint segmented control (L2 / L3), and a
Reset-all-to-defaults button. Reads/writes via getAppPreferences,
saveAppPreferences, and a new setActiveWorkspacePanelColors action on
the workspace Zustand store.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Wire PanelColorsSettings into the SettingsPanel

**Files:**
- Modify: `src/components/settings/SettingsPanel.tsx` (the existing `preferences` section render block, currently around lines 1327–1707)

- [ ] **Step 1: Add the import at the top of `SettingsPanel.tsx`**

```ts
import { PanelColorsSettings } from "@/components/settings/PanelColorsSettings";
```

- [ ] **Step 2: Render PanelColorsSettings inside the preferences section**

Find the JSX block matching `{activeSection === "preferences" && (` (around line 1327). Inside that block — preferably at the bottom, after the existing sub-sections — render the new component:

```tsx
            <PanelColorsSettings />
```

- [ ] **Step 3: Verify TypeScript + lint pass**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 4: Manual end-to-end check**

Run: `pnpm dev`.

1. Open Settings → Preferences. Scroll to **Panel Colors**. Confirm all 7 module rows render with their default swatches.
2. Click the Mail swatch → pick a different palette color. Confirm the Mail tab bar's wash immediately reflects the new color.
3. Click Reset on the Mail row. Confirm it returns to the default emerald.
4. Toggle **Use custom colors for this workspace** ON. Change Mail to rose. Open a second workspace (or create one via the workspace switcher). Confirm the second workspace still shows the default emerald (workspace overrides don't bleed).
5. Toggle **Body tint** to Level 3 in any workspace. Confirm the panel bodies pick up a very subtle wash and hovered rows tint.
6. Open the Mail swatch → click **+ Custom hex** → enter `#ff8800` → press Enter. Confirm the Mail tab bar wash becomes orange.
7. Reload the app (`Cmd+R` in dev). Confirm all customizations persist.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/SettingsPanel.tsx
git commit -m "$(cat <<'EOF'
settings: mount PanelColorsSettings under Preferences

Wires the new Panel Colors section into Settings → Preferences so the
end-to-end customization flow is reachable from the UI.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Run the full verification suite

**Files:** none (verification only)

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: all tests pass, including the new `panelColors.test.ts`.

- [ ] **Step 2: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 3: Manual visual sweep**

Run: `pnpm dev` and confirm the following against the spec:

1. **Chrome treatment** — every panel's tab bar shows the 8 % wash; the focused panel bumps to 14 %; the active tab in every tab bar shows the 2 px module-color underline.
2. **Top divider** — there's a faint module-color horizontal line just under each panel's tab bar.
3. **Selected row (L2)** — clicking a row in Mail, Nav, Contacts, or Calendar tints it with the panel's module color and adds a 2 px module-color side strip.
4. **L3 body wash + hover** — toggling L3 in Settings causes panel bodies to take a very subtle tinted wash and hovered rows show a faint tint.
5. **Drag a tab between groups** — drag the Calendar tab from the Message panel into the Mail panel. Confirm the Mail panel's wash changes to rose while Calendar is the active tab, and back to emerald when Mail is reactivated.
6. **Per-workspace override** — make a customization, switch workspaces, confirm the other workspace shows its own state.
7. **Reset all** — clicking "Reset all to defaults" returns every swatch to its default and the workspace immediately re-renders with the default mapping.
8. **Accent stays global** — confirm buttons, focus rings, and link text are still using the existing crimson accent (no change).

- [ ] **Step 4: No extra commit unless a regression was found and fixed**

If everything passes, no commit. The verification step is the final stop.

---

## Out of plan (deferred / not covered)

- **Light theme variants** — `--color-link-*` already has light-theme overrides at the existing CSS layer (see `tokens.css` around line 148). The wash uses `color-mix(in oklch, …, var(--color-surface-1))` which adapts automatically when the surface token swaps. No additional work needed for theme parity.
- **Linting rules to enforce ModuleKey ↔ DV_COMPONENTS consistency** — the spec calls for matching keys; a future codebase-level lint can enforce it. Out of scope for v1.
- **Settings UI for the side fix (unread row weights)** — already shipped in commit `e1713b1`.
- **Avatar work** — already shipped in commit `9dccb17`.
