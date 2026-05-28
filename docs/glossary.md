# NEXUS — Glossary & Component Registry

**Status:** v0.1 living reference
**Audience:** Anyone working on NEXUS — humans and agents
**Scope:** Canonical names + stable IDs for every concept, component,
workflow, view, and epic in the NEXUS codebase

This is the **single source of truth for terminology**. If you read a name
in a PR, a commit message, a code comment, or in conversation with the
project owner, you should be able to find it here. If you can't find it
here, either the name is wrong or this doc is out of date — fix one or
the other.

**Purpose**: prevent the "email list mode view tag label labels" class of
ambiguity. Every term has an **Is** definition AND an **Is NOT**
disambiguation against its closest neighbors.

When in doubt about what the project owner meant, **ask using the ID** —
e.g. "Did you mean `TAG` (free-form #hashtag) or `LBL` (managed
taxonomy)?"

---

## Table of contents

1. [ID conventions](#1-id-conventions)
2. [Metadata axes](#2-metadata-axes)
3. [Core data entities](#3-core-data-entities)
4. [Components](#4-components)
5. [Workflows / processes](#5-workflows--processes)
6. [Views](#6-views)
7. [Epics](#7-epics)
8. [Mutation kinds](#8-mutation-kinds)
9. [Naming conventions](#9-naming-conventions)

---

## 1. ID conventions

| Category | Prefix | Example |
|---|---|---|
| Metadata axis | 3 letters (uppercase) | `LBL`, `TAG`, `STA` |
| Core data entity | 3 letters (uppercase) | `MSG`, `FLD`, `VLT` |
| Component | `<PANEL>-<COMPONENT>[-<VARIANT>]` | `INS-LBL-COMBO`, `LST-EMAIL-ROW-MOBILE` |
| Workflow | `WF-<SLUG>` | `WF-INBOUND-SYNC` |
| View | `VW-<SLUG>` | `VW-KANBAN-BY-STATUS` |
| Epic | `EP-<N>` | `EP-0` |
| Mutation kind | `SCREAMING_SNAKE_CASE` | `ADD_LABEL`, `SET_STATUS` |

**Entry format** (used throughout this doc):

```
### <ID> — <Name>
**Is**: One-line definition of what this is.
**Is NOT**: Disambiguation against the closest-neighbor concepts.
**Cardinality / shape**: (for data) — many/one/bool + shape.
**Lives in**: file paths (or "not yet built — Epic N").
**See also**: cross-references to neighbor IDs.
```

---

## 2. Metadata axes

The orthogonal dimensions a message can be annotated on. Each axis is
indexed independently for sub-10ms multi-axis `includes` filtering on
100k+ message vaults.

### LBL — Label
**Is**: Organizational taxonomy. Many-to-many per message. Color-coded.
Nestable (Gmail-style). Picked from a managed list. JMAP-mailbox-equivalent.
**Is NOT**: A folder (`FLD`, single per message, disk-canonical). A tag
(`TAG`, free-form, no color). A status (`STA`, single-value, workflow).
**Cardinality / shape**: many; typed `{name, color: 1..8, kind, parentId?, position}`.
**Subset — system labels**: `inbox`, `sent`, `drafts`, `trash`, `archive`,
`snoozed`, `starred`, `important`. Fixed, special UI treatment.
**Provider-portable?** Yes (Gmail labels, JMAP mailboxes, IMAP folders via mapping).
**Lives in**: `src/data/types.ts` (Epic 0), `src/state/workspace.ts` (Epic 0).
**See also**: `TAG`, `FLD`, `STA`, `INS-LBL-COMBO`.

### TAG — Tag
**Is**: Lightweight atomic free-form annotation. `#hashtag` string. Many
per message. No color. No hierarchy. Lower ceremony than `LBL`.
**Is NOT**: A label (`LBL`, managed list with color/nesting). A
keyword/full-text-search match. A status (`STA`). The `UI-TAG` chip
primitive (that's a presentation component which can render `TAG`s,
`LBL`s, statuses, etc.).
**Cardinality / shape**: many; bare strings stored on `MSG.tags: string[]`
with a denormalized `messages_tags` inverted-index table + a `tag_usage`
table for autocomplete and global rename.
**Provider-portable?** No (NEXUS-local).
**Lives in**: `src/data/types.ts` (Epic 0), `src/storage/local.ts` (Epic 0).
**See also**: `LBL`, `INS-TAG-BAR`, `UI-TAG`.

### STA — Status
**Is**: Single-select workflow state. User-customizable ordered list (e.g.
Triage → Reading → Awaiting Reply → Action → Done). Has progression
semantics (`isDefault`, `isTerminal`). Drives kanban view (`VW-KANBAN-BY-STATUS`).
**Is NOT**: A label (`LBL`, multi-value). A priority (`PRI`, urgency, not
flow position). A folder (`FLD`).
**Cardinality / shape**: one (nullable); `{name, color: 1..8, position, isDefault?, isTerminal?}`.
**Provider-portable?** No.
**Lives in**: `src/data/types.ts` (Epic 0).
**See also**: `PRI`, `VW-KANBAN-BY-STATUS`, `INS-STATUS-PICKER`.

### PRI — Priority
**Is**: User-set urgency level. 4-value enum: 1=urgent, 2=high, 3=normal, 4=low.
Distinct from provider-derived "importance" (auto-heuristic).
**Is NOT**: A flag (`FLG`, follow-up with due date). A star (`STR`, visual mark).
A status (`STA`, flow position).
**Cardinality / shape**: one (nullable); enum `1 | 2 | 3 | 4 | null`.
**Provider-portable?** No.
**Lives in**: `src/data/types.ts` (Epic 0).
**See also**: `STA`, `FLG`, `INS-PRIORITY-PICKER`.

### STR — Star
**Is**: Single visual mark per message, picked from a 12-icon palette
(Gmail-superstar set): yellow / red / orange / green / blue / purple /
check-green / bang-red / question-purple / guillemet-orange / info-blue /
bang-yellow. One slot per message, rich expressivity.
**Is NOT**: A boolean (we replaced the old binary star). A flag (`FLG`,
has due date + reminder). A label (`LBL`).
**Cardinality / shape**: one (nullable); enum `StarStyle`.
**Provider-portable?** Partial — Gmail's `STARRED` label maps to any
non-null `STR`; the specific icon is NEXUS-local.
**Lives in**: `src/data/types.ts` (Epic 0).
**See also**: `FLG`, `LBL` (system: `starred`), `INS-STAR-PALETTE`.

### FLG — Flag (Follow-up)
**Is**: Outlook-style follow-up marker with optional due date and reminder.
Tracks `setAt`, `dueAt?`, `reminderAt?`, `completedAt?`.
**Is NOT**: A star (`STR`, visual mark with no semantics). A priority
(`PRI`, urgency level). The RFC `\Flagged` keyword (that's `MSG.flags.flagged`).
**Cardinality / shape**: one (nullable); typed `FlagState`.
**Provider-portable?** Partial — maps to `\Flagged` boolean; due date stays local.
**Lives in**: `src/data/types.ts` (Epic 0). UI in Epic 2.
**See also**: `STR`, `PRI`.

### PIN — Pinned
**Is**: Boolean. Pinned messages float to the top of any list view.
**Is NOT**: Starred (`STR`). Flagged (`FLG`). Labeled `important` (`LBL`).
**Cardinality / shape**: bool.
**Provider-portable?** No.
**Lives in**: `MSG.pinned`.
**See also**: `MUT`, `LST-EMAIL-ROW`.

### MUT — Muted
**Is**: Boolean per thread. Suppresses new-message notifications;
greys row in list views.
**Is NOT**: Snoozed (system label `snoozed`). Deleted. Archived.
**Cardinality / shape**: bool.
**Provider-portable?** No.
**Lives in**: `MSG.muted` (applies thread-wide).
**See also**: `PIN`, `THR`.
**⚠ Naming caveat**: `MUT` overlaps visually with `Mutation` (which we
spell out as `MUTN` for the data entity). When in doubt write the full word.

### NTE — Note
**Is**: Free-text markdown annotation per message or thread. Searchable
(joined into FTS5 index in Epic 3).
**Is NOT**: An email body. A reply draft. A tag (`TAG`).
**Cardinality / shape**: one nullable markdown string per message.
**Provider-portable?** No.
**Lives in**: `MSG.notes`. UI in `INS-NOTE-EDITOR`.
**See also**: `INS-NOTE-EDITOR`.

### CFD — Custom Field
**Is**: User-defined typed field. Airtable-style. Unlimited count.
Types: text / longtext / number / date / datetime / url / email / boolean /
select / multi-select / person. Indexed for fast filter performance via EAV.
**Is NOT**: A label (`LBL`, system+user typed metadata). A tag (`TAG`,
untyped strings). A built-in axis.
**Cardinality / shape**: many definitions × one or many values per definition per message.
**Provider-portable?** No.
**Lives in**: `src/data/types.ts` (definitions + values). UI in `INS-CUSTOM-FIELDS`, `SET-CUSTOM-FIELDS`.
**See also**: `VW-TABLE-CUSTOM-FIELDS`, `SET-CUSTOM-FIELDS`.

### RD — Read state
**Is**: Boolean. RFC `\Seen`.
**Is NOT**: Archived. Snoozed. Muted (`MUT`).
**Cardinality / shape**: bool. Lives in `MSG.flags.read`.
**Provider-portable?** Yes.
**See also**: `MSG`.

---

## 3. Core data entities

### VLT — Vault
**Is**: The top-level container for one user's mail. One vault per user.
Manifested as a single directory on disk (`~/Mail/` or chosen path) in
Tauri/desktop; as an OPFS root in web.
**Is NOT**: An account (`ACT`). A folder (`FLD`).
**Lives in**: `src/data/types.ts` (Epic 0).

### ACT — Account
**Is**: A provider connection inside a vault. Gmail / JMAP / IMAP. Multi-account per vault.
**Is NOT**: A vault. A folder.
**Lives in**: `src/data/types.ts` (Epic 0).

### FLD — Folder
**Is**: A real subdirectory of the vault. Hierarchical. Each `.eml`
lives in **exactly one** folder. Mirrors the user's native file browser.
**Is NOT**: A label (`LBL`, metadata, many-to-many). System nav items
(those are labels). A "smart folder" (those are saved views — `VW-LIST`).
**Cardinality / shape**: one folder per message; tree via `parentId`.
**Lives in**: `src/data/types.ts`, on disk via Maildir-style tree.

### MSG — Message
**Is**: An email. Identified by stable canonical UUID across providers.
Holds envelope + body-hash + all metadata axes.
**Lives in**: `src/data/types.ts` (Epic 0).

### THR — Thread
**Is**: Local aggregation of messages by `Message-ID` / `In-Reply-To` /
`References`. Tracked via `MSG.threadId`. Mute (`MUT`) applies thread-wide.
**Is NOT**: A conversation as Gmail defines it (we use stricter local rules).

### MUTN — Mutation
**Is**: A structured user intent (`{kind, payload, ts, deviceId, lamport}`)
recorded in the local log and shipped to the sync relay. The unit of replication.
**Is NOT**: A direct DB write. State change goes through mutations always.
**Cardinality / shape**: append-only log per vault.
**Lives in**: `src/state/mutations.ts` (Epic 0). Full kind list in §8.

### TGU — Tag usage
**Is**: Denormalized count of how often each `TAG` is used. Powers
autocomplete in `INS-TAG-BAR` and global rename via `RENAME_TAG_GLOBAL`.
**Lives in**: `src/storage/local.ts` (Epic 0).

### CFV — Custom field value
**Is**: A single value of a `CFD` for a specific message. Stored EAV-style
in `custom_field_values(message_id, field_id, value_text, value_number,
value_date, value_bool)` for fast indexed filter.
**Lives in**: `src/storage/local.ts` (Epic 0).

### CMM — Client Mode
**Is**: Application-level switch between two sync models, persisted per vault.
- `"traditional"` — cloud-first. Provider (Gmail/IMAP) is the primary source of truth. Mutations write to DB only; no filesystem side-effects.
- `"local-first"` — disk-first. Maildir `.eml` tree is canonical. Mutations write to DB **and** trigger FS side-effects (rename/move/create). Manual file moves in Finder generate equivalent mutations via the `notify` watcher.
**Lives in**: `AppState.client_mode: Mutex<String>` (Rust), persisted to `{vault_path}/.nexus-mode` file. Frontend: `src/lib/clientMode.ts` (`loadClientMode()` / `saveClientMode()`).
**IPC**: `get_client_mode`, `set_client_mode` in `src-tauri/src/commands.rs`.
**Set during**: `VaultSetup` onboarding (mode selection step) and can be changed in Settings.
**See also**: `VLT`, `WF-FS-RECONCILE-APP-TO-DISK`, `WF-FS-RECONCILE-DISK-TO-APP`.

### RULE — Automation Rule
**Is**: A saved automation that fires when an inbound message matches one or more conditions. Conditions test message fields (from, subject, has_attachment, label, tag) with string operators (contains, equals, starts_with, not_contains) combined with AND or OR logic. Actions include ADD_LABEL, REMOVE_LABEL, SET_STATUS, SET_PRIORITY, ADD_TAG, STAR, MARK_READ, ARCHIVE, TRASH.
**Is NOT**: A filter (`MetadataFilter` — synchronous, query-time); rules fire once at ingest time.
**Cardinality / shape**: many per vault; typed `{ id, vaultId, name, conditions: RuleCondition[], conditionLogic: 'AND'|'OR', actions: RuleAction[], enabled: boolean, position: number }`.
**Lives in**: `src/data/types.ts`, `src-tauri/src/db/queries.rs` (`apply_rules_to_message`), `src/components/settings/RulesSettings.tsx`, `src/components/settings/RuleEditorDialog.tsx`.
**See also**: `MSG`, `LBL`, `TAG`, `STA`.

### TMPL — Email Template
**Is**: A saved subject + HTML body pair that can be applied to the composer with one click to pre-fill a new message.
**Is NOT**: A draft (a specific in-progress message); templates are reusable archetypes with no recipients. Not a calendar event template (`ETMPL`).
**Cardinality / shape**: many per vault; typed `{ id, vaultId, name, subject: string, bodyHtml: string, createdAt: number }`.
**Lives in**: `src/data/types.ts`, `src-tauri/src/db/queries.rs`, `src/components/settings/TemplatesSettings.tsx`, `src/components/email/EmailComposerPanel.tsx` (picker).
**See also**: `MSG`, `ETMPL`.

### CAL — Calendar
**Is**: A connected Google Calendar (or future CalDAV calendar) belonging to an account. Holds display name, color, and an enabled/disabled toggle for list-view visibility.
**Is NOT**: A `CalendarEvent` (`EVT`). A vault (`VLT`). An account (`ACT`).
**Cardinality / shape**: many per account; typed `{ id, vaultId, accountId, externalId, name, color?, enabled: boolean }`.
**Lives in**: `src/data/types.ts` (EP-11), `calendars` table in `src-tauri/src/db/schema.rs`, `src/components/calendar/CalendarManagementSection.tsx`.
**See also**: `EVT`, `ACT`.

### EVT — Calendar Event
**Is**: A single calendar event instance (Google Calendar `singleEvents=true` expansion; recurring series pre-expanded server-side). Holds all Google Calendar API fields captured in EP-12.
**Is NOT**: A recurring series template (Google handles that). An email message (`MSG`).
**Cardinality / shape**: many per vault; typed `CalendarEvent` in `src/data/types.ts`. Key fields: `startTs`, `endTs`, `allDay`, `title`, `attendees: CalendarAttendee[]`, `colorId`, `conferenceUrl`, `attachments`, `reminders`, `recurringEventId`, `visibility`, `transparency`, `notes` (local-only).
**Lives in**: `src/data/types.ts` (EP-11), `calendar_events` DB table with 9 additional columns from EP-12 migration, `localStore.calendarEvents`.
**See also**: `CAL`, `ETMPL`.

### ETMPL — Event Template
**Is**: A saved preset that pre-fills `EventCreateModal` with a title, description, location, duration, and default attendees. Reusable across many calendar events.
**Is NOT**: A `CalendarEvent` (`EVT`) — templates have no dates. An email template (`TMPL`).
**Cardinality / shape**: many per vault; typed `{ id, vaultId, name, title: string, description?: string, location?: string, durationMinutes: number, defaultAttendees: string[], createdAt: number }`.
**Lives in**: `src/data/types.ts` (EP-13), `event_templates` DB table (`src-tauri/src/db/schema.rs`), `localStore.eventTemplates`, `src/components/settings/EventTemplatesSettings.tsx`.
**See also**: `EVT`.

---

## 4. Components

### Navigation panel (`NAV-*`)

#### NAV-PANEL — Navigation panel container
**Is**: The left-rail panel hosting accounts, system labels, folder tree, user labels.
**Lives in**: `src/components/nav/NavigationPanel.tsx`.

#### NAV-ACCOUNT-DOT — Account sync-status dot
**Is**: Colored dot on each account row indicating sync state (green idle /
blue syncing / amber pending / red error).
**Lives in**: `src/components/nav/NavigationPanel.tsx` (Epic 0 wires it).

#### NAV-FOLDER-TREE — Folder tree
**Is**: Hierarchical folder listing. Renders `FLD` records as a nested tree.
Right-click / long-press → `NAV-FOLDER-CTX`.
**Lives in**: `src/components/nav/NavigationPanel.tsx` (Epic 0).

#### NAV-FOLDER-CREATE — Folder create input
**Is**: Inline create input triggered by the "New folder" button.
**Lives in**: `src/components/nav/NavigationPanel.tsx` (Epic 0).

#### NAV-FOLDER-CTX — Folder context menu
**Is**: Rename / delete / recolor / nest menu for a folder.
**Lives in**: `src/components/nav/NavigationPanel.tsx` (Epic 0).

#### NAV-LABEL-LIST — Label list
**Is**: User-label listing with color dots. Nestable.
**Lives in**: `src/components/nav/NavigationPanel.tsx` (Epic 0).

#### NAV-SYSTEM-LABEL-LIST — System-label list
**Is**: The 8 system labels (`inbox`/`starred`/`drafts`/`sent`/`snoozed`/
`archive`/`spam`/`trash`). Replaces the current "system folders" misnomer.
**Lives in**: `src/components/nav/NavigationPanel.tsx` (Epic 0).

### Inspector panel (`INS-*`)

#### INS-PANEL — Inspector panel container
**Is**: The right-rail metadata editor for the selected message/thread.
**Lives in**: `src/components/inspector/InspectorPanel.tsx`.

#### INS-LBL-COMBO — Label combobox
**Is**: Picker over existing `LBL` + "create new" affordance. Records `ADD_LABEL`/`CREATE_LABEL` mutations.
**Lives in**: `src/components/inspector/InspectorPanel.tsx` (Epic 0).

#### INS-TAG-BAR — Tag bar
**Is**: Inline `#hashtag`-typing editor for `TAG`. Autocomplete from `TGU`.
**Lives in**: `src/components/inspector/TagBar.tsx` (new, Epic 0).

#### INS-STATUS-PICKER — Status picker
**Is**: Single-select combobox for `STA`. Palette + "create new" affordance.
**Lives in**: `src/components/inspector/StatusPicker.tsx` (new, Epic 0).

#### INS-PRIORITY-PICKER — Priority picker
**Is**: 4-level dropdown for `PRI` (urgent/high/normal/low).
**Lives in**: `src/components/inspector/PriorityPicker.tsx` (new, Epic 0).

#### INS-STAR-PALETTE — Star palette
**Is**: 12-icon picker for `STR`. Long-press / shift-click on the star
icon opens the palette.
**Lives in**: `src/components/inspector/StarPalette.tsx` (new, Epic 0).

#### INS-PIN-TOGGLE — Pin toggle
**Is**: Toggle for `PIN`.
**Lives in**: `src/components/inspector/InspectorPanel.tsx` (Epic 0).

#### INS-MUTE-TOGGLE — Mute toggle
**Is**: Thread mute toggle for `MUT`.
**Lives in**: `src/components/inspector/InspectorPanel.tsx` (Epic 0).

#### INS-FLAG-TOGGLE — Flag toggle (boolean MVP)
**Is**: Boolean flag toggle (maps `flag = { setAt } | null`).
**Lives in**: `src/components/inspector/InspectorPanel.tsx`.
**See also**: `INS-FLAG-PICKER`.

#### INS-FLAG-PICKER — Flag picker with due date
**Is**: Full follow-up UI with date picker + reminder.
**Lives in**: `src/components/inspector/FlagPicker.tsx`.

#### INS-NOTE-EDITOR — Note editor
**Is**: Markdown editor for `NTE`.
**Lives in**: `src/components/inspector/NoteEditor.tsx`.

#### INS-CUSTOM-FIELDS — Custom field strip
**Is**: Per-message editors for defined `CFD`s, rendered with type-appropriate inputs.
**Lives in**: `src/components/customfields/CustomFieldStrip.tsx`.

### Email list (`LST-*`)

#### LST-PANEL — Email list panel container
**Is**: The center panel showing the email list for the current view.
**Lives in**: `src/components/email/EmailListPanel.tsx`.

#### LST-EMAIL-ROW — Email row (desktop)
**Is**: One row per message in the desktop list view. Renders sender,
subject, snippet, time, `STR`, `PRI` indicator, `LBL` chips, `TAG`
chips, `STA` chip, `PIN`/`MUT` state.
**Lives in**: `src/components/email/EmailRow.tsx` (Epic 0 extends it).

#### LST-EMAIL-ROW-MOBILE — Email row (mobile)
**Is**: Mobile variant of `LST-EMAIL-ROW`. Denser; swipe gestures.
**Lives in**: `src/components/email/EmailRowMobile.tsx` (Epic 0 extends it).

#### LST-HEADER — Email list header
**Is**: Sort / group / view-mode controls at top of `LST-PANEL`.
**Lives in**: `src/components/email/EmailListPanel.tsx` (header is internal to the panel today; may extract later).

#### LST-VIEWER — Email viewer panel
**Is**: The reading pane for the selected `MSG`.
**Lives in**: `src/components/email/EmailViewerPanel.tsx`.

#### LST-COMPOSER — Email composer panel
**Is**: Compose / reply / forward editor.
**Lives in**: `src/components/email/EmailComposerPanel.tsx`.

### Command palette (`PAL-*`)

#### PAL-COMMAND — Command palette
**Is**: ⌘K palette. Commands include: move-to-folder, add-label, add-tag,
set-status, set-priority, set-star, pin, mute, snooze, archive.
**Lives in**: `src/components/palette/CommandPalette.tsx` (Epic 0 extends it).

### Workspace (`WSP-*`)

#### WSP-SHELL — Workspace shell
**Is**: Top-level layout host. Owns panel docking + window chrome.
**Lives in**: `src/components/Workspace.tsx`.

#### WSP-CHROME — Workspace chrome
**Is**: Window chrome (title bar / panel borders / system controls).
**Lives in**: `src/components/chrome/WorkspaceChrome.tsx`.

#### WSP-STATUS-BAR — Status bar
**Is**: Bottom bar surfacing sync state ("All synced" / "Syncing 12…" /
"3 pending — offline" / "Conflict: 1 review needed").
**Lives in**: `src/components/chrome/StatusBar.tsx`.

#### WSP-HUD-STRIP — HUD strip
**Is**: Top heads-up strip surfacing global notifications / shortcuts.
**Lives in**: `src/components/hud/HudStrip.tsx`.

#### WSP-CONFLICT-CHIP — Conflict chip (Epic 8)
**Is**: Inline chip in affected folder/email row indicating a sync conflict.
Click → conflict resolve sheet.

### Mobile (`MOB-*`)

#### MOB-SHELL — Mobile shell
**Is**: Top-level mobile layout host.
**Lives in**: `src/components/mobile/MobileShell.tsx`.

#### MOB-TOPBAR — Mobile top bar
**Lives in**: `src/components/mobile/MobileTopBar.tsx`.

#### MOB-TABBAR — Mobile tab bar
**Lives in**: `src/components/mobile/MobileTabBar.tsx`.

#### MOB-SEARCHBAR — Mobile search bar
**Lives in**: `src/components/mobile/MobileSearchBar.tsx`.

### UI primitives (`UI-*`)

UI primitives are presentation-layer building blocks with no domain
meaning. Catalogued here so domain components can reference them
unambiguously.

#### UI-TAG — Tag chip primitive
**Is**: A visual chip primitive used to render any kind of chip in the UI.
**Is NOT**: The `TAG` metadata axis. The chip primitive is named "Tag"
because of its visual shape; the metadata concept `TAG` is something
the chip can render. **Always disambiguate** in code/conversation:
`UI-TAG` is the React component, `TAG` is the data axis.
**Lives in**: `src/components/ui/Tag.tsx`.

#### Other UI primitives
`UI-AVATAR`, `UI-BUTTON`, `UI-INPUT`, `UI-KBD`, `UI-SKELETON`,
`UI-SPINNER`, `UI-TOOLTIP` — see `src/components/ui/`.

### Settings (`SET-*`, Epic 2+)

#### SET-CUSTOM-FIELDS — Custom field definitions UI (Epic 2)
**Is**: Settings surface to create/edit/delete `CFD`s.

#### SET-RULES — Automation rules UI (EP-7)
**Is**: Settings surface to create/edit/delete/reorder `RULE`s. Opens `RuleEditorDialog` for condition + action builder.
**Lives in**: `src/components/settings/RulesSettings.tsx`, `src/components/settings/RuleEditorDialog.tsx`.

#### SET-TEMPLATES — Email templates UI (EP-7)
**Is**: Settings surface to create/edit/delete `TMPL`s.
**Lives in**: `src/components/settings/TemplatesSettings.tsx`.

### Contacts (`CON-*`)

#### CON-HOVER-CARD — Contact hover card
**Is**: Radix HoverCard (400ms open / 200ms close) triggered by hovering a sender name or participant name. Shows avatar, VIP badge, company, title, email, message count, 3 recent thread links, and "Compose" + "View Contact" action buttons.
**Is NOT**: The full `ContactCard` (that's the expanded panel view in ContactsPanel). A tooltip.
**Lives in**: `src/components/contacts/ContactHoverCard.tsx`.
**Used in**: `EmailViewerPanel.tsx` (sender name/avatar), `InspectorPanel.tsx` (each participant row).
**See also**: `LST-VIEWER`, `INS-PANEL`.

### Email body rendering

#### EmailBody — iframe-based HTML email renderer
**Is**: Component that renders sanitized HTML email bodies inside a sandboxed iframe using `contentDocument.write()` + `ResizeObserver` for auto-height. Applies DOMPurify sanitization and optionally strips remote images for tracking protection.
**Is NOT**: The full `EmailViewerPanel` (which handles loading state, thread display, metadata). `EmailBody` is only the iframe rendering primitive.
**Lives in**: `src/components/email/EmailViewerPanel.tsx` (inline component). `bodyHtml` state uses `string | null`: `null` = loading, `""` = no body/show snippet, `string` = render.
**See also**: `LST-VIEWER`.

### Calendar (`CAL-*`)

#### CAL-PANEL — Calendar panel
**Is**: The top-level calendar container. Hosts the view mode segmented control (Agenda / Week / Month), prev/next navigation arrows, "Today" shortcut, sync button, new-event button, MiniMonth (agenda mode only), and the active view component.
**Lives in**: `src/components/calendar/CalendarPanel.tsx`.

#### CAL-AGENDA — Agenda view
**Is**: Chronological event list grouped by day from the current focus date forward. The default calendar view.
**Lives in**: `src/components/calendar/AgendaView.tsx`.

#### CAL-WEEK — Week view
**Is**: 7-column time grid (56 px per hour, Mon–Sun). Uses a greedy two-pass algorithm to layout overlapping events into non-overlapping columns. Shows an all-day strip at the top, a red current-time indicator on today's column, and supports drag-to-reschedule for non-recurring events.
**Lives in**: `src/components/calendar/WeekView.tsx`.

#### CAL-MONTH — Month view
**Is**: 42-cell (6×7) month grid starting from the Monday of the week containing the 1st. Shows up to 3 event pills per day with a "+N more" overflow button. Clicking a day navigates to agenda for that date. Supports drag-to-reschedule.
**Lives in**: `src/components/calendar/MonthView.tsx`.

#### CAL-MINI — Mini month navigator
**Is**: Compact month grid used in the CalendarPanel sidebar in agenda mode. Event dots use `eventColor(colorId)` to show the first event's Google color per day.
**Lives in**: `src/components/calendar/MiniMonth.tsx`.

#### CAL-EVENT-POPOVER — Event detail popover
**Is**: Hover/click popover on an event pill. Shows title, date/time, attendees (with `CON-HOVER-CARD`), location, local notes (editable), "Join meeting" link (when `conferenceUrl` is set), Drive file attachments list, a private lock icon (when `visibility = "private" | "confidential"`), and a creator line (when creator ≠ organizer).
**Lives in**: `src/components/calendar/EventDetailPopover.tsx`.

#### CAL-CREATE-MODAL — Event create modal
**Is**: Full-screen modal for creating a new event. Accepts optional prefill props (`prefillDate`, `prefillAttendees`, `prefillTitle`). Renders a "Use template" dropdown when event templates exist. Mounted at Workspace root (not inside CalendarPanel) so it works even when the calendar panel is closed.
**Lives in**: `src/components/calendar/EventCreateModal.tsx`.
**See also**: `ETMPL`, `openEventCreateModal()` in `src/state/workspace.ts`.

#### CAL-EDIT-MODAL — Event edit modal
**Is**: Modal for editing an existing event.
**Lives in**: `src/components/calendar/EventEditModal.tsx`.

#### SET-CAL-MGMT — Calendar management settings
**Is**: Per-calendar enable/disable toggles in SettingsPanel.
**Lives in**: `src/components/calendar/CalendarManagementSection.tsx`.

#### SET-EVENT-TEMPLATES — Event templates settings
**Is**: CRUD UI for `ETMPL`s (name, title, location, duration, description, default attendees). Follows the same pattern as `SET-TEMPLATES` for email templates.
**Lives in**: `src/components/settings/EventTemplatesSettings.tsx`.

---

## 5. Workflows / processes

### WF-OUTBOUND-MUTATION — User action → mutation log → (relay)
**Is**: Every user-facing state change writes a `MUTN`, applies optimistically
to the local store, and (Epic 5+) enqueues to the relay.
**Lives in**: `src/state/mutations.ts` + `src/state/workspace.ts` (Epic 0).

### WF-INBOUND-PROVIDER-SYNC — Provider → vault (Epic 6)
**Is**: Provider worker polls Gmail/JMAP/IMAP, generates
`RECEIVE_FROM_PROVIDER` mutations, encrypts, ships to relay.

### WF-FS-RECONCILE-APP-TO-DISK — App → disk (Epic 4)
**Is**: A folder/move op writes the mutation, then performs the FS op
(`fs.rename` of the .eml file). Tagged with an "expected change" cookie
so the watcher ignores its own work.

### WF-FS-RECONCILE-DISK-TO-APP — Disk → app (Epic 4)
**Is**: `notify` detects a manual move/rename → reconciler resolves
the affected `MSG`(s) by content hash → emits equivalent mutation(s).

### WF-CONFLICT-RESOLVE — Concurrent edit resolution (Epic 8)
**Is**: When two devices edit the same record concurrently, last-write-wins
by `(lamport, deviceId)`; concurrent renames record both names + surface
`WSP-CONFLICT-CHIP`.

### WF-SEARCH-QUERY — Filter + full-text composition
**Is**: `queryMessages(filter)` composes predicates across any combination
of metadata axes; Epic 3 adds FTS5 subject+body+notes joining on top.
**Lives in**: `src/storage/query.ts` (Epic 0).

### WF-LABEL-PROVIDER-SYNC — Label push-back (Epic 6)
**Is**: `LBL` add/remove → Gmail `messages.modify` / JMAP `Email/set` /
IMAP `STORE +FLAGS`.

---

## 6. Views

### VW-LIST — List view
**Is**: The default email list (`LST-PANEL`). Filterable, sortable,
groupable by any indexed axis.

### VW-CONVERSATION — Conversation / thread view
**Is**: One `THR` expanded with all messages inline.

### VW-KANBAN-BY-STATUS — Kanban view
**Is**: Columns = `STA` values; cards = messages. Drag = `SET_STATUS`.
**Lives in**: `src/components/views/KanbanView.tsx`.

### VW-TABLE-CUSTOM-FIELDS — Table view
**Is**: Tabular view with one column per `CFD` definition plus core fields.
**Lives in**: `src/components/views/TableView.tsx`.

### VW-SAVED — Saved view
**Is**: A named, persisted filter. Surfaces in nav + palette.
**Lives in**: `src-tauri/src/db/schema.rs` (`saved_views` table) + `src/storage/local.ts`.

---

## 7. Epics

Between EP-8 and EP-11 a set of inter-epic improvements shipped: `ContactHoverCard` hover card on sender/participants, vCard 3.0 import/export (`src/lib/vcard.ts`), tag sidebar navigation (tags as clickable nav items), 21-color label palette, comprehensive email row right-click context menu, and undo/redo with action history modal.

| ID | Title | Status | Validates |
|---|---|---|---|
| **EP-0** | Data model overhaul (web) | Shipped | Power-user mental model + filter speed |
| **EP-1** | Filter & saved-views (web) | Shipped | Power-user feel |
| **EP-2** | Custom fields UI + Notes editor + Flag-with-due-date | Shipped | Airtable-grade expressivity |
| **EP-3** | FTS index + contacts (web) | Shipped | Soundminer-class search |
| **EP-4** | Tauri shell (desktop) + Gmail sync | Shipped | Local-first thesis |
| **EP-5** | E2EE relay sync | Shipped | Cross-device |
| **EP-6** | Multi-provider mail (Gmail / IMAP / SMTP / Outlook) + local-first EML writing | Shipped | Real mail |
| **EP-7** | Native FTS5, rules engine & quick wins | Shipped | Power tools |
| **EP-8** | iOS app (Swift, shares vault format) | In progress | Phone-first users |
| **EP-9** | Conflict UI + advanced sync state | Planned | Edge-case polish |
| **EP-10** | Encrypted FTS hardening | Planned | Trust |
| **EP-11** | Calendar foundation (Google Calendar sync, agenda view, event CRUD, per-calendar toggles) | Shipped | Calendar-first workflow |
| **EP-12** | Calendar field completeness (all Google API fields, per-event colors, Compose→Event flow) | Shipped | Full Google Calendar fidelity |
| **EP-13** | Calendar event templates, week/month time-grid views, drag-to-reschedule | Shipped | Power-user calendar editing |

Full per-epic scope lives in `docs/architecture.md`.

---

## 8. Mutation kinds

The canonical list of `MUTN.kind` values. Adding a new state-change in
the app **requires** adding a kind here.

**Folder ops**
- `MOVE_TO_FOLDER` — `MSG.folderId` change
- `CREATE_FOLDER` / `RENAME_FOLDER` / `DELETE_FOLDER`

**Label ops**
- `ADD_LABEL` / `REMOVE_LABEL`
- `CREATE_LABEL` / `RENAME_LABEL` / `DELETE_LABEL` / `REORDER_LABELS`

**Tag ops**
- `ADD_TAG` / `REMOVE_TAG`
- `RENAME_TAG_GLOBAL` / `DELETE_TAG_GLOBAL`

**Status ops**
- `SET_STATUS` / `CLEAR_STATUS`
- `CREATE_STATUS` / `RENAME_STATUS` / `DELETE_STATUS` / `REORDER_STATUSES`

**Priority / Star / Flag / Pin / Mute / Note**
- `SET_PRIORITY` / `CLEAR_PRIORITY`
- `SET_STAR` / `CLEAR_STAR`
- `SET_FLAG` / `UPDATE_FLAG` / `COMPLETE_FLAG` / `CLEAR_FLAG`
- `SET_PINNED` / `SET_MUTED`
- `SET_NOTE`

**Custom fields**
- `CREATE_CUSTOM_FIELD` / `UPDATE_CUSTOM_FIELD` / `DELETE_CUSTOM_FIELD`
- `SET_CUSTOM_FIELD_VALUE` / `CLEAR_CUSTOM_FIELD_VALUE`
- `REORDER_CUSTOM_FIELD_DEFS` — Reorder field definitions by position (dnd-kit drag in `SET-CUSTOM-FIELDS`)
- `REORDER_CUSTOM_FIELD_OPTIONS` — Reorder a select/multi-select field's options

**Automation rules**
- `CREATE_RULE` — Create a new automation rule
- `UPDATE_RULE` — Update an existing rule's conditions/actions/enabled state
- `DELETE_RULE` — Delete a rule by id
- `REORDER_RULES` — Reorder rules by position; handler wired in both `state/mutations.ts` and `src-tauri/src/db/queries.rs` (updates `rules.position`).

**Email templates**
- `CREATE_TEMPLATE` — Create a new email template (`TMPL`)
- `UPDATE_TEMPLATE` — Update an existing email template
- `DELETE_TEMPLATE` — Delete an email template by id

**Calendar ops**
- `UPSERT_CALENDAR_EVENT` — Insert or update a `CalendarEvent` in the local store (used by sync worker)
- `DELETE_CALENDAR_EVENT` — Remove a `CalendarEvent` from the local store
- `UPDATE_CALENDAR_EVENT_NOTES` — Update local-only notes on a `CalendarEvent`
- `UPDATE_CALENDAR_EVENT` — Reschedule a `CalendarEvent` (new `startTs`/`endTs`); also pushes the change to Google Calendar
- `SAVE_EVENT_TEMPLATE` — Create or update an `ETMPL`
- `DELETE_EVENT_TEMPLATE` — Delete an `ETMPL` by id

**Message ops**
- `READ` / `UNREAD` / `ARCHIVE` / `SNOOZE` / `DELETE_MESSAGE`
- `SEND_MESSAGE` / `RECEIVE_FROM_PROVIDER`

---

## 9. Naming conventions

### Files & modules
- Components: `PascalCase.tsx` matching the component name.
- State / hooks: `camelCase.ts`; hooks prefixed `use*`.
- Types: `src/data/types.ts` is the single home for shared types.
- Storage: `src/storage/*.ts` (local store, query helper, indexes).
- Mutations: `src/state/mutations.ts`.

### Identifiers in code
- Database column / SQL: `snake_case` (`message_id`, `folder_id`).
- TS field: `camelCase` (`messageId`, `folderId`).
- TS type / class: `PascalCase`.
- Enum values: `kebab-case` strings (e.g. `StarStyle = "check-green"`).
- Mutation kinds: `SCREAMING_SNAKE_CASE`.

### IDs in conversation / commits / PRs
- Always prefer the registry ID when ambiguous: "Add `INS-STATUS-PICKER`" not "add the status thing."
- When a term has an `Is NOT` neighbor in this glossary, qualify it on first use.

### When this glossary needs to grow
- A new component lands → add it under §4.
- A new mutation kind → add it to §8.
- A new metadata axis → seriously? Add it to §2 with the full Is / Is NOT treatment and update §8 with its mutation kinds.
- A name collision is discovered → resolve it here first, rename in code second.

---

## Sources & cross-references

- Architecture spec: `docs/architecture.md`
- UI design system: `docs/UI-DESIGN-SYSTEM-SPEC.md`
- Epic 0 checklist: `docs/epic-0-checklist.md`
- Plan-of-record (decision log): `/root/.claude/plans/sunny-munching-sun.md`
