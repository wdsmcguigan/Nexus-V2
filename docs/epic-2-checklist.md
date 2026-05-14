# EP-2 — Custom Fields UI + Notes Editor + Flag-with-due-date — Execution Checklist

**Status:** Complete
**Branch:** `claude/nexus-ep2-execution`
**Reference docs:** `docs/architecture.md`, `docs/glossary.md`

---

## Phase 2a — Workspace + store foundations ✅

- [x] `updateFlag` / `completeFlag` added to `WorkspaceState` + implementation
- [x] `updateCustomField` / `deleteCustomField` added to `WorkspaceState` + implementation
- [x] `recolorLabel` / `recolorFolder` added to `WorkspaceState` + implementation
- [x] `useCustomFieldDefs()` hook added to `src/storage/useStore.ts`
- [x] `RECOLOR_LABEL` / `RECOLOR_FOLDER` added to `MutationKind` in `src/data/types.ts`
- [x] `RECOLOR_LABEL` / `RECOLOR_FOLDER` case handlers added to `applyMutation` in `mutations.ts`
- [x] Typed helpers: `recolorLabel` / `recolorFolder` added to `mutations.ts`

**Gate 2a:** `pnpm typecheck` clean ✅

---

## Phase 2b — `INS-FLAG-PICKER` ✅

- [x] `src/components/inspector/FlagPicker.tsx` (new)
  - [x] Popover trigger: shows flag status (No flag / Flagged / Due / Overdue / Completed)
  - [x] `FlagEditor` inner component with date input for `dueAt` + reminder `date` input
  - [x] "Flag without date" shortcut button
  - [x] "Set flag with date" / "Update flag" primary action
  - [x] "Mark complete" → `COMPLETE_FLAG` mutation
  - [x] "Remove flag" → `CLEAR_FLAG` mutation
  - [x] Color-coded status: overdue = red, due = amber, completed = green
- [x] Replaces the boolean `INS-FLAG-TOGGLE` in `InspectorPanel.tsx`
  - [x] Old boolean toggle removed; "Flags" section keeps PIN + MUTE
  - [x] New "Follow-up" section added with `FlagPicker`

**Gate 2b:** `pnpm typecheck` clean ✅

---

## Phase 2c — `INS-NOTE-EDITOR` ✅

- [x] `src/components/inspector/NoteEditor.tsx` (new)
  - [x] Auto-resize textarea (4 rows default, user-resizable)
  - [x] Debounced save: 600ms after last keystroke → `SET_NOTE` mutation
  - [x] Resets on `messageId` change (new message selected)
  - [x] Flush on component unmount
  - [x] Character count + "saving…" indicator
  - [x] Empty string → `setNote(null)` (clears)
- [x] "Notes" section added to `InspectorPanel.tsx`

**Gate 2c:** `pnpm typecheck` clean ✅

---

## Phase 2d — `INS-CUSTOM-FIELDS` ✅

- [x] `src/components/customfields/CustomFieldStrip.tsx` (new)
  - [x] One `FieldRow` per `CustomFieldDef`, sorted by `position`
  - [x] Type-appropriate editors:
    - [x] `text` / `url` / `email` → `<input type="text|url|email">` + clear (✕) button
    - [x] `longtext` → `<textarea rows={2}>`
    - [x] `number` → `<input type="number">` + clear button
    - [x] `date` / `datetime` → `<input type="date|datetime-local">` + clear button
    - [x] `boolean` → checkbox + Yes/No label
    - [x] `select` → Radix DropdownMenu single-select with color dots
    - [x] `multi-select` → chip-toggle buttons for each option
    - [x] `person` → email + display-name inputs (commits on blur)
  - [x] Empty-state message when no CFDs defined
  - [x] `SET_CUSTOM_FIELD_VALUE` / `CLEAR_CUSTOM_FIELD_VALUE` mutations
- [x] "Custom Fields" section added to `InspectorPanel.tsx`

**Gate 2d:** `pnpm typecheck` clean ✅

---

## Phase 2e — `SET-CUSTOM-FIELDS` settings UI ✅

- [x] `src/components/settings/CustomFieldsSettings.tsx` (new)
  - [x] "Add field" button → `CreateFieldForm` inline form
    - [x] Name input + `TypePicker` dropdown → `CREATE_CUSTOM_FIELD`
  - [x] `FieldEditor` per definition:
    - [x] Inline name edit (blur/Enter commits) → `UPDATE_CUSTOM_FIELD`
    - [x] `TypePicker` to change type in-place → `UPDATE_CUSTOM_FIELD`
    - [x] Collapse/expand chevron
    - [x] Delete (✕) with `confirm()` guard → `DELETE_CUSTOM_FIELD`
    - [x] For `select` / `multi-select`: option management (add/edit label & color / delete) → `UPDATE_CUSTOM_FIELD`
    - [x] For other types: description input
  - [x] Empty state with explanation copy
- [x] Settings Dialog wired into `NavigationPanel.tsx` gear icon

**Gate 2e:** `pnpm typecheck` clean ✅

---

## Phase 2f — `ColorPicker` UI primitive + Recolor ✅

- [x] `src/components/ui/ColorPicker.tsx` (new)
  - [x] 8-slot row of color dot buttons
  - [x] Selected dot: `border-text-primary` ring
  - [x] `aria-pressed` + `aria-label` on each button
- [x] `InlineRecolor` helper added to `NavigationPanel.tsx`
  - [x] Shows `ColorPicker` inline (replaces row when recoloring)
  - [x] Commits immediately on color click
  - [x] ✕ to cancel without saving
- [x] `UserLabelRow` — "Recolor" context menu item → `RECOLOR_LABEL`
- [x] `FolderTreeNode` — "Recolor" context menu item → `RECOLOR_FOLDER`
- [x] `LabelCombobox` — replaced `charCodeAt` stub with position-cycling auto-color

**Gate 2f:** `pnpm typecheck` clean ✅

---

## Phase 2g — Inspector wiring ✅

- [x] Removed old `Flag` / `FlagOff` boolean imports from `InspectorPanel.tsx`
- [x] Removed old `setFlag` / `clearFlag` dead wires from `InspectorPanel.tsx`
- [x] "Flags" section: PIN + MUTE toggles (unchanged)
- [x] "Follow-up" section: `FlagPicker` (new)
- [x] "Custom Fields" section: `CustomFieldStrip` (new)
- [x] "Notes" section: `NoteEditor` (new)

**Gate 2g:** `pnpm typecheck` clean ✅

---

## Phase 2h — Settings access point ✅

- [x] `NavigationPanel.tsx` Settings gear icon wired → `settingsOpen` state
- [x] Radix `Dialog.Root` wraps `CustomFieldsSettings`
  - [x] Overlay + centered content with scroll
  - [x] `Dialog.Title` = "Settings" for a11y
  - [x] Close button (✕) via `Dialog.Close`

**Gate 2h:** `pnpm typecheck` clean ✅

---

## Phase 2i — Tests + docs ✅

- [x] `src/state/__tests__/ep2.test.ts` — 17 tests:
  - [x] Flag: set / update / complete / clear + MUTN assertions
  - [x] Note: set / clear / MUTN assertion
  - [x] CFD CRUD: create / update / delete + cascade to messages
  - [x] CFV: set / clear + MUTN assertions
  - [x] Recolor: label + folder color changes + MUTN assertions
- [x] `pnpm test` — 100/100 passing
- [x] `pnpm build` — clean (521 kB bundle)
- [x] This checklist written
- [x] Commit + push to `claude/nexus-ep2-execution`

**🚦 Gate 2i:** `pnpm typecheck && pnpm build && pnpm test` all green ✅

---

## Deferred items (for EP-3 / EP-4 planning)

**→ EP-3:**
- Full body retrieval via `bodyRef` in `EmailViewerPanel`
- FTS5 full-text search wired into `queryMessages`
- Markdown rendering for `NoteEditor` (currently plain textarea)
- OPFS persistence for `LocalStore`

**→ EP-4 (Tauri desktop):**
- CFD option drag-reorder (currently shows GripVertical icon but DnD not wired)
- CFD definition drag-reorder
- Saved-view + custom-field settings tab-based Settings panel (replace single-modal approach)

---

## Decisions log

**`NoteEditor` textarea — no markdown preview in EP-2:**
Markdown preview requires either a parser bundle (adds ~40kB) or the full body retrieval pipeline (EP-3). Deferred to EP-3 when FTS + body retrieval land together.

**`FlagPicker` date inputs — HTML `<input type="date">` not a custom picker:**
Native date inputs are accessible by default, work across all browsers, and require zero added dependencies. A styled calendar picker (react-day-picker or similar) is a cosmetic upgrade deferred to EP-4 when the design system is more locked.

**`CustomFieldStrip` person editor commits on blur:**
Committing on every keystroke would create excessive mutations. Blur is the right save boundary for a two-field form (email + name). A "save" button would add chrome for little benefit.

**`RECOLOR_LABEL` / `RECOLOR_FOLDER` as separate mutation kinds:**
Separating color from name in the mutation log is semantically clean and future-proofs sync conflict resolution — a color change and a rename can coexist without a conflict, whereas a merged `UPDATE_LABEL` would require field-level diff.

**Settings as a dialog (not a separate panel):**
EP-2 has one settings surface (CFDs). A full settings panel/tab system is over-engineering for one screen. Dialog is the right scope for EP-2; EP-4 can introduce a dedicated Settings route.
