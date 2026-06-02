# Panel Color Identity — Design

**Status:** Spec · **Date:** 2026-06-02 · **Owner:** wfhl

## Goal

Give each Nexus module type (Mail, Inspector, Calendar, etc.) a glanceable color identity that travels with its tab wherever it's docked, so a user can identify a panel at a glance without changing existing Nexus typography, density, or interaction patterns.

## Non-goals

- Replace `--color-accent` (buttons, focus rings, links keep their existing crimson).
- Style panel content beyond what's defined under "Visual treatment — body" below.
- Style any non-dockview chrome (top bar, workspace switcher, modals, popovers).

## Visual treatment

Color identity belongs to the **module type**, not the column position. When the user drags Inspector into the Mail column, the wash and underline that previously rendered with Mail's emerald immediately switch to Inspector's grape — the color follows the tab.

### Chrome (always on)

- **Tab-bar background wash** — the dockview tab bar background is mixed: `color-mix(in oklch, var(--module-color) <intensity>%, var(--color-surface-1))`.
  - Unfocused panel: **8 %**
  - Focused panel: **14 %** — keyed off the existing `data-panel-focused="true"` attribute on `Panel`.
- **Active-tab underline** — 2 px bar at the bottom of the active tab in `var(--module-color)` at ~75 % opacity. Replaces the existing dockview default underline.
- **Multi-tab panels** — the wash reflects the *active* tab's module color (each tab carries its own `--module-color`; the active one wins for the bar background).

### Body — Level 2 (default)

- **Selected-row background** — `color-mix(in oklch, var(--module-color) 14%, var(--color-surface-2))`
- **Selected-row side strip** — 2 px module-color bar on the left edge of the selected row
- **Top divider** — 1 px module-color horizontal rule directly under the tab bar at ~25 % opacity, separating the chrome wash from the body.

### Body — Level 3 (opt-in)

Everything from Level 2 plus:
- **Atmospheric body wash** — `color-mix(in oklch, var(--module-color) 3%, var(--color-surface-1))` on the panel body container.
- **Tinted row hover** — `color-mix(in oklch, var(--module-color) 8%, transparent)`.

Level 2 is the default for every user and workspace; Level 3 is selectable via a toggle in Settings → Preferences → Panel Colors and is per-workspace overridable.

## Default color mapping

The seven canonical modules map to existing tokens from the 21-color `--color-link-*` palette:

| Module key | Default | Token |
| --- | --- | --- |
| `nav` | blue | `link-16` |
| `list` | emerald | `link-4` |
| `viewer` | steel | `link-21` |
| `inspector` | grape | `link-18` |
| `contacts` | amber | `link-2` |
| `calendar` | rose | `link-7` |
| `settings` | slate | `link-8` |

The keys mirror the existing dockview component keys in `DV_COMPONENTS` ([Workspace.tsx:43](../../../src/components/Workspace.tsx)).

## User customization

A new section **Panel Colors** lives under Settings → Preferences. Layout:

1. **Header row** — section title plus a "Reset all to defaults" button.
2. **Workspace toggle** — `Use custom colors for this workspace`. When off, the workspace inherits user-level defaults. When on, edits in this section write to the workspace's own override map.
3. **Body-tint level** — segmented control: *Level 2* (default) · *Level 3* (immersive). Also per-workspace overridable.
4. **One row per module** — 20 px icon, module name, one-line description, per-row **Reset** button, and a 22 px swatch chip.
5. **Swatch chip → popover** — 7×3 grid of the 21 `--color-link-*` palette swatches. The currently selected swatch shows a `✓`. Below the grid, a **+ Custom hex…** link expands a `#rrggbb` input. Pressing Enter or clicking a palette swatch commits and closes the popover.

The Reset button next to each row writes the current default for that module (workspace default if a workspace override is active, otherwise the system default). Reset-all wipes the active layer (user or workspace, depending on which is being edited).

## Storage

### App-level preferences

Extends `AppPreferences` in [`src/lib/appPreferences.ts`](../../../src/lib/appPreferences.ts):

```ts
interface PanelColorPrefs {
  // Resolved CSS color (a hex like "#aabbcc") OR a token reference like "link-4".
  colors: Partial<Record<ModuleKey, string>>;
  // "L2" (default) or "L3" (immersive body wash).
  bodyTintLevel: "L2" | "L3";
}

interface AppPreferences {
  // … existing fields …
  panelColors: PanelColorPrefs;
}
```

`ModuleKey` is `"nav" | "list" | "viewer" | "inspector" | "contacts" | "calendar" | "settings"` — declared once in [`src/data/types.ts`](../../../src/data/types.ts) (the canonical types file) and imported by `appPreferences.ts`, `Workspace.tsx`, and the resolver. The values must remain identical to the keys in [`DV_COMPONENTS`](../../../src/components/Workspace.tsx). A new module added to dockview must also be added to this union and given a system default in the "Default color mapping" table above (with a corresponding `DEFAULT_MODULE_COLORS` const exported from `appPreferences.ts`).

`DEFAULTS.panelColors` is `{ colors: {}, bodyTintLevel: "L2" }`. Empty `colors` means "use the system default mapping" — overrides only persist when the user actually changes a swatch.

### Workspace-level override

Extends the workspace snapshot persisted via [`src/storage/workspaceManager.ts`](../../../src/storage/workspaceManager.ts):

```ts
interface WorkspaceSnapshot {
  // … existing fields …
  panelColors?: PanelColorPrefs;  // optional — omitted means "inherit user defaults"
}
```

A workspace has an override when `panelColors` is present; when absent, the resolver falls through to user-level preferences.

## Resolution

A single resolver lives next to `appPreferences.ts`:

```ts
function resolvePanelColor(module: ModuleKey, workspaceId?: string): string;
function resolveBodyTintLevel(workspaceId?: string): "L2" | "L3";
```

Resolution order for both functions:

1. Active workspace override (when present)
2. User-level preference (when set)
3. System default mapping (in this spec)

The returned string is a CSS color usable as `var(--module-color)`. Token references (`"link-4"`) are translated to `var(--color-link-4)` so dark/light-mode swaps continue to work automatically. Hex strings pass through unchanged.

## Plumbing

### Workspace.tsx

For each dockview group, set `--module-color` on the group's outer element using the active tab's resolved color. Subscribe to dockview's `onDidActiveGroupChange` and `onDidActivePanelChange` events to update when the user clicks tabs or rearranges panels. Also set `data-body-tint-level="L2"|"L3"` on the workspace root.

### tokens.css

New CSS rules consume `--module-color` and the body-tint level data attribute:

```css
/* Tab-bar wash (always on, unfocused) */
.dv-theme-nexus .dv-tabs-and-actions-container {
  background: color-mix(in oklch, var(--module-color, transparent) 8%, var(--color-surface-1));
}
/* Focused panel bumps to 14% */
.dv-theme-nexus [data-panel-focused="true"] .dv-tabs-and-actions-container {
  background: color-mix(in oklch, var(--module-color, transparent) 14%, var(--color-surface-1));
}
/* 2 px active-tab underline */
.dv-theme-nexus .tab.active::after {
  content: "";
  position: absolute;
  left: 8px; right: 8px; bottom: 0;
  height: 2px;
  background: var(--module-color, var(--color-accent));
  opacity: 0.75;
}
/* 1 px top divider under the tab bar (~25% opacity) */
.dv-theme-nexus .panel-body::before {
  content: "";
  display: block;
  height: 1px;
  background: color-mix(in oklch, var(--module-color, transparent) 25%, transparent);
}
/* Level 2: selected-row tint + 2 px module-color side strip */
.dv-theme-nexus [data-selected="true"] {
  background: color-mix(in oklch, var(--module-color, transparent) 14%, var(--color-surface-2));
  box-shadow: inset 2px 0 0 var(--module-color, transparent);
}
/* Level 3: atmospheric body wash */
[data-body-tint-level="L3"] .dv-theme-nexus .panel-body {
  background: color-mix(in oklch, var(--module-color, transparent) 3%, var(--color-surface-1));
}
/* Level 3: tinted row hover */
[data-body-tint-level="L3"] .dv-theme-nexus [data-list-row]:hover:not([data-selected="true"]) {
  background: color-mix(in oklch, var(--module-color, transparent) 8%, transparent);
}
```

Existing dockview CSS variable bindings remain; the rules above are additive.

### Panel.tsx

`Panel`'s body section gets a `panel-body` class and a top-divider element. The top divider is purely a CSS pseudo-element (`::before` on `.panel-body`) — no JSX change, no runtime cost.

### Selected-row hook-in

Each existing list/row component (EmailRow, FolderRow, SystemLabelRow, ContactRow, etc.) already conveys selection via Tailwind classes (`bg-accent-soft` or similar). We do NOT change those classes.

Instead, the module-color rules target `data-selected="true"` — a single conventional attribute added to the selected row element of each list. Where a component doesn't already expose it, the implementation plan adds it as a one-line change (no logic change — the boolean is the same one already driving the Tailwind class).

`data-selected` is chosen over `aria-selected` because `aria-selected` has semantic constraints (only valid on options/rows/tabs/treeitems) and some Nexus rows are buttons; a plain `data-*` attribute is unambiguous and styling-only.

For the Level 3 hover rule, row elements that should participate in module-color theming also gain a `data-list-row` attribute (boolean presence). These are the same row components affected by `data-selected` — adding both attributes is one PR pass through the row components.

## Settings UI — component shape

A new component `PanelColorsSettings.tsx` mounts under the existing Preferences section in [`SettingsPanel.tsx`](../../../src/components/settings/SettingsPanel.tsx). Internal structure:

- `PanelColorsHeader` — title + Reset-all
- `WorkspaceOverrideToggle` — checkbox bound to "this workspace has its own colors"
- `BodyTintLevelControl` — segmented control (L2 / L3)
- `ModuleColorRow[7]` — repeated row component
- `SwatchPopover` — palette grid + custom-hex input (Radix Popover, mirrors the existing `LabelPickerPopover` styling)

State writes go through `appPreferences.ts` setters (for user-level edits) or through the workspace-mutation pipeline (for workspace-level edits). Reactive: subscribers to `useAppPreferences()` and `useWorkspace()` already re-render on changes, so the UI updates immediately.

## Migration

- Existing users: `panelColors` field is absent from their stored `AppPreferences` JSON; the loader merges with `DEFAULTS` (the existing pattern), so they get `{ colors: {}, bodyTintLevel: "L2" }` and see the new default mapping.
- Existing workspaces: `panelColors` is absent; the workspace inherits user-level defaults, so no visual change happens until the user opts in.
- No DB migration. No vault schema change. No relay change.

## Risk / mitigation

- **Color clash with existing accent uses.** Mitigation: module color is scoped to dockview chrome + row selection. The `--color-accent` token is untouched. Visual review during implementation will catch any spillover.
- **Reduced contrast on busy backgrounds in Level 3.** Mitigation: Level 3 wash is 3 % — barely visible. Selected-row tint already mixes against `--color-surface-2` to preserve text contrast. Both are testable against WCAG AA at implementation time using the existing chrome.
- **Per-workspace storage growth.** Mitigation: the override map is optional and only persists when the user opts in. Empty by default.
- **Custom hex picker bypasses dark/light mode swap.** Mitigation: custom hex is a deliberate user override; the user accepting "+ Custom hex…" implicitly accepts that the color is fixed across themes. The 21-color palette remains the recommended path.

## Side fix (already shipped)

The brainstorming session also surfaced inconsistent text rendering on unread rows in the navigation panel. The conditional `text-text-primary` color bump in [`NavigationPanel.tsx:318`](../../../src/components/nav/NavigationPanel.tsx) (SystemLabelRow) and [`:605`](../../../src/components/nav/NavigationPanel.tsx) (FolderRow) has been removed — unread state is now signalled only by the count badge, so Inbox / Spam / Important render identically to Sent / Drafts / Trash regardless of selection state.

## Implementation notes (not normative — for the plan to flesh out)

- The dockview group element is reachable via `api.group?.element` from `Workspace.tsx`'s `initLayout`.
- Setting CSS custom properties on the group element is preferred over global injection — keeps each group's color isolated from siblings.
- The L2 / L3 toggle being per-workspace means the body data attribute lives on the workspace shell, not the document root.
- All new CSS lives in `src/design-system/tokens.css` next to the existing `.dv-theme-nexus` rules.
