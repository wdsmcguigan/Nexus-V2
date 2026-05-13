# EP-0 — Data Model Overhaul (Web) — Execution Checklist

**Status:** Ready to execute
**Branch:** `claude/nexus-design-system-spec-Ub2D2`
**Reference docs:** `docs/architecture.md`, `docs/glossary.md`

This is the concrete, file-level checklist for `EP-0`. Every item
references the glossary by ID. Check items off as they ship. A fresh
chat agent should be able to pick up this file mid-stream and continue
without rebuilding context.

**Guiding principle**: Lock in the schema and indexes for **every**
metadata axis (so we never have to migrate later). Ship UI for the
high-frequency axes only. UI for `CFD`, `NTE`, `FLG`-with-due-date is
deferred to `EP-2` per the architecture.

---

## How to use this file

- Mark `[x]` when shipped + verified.
- Each major section ends with a **gate** — don't proceed past it
  until the gate is green.
- File paths are absolute relative to repo root.
- IDs in `CODE_FONT` link back to `docs/glossary.md`.

---

## Phase 0a — Foundations (schema-only, no UI changes)

Goal: every metadata axis exists in types + indexed storage. Nothing in
the UI changes yet; the app should still build and look identical.

- [ ] **`src/data/types.ts` (new)** — formal types per `docs/architecture.md` §4:
  - [ ] `Vault` (`VLT`)
  - [ ] `Account` (`ACT`)
  - [ ] `Folder` (`FLD`) with `parentId`, `diskSlug`, `diskPath`
  - [ ] `Label` (`LBL`) with `kind: "system" | "user"`, `systemKind?`, `parentId?`, `position`
  - [ ] `Status` (`STA`) with `position`, `isDefault?`, `isTerminal?`
  - [ ] `CustomFieldDef` (`CFD`) with full type union + `options[]`
  - [ ] `CustomFieldValue` (`CFV`) discriminated union
  - [ ] `TagUsage` (`TGU`)
  - [ ] `Message` (`MSG`) with all axis fields: `labelIds[]`, `tags[]`,
    `statusId`, `priority`, `star`, `flag`, `pinned`, `muted`, `notes`,
    `customFields`, plus `flags` (RFC 9051), envelope, `bodyRef`
  - [ ] `StarStyle` literal union (12 variants)
  - [ ] `FlagState` (`FLG`)
  - [ ] `Mutation` (`MUTN`) with `kind` literal union from glossary §8
  - [ ] `MetadataFilter` shape for `WF-SEARCH-QUERY`

- [ ] **`src/storage/local.ts` (new)** — in-memory store with the indexes
  described in `docs/architecture.md` §5:
  - [ ] Tables: `messages`, `messages_labels`, `messages_tags`,
    `labels`, `folders`, `statuses`, `custom_field_defs`,
    `custom_field_values`, `tag_usage`, `mutations`
  - [ ] All composite indexes per §5
  - [ ] OPFS persistence layer (read on init, debounced write on change)
  - [ ] Cascade behavior (label/folder/status delete cleans references)
  - [ ] Note: pre-FTS5; full-text search is `EP-3`. Metadata filtering is fully indexed now.

- [ ] **`src/storage/query.ts` (new)** — `queryMessages(filter)` (`WF-SEARCH-QUERY`):
  - [ ] Compose predicates across any combination of axes
  - [ ] Sort/group args
  - [ ] Pagination cursor
  - [ ] Returns `{ items: Message[], total: number, took: number }` for benchmarks

- [ ] **`src/state/mutations.ts` (new)** — `WF-OUTBOUND-MUTATION`:
  - [ ] `recordMutation(kind, payload)` writes to `mutations` table + applies optimistically to local store
  - [ ] One helper per `MUTN` kind from glossary §8 (typed wrappers)
  - [ ] Mutation replay function (for tests + future hydration)
  - [ ] Lamport clock + deviceId stub (relay integration is `EP-5`)

**🚦 Gate 0a**: `pnpm typecheck && pnpm build` clean. Existing app
behavior unchanged. New unit tests exist for: every mutation kind round-trips
(emit → apply → assert state), `queryMessages` returns expected ids on a
seeded fixture.

---

## Phase 0b — Fixture migration + state refactor

Goal: existing `fixtures.ts` data is reshaped into the new schema and
flows through the new store + query helper. UI still reads/writes through
existing hooks; under the hood it's the new pipeline.

- [ ] **`src/data/fixtures.ts` (refactor)**:
  - [ ] Convert flat folder list into `FLD` tree with at least 2 levels of nesting (e.g. `Personal/Receipts/2026`)
  - [ ] Seed the 8 system `LBL`s (`inbox`/`sent`/`drafts`/`trash`/`archive`/`snoozed`/`starred`/`important`)
  - [ ] Seed 4–6 user `LBL`s (some nested) matching the existing fixture intent
  - [ ] Seed 4–5 sample `STA`s (Triage / Reading / Awaiting Reply / Action / Done; `Done` marked `isTerminal`, `Triage` marked `isDefault`)
  - [ ] Seed 2–3 sample `CFD`s (e.g. "Project" select, "Deal Stage" select, "Notes URL" url) so we exercise the EAV index
  - [ ] Reshape existing message fixtures: every message gets `folderId` (one), `labelIds` (incl. correct system labels), some get `tags`, some get `statusId`, some get `priority`, a few get colored `STR`, one gets `pinned`, one gets `muted`, one gets `notes`, one or two get `CFV` values
  - [ ] Generate (in dev only, via a flag) a 100k-synthetic-message fixture for the filter benchmark

- [ ] **`src/state/workspace.ts` (refactor)**:
  - [ ] Replace direct fixture reads with calls into `src/storage/local.ts`
  - [ ] `useVisibleEmails` → calls `queryMessages({ folderId? } | { labelId? } | { statusId? } | …)` per current selection
  - [ ] All existing actions (`archive`, `snooze`, `removeLabelFromEmail`, `setStarred`, `setRead`, etc.) route through `recordMutation`
  - [ ] Add new actions for every axis: `addLabel`, `removeLabel`, `addTag`, `removeTag`, `setStatus`, `clearStatus`, `setPriority`, `clearPriority`, `setStar`, `clearStar`, `setFlag` (boolean MVP), `clearFlag`, `setPinned`, `setMuted`, `setNote`, `setCustomFieldValue`, `clearCustomFieldValue`, plus folder/label/status/CFD CRUD

**🚦 Gate 0b**: App still renders identically. All existing actions
work. `pnpm typecheck && pnpm build` clean. Existing 25 screenshots all pass.

---

## Phase 0c — Navigation panel UI (`NAV-*`)

- [ ] **`src/components/nav/NavigationPanel.tsx`**:
  - [ ] System-label conversion: render the 8 fixed `LBL`s in `NAV-SYSTEM-LABEL-LIST` (replaces the current "system folders")
  - [ ] `NAV-FOLDER-TREE`: render `FLD` tree with nesting; click selects; chevron toggles expand/collapse
  - [ ] `NAV-FOLDER-CREATE`: wire the existing "New folder" button stub to inline create input (Esc cancels, Enter commits, records `CREATE_FOLDER`)
  - [ ] `NAV-FOLDER-CTX`: right-click / long-press menu — Rename, Delete, Recolor, Nest under
  - [ ] `NAV-LABEL-LIST`: render user `LBL`s; same context menu pattern (`RENAME_LABEL`, `DELETE_LABEL`, etc.)
  - [ ] `NAV-ACCOUNT-DOT`: dot color from latest mutation log status (existing field, now wired)

**🚦 Gate 0c**: Manual test — create / rename / nest / delete a folder
via UI; do the same for labels; click a system label and see filtered
list. New screenshots `26-folder-create-flow`, `27-label-add-combobox`
(this one technically is INS, see 0d), `28-nested-folder-tree` pass.

---

## Phase 0d — Inspector panel UI (`INS-*`)

- [ ] **`src/components/inspector/InspectorPanel.tsx`**:
  - [ ] `INS-LBL-COMBO`: wire the existing "Add" label button stub to a combobox over existing `LBL`s + "create new" + nesting (records `ADD_LABEL` / `CREATE_LABEL`)
  - [ ] `INS-PIN-TOGGLE`: pin toggle (records `SET_PINNED`)
  - [ ] `INS-MUTE-TOGGLE`: mute toggle thread-wide (records `SET_MUTED`)
  - [ ] `INS-FLAG-TOGGLE`: boolean flag toggle (records `SET_FLAG` with `{ setAt: now }` / `CLEAR_FLAG`). Full date picker is `EP-2`.

- [ ] **`src/components/inspector/TagBar.tsx` (new, `INS-TAG-BAR`)**:
  - [ ] Inline `#hashtag`-typing editor
  - [ ] Autocomplete suggestions from `TGU` ranked by recency + count
  - [ ] Enter or comma commits a tag (`ADD_TAG`); Backspace on empty input removes the last chip (`REMOVE_TAG`)
  - [ ] Renders existing tags as monospace `#prefix` chips (visually distinct from `LBL` color chips)

- [ ] **`src/components/inspector/StatusPicker.tsx` (new, `INS-STATUS-PICKER`)**:
  - [ ] Single-select combobox over `STA`s (color dot + name)
  - [ ] "Create new status" affordance opens an inline mini-form (name + color)
  - [ ] Records `SET_STATUS` / `CLEAR_STATUS` / `CREATE_STATUS`

- [ ] **`src/components/inspector/PriorityPicker.tsx` (new, `INS-PRIORITY-PICKER`)**:
  - [ ] 4-level dropdown: urgent (red bang) / high (orange) / normal (blank) / low (grey)
  - [ ] Records `SET_PRIORITY` / `CLEAR_PRIORITY`

- [ ] **`src/components/inspector/StarPalette.tsx` (new, `INS-STAR-PALETTE`)**:
  - [ ] 12-icon palette popover (yellow/red/orange/green/blue/purple/check-green/bang-red/question-purple/guillemet-orange/info-blue/bang-yellow)
  - [ ] Triggered by long-press / shift-click on the star icon in either `INS-PANEL` or `LST-EMAIL-ROW`
  - [ ] Click-an-icon = `SET_STAR` with that style; click the active icon again = `CLEAR_STAR`
  - [ ] Click without modifier on an unstarred message = quick-star with the user's last-used color

**🚦 Gate 0d**: Every metadata axis has an Inspector affordance
(except the three deferred to `EP-2`: full `INS-FLAG-PICKER`,
`INS-NOTE-EDITOR`, `INS-CUSTOM-FIELDS`). New screenshots `27-label-add-combobox`,
`29-tag-bar-inline`, `30-status-picker`, `31-priority-and-star` pass.

---

## Phase 0e — Email list UI (`LST-*`)

- [ ] **`src/components/email/EmailRow.tsx` (`LST-EMAIL-ROW`)**:
  - [ ] Render `STR` icon at chosen color (replaces the existing boolean star)
  - [ ] Render `PRI` indicator (left-edge color bar or chip)
  - [ ] Render `LBL` chips (color + name)
  - [ ] Render `TAG` chips (monospace `#prefix`, no color) — visually distinct from labels
  - [ ] Render `STA` chip (color dot + name)
  - [ ] Render `PIN` indicator (small icon)
  - [ ] Render `MUT` state (greyed text)
  - [ ] Long-press / shift-click the star opens `INS-STAR-PALETTE`

- [ ] **`src/components/email/EmailRowMobile.tsx` (`LST-EMAIL-ROW-MOBILE`)**:
  - [ ] Same axes rendered in a denser layout
  - [ ] Swipe gestures unchanged from current behavior

- [ ] **`src/components/email/EmailListPanel.tsx`**:
  - [ ] Pinned messages float to the top of the list (sort key: `pinned DESC, receivedAt DESC` by default)
  - [ ] Header sort options: by date, by `PRI`, by `STA` (group-by toggle), by sender
  - [ ] Group-by-`STA` mode (gated behind a list-mode toggle; full kanban is `EP-1`)

**🚦 Gate 0e**: New screenshots `32-pin-mute-row` pass. Manual:
filter by `STA` selection in nav and confirm the list updates correctly.

---

## Phase 0f — Command palette (`PAL-COMMAND`)

- [ ] **`src/components/palette/CommandPalette.tsx`**:
  - [ ] Add commands: move-to-folder, add-label, remove-label, add-tag,
    remove-tag, set-status, clear-status, set-priority, clear-priority,
    set-star (with palette submenu), clear-star, pin / unpin, mute / unmute,
    flag / unflag, snooze, archive
  - [ ] Each command records the appropriate `MUTN`

**🚦 Gate 0f**: Manual: every command discoverable in `⌘K` and every
one mutates the selected message correctly.

---

## Phase 0g — Tests, screenshots, benchmark

- [ ] **Unit tests**:
  - [ ] Mutation log: every kind from glossary §8 emits the right shape;
    mutation replay reconstructs state across folder + label + tag +
    status + priority + star + flag + pin + mute + note + custom-field ops
  - [ ] `queryMessages`: arbitrary multi-axis intersections return
    expected ids on the seeded fixture
  - [ ] Indexes: schema-asserted presence of every index listed in
    `docs/architecture.md` §5
- [ ] **Filter benchmark**:
  - [ ] On the 100k-synthetic-message fixture, the canonical query
    `LBL=X AND STA=Y AND PRI≤Z AND TAG=T AND CFD.Project=P` runs in **<10ms**
  - [ ] Benchmark runs in CI as a regression check
- [ ] **Screenshots** (extend the existing 25):
  - [ ] `26-folder-create-flow`
  - [ ] `27-label-add-combobox`
  - [ ] `28-nested-folder-tree`
  - [ ] `29-tag-bar-inline`
  - [ ] `30-status-picker`
  - [ ] `31-priority-and-star`
  - [ ] `32-pin-mute-row`
- [ ] **Manual smoke** (per `docs/architecture.md` verification):
  - [ ] Create a folder; rename; nest; delete
  - [ ] Create a label; apply to multiple emails
  - [ ] Archive removes the `inbox` `LBL` (does NOT move file)
  - [ ] Add a `TAG`; change `STA`; set `PRI`; pick a colored `STR`; pin; mute; flag (boolean)
  - [ ] Filter the list to "status = Awaiting Reply AND priority ≥ High"
    and confirm sub-100ms response on the 100k-fixture

**🚦 Gate 0g**: All gates above green. `pnpm typecheck && pnpm build && pnpm test` clean.

---

## Phase 0h — Wrap-up

- [ ] Update `docs/architecture.md` if any decisions changed during build
- [ ] Update `docs/glossary.md` if any new components got names
- [ ] Note any deferred items here (with rationale) for `EP-1` / `EP-2` planning
- [ ] Commit with message referencing `EP-0`
- [ ] Push to `claude/nexus-design-system-spec-Ub2D2`

---

## Out of scope (do NOT do here — tracked in roadmap)

- `INS-CUSTOM-FIELDS` editor + `SET-CUSTOM-FIELDS` settings UI → `EP-2`
- `INS-NOTE-EDITOR` markdown surface → `EP-2`
- `INS-FLAG-PICKER` with date + reminder → `EP-2`
- `VW-SAVED`, `VW-KANBAN-BY-STATUS`, `VW-TABLE-CUSTOM-FIELDS` → `EP-1`
- FTS5 full-text search → `EP-3`
- Sync relay, E2EE protocol, key derivation → `EP-5`
- Tauri shell + real Maildir on disk → `EP-4`
- Provider adapters → `EP-6`
- Mobile native shells → `EP-7`
- Conflict resolution UI → `EP-8`
- Encrypted FTS index → `EP-9`

---

## Decisions log (fill in as we build)

Append-only record of decisions made during execution that future
agents/contributors will want to know.

- _(empty — to be filled during Phase 0a–h)_
