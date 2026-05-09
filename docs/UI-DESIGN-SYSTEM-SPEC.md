# NEXUS — UI Design System Specification

**Status:** v1.0 draft for implementation
**Audience:** Frontend engineers, design QA, contributors building modules
**Scope:** Visual + interaction design system for the NEXUS desktop workspace
(Tauri v2 + React/TypeScript, shadcn/ui + Tailwind, dockview)

This document is the source of truth for tokens, component states, panel
behavior, motion, and accessibility. It is written so a developer can build
any component or state without asking a designer a single question. Where
a decision needs the product owner's explicit blessing, it is flagged
**🚩 PO DECISION**.

---

## Table of Contents

1. [Foundations](#1-foundations)
2. [Design Token Inventory](#2-design-token-inventory)
3. [Component State Matrix](#3-component-state-matrix)
4. [Panel System Visual Spec](#4-panel-system-visual-spec)
5. [Email-Specific Patterns](#5-email-specific-patterns)
6. [Interaction Patterns](#6-interaction-patterns)
7. [Typography Usage Guide](#7-typography-usage-guide)
8. [Iconography System](#8-iconography-system)
9. [Motion & Micro-interaction Spec](#9-motion--micro-interaction-spec)
10. [Accessibility Checklist](#10-accessibility-checklist)
11. [Tailwind Configuration](#11-tailwind-configuration)
12. [Open Decisions for Product Owner](#12-open-decisions-for-product-owner)

---

## 1. Foundations

### 1.1 Design north star

NEXUS is a **power tool**, not a consumer app. The design optimizes for:

- **Density without noise** — every pixel earns its keep, but visual hierarchy
  prevents the screen from feeling crowded.
- **Keyboard primacy** — every state must be reachable, visible, and
  distinguishable without a mouse.
- **Spatial memory** — panels, columns, and chrome live in predictable places
  across sessions and workspaces.
- **Focused attention** — Content-Aware Dimming reduces the visual weight of
  metadata so primary content reads first.

### 1.2 Locked decisions (do not revisit)

| Concern | Decision |
|---|---|
| UI library | shadcn/ui + Tailwind, build on top, do not replace |
| Panel system | dockview |
| Runtime | Tauri v2 (WebKit on macOS, WebView2 on Windows) |
| UI font | Inter (recommended) — bundled — see §7.1 |
| Mono font | JetBrains Mono — bundled |
| Theme | Dark is the primary design target; light is derived |
| Layout | Container Queries, never media queries, for module layouts |
| Scrollbars | `scrollbar-gutter: stable` on every scroll container |
| Focus ring | 2px solid accent, sharp; no rounded blur, no glow |
| Z-axis | L0 base chrome → L1 panels → L2 HUD → L3 overlays/modals |
| Panel taxonomy | Stage, Inspector, HUD, Navigation |

### 1.3 Theme model

Two themes ship: **dark** (primary) and **light** (derived). Every token in
§2 has a value in both. Themes are toggled by adding `class="dark"` (or
omitting it) on the `<html>` element. shadcn already follows this convention.

```html
<html class="dark">  <!-- default -->
<html>               <!-- light theme -->
```

There is no system-pref auto-toggle in v1 unless §12 #1 is resolved that way.

### 1.4 Z-axis layers

| Layer | Used by | Token |
|---|---|---|
| L0 | App background, workspace chrome, status bar | `--shadow-l0` (none) |
| L1 | Panels in their docked position | `--shadow-l1` |
| L2 | Floating/detached panels, HUDs, popovers, dropdowns | `--shadow-l2` |
| L3 | Modals, sheets, command palette | `--shadow-l3` |
| L4 | Toast stack, tooltips (above modals) | `--shadow-l4` |

---

## 2. Design Token Inventory

Tokens are CSS custom properties on `:root` (light) and `.dark` (dark). All
Tailwind theme extensions in §11 reference these variables, so a single
token edit propagates everywhere.

> **Format note.** Color values are given in **OKLCH** for perceptual
> tuning, with a hex fallback comment. The Tailwind config reads the
> OKLCH variable; hex is informational only.

### 2.1 Color tokens — Background & surface

These form the L0–L4 surface ladder. Each step is ~3.5 ΔL* lighter than the
previous so adjacent layers separate without a border.

```css
.dark {
  /* Surfaces (L0 darkest → L4 lightest) */
  --color-bg-canvas:      oklch(0.145 0.005 270); /* #0A0B0D — app body */
  --color-surface-1:      oklch(0.180 0.005 270); /* #111316 — panel base */
  --color-surface-2:      oklch(0.215 0.006 270); /* #181A1E — input, raised row */
  --color-surface-3:      oklch(0.255 0.007 270); /* #1F2228 — popover, HUD */
  --color-surface-4:      oklch(0.295 0.008 270); /* #272A31 — modal, cmdk */
  --color-surface-inset:  oklch(0.115 0.004 270); /* #06070A — pressed wells, code blocks */
}

:root {
  --color-bg-canvas:      oklch(0.985 0.002 270); /* #F8F9FB */
  --color-surface-1:      oklch(1.000 0 0);       /* #FFFFFF */
  --color-surface-2:      oklch(0.975 0.003 270); /* #F2F3F6 */
  --color-surface-3:      oklch(0.955 0.004 270); /* #E9EBEF */
  --color-surface-4:      oklch(0.935 0.005 270); /* #DEE1E7 */
  --color-surface-inset:  oklch(0.920 0.005 270); /* #D3D6DD */
}
```

### 2.2 Color tokens — Borders & dividers

```css
.dark {
  --color-border-subtle:   rgba(255, 255, 255, 0.06); /* divider inside a panel */
  --color-border-default:  rgba(255, 255, 255, 0.10); /* panel edges, inputs at rest */
  --color-border-strong:   rgba(255, 255, 255, 0.18); /* hovered controls, separators */
  --color-border-focus:    var(--color-accent);       /* focus ring uses this */
  --color-border-ghost:    color-mix(in oklch, var(--color-accent) 55%, transparent); /* ghosted selection */
}

:root {
  --color-border-subtle:   rgba(15, 17, 21, 0.06);
  --color-border-default:  rgba(15, 17, 21, 0.12);
  --color-border-strong:   rgba(15, 17, 21, 0.20);
  --color-border-focus:    var(--color-accent);
  --color-border-ghost:    color-mix(in oklch, var(--color-accent) 55%, transparent);
}
```

### 2.3 Color tokens — Text hierarchy

Five steps, mapped directly to Content-Aware Dimming roles.

```css
.dark {
  --color-text-primary:    oklch(0.970 0 0);     /* #F5F6F8 — body, subjects, sender names */
  --color-text-secondary:  oklch(0.780 0 0);     /* #B8BCC4 — column headers, labels */
  --color-text-tertiary:   oklch(0.620 0 0);     /* #8B909A — metadata at rest (dimmed) */
  --color-text-muted:      oklch(0.500 0 0);     /* #6E727B — placeholders, hints */
  --color-text-disabled:   oklch(0.420 0 0);     /* #555861 — disabled controls */
  --color-text-on-accent:  oklch(0.985 0 0);     /* #F8FAFC — text on accent fill */
  --color-text-on-danger:  oklch(0.985 0 0);
}

:root {
  --color-text-primary:    oklch(0.180 0.005 270);
  --color-text-secondary:  oklch(0.380 0.005 270);
  --color-text-tertiary:   oklch(0.500 0.005 270);
  --color-text-muted:      oklch(0.580 0.005 270);
  --color-text-disabled:   oklch(0.700 0.004 270);
  --color-text-on-accent:  oklch(0.985 0 0);
  --color-text-on-danger:  oklch(0.985 0 0);
}
```

**WCAG verification (dark theme, against `--color-surface-1`):**

| Token | Contrast | Rating |
|---|---|---|
| primary | 14.8 : 1 | AAA |
| secondary | 9.4 : 1 | AAA |
| tertiary | 5.6 : 1 | AA (AAA for large) |
| muted | 3.7 : 1 | AA (large only); only used for placeholders ≥13px |
| disabled | 2.6 : 1 | Below AA — **disabled state only**, paired with cursor + ARIA |

### 2.4 Color tokens — Accent & semantic

The accent is the single brand color used for selection, focus, and primary
actions. **🚩 PO DECISION #2** in §12 — confirm the exact hue.

```css
.dark {
  /* Accent — used for: focus ring, primary selection, primary buttons,
     pin icon active, keyboard hint underline */
  --color-accent:          oklch(0.680 0.170 257); /* #5B8DEF */
  --color-accent-hover:    oklch(0.730 0.170 257); /* #76A1F5 */
  --color-accent-active:   oklch(0.620 0.170 257); /* #4477D8 */
  --color-accent-soft:     color-mix(in oklch, var(--color-accent) 18%, transparent); /* selection bg */
  --color-accent-ghost:    color-mix(in oklch, var(--color-accent) 12%, transparent); /* unfocused selection bg */

  /* Semantic — keep saturation moderate for dark backgrounds */
  --color-success:         oklch(0.740 0.155 152); /* #3DD68C */
  --color-success-soft:    color-mix(in oklch, var(--color-success) 18%, transparent);
  --color-warning:         oklch(0.800 0.145 78);  /* #F5B544 */
  --color-warning-soft:    color-mix(in oklch, var(--color-warning) 18%, transparent);
  --color-danger:          oklch(0.660 0.220 25);  /* #EF4D4D */
  --color-danger-hover:    oklch(0.700 0.220 25);
  --color-danger-soft:     color-mix(in oklch, var(--color-danger) 18%, transparent);
  --color-info:            var(--color-accent);
}

:root {
  --color-accent:          oklch(0.580 0.180 257); /* slightly darker for AA on white */
  --color-accent-hover:    oklch(0.520 0.180 257);
  --color-accent-active:   oklch(0.460 0.180 257);
  --color-accent-soft:     color-mix(in oklch, var(--color-accent) 14%, transparent);
  --color-accent-ghost:    color-mix(in oklch, var(--color-accent) 10%, transparent);
  --color-success:         oklch(0.560 0.155 152);
  --color-success-soft:    color-mix(in oklch, var(--color-success) 14%, transparent);
  --color-warning:         oklch(0.620 0.150 78);
  --color-warning-soft:    color-mix(in oklch, var(--color-warning) 14%, transparent);
  --color-danger:          oklch(0.560 0.220 25);
  --color-danger-hover:    oklch(0.500 0.220 25);
  --color-danger-soft:     color-mix(in oklch, var(--color-danger) 14%, transparent);
  --color-info:            var(--color-accent);
}
```

### 2.5 Color tokens — Panel link palette

When the user pairs panels (e.g. an Inspector follows a specific List), each
pair is given a deterministic color drawn from this 8-color set. Colors are
chosen for distinguishability under dark mode and to never conflict with the
accent or semantic colors.

```css
.dark {
  --color-link-1: oklch(0.72 0.16 25);   /* coral   #F08C7A */
  --color-link-2: oklch(0.78 0.14 78);   /* amber   #F0B85E */
  --color-link-3: oklch(0.78 0.14 130);  /* lime    #B5D571 */
  --color-link-4: oklch(0.74 0.16 152);  /* mint    #5EDB9D */
  --color-link-5: oklch(0.74 0.14 200);  /* teal    #5EC9D6 */
  --color-link-6: oklch(0.72 0.16 290);  /* violet  #A78BF5 */
  --color-link-7: oklch(0.72 0.18 330);  /* magenta #E27CC8 */
  --color-link-8: oklch(0.78 0.04 250);  /* slate   #B6BEC8 */
}
```

Each is rendered as a 3px strip on the inside-left edge of paired panel
headers. **🚩 PO DECISION #3** — confirm 8 is the right count.

### 2.6 Spacing scale

Base unit: **4px**. The scale is Tailwind-native; no magic numbers in
components.

| Token | px | Common uses |
|---|---|---|
| `--space-0` | 0 | reset |
| `--space-px` | 1 | hairlines, focus offset |
| `--space-0_5` | 2 | icon-to-text gap inside dense rows |
| `--space-1` | 4 | tight padding, gap between pills |
| `--space-1_5` | 6 | inner button padding y |
| `--space-2` | 8 | row inner padding x, panel header padding x |
| `--space-2_5` | 10 | input padding y (sm) |
| `--space-3` | 12 | toolbar gap, default control gap |
| `--space-4` | 16 | panel content padding (cozy) |
| `--space-5` | 20 | section gap |
| `--space-6` | 24 | empty-state inner padding |
| `--space-8` | 32 | modal padding |
| `--space-10` | 40 | modal vertical padding |
| `--space-12` | 48 | large empty-state padding |

#### Density-derived spacing (email list row)

| Density | Row height | Vertical padding | Avatar size | Visible columns |
|---|---|---|---|---|
| compact | 28px | 4px | 16px (or none) | star · sender · subject · date |
| comfortable (default) | 36px | 8px | 20px | star · sender · subject · snippet · labels · attachment · date |
| cozy | 48px | 12px | 28px | all comfortable + 2nd-line snippet |

### 2.7 Typography tokens

```css
:root, .dark {
  --font-sans: "Inter Variable", "Inter", ui-sans-serif, system-ui, -apple-system,
               "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono Variable", "JetBrains Mono", ui-monospace,
               "SF Mono", "Menlo", "Consolas", monospace;

  /* Size · line-height · weight · tracking — see §7 for role mapping */
  --text-display:    24px / 32px / 600 / -0.01em;
  --text-h1:         20px / 28px / 600 / -0.005em;
  --text-h2:         16px / 24px / 600 / 0;
  --text-h3:         14px / 20px / 600 / 0;
  --text-body:       13px / 18px / 400 / 0;
  --text-body-strong:13px / 18px / 500 / 0;
  --text-small:      12px / 16px / 400 / 0;
  --text-caption:    11px / 14px / 500 / 0.02em;
  --text-overline:   10px / 12px / 600 / 0.06em; /* uppercase */

  --text-mono-md:    13px / 18px / 500 / 0;
  --text-mono-sm:    11px / 14px / 500 / 0;
  --text-mono-xs:    10px / 12px / 500 / 0;
}
```

Tailwind utilities for these are defined in §11.2.

### 2.8 Border-radius tokens

```css
:root, .dark {
  --radius-none: 0;
  --radius-xs:   2px;  /* tag pills, label badges (Soundminer-style square) */
  --radius-sm:   4px;  /* buttons, inputs, dropdown items */
  --radius-md:   6px;  /* panels, cards, toasts */
  --radius-lg:   8px;  /* modals, dialogs */
  --radius-xl:   12px; /* command palette */
  --radius-full: 9999px;
}
```

Avatars are circular (`--radius-full`). Everything else stays rectangular —
the design language is angular.

### 2.9 Shadow / elevation tokens

```css
.dark {
  --shadow-l0: none;
  --shadow-l1: 0 1px 0 0 rgba(0, 0, 0, 0.45);                                /* docked panels */
  --shadow-l2: 0 8px 24px -8px rgba(0, 0, 0, 0.65),
               0 2px 6px -2px rgba(0, 0, 0, 0.45);                           /* HUD, popover */
  --shadow-l3: 0 24px 48px -12px rgba(0, 0, 0, 0.70),
               0 4px 12px -4px rgba(0, 0, 0, 0.50);                          /* modal, cmdk */
  --shadow-l4: 0 32px 64px -16px rgba(0, 0, 0, 0.75),
               0 8px 16px -8px rgba(0, 0, 0, 0.55);                          /* toast, tooltip */
  --shadow-focus: 0 0 0 2px var(--color-accent);                             /* sharp focus ring */
  --shadow-focus-danger: 0 0 0 2px var(--color-danger);
}

:root {
  --shadow-l0: none;
  --shadow-l1: 0 1px 2px 0 rgba(15, 17, 21, 0.06);
  --shadow-l2: 0 6px 16px -4px rgba(15, 17, 21, 0.12),
               0 2px 4px -2px rgba(15, 17, 21, 0.08);
  --shadow-l3: 0 16px 40px -8px rgba(15, 17, 21, 0.18),
               0 4px 10px -4px rgba(15, 17, 21, 0.10);
  --shadow-l4: 0 24px 56px -12px rgba(15, 17, 21, 0.22),
               0 8px 16px -8px rgba(15, 17, 21, 0.12);
  --shadow-focus: 0 0 0 2px var(--color-accent);
  --shadow-focus-danger: 0 0 0 2px var(--color-danger);
}
```

### 2.10 Motion tokens

```css
:root, .dark {
  /* Durations */
  --duration-instant: 0ms;
  --duration-fast:    80ms;   /* hover bg, selection, opacity step */
  --duration-base:    160ms;  /* popover open, panel resize end */
  --duration-slow:    240ms;  /* modal open, sheet slide */
  --duration-slower:  320ms;  /* toast slide, page-level transition */

  /* Easings */
  --ease-out:      cubic-bezier(0.20, 0.80, 0.20, 1.00); /* default for entrances */
  --ease-in:       cubic-bezier(0.40, 0.00, 0.80, 0.20); /* exits */
  --ease-in-out:   cubic-bezier(0.40, 0.00, 0.20, 1.00); /* state changes */
  --ease-spring:   cubic-bezier(0.34, 1.30, 0.64, 1.00); /* micro pop on confirm */
  --ease-linear:   linear;                                /* progress bars */
}

@media (prefers-reduced-motion: reduce) {
  :root, .dark {
    --duration-fast:   0ms;
    --duration-base:   0ms;
    --duration-slow:   0ms;
    --duration-slower: 0ms;
  }
}
```

### 2.11 Opacity tokens (Content-Aware Dimming)

These drive every "metadata is dimmer than content" rule in the system.
They are applied to text or icons via the `opacity` property — never by
swapping color tokens — so a single hover/focus/select transition reveals
full contrast.

```css
:root, .dark {
  --opacity-dim-strong:  0.45;  /* metadata in unfocused panel */
  --opacity-dim:         0.60;  /* metadata at rest in focused panel */
  --opacity-dim-soft:    0.80;  /* secondary chrome (icons in panel header) */
  --opacity-full:        1.00;  /* hover, focus, selected, pinned */
  --opacity-disabled:    0.40;  /* disabled controls */
  --opacity-skeleton:    0.06;  /* base skeleton fill on dark */
  --opacity-skeleton-hi: 0.12;  /* skeleton shimmer crest */
}
```

### 2.12 Sizing tokens (controls)

```css
:root, .dark {
  --size-control-xs: 20px;  /* dense in-row toggle */
  --size-control-sm: 24px;  /* secondary toolbar buttons, panel header actions */
  --size-control-md: 28px;  /* default button, default input */
  --size-control-lg: 32px;  /* primary actions, panel header height */
  --size-control-xl: 40px;  /* compose CTA, large form fields */
}
```

---

## 3. Component State Matrix

The table below is the canonical visual treatment for the eleven canonical
states across the seven core component types. Every state is observable
via keyboard alone — selection and focus are visually distinct (see
**Contextual Ghosting** §6.1).

### 3.1 Email list row

| State | Background | Left rail | Border | Text · primary | Text · metadata | Notes |
|---|---|---|---|---|---|---|
| Default | transparent | none | bottom 1px `--color-border-subtle` | `--color-text-primary` | opacity `--opacity-dim` | unread bumps weight to 600 |
| Hover | `rgba(255,255,255,0.03)` (dark) / `rgba(15,17,21,0.04)` (light) | none | unchanged | unchanged | opacity `--opacity-full` | row action icons fade in over 80ms |
| Focus (kbd cursor) | `rgba(255,255,255,0.045)` | 3px solid `--color-accent` at 0.6 opacity | 1px inset top+bottom `--color-border-strong` | unchanged | `--opacity-full` | focused but not selected — j/k cursor |
| Active selection (panel focused) | `--color-accent-soft` | 3px solid `--color-accent` | bottom 1px `--color-border-subtle` | `--color-text-primary` (weight 500) | `--opacity-full` | the canonical "selected" |
| Ghosted selection (panel unfocused) | `--color-accent-ghost` | 3px solid `--color-border-ghost` | 1px inset `--color-border-ghost` | `--color-text-primary` | `--opacity-dim-strong` | hollow look — see §6.1 |
| Pinned (Inspector context only) | as Active | as Active + 6px wide pin chip top-right | unchanged | unchanged | unchanged | persistent dot icon `--color-accent` 8px |
| Disabled | transparent | none | unchanged | opacity `--opacity-disabled` | opacity `--opacity-disabled` | `cursor: not-allowed`, `aria-disabled` |
| Loading | `--opacity-skeleton` shimmer fill | none | unchanged | hidden, replaced by skeleton bars | hidden | shimmer animation — see §9.4 |
| Error | unchanged | 3px solid `--color-danger` | unchanged | unchanged | unchanged + danger icon at right | Tooltip on error icon explains |
| Empty | n/a — see §4.6 | | | | | row container hidden, empty state shown |
| Drag-source | opacity 0.5 | unchanged | dashed 1px `--color-border-strong` | unchanged | unchanged | ghost preview follows cursor (§6.2) |

### 3.2 Panel header

| State | Background | Border | Title color | Action-icon opacity |
|---|---|---|---|---|
| Default (unfocused) | `--color-surface-1` | bottom 1px `--color-border-subtle` | `--color-text-tertiary` | `--opacity-dim` |
| Focused | `--color-surface-1` | bottom 1px `--color-border-default`; 2px inside top `--color-accent` (tab-only when grouped, see §4.4) | `--color-text-secondary` | `--opacity-full` |
| Hover (cursor in header) | unchanged | unchanged | unchanged | `--opacity-full`; drag handle visible |
| Pinned (Inspector) | unchanged | unchanged | unchanged | pin icon switches to `--color-accent` at full opacity |
| Linked (paired with another panel) | unchanged | inside-left 3px solid `--color-link-N` | unchanged | unchanged |
| Disabled | unchanged | unchanged | `--color-text-disabled` | `--opacity-disabled` |
| Loading | unchanged | bottom 2px gradient progress bar (see §9.4) | unchanged | unchanged |
| Error | unchanged | bottom 1px `--color-danger` | `--color-danger` | error icon replaces actions |

Header height is always **32px** (`--size-control-lg`). No exception.

### 3.3 Button — primary, secondary, ghost, destructive

States are identical in shape; only the colors swap per variant. Rules
below are written for **primary**; substitute the variant's base color.

| State | Bg | Text | Border | Shadow | Note |
|---|---|---|---|---|---|
| Default | `--color-accent` | `--color-text-on-accent` | none | none | |
| Hover | `--color-accent-hover` | `--color-text-on-accent` | none | none | transition `bg --duration-fast --ease-out` |
| Active (pressed) | `--color-accent-active` | `--color-text-on-accent` | none | inset 0 1px 0 rgba(0,0,0,.2) | |
| Focus-visible | `--color-accent` | `--color-text-on-accent` | none | `--shadow-focus`, offset 2px from button edge | sharp ring, not glow |
| Selected (toggle) | `--color-accent-active` | `--color-text-on-accent` | inset 0 0 0 1px rgba(255,255,255,.15) | none | only for toggle buttons |
| Pinned | n/a | | | | not applicable |
| Disabled | `--color-accent` at opacity 0.4 | `--color-text-on-accent` at opacity 0.6 | none | none | `cursor: not-allowed`, `aria-disabled` |
| Loading | `--color-accent` | spinner replaces label, button width pinned | none | none | Spinner = 14px, 1.2s linear rotate |
| Error | `--color-danger` | `--color-text-on-danger` | none | none | only for "retry" affordance |
| Empty | n/a | | | | |

Variants:

- **Secondary**: bg `--color-surface-2` → hover `--color-surface-3` → active `--color-surface-1`. Text `--color-text-primary`.
- **Ghost**: bg transparent → hover `--color-surface-2` → active `--color-surface-1`. Text `--color-text-secondary`, hover `--color-text-primary`.
- **Destructive**: same shape as primary, replace accent → danger. Always require keyboard confirmation (Enter) or modal — never single-click destroy.

Sizes (px): xs 20 · sm 24 · md 28 · lg 32 · xl 40. Padding x: xs 6, sm 8, md 12, lg 14, xl 18. Icon-only buttons are square, no horizontal padding override.

### 3.4 Input field

| State | Bg | Border | Text | Notes |
|---|---|---|---|---|
| Default | `--color-surface-2` | 1px solid `--color-border-default` | `--color-text-primary` | placeholder is `--color-text-muted` |
| Hover | `--color-surface-2` | 1px solid `--color-border-strong` | unchanged | only when not focused |
| Focus | `--color-surface-2` | 1px solid `--color-accent` | unchanged | + `--shadow-focus` on outside |
| Active (typing) | unchanged | unchanged | unchanged | caret `--color-accent` |
| Selected (text selection) | n/a | n/a | n/a | text-selection bg `--color-accent-soft`, fg `--color-text-primary` |
| Pinned | n/a | | | not applicable |
| Disabled | `--color-surface-2` opacity 0.5 | 1px solid `--color-border-default` | opacity `--opacity-disabled` | |
| Loading | `--color-surface-2` | unchanged | spinner inside right padding | for async validators |
| Error | `--color-surface-2` | 1px solid `--color-danger` + `--shadow-focus-danger` when focused | unchanged | error text below in `--color-danger`, `--text-small` |
| Empty | n/a — placeholder serves this role | | | |

Heights map to control sizes from §2.12. Padding x is always 10px.

### 3.5 Tag / label pill

Soundminer-style — square, dense, monospace. **Never** rounded pill.

| State | Bg | Border | Text | Size |
|---|---|---|---|---|
| Default | `tag-color` at α 0.18 | none | `tag-color` at full saturation | h 18px (sm), 22px (md). px 6/8 |
| Hover (clickable) | α 0.28 | none | unchanged | + `cursor: pointer` |
| Focus-visible | α 0.18 | 1px solid `tag-color` α 1.0 | unchanged | + `--shadow-focus` |
| Active (filter applied) | α 0.28 | 1px solid `tag-color` α 0.7 | unchanged | persistent until removed |
| Selected (multi-select) | as Active | as Active | unchanged | + 8px checkmark on left |
| Pinned | n/a | | | |
| Disabled | α 0.10 | none | `tag-color` α 0.5 | |
| Loading | shimmer fill | none | hidden | |
| Error | `--color-danger-soft` | none | `--color-danger` | |
| Empty | "+ Add tag" ghost button uses ghost-button rules | | | |

Typography: `--text-mono-xs` uppercase. Removable pills add a 12px × icon
in the right padding; hover the icon, not the pill, to delete.

### 3.6 Command palette item (cmdk)

| State | Bg | Text | Icon | Shortcut |
|---|---|---|---|---|
| Default | transparent | `--color-text-primary` | opacity `--opacity-dim` | `--color-text-tertiary`, mono-xs |
| Hover | `--color-surface-3` | unchanged | `--opacity-full` | unchanged |
| Highlighted (kbd cursor) | `--color-surface-3` | `--color-text-primary` | `--opacity-full` | `--color-text-secondary` |
| Active (executing) | `--color-accent-soft` | unchanged | `--color-accent` | hidden |
| Selected (multi-select cmdk, rare) | `--color-accent-soft` | unchanged | `--color-accent` | check icon left |
| Disabled | transparent | opacity `--opacity-disabled` | opacity `--opacity-disabled` | hidden |
| Loading | `--color-surface-3` | "Loading…" `--color-text-tertiary` | spinner 14px | hidden |
| Error | `--color-danger-soft` | `--color-danger` | error icon `--color-danger` | hidden |
| Empty | "No commands match" centered, `--color-text-tertiary`, `--text-small` | | | |

Item height 36px. Mouse hover and keyboard cursor share one visual state to
avoid double-highlight when the user moves the mouse over a kbd-highlighted
row.

### 3.7 Toast notification

| State | Bg | Border-left | Icon | Text | Action |
|---|---|---|---|---|---|
| Default (info / Undo) | `--color-surface-4` w/ `backdrop-filter: blur(12px)` | 3px `--color-accent` | `--color-accent` 16px | `--color-text-primary`, `--text-body` | "Undo" ghost button right side |
| Hover | unchanged | unchanged | unchanged | unchanged | dismiss timer paused |
| Focus | unchanged | unchanged | unchanged | unchanged | toast keyboard-reachable via `F6` cycle |
| Active (Undo clicked) | unchanged | flashes `--color-accent-active` 80ms | unchanged | "Undone" appended | button disappears |
| Pinned | n/a | | | | |
| Disabled | n/a | | | | |
| Loading | unchanged | `--color-accent` | spinner 14px | "Sending…" | inline progress |
| Error | unchanged | 3px `--color-danger` | `--color-danger` | unchanged | "Retry" button |
| Empty | n/a | | | | |

Variant border-left colors: success `--color-success`, warning
`--color-warning`, danger `--color-danger`.

Width: min 280, max 420. Padding 12 16. Stack bottom-right (16px gap). Max
3 visible; older toasts collapse into a "+N more" chip. See §9.3.

---

## 4. Panel System Visual Spec

dockview owns layout mechanics. NEXUS skins it via the four panel **types**
below. Each type differs in chrome, default placement, behavior on focus
loss, and interaction affordances.

### 4.1 Panel-type comparison

| Trait | Stage | Inspector | HUD / Utility | Navigation |
|---|---|---|---|---|
| Default size | flex grow | 320px fixed | 240–360px | 240px fixed |
| Default position | center | right rail | floats / collapses bottom-right | left rail |
| Header height | 32px | 32px | 28px (denser) | 32px |
| Header bg | `--color-surface-1` | `--color-surface-1` | `--color-surface-3` (slightly lighter to read as floating) | `--color-surface-1` |
| Header drag handle | always | always | always | hidden — sidebar is sticky |
| Header pin icon | hidden | **always present** | hidden | hidden |
| Loses focus when… | clicked outside | clicked outside | always-on-top until dismissed | rarely owns focus |
| Empty-state weight | full graphic + CTA | text + secondary action | "Drop a tool here" hint | folder placeholder list |
| Resize handles | all 4 sides | left only | all 4 sides + corner | right only |
| Detachable to window | yes | yes | yes (default behavior) | no |
| Collapsible to strip | no | no | **yes** — see §4.7 | yes (icon-only rail) |
| Border on focus | top inset 2px `--color-accent` | top inset 2px `--color-accent` | full inset 1px `--color-accent` (HUD floats, needs perimeter clarity) | top inset 2px `--color-accent` |

### 4.2 Panel container

Every panel is rendered inside a div with:

```
background: var(--color-surface-1);
border-radius: var(--radius-md);
box-shadow: var(--shadow-l1);   /* L2 when floating, L3 when modal-mode */
overflow: hidden;
contain: layout paint;
container-type: inline-size;     /* Container Queries */
```

Detached / floating panels switch to `--shadow-l2` and add a 1px solid
`--color-border-default` perimeter for visual liftoff against the canvas.

### 4.3 Panel header anatomy

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [⠿] [tab1▼] [tab2] [tab3]    Inbox · 1,247              [📌] [⋯] [↕] [×] │
│  ↑   └─ tab bar (only when grouped) ──┘   ↑                ↑    ↑    ↑   │
│  drag handle                              title slot      pin  more det │
└──────────────────────────────────────────────────────────────────────────┘
  6px              variable                  fills           24px each, 4px gap
```

Specifications:

- **Drag handle.** 6px wide column on the far left. Two stacks of 3 dots
  (2px circles, `--color-text-tertiary`). Opacity `--opacity-dim-strong`
  at rest, `--opacity-full` on header hover. Cursor `grab`.
- **Tab bar.** Only visible when this panel is part of a dockview tab group.
  Tab height = full header. Active tab uses `--color-surface-2` background
  and `--color-text-primary`. Inactive tabs use transparent bg and
  `--color-text-tertiary`. See §4.4.
- **Title slot.** When no tab bar, the title fills the center. Sans, 12px,
  weight 500, opacity dim/full per focus state. Breadcrumb separator is
  ` · ` (mid-dot with hair-spaces) at `--color-text-muted`.
- **Action zone.** Right-aligned. Icons are 16px, hit area 24×24, 4px gap.
  Tooltip every action; never icon-only without a tooltip. Default actions
  (in order): pin (Inspector only), more (overflow), detach, close.

### 4.4 Tab group treatment (dockview tab bar)

When dockview groups two or more panels, replace the title slot with a tab
strip:

| Tab state | Bg | Text | Border |
|---|---|---|---|
| Active, panel focused | `--color-surface-2` | `--color-text-primary`, weight 500 | top inset 2px `--color-accent`; bottom 1px `--color-surface-2` (covers panel border) |
| Active, panel unfocused | `--color-surface-2` | `--color-text-secondary` | top inset 2px `--color-border-strong`; bottom 1px `--color-surface-2` |
| Inactive | transparent | `--color-text-tertiary` | bottom 1px `--color-border-subtle` |
| Hover (inactive) | `--color-surface-2` opacity 0.4 | `--color-text-secondary` | unchanged |
| Drag-source | opacity 0.5, dashed border | unchanged | unchanged |
| Drop-target gap | 2px solid `--color-accent` line in the tab strip at insertion point | n/a | n/a |

Tab inner padding: 8px 12px. Min width 80px, max 200px. Long titles
ellipsize. Each tab shows a tiny module icon (12px) on the left.

### 4.5 Resize handles

dockview's split lines are restyled:

- **At rest:** invisible. The 1px panel border serves as the boundary.
- **On hover (cursor within 4px of edge):** a 2px-wide, full-length
  `--color-accent` at opacity 0.4 fades in over 80ms.
- **While dragging:** opacity jumps to `--opacity-full`. The cursor
  becomes `col-resize` / `row-resize`.
- **Snap targets:** when resize crosses a snap (50%, 33%, 66%), a 1px
  perpendicular accent guide appears for 200ms with a `--ease-spring`
  pulse, then fades.

### 4.6 Empty panel placeholder

Never blank. The empty state contains four elements in vertical stack,
centered both axes, max-width 320px:

1. **Icon** — 32px, `--color-text-tertiary`. Choose a noun-icon for the
   module (mail, inbox, search, etc.).
2. **Title** — `--text-h3`, `--color-text-secondary`. e.g. "No emails in
   this view".
3. **Body** — `--text-small`, `--color-text-tertiary`, max 2 lines.
   Explains why and what to do. e.g. "Try clearing filters or selecting
   a different folder."
4. **Action** — secondary button, optional. e.g. "Clear filters" or
   "Open command palette (⌘K)".

Vertical padding scales with panel size via Container Queries:

```css
@container (min-height: 240px) { .empty { padding-block: 24px; } }
@container (min-height: 480px) { .empty { padding-block: 64px; } }
```

Empty-state variants by phase:

| Phase | Title | Body | Action |
|---|---|---|---|
| First-run (no account) | "Connect an account" | "NEXUS is empty. Connect Gmail, IMAP, or import .mbox to start." | "Connect account" (primary) |
| Loading first sync | "Syncing 5,247 emails…" | "1,250 / 5,247 complete. You can already use what's downloaded." | progress bar instead of button |
| Filtered to nothing | "No matches for these filters" | shows active filter chips | "Clear filters" (secondary) |
| Module not yet placed | "Drop a module here" | "Drag a module from the palette, or press ⌘K → 'Open module'." | "Open palette" (ghost) |

### 4.7 HUD collapsed strip

HUD/Utility panes can collapse to a 32px strip docked to a workspace edge.

```
┌──────────────────────────────────────────────────────────┐
│ [icon] Activity · 3 running                       [▲]    │  ← 32px tall
└──────────────────────────────────────────────────────────┘
```

- Background `--color-surface-3`, border-top 1px `--color-border-default`,
  shadow `--shadow-l2` (still floats above panel layer).
- Label uses `--text-caption`. Counts and timers in `--font-mono`
  `--text-mono-xs`.
- Right-side chevron expands. Click anywhere else opens to last height.
- A pulsing 6px dot in `--color-accent` appears when activity is in
  flight; pulse cycle 1.2s ease-in-out (suppressed under reduced motion).

---

## 5. Email-Specific Patterns

### 5.1 Email list row — three densities

All densities share the same 12-column grid (4px column gap) and read
left-to-right. Density only changes row height, vertical padding, avatar
size, and which columns render.

```
┌─[c]─[★]─[avatar]─[from]──[subject]──────────[snippet]───[📎][labels]──[date]─┐
│ 24px 16     20      120      flex            flex 0.6   16   auto       64    │
└────────────────────────────────────────────────────────────────────────────────┘
```

| Column | Compact (28px) | Comfortable (36px) | Cozy (48px) |
|---|---|---|---|
| Checkbox `c` | hover/select only | hover/select only | always |
| Star `★` | always (on/off) | always | always |
| Avatar | hidden | 20px circle | 28px circle |
| From | 100px, ellipsis, `--text-body` | 120px, ellipsis | 160px, 2-line allowed |
| Subject | flex, ellipsis, weight 500 if unread | flex | flex, 2-line allowed |
| Snippet | hidden | flex, 1-line, `--color-text-tertiary` | flex, 2-line |
| Attachment 📎 | shown if present | shown if present | shown if present, with size in mono |
| Labels | first label only as 14px square swatch | up to 3 pills (sm) | up to 5 pills (md) |
| Date | mono-xs, "2h" / "Apr 8" | mono-sm, "2h ago" / "Apr 8" | mono-sm + secondary line "14:23" |

Rules:

- **Unread** rows render `from` and `subject` at weight 600 and color
  `--color-text-primary`. Read rows use weight 400 and
  `--color-text-secondary` for `subject`.
- **Snippet** is always `--color-text-tertiary` and uses opacity
  `--opacity-dim` → `--opacity-full` on hover/focus/select.
- **Date** is always `--font-mono` to keep the right edge aligned.
- **Star** is empty outline at `--color-text-tertiary` α `--opacity-dim`
  by default; filled `--color-warning` when set.

### 5.2 Thread grouping

A thread is rendered as one parent row. Expanded threads indent child
rows with a 16px left inset and a 1px vertical guide
(`--color-border-subtle`) running through the indent column. The parent
row shows a count badge ("3") in `--color-text-tertiary` mono-xs, right
of the subject. A 12px chevron at row left rotates 90° when expanded.

Thread parent and children share the same selection model: clicking the
parent selects the thread; clicking a child selects only that message.

### 5.3 Sender avatar / initials fallback

- **Photo present.** Square-cropped circle. Lazy-loaded; placeholder
  during fetch is a solid circle of `--color-surface-3`.
- **Photo absent.** Solid circle, background hash-derived from the email
  address (deterministic) using the panel-link palette §2.5. Initials
  rendered in `--color-text-on-accent` (always white-on-color), centered,
  weight 600. One initial when avatar ≤ 20px, two initials at ≥ 28px.
- **Unknown sender** (no name): use the @-character or first letter of
  local-part.
- **Multi-recipient bubbles** (To: list): overlap by 8px, max 3 visible,
  "+N" chip after.

### 5.4 In-row affordances

On hover (or while focused via keyboard), a right-side action cluster
fades in from opacity 0 → 1 over 80ms. Cluster is right-aligned, sits
above the date (date dims to opacity 0). Default actions (icon-only
ghost buttons, 24px hit area, 16px icon):

`Reply` `Reply All` `Forward` `Archive` `Snooze` `Delete` `More`

Tooltip every button. Cluster collapses to "More" overflow when the row
is < 360px wide (Container Query).

### 5.5 Email viewer chrome — iframe sandbox boundary

The HTML email body is rendered inside a sandboxed iframe (per build plan
§"Email Body Rendering"). The boundary is communicated by:

- A 1px `--color-border-default` frame around the iframe.
- A 24px chrome strip above the iframe with:
  - Sender block on the left (avatar + name + email in `--font-mono`
    `--text-mono-sm`).
  - Sandbox indicator on the right: a shield icon (12px,
    `--color-text-tertiary`) followed by `"isolated content"` in
    `--text-overline`. Hovering opens a tooltip explaining what is
    blocked (scripts, top-level nav, mixed content).
- A 24px chrome strip below the iframe with reply / reply-all / forward
  buttons aligned right; left side reserved for "Show original",
  "View source", "Block sender" overflow.

When remote images are blocked, a banner sits between the upper chrome
and the iframe: full-width `--color-warning-soft` background, 32px tall,
warning icon left, "Remote images blocked" text, and a "Show images" /
"Always show from this sender" pair of ghost buttons on the right.

### 5.6 Composer layout

The composer is a panel (Stage type), not a modal. It opens in the
current group as a new tab unless the user holds **⇧ Shift** when
invoking, which opens it as a floating window.

```
╭─ Compose · Draft to alice@example.com ─────────────── [📌] [⋯] [↕] [×] ╮
│                                                                         │
│  From   ▾  Will McGuigan <will@nexus.app>                              │
│  ──────────────────────────────────────────────────────────────────────│
│  To       Alice Chen ⓧ   bob@team.io ⓧ   |                           │
│  ──────────────────────────────────────────────────────────────────────│
│  Cc Bcc ▾                                                               │
│  ──────────────────────────────────────────────────────────────────────│
│  Subject  Q2 review notes                                              │
│  ══════════════════════════════════════════════════════════════════════│
│  [B] [I] [U] [S]  |  [link]  |  [• list] [1. list] [" quote] [</> code]│
│  ──────────────────────────────────────────────────────────────────────│
│                                                                         │
│  Hi Alice,                                                             │
│                                                                         │
│  ▍                                                                      │
│                                                                         │
│  ──────────────────────────────────────────────────────────────────────│
│  📎 Q2-deck.pdf · 4.2 MB ⓧ      [+ Attach]                            │
│  ──────────────────────────────────────────────────────────────────────│
│  [Send  ▾ ⌘↵]              "Saved 2s ago"           [Discard]          │
╰─────────────────────────────────────────────────────────────────────────╯
```

Specifics:

- **Field rows** are 36px tall, 12px x-padding. Field labels are
  `--text-caption` `--color-text-tertiary`, right-padded 12px from
  the input.
- **Address chips** use the §3.5 tag style with avatar 16px on left.
  Invalid addresses (failed local validation) get `--color-danger`
  border. Server-side rejection surfaces as a toast.
- **Cc/Bcc collapse** by default. Clicking the disclosure triangle
  expands both, persisted per-conversation.
- **Tiptap toolbar** is 32px tall, ghost buttons 24px hit area, 16px
  icons, 4px gap, 8px between groups (separator: 1px vertical
  `--color-border-default`).
- **Editor body** uses `--text-body` (13/18 sans). Block elements
  (lists, quotes, code) follow a quiet visual treatment — see §7.
- **Send button** is primary (`--color-accent`), with a kbd hint chip
  on the right (`⌘↵` in `--font-mono` `--text-mono-xs`).
  - **Undo-send countdown.** After clicking Send, the button morphs
    over 160ms into a `--color-accent-soft` capsule that reads
    "Sending… 5" with a circular countdown ring at the right (`16px`
    SVG, stroke `--color-accent`, stroke-dashoffset animated linear
    over the countdown duration). Default countdown 5s.
    **🚩 PO DECISION #4** in §12.
  - Click anywhere on the capsule = "Undo". A toast also appears
    (§3.7) for double redundancy in case the user is looking
    elsewhere on screen.
- **Saved hint** ("Saved 2s ago") in `--text-caption`
  `--color-text-tertiary`, updates on draft autosave events. Replaced
  by an animated dot pulse during autosave write.

---

## 6. Interaction Patterns

### 6.1 Contextual Ghosting — the canonical visual

Every selection-bearing panel has two visual modes for "I have a
selection":

- **Active.** This panel currently holds keyboard focus. Selected rows
  use `--color-accent-soft` background, `--color-accent` left rail,
  primary text at full contrast, metadata at `--opacity-full`.
- **Ghosted.** Another panel is focused. Same selection persists, but
  rendered as: no fill (or `--color-accent-ghost`), `--color-border-ghost`
  hollow rail, primary text at full contrast, metadata at
  `--opacity-dim-strong`.

Implemented as a single CSS class on the panel root, e.g.
`data-focused="true|false"`. Tailwind:

```html
<div data-panel-focused={isFocused ? "true" : "false"} className="
  group/panel
  data-[panel-focused=true]:[--row-selected-bg:var(--color-accent-soft)]
  data-[panel-focused=false]:[--row-selected-bg:var(--color-accent-ghost)]
">
```

### 6.2 Keyboard focus flow between panels

- **Tab** moves focus to the next panel in document order. Panel order
  is set by dockview's tree walk, not the DOM, to match visual layout.
- **Shift+Tab** moves to previous.
- **F6** cycles among "regions": chrome → nav → stage group → inspector
  → HUD strip → toast (if visible). This matches macOS native window
  region cycling.
- **Arrow keys** are owned by the focused module. The shell does not
  intercept arrows once a panel has focus.
- **Esc**:
  - With cmdk open: close cmdk, restore focus via Focus Memory Stack.
  - With a modal open: close modal.
  - With a HUD floating: collapse to strip, focus returns to last
    panel.
  - At rest in a panel: clear current selection, leave focus where it
    is.
- **Focus indicator on a panel.** When a panel acquires focus through
  keyboard (not click), its title flashes `--color-accent` for 80ms
  before settling to `--color-text-secondary`, providing audible
  confirmation analogue.

The Focus Memory Stack (per build plan) is a 2-element stack of
`activePanelId` and `previousPanelId`. cmdk push/pop is automatic.

### 6.3 Drag-and-drop visual states

Two domains of drag exist: **email-to-folder** (data drag) and
**panel-to-position** (layout drag). Visuals differ deliberately so the
user is never confused which they are doing.

#### 6.3.1 Email → folder

- **Drag source row.** Opacity 0.5, dashed 1px `--color-border-strong`
  inset border. Cursor `grabbing`.
- **Cursor follower.** Floating chip at cursor: panel-link color tile +
  count + first sender's name. e.g. `[●] 3 selected · Alice Chen +2`.
  Rendered with `--shadow-l2`, radius `--radius-md`.
- **Valid drop target.** The target folder row in the nav: background
  `--color-accent-soft`, left rail 3px `--color-accent`, folder name
  weight 500. A 16px icon `inbox-arrow-down` appears on the right.
- **Invalid drop target.** Background `--color-danger-soft`, cursor
  `not-allowed`, no rail. Folder name unchanged. Tooltip after 400ms:
  e.g. "Cannot move to system folder."
- **Auto-expand.** Hovering a collapsed parent folder for 600ms expands
  it (so deep targets are reachable in one drag). A spring pulse on
  the chevron telegraphs the expand.

#### 6.3.2 Panel → new position

- **Drag source panel.** Header opacity 0.6, panel content static
  (snapshot) with opacity 0.4. Cursor `grabbing`.
- **Drop overlay.** dockview's native overlay is restyled:
  - Drop zones: 4 edge regions + center. Default zone fill
    `--color-accent-soft`, border 2px dashed `--color-accent`, radius
    `--radius-md`. Inactive zones invisible.
  - Active hovered zone: fill changes to `color-mix(in oklch, var(--color-accent) 28%, transparent)`,
    border becomes solid 2px.
  - Tab insertion: vertical 2px line in `--color-accent` between tabs.
- **Pop-out window** drag-out zone: when the drag exits the workspace
  bounds, the cursor follower switches to a "window" icon in
  `--color-text-secondary`. Releasing outside opens a new OS window via
  Tauri.

### 6.4 Multi-select feedback

| Gesture | Behavior | Visual |
|---|---|---|
| Click | Single-select; clears prior | Active row state, prior rows return to default |
| Shift+Click | Range from anchor to clicked row | All in-range rows in Active state, anchor stays |
| Cmd/Ctrl+Click | Toggle single row in/out of set | The clicked row only flips state |
| Cmd/Ctrl+A | Select all in current view (max 10k rows; warns above) | All visible rows Active; status bar shows "10,000 selected" |
| Drag-lasso | Marquee select; only fires if cursor moves > 4px from mousedown | Marquee rectangle: 1px solid `--color-accent`, fill `--color-accent-soft` α 0.4. Rows under marquee enter Active state in real time. |
| j / k | Move kbd cursor by one (no select) | Focused row state, no selection change |
| Shift+J / Shift+K | Extend selection by one | Adds row to Active set |
| Space | Toggle selection of focused row | |
| x | Toggle checkbox of focused row | Same as Cmd+Click |

When `selection.count > 1`, the bulk-action bar (status-bar segment, see
§5.6 of build plan) shows count + bulk actions.

### 6.5 Command palette (cmdk) lifecycle

- **Open.** ⌘K from anywhere. Animation: backdrop fade 0 → 1 over
  `--duration-base` `--ease-out`. Palette panel scales from 0.96 → 1.0
  and translates Y +8px → 0 over the same duration.
- **Focus.** Input auto-focused. The previously focused element ID is
  pushed to the Focus Memory Stack.
- **Item highlight.** Arrow keys move highlight; mouse hover replaces
  highlight. There is only one visual cursor at a time.
- **Execute.** Enter on a 0-variable command runs immediately and
  closes the palette; runs a 1-variable command by entering an
  inline-prompt mode (see below); ≥2 variables open a sheet (see §6.6).
- **Inline-prompt mode (1 variable).** Selected command becomes a chip
  pinned to the input left, the input clears, and a placeholder
  describes the variable. e.g. `[Move to →]  Folder name…`. Tab cycles
  suggestions, Enter commits.
- **Close.** Esc, click outside, or successful execute. Backdrop fades
  out over `--duration-fast`. Focus returns to Focus Memory Stack top.

### 6.6 Modal vs docked panel — same component, two renderings

Every command-palette command that needs ≥2 variables opens a **sheet**.
Every sheet must also be dockable. The component contract:

```ts
type DockableModalProps = {
  mode: 'modal' | 'panel';
  // ... shared content props
};
```

- **Modal mode.** Renders inside a `<Dialog>` at L3, max-width 640px,
  L3 shadow, backdrop `--color-bg-canvas` α 0.6 + `backdrop-filter:
  blur(8px)`. Header 48px, footer (actions) 56px right-aligned.
- **Panel mode.** Renders inside a Stage panel container. Header
  becomes the panel header (32px), footer actions move to the panel
  toolbar (last row of content, sticky). No backdrop.
- **Switch affordance.** Modal header includes a `dock` icon (16px,
  `--color-text-tertiary`). Click pops the modal into a new dockview
  panel at the workspace right edge, preserves all in-flight values.

Body composition is identical between modes; only chrome differs. Use a
shared layout primitive that composes header / body / footer slots.

---

## 7. Typography Usage Guide

### 7.1 Font selection rationale

- **Inter** is recommended over Geist. Inter's higher x-height holds up
  better at 11–13px (our densest sizes), the OpenType `cv11`/`ss01`
  features clean up the `g` and `1`/`l` ambiguity, and the variable
  axis covers everything we need (weights 400–700). Geist is excellent
  but tuned more to ~14px+ display work.
- **JetBrains Mono** for metadata. Tabular figures, ligature support
  (which we leave **off** — `font-feature-settings: "liga" 0`), and
  excellent zero/dotted-zero readability at small sizes.
- Both fonts ship as **variable WOFF2** in
  `src-tauri/resources/fonts/`. Loaded via `@font-face` with
  `font-display: block` (fonts are local — no flash) and
  `unicode-range` for Latin Ext + Symbols only.

```css
@font-face {
  font-family: "Inter Variable";
  src: url("/fonts/InterVariable.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: "JetBrains Mono Variable";
  src: url("/fonts/JetBrainsMonoVariable.woff2") format("woff2-variations");
  font-weight: 100 800;
  font-style: normal;
  font-display: block;
}
```

### 7.2 Role → token mapping

| Role | Token | Family | Weight | Color | Truncation |
|---|---|---|---|---|---|
| Workspace name (chrome) | `--text-caption` | sans | 600 | `--color-text-secondary` | ellipsis at 200px |
| Panel title | `--text-h3` (sans 14/20 600) | sans | 600 | `--color-text-secondary` (focused: primary) | ellipsis at 50% panel width |
| Panel breadcrumb separator | inline ` · ` | sans | 400 | `--color-text-muted` | n/a |
| Tab label | `--text-small` | sans | 500 | per state §4.4 | ellipsis at 200px tab max |
| Column header (list) | `--text-overline` (uppercase) | sans | 600 | `--color-text-tertiary` | hard truncate; tooltip on hover |
| Email subject | `--text-body-strong` if unread, `--text-body` if read | sans | 600/400 | primary/secondary per read | 1 line ellipsis (compact, comfortable); 2-line clamp (cozy) |
| Sender name | `--text-body` | sans | 600 unread / 400 read | primary | 1-line ellipsis |
| Snippet | `--text-small` | sans | 400 | `--color-text-tertiary` | 1 or 2 line clamp per density |
| Metadata value (size, count, ID, address) | `--text-mono-sm` | mono | 500 | `--color-text-tertiary` (primary on hover/focus/select) | tabular-numerals locked; truncate via middle-ellipsis if address |
| Timestamp (relative) | `--text-mono-xs` | mono | 500 | `--color-text-tertiary` | n/a |
| Timestamp (absolute, on hover-tip) | `--text-mono-xs` | mono | 500 | `--color-text-secondary` | n/a |
| Badge / count | `--text-mono-xs` tabular-nums | mono | 600 | per badge variant | hard cap at 99+ |
| Tooltip | `--text-small` | sans | 400 | `--color-text-primary` on `--color-surface-4` | 2-line max, then wrap at 240px |
| Toast title | `--text-body` | sans | 500 | primary | 2-line max |
| Toast body | `--text-small` | sans | 400 | secondary | 3-line max |
| Empty state title | `--text-h3` | sans | 600 | secondary | 1 line |
| Empty state body | `--text-small` | sans | 400 | tertiary | 2 lines |
| Form label | `--text-caption` | sans | 500 | tertiary | n/a |
| Form helper / error | `--text-caption` | sans | 400 | tertiary / danger | 2 lines |
| Code block (in viewer) | `--text-mono-md` | mono | 400 | primary on `--color-surface-inset` | wrap, 4-space tabs |
| Email body (rendered HTML in iframe) | n/a — host CSS does not affect | — | — | — | iframe is sandboxed |

### 7.3 Truncation rules (canonical)

- **Single-line ellipsis** uses `text-overflow: ellipsis; white-space: nowrap; overflow: hidden;`.
- **Multi-line clamp** uses `display: -webkit-box; -webkit-line-clamp: N; -webkit-box-orient: vertical; overflow: hidden;`.
- **Email addresses** use **middle-ellipsis** (custom JS — `alice.long…@example.com`) so the domain stays visible.
- **Identifiers and hashes** truncate to 8 chars and append `…` only when ≥10. Full ID is in the tooltip.
- **Numbers** never ellipsize. They render full or use SI suffix (1.2k,
  3.4M) at `--color-text-tertiary` for the suffix.

---

## 8. Iconography System

### 8.1 Library

**Lucide React** (`lucide-react`). Reasons:

- Already the de-facto icon set for shadcn/ui examples.
- Tree-shakeable per-icon imports keep bundle small.
- 1.5px stroke weight matches our 1px borders + dense type without
  going thin.
- Open license (ISC), works in Tauri without bundling restrictions.

Avoid mixing icon families. If a needed glyph is missing from Lucide,
extend the local `icons/` folder with a custom SVG drawn at 1.5px stroke
on a 24px grid.

### 8.2 Sizing

| Size | px | Usage |
|---|---|---|
| `xs` | 12 | inline with mono text, tab module marker, sandbox indicator |
| `sm` | 14 | within inputs, inside ghost buttons in dense rows |
| `md` | 16 | default — panel header actions, in-row affordances, button content |
| `lg` | 20 | toolbars, navigation rail items |
| `xl` | 24 | empty states, workspace switcher, sidebar account icons |
| `xxl` | 32 | empty-state hero icon |

Stroke is fixed at 1.5px for sm/md/lg, 1.75px for xs (so it doesn't
disappear), 2px for xl/xxl.

### 8.3 With label vs alone

- **Icon + label** is the default in any control wider than 80px and any
  destructive action.
- **Icon-only** is only acceptable when (a) the icon is in a panel
  header action zone or in-row toolbar, and (b) a tooltip is wired up
  with the action name and shortcut.
- Tooltips show after **600ms** hover, immediately on keyboard focus.

### 8.4 Required icons for Phase 1

```
Mail / messages:
  inbox, mail, mail-open, mail-plus, send, send-horizontal, reply,
  reply-all, forward, archive, trash-2, alarm-clock (snooze),
  bell-off (mute), star, paperclip, file-text, file-image, file-video,
  file-archive, image, link

Threading & state:
  chevron-right, chevron-down, chevron-up, dot, badge-check,
  alert-triangle, alert-circle, info, check, x, loader-2,
  refresh-cw (sync), wifi, wifi-off

Layout & panels:
  layout-dashboard, sidebar, sidebar-open, columns-2, columns-3,
  rows-2, pin, pin-off, maximize-2, minimize-2, expand, shrink,
  external-link (detach), x (close), grip-vertical (drag handle),
  more-horizontal, more-vertical

Navigation:
  folder, folder-open, folder-plus, tag, tags, hash, at-sign, user,
  users, contact-round, calendar, search

Composer / editor:
  bold, italic, underline, strikethrough, link-2, list, list-ordered,
  list-todo, quote, code, code-2, image-plus

System:
  command, keyboard, settings, sliders-horizontal, eye, eye-off,
  shield, shield-alert, lock, unlock, sun, moon, monitor, log-in,
  log-out, plus, minus, copy, scissors, clipboard, download, upload,
  cloud, cloud-off
```

If an icon is needed and missing, add to a follow-up list — do not
substitute a wrong-meaning icon.

---

## 9. Motion & Micro-interaction Spec

All values reference tokens from §2.10. Reduced motion zeroes all
durations except linear progress indicators and the cmdk backdrop.

### 9.1 Panel resize

- **During drag**: positions update at frame rate, no easing, no
  transition.
- **On release**: width/height settles over `--duration-base`
  `--ease-out` to compensate for any snap correction.
- **Snap pulse**: when crossing 50/33/66 splits, a 1px perpendicular
  guide flashes for 200ms `--ease-spring`.

### 9.2 Row selection

- **Background fill** transitions over `--duration-fast` `--ease-out`.
- **Left rail** has no transition — the rail snaps in/out so fast
  scrolling with j/k feels mechanical, not gummy.
- **Metadata opacity** transitions over `--duration-fast` `--ease-out`.

### 9.3 Toast appear / dismiss

- **Appear**: translateY +12px → 0 + opacity 0 → 1 over
  `--duration-slower` `--ease-out`. New toast pushes existing toasts up
  by `height + 8px` over the same duration in lockstep.
- **Auto-dismiss**: idle for 4000ms (info) / 6000ms (warning) / never
  (danger; manual dismiss). Hovering pauses the timer; leaving resumes
  with 1000ms remaining minimum.
- **Dismiss**: opacity 1 → 0 over `--duration-base` `--ease-in`, then
  remove from layout (subsequent toasts slide down `--duration-base`).
- **Undo flash**: clicking Undo flashes the toast bg to
  `--color-accent-soft` for 80ms before dismissal.

### 9.4 Loading shimmer & inline progress

- **Skeleton shimmer.** Element bg is `--opacity-skeleton`; a 96px-wide
  diagonal gradient (`--opacity-skeleton-hi` peak) sweeps across over
  1200ms linear, infinite, with 800ms gap. Suppressed under reduced
  motion (static fill only).
- **Panel inline progress (per feedback doc).** A 2px-tall bar appears
  flush with the bottom of the panel header. It is a gradient
  `transparent → --color-accent → transparent` translating left → right
  over 1000ms linear. No border shimmer on the panel itself — that
  feedback was explicit.
- **Determinate progress** (sync, attachment upload): a solid
  `--color-accent` bar grows from 0 → 100% width.

### 9.5 cmdk open / close

- **Open.** Backdrop fades 0 → 1 (`--duration-base` `--ease-out`).
  Palette scales `0.96 → 1.0` and translates Y `+8 → 0`
  (`--duration-base` `--ease-out`). Input gets focus on the first
  paint frame after mount (one-frame delay so the focus ring's appearance
  reads as deliberate).
- **Close.** Palette translates Y `0 → +4` and fades 1 → 0
  (`--duration-fast` `--ease-in`). Backdrop fades over `--duration-fast`.
  Focus restored after both transitions complete.

### 9.6 Tooltip

- Hover delay 600ms → fade in over `--duration-fast`.
- Keyboard focus: appears immediately, no fade.
- Dismiss: fade over `--duration-fast`.
- Position: 8px from anchor; flips quadrant if it would clip viewport.

### 9.7 Pin toggle (Inspector)

- Click pin icon → icon swaps from `pin-off` to `pin` with a 120°
  rotation pulse (`--duration-base` `--ease-spring`). Color shifts
  from `--color-text-tertiary` to `--color-accent`.
- A toast confirms: "Pinned to {entity}. Press P again to release."

### 9.8 Compose send → undo countdown

See §5.6. The countdown ring is the only timer-driven loop in the UI
that does not pause on hover (since the user expects "send" to actually
send).

---

## 10. Accessibility Checklist

### 10.1 Contrast (dark theme primary, against `--color-surface-1`)

| Element | Tokens | Computed | Required | Pass |
|---|---|---|---|---|
| Body text | `text-primary` on `surface-1` | 14.8:1 | 4.5 (AA) / 7 (AAA) | AAA |
| Subject (read) | `text-secondary` on `surface-1` | 9.4:1 | 4.5 | AAA |
| Metadata at rest | `text-tertiary` α 1.0 | 5.6:1 | 4.5 | AA |
| Metadata at rest dimmed | `text-tertiary` α 0.6 → effective 4.4:1 | borderline | **AA at large only** | ⚠ — dimmed metadata uses `--text-small` (12px) which is below 18px large-text threshold; mitigated by full restore on hover/focus/select |
| Placeholder | `text-muted` | 3.7:1 | 3 (AA large) | AA |
| Disabled | `text-disabled` | 2.6:1 | n/a (UI-disabled exempt) | exempt + ARIA |
| Accent on surface-1 | `accent` 14.5/8.0 lightness | 4.7:1 | 4.5 | AA |
| Text on accent button | `text-on-accent` on `accent` | 5.2:1 | 4.5 | AA |
| Danger text | `danger` on `surface-1` | 5.1:1 | 4.5 | AA |

For the dimmed-metadata case at 12px, an explicit user setting "Always
full contrast" disables the dimming everywhere
(**🚩 PO DECISION #5**) — needed to clear AA absolutely for all users
and to satisfy organizations with stricter procurement requirements.

### 10.2 Focus visibility

- Every interactive element must show `--shadow-focus` on
  `:focus-visible`. We rely on `:focus-visible` (not `:focus`) so mouse
  clicks don't paint rings.
- Panel-level focus state uses the data-attribute approach in §6.1, not
  the focus pseudo-class — because focus is logical, not DOM-leaf.
- Skip links: a `Skip to main content` link, visually hidden until
  focused, placed first in the document order (per build plan).

### 10.3 Screen reader semantics

- Each panel root is `<section role="region" aria-label="{module name} — {panel title}">`.
- Panel header title is `<h2>` for screen-reader landmark structure.
- Tab groups use `<div role="tablist">` with `role="tab"` /
  `aria-selected` / `aria-controls` mapped automatically from dockview
  state.
- Email rows are `<tr role="row">` inside a `<table role="grid">` so
  arrow-key navigation maps to AT grid behavior. Each cell is
  `<td role="gridcell">`. Avoid the temptation to use `<div>` —
  the semantic table improves screen reader summaries (e.g. NVDA reads
  "row 14 of 5,247").
- Selection state announces via `aria-selected` on the row and
  `aria-multiselectable="true"` on the grid.
- Pinned Inspector uses an `aria-pressed="true"` on the pin button and
  appends "(pinned)" to the panel's `aria-label`.
- Toasts use `<div role="status">` (info/success) or
  `<div role="alert">` (warning/danger).

### 10.4 Keyboard reachability

- All shortcuts surfaced in `?` modal (per build plan).
- Roving tabindex inside long virtualized lists: only the focused row
  is `tabindex="0"`; all others `-1`. Arrow keys move focus and
  shift the tabindex.
- No keyboard trap inside dockview tab groups; user can always Esc to
  the panel boundary, F6 to next region.

### 10.5 Reduced motion

- `@media (prefers-reduced-motion: reduce)` zeroes durations (see §2.10).
- Loading shimmers become static fills.
- Snap pulses do not render.
- Toast slide is replaced by fade-only.

### 10.6 Color blindness

- Selection state must not rely solely on accent fill — the 3px left
  rail and the bg fill together communicate selection. The rail also
  carries a `data-state` attribute so AT can reach it programmatically.
- Semantic colors (success/warning/danger) are always paired with an
  icon. Never communicate state with color alone.

---

## 11. Tailwind Configuration

This is meant to be **added on top of** the shadcn/ui Tailwind config
that gets generated by `npx shadcn@latest init`. The generated config
already wires `darkMode: ["class"]`, the shadcn color tokens, and the
animate plugin. The additions below extend (do not replace) those.

### 11.1 `tailwind.config.ts`

```ts
import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import containerQueries from "@tailwindcss/container-queries";

const config = {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./node_modules/@nexus/**/dist/**/*.js", // future internal packages
  ],
  theme: {
    container: {
      center: true,
      padding: "var(--space-4)",
    },
    extend: {
      colors: {
        // Surfaces
        canvas:        "var(--color-bg-canvas)",
        "surface-1":   "var(--color-surface-1)",
        "surface-2":   "var(--color-surface-2)",
        "surface-3":   "var(--color-surface-3)",
        "surface-4":   "var(--color-surface-4)",
        "surface-inset": "var(--color-surface-inset)",

        // Borders
        "border-subtle":  "var(--color-border-subtle)",
        "border-default": "var(--color-border-default)",
        "border-strong":  "var(--color-border-strong)",
        "border-focus":   "var(--color-border-focus)",
        "border-ghost":   "var(--color-border-ghost)",

        // Text
        "text-primary":   "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-tertiary":  "var(--color-text-tertiary)",
        "text-muted":     "var(--color-text-muted)",
        "text-disabled":  "var(--color-text-disabled)",
        "text-on-accent": "var(--color-text-on-accent)",
        "text-on-danger": "var(--color-text-on-danger)",

        // Accent + semantic (overrides shadcn defaults)
        accent: {
          DEFAULT: "var(--color-accent)",
          hover:   "var(--color-accent-hover)",
          active:  "var(--color-accent-active)",
          soft:    "var(--color-accent-soft)",
          ghost:   "var(--color-accent-ghost)",
        },
        success: {
          DEFAULT: "var(--color-success)",
          soft:    "var(--color-success-soft)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
          soft:    "var(--color-warning-soft)",
        },
        danger: {
          DEFAULT: "var(--color-danger)",
          hover:   "var(--color-danger-hover)",
          soft:    "var(--color-danger-soft)",
        },
        info: "var(--color-info)",

        // Panel-link palette
        link: {
          1: "var(--color-link-1)",
          2: "var(--color-link-2)",
          3: "var(--color-link-3)",
          4: "var(--color-link-4)",
          5: "var(--color-link-5)",
          6: "var(--color-link-6)",
          7: "var(--color-link-7)",
          8: "var(--color-link-8)",
        },
      },

      fontFamily: {
        sans: ["Inter Variable", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono Variable", "JetBrains Mono", "ui-monospace", "Menlo", "monospace"],
      },

      // Custom font roles — see §7.2 for usage
      fontSize: {
        display:        ["24px", { lineHeight: "32px", letterSpacing: "-0.01em", fontWeight: "600" }],
        h1:             ["20px", { lineHeight: "28px", letterSpacing: "-0.005em", fontWeight: "600" }],
        h2:             ["16px", { lineHeight: "24px", fontWeight: "600" }],
        h3:             ["14px", { lineHeight: "20px", fontWeight: "600" }],
        body:           ["13px", { lineHeight: "18px", fontWeight: "400" }],
        "body-strong":  ["13px", { lineHeight: "18px", fontWeight: "500" }],
        small:          ["12px", { lineHeight: "16px", fontWeight: "400" }],
        caption:        ["11px", { lineHeight: "14px", letterSpacing: "0.02em", fontWeight: "500" }],
        overline:       ["10px", { lineHeight: "12px", letterSpacing: "0.06em", fontWeight: "600" }],
        "mono-md":      ["13px", { lineHeight: "18px", fontWeight: "500" }],
        "mono-sm":      ["11px", { lineHeight: "14px", fontWeight: "500" }],
        "mono-xs":      ["10px", { lineHeight: "12px", fontWeight: "500" }],
      },

      spacing: {
        "0.5": "2px",
        "1.5": "6px",
        "2.5": "10px",
        "row-compact":     "28px",
        "row-comfortable": "36px",
        "row-cozy":        "48px",
        "ctrl-xs": "20px",
        "ctrl-sm": "24px",
        "ctrl-md": "28px",
        "ctrl-lg": "32px",
        "ctrl-xl": "40px",
      },

      borderRadius: {
        none: "0",
        xs:   "var(--radius-xs)",
        sm:   "var(--radius-sm)",
        md:   "var(--radius-md)",
        lg:   "var(--radius-lg)",
        xl:   "var(--radius-xl)",
        full: "var(--radius-full)",
      },

      boxShadow: {
        l0: "var(--shadow-l0)",
        l1: "var(--shadow-l1)",
        l2: "var(--shadow-l2)",
        l3: "var(--shadow-l3)",
        l4: "var(--shadow-l4)",
        focus:        "var(--shadow-focus)",
        "focus-danger": "var(--shadow-focus-danger)",
      },

      opacity: {
        "dim-strong": "0.45",
        dim:          "0.60",
        "dim-soft":   "0.80",
        full:         "1.00",
        disabled:     "0.40",
        skeleton:     "0.06",
        "skeleton-hi": "0.12",
      },

      transitionDuration: {
        instant: "0ms",
        fast:    "80ms",
        DEFAULT: "160ms",
        slow:    "240ms",
        slower:  "320ms",
      },
      transitionTimingFunction: {
        out:    "cubic-bezier(0.20, 0.80, 0.20, 1.00)",
        in:     "cubic-bezier(0.40, 0.00, 0.80, 0.20)",
        "in-out":"cubic-bezier(0.40, 0.00, 0.20, 1.00)",
        spring: "cubic-bezier(0.34, 1.30, 0.64, 1.00)",
      },

      keyframes: {
        "skeleton-shimmer": {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "panel-progress": {
          "0%":   { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        "toast-in": {
          "0%":   { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "cmdk-in": {
          "0%":   { opacity: "0", transform: "translateY(8px) scale(0.96)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "skeleton-shimmer": "skeleton-shimmer 1200ms linear infinite",
        "panel-progress":   "panel-progress 1000ms linear infinite",
        "toast-in":         "toast-in 320ms cubic-bezier(0.20, 0.80, 0.20, 1.00)",
        "cmdk-in":          "cmdk-in 160ms cubic-bezier(0.20, 0.80, 0.20, 1.00)",
      },
    },
  },
  plugins: [
    animate,
    containerQueries,
    // Local plugin: scrollbar-gutter base, font features, custom variants
    ({ addBase, addVariant }: { addBase: Function; addVariant: Function }) => {
      addBase({
        "*, *::before, *::after": { boxSizing: "border-box" },
        "html, body, #root": {
          height: "100%",
          backgroundColor: "var(--color-bg-canvas)",
          color: "var(--color-text-primary)",
          fontFamily: "var(--font-sans)",
          fontFeatureSettings: '"cv11", "ss01"',
          textRendering: "optimizeLegibility",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
          "-webkit-tap-highlight-color": "transparent",
        },
        // Stable scrollbars on every scroll container
        '[data-scroll], .nx-scroll, body': {
          scrollbarGutter: "stable",
          scrollbarColor: "var(--color-border-strong) transparent",
          scrollbarWidth: "thin",
        },
        // Mono uses tabular nums
        ".font-mono": {
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"liga" 0',
        },
        // Reduced motion is honored by tokens but we also strip animations
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": {
            animationDuration: "0.001ms !important",
            transitionDuration: "0.001ms !important",
          },
        },
      });

      // Variant: focus state of the parent panel — drives Contextual Ghosting
      addVariant("panel-focused",   ['&[data-panel-focused="true"]', '[data-panel-focused="true"] &']);
      addVariant("panel-unfocused", ['&[data-panel-focused="false"]', '[data-panel-focused="false"] &']);
      // Variant: pinned inspector
      addVariant("pinned",         ['&[data-pinned="true"]', '[data-pinned="true"] &']);
      // Variant: density
      addVariant("density-compact",     ['&[data-density="compact"]',     '[data-density="compact"] &']);
      addVariant("density-comfortable", ['&[data-density="comfortable"]', '[data-density="comfortable"] &']);
      addVariant("density-cozy",        ['&[data-density="cozy"]',        '[data-density="cozy"] &']);
    },
  ],
} satisfies Config;

export default config;
```

### 11.2 Required npm packages

```
pnpm add tailwindcss-animate @tailwindcss/container-queries
pnpm add lucide-react
pnpm add @tanstack/react-virtual
pnpm add cmdk sonner
pnpm add @tiptap/react @tiptap/starter-kit @tiptap/extension-link
pnpm add @smastrom/react-email-autocomplete
pnpm add tinykeys
pnpm add @fontsource-variable/inter @fontsource-variable/jetbrains-mono
```

`@fontsource-variable/*` is the simplest route to bundle the variable
fonts; copy the WOFF2s to `src-tauri/resources/fonts/` for Tauri to
serve and configure the `@font-face` declarations in §7.1 to point at
the Tauri-served paths.

### 11.3 TypeScript types for tokens

A small token-types file makes `data-density`, `data-panel-focused`,
and the panel-link palette type-safe across the app:

```ts
// src/design-system/tokens.ts
export type Density = "compact" | "comfortable" | "cozy";
export type PanelLink = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type Elevation = "l0" | "l1" | "l2" | "l3" | "l4";
export type Semantic = "info" | "success" | "warning" | "danger";

export type ControlSize = "xs" | "sm" | "md" | "lg" | "xl";
export type RowDensity = Density;

export const DENSITY_ROW_HEIGHT_PX: Record<Density, number> = {
  compact: 28,
  comfortable: 36,
  cozy: 48,
};
```

---

## 12. Open Decisions for Product Owner

The implementation can proceed without these answers using the
defaults shown, but each is a meaningful brand or behavior choice
that should be confirmed.

| # | Question | Default if not answered | Why it matters |
|---|---|---|---|
| 1 | Should NEXUS auto-follow OS dark/light preference, or always start in dark with explicit user toggle? | Always-dark with toggle in chrome | Light theme is derived; some users on always-light OSes will never see dark unless we explicitly set it. |
| 2 | Confirm the accent hue. Default is `oklch(0.68 0.17 257)` — a vibrant cyan-blue similar to VS Code's accent but distinct from system blue. | Use the default | This color appears in selection, focus, primary actions, and the brand chrome. Once shipped, changing it touches every screen. |
| 3 | Panel-link palette — confirm 8 colors is the right ceiling for distinguishable panel pairings. | 8 colors, recycled by hash beyond that | Too few = pairings collide; too many = colors lose distinguishability under dimming. |
| 4 | Default undo-send window. Options: off / 5s / 10s / 30s. | 5s | Affects how long the user must wait before a Send actually leaves the queue. Power users want 5s; risk-averse organizations want 30s. |
| 5 | "Always full contrast" accessibility setting that disables Content-Aware Dimming globally — ship in v1 or defer? | Ship in v1 settings panel | Required for organizations with strict procurement A11y bars; cheap to add up front, costly to retrofit. |
| 6 | Bulk-select cap warning threshold. We allow `Cmd+A` on virtualized lists; should there be a hard cap (e.g. 10,000) before showing a confirmation? | Hard cap at 10,000 with "Select all 47,231" confirmation | Without a cap, accidental selection of 500k rows can lead to accidental destructive actions. |
| 7 | Should the Composer be a Stage panel by default, a floating window by default, or last-used? | Stage panel by default; ⇧-click for window | Affects keyboard flow into the composer. Stage default keeps it in the workspace; floating default matches Apple Mail muscle memory. |
| 8 | First-Phase modules to register with the shell beyond {EmailList, Inspector, Composer, FolderNav, Search, Settings}? Mark each as Phase-1 or Phase-2. | Above six only in Phase 1 | Determines what slots and icons we wire in the module palette for MVP. |

---

## Appendix A — Component → Token quick map

| Component | Surface | Border | Text | Accent role |
|---|---|---|---|---|
| App canvas | `bg-canvas` | — | `text-primary` | — |
| Workspace chrome | `surface-1` | bottom `border-default` | `text-secondary` | active workspace dot uses `accent` |
| Status bar | `surface-1` | top `border-subtle` | `text-tertiary` | bulk-action button uses `accent` |
| Navigation panel | `surface-1` | right `border-subtle` | `text-secondary` | selected folder uses `accent-soft` + 3px rail |
| Stage panel | `surface-1` | radius `md`, shadow `l1` | per role | selected row uses `accent-soft` + rail |
| Inspector panel | `surface-1` | radius `md`, shadow `l1` | per role | pin uses `accent` when active |
| HUD | `surface-3` | radius `md`, shadow `l2` | per role | title bar accent dot when busy |
| Modal | `surface-4` | radius `lg`, shadow `l3` | per role | primary CTA uses `accent` |
| cmdk | `surface-4` | radius `xl`, shadow `l3` | per role | active item uses `accent-soft` |
| Toast | `surface-4` blur 12 | radius `md`, shadow `l4` | `text-primary` | left rail per variant |

## Appendix B — Keyboard shortcut reservations (chrome-level)

These are reserved by the shell. Modules cannot rebind them.

| Shortcut | Action |
|---|---|
| ⌘K | Open command palette |
| ⌘⇧K | Open command palette in inline-prompt mode for last command |
| ⌘P | Quick switcher (panels + recently opened entities) |
| ⌘⇧P | Same as ⌘K (VS Code muscle memory) |
| ⌘, | Open Settings |
| ⌘W | Close active panel (not window) |
| ⌘⇧W | Close active panel group |
| ⌘N | New (default = compose; module can override when focused) |
| ⌘⇧N | New window |
| ⌘1…9 | Switch to workspace 1–9 |
| ⌘⇥ / ⌘⇧⇥ | Cycle tabs within active group |
| ⌃⇥ / ⌃⇧⇥ | Cycle panel groups |
| F6 / ⇧F6 | Cycle workspace regions |
| ⌘/ | Focus the global search box |
| ? | Show keyboard shortcut overlay |
| Esc | Context-sensitive close (see §6.2) |

Module-owned shortcuts (j/k, e for archive, r for reply, etc.) are
documented per module and only active when that module's panel has
focus.

---

*End of specification.*
