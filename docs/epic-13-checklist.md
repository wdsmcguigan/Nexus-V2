# EP-13 — Event Templates + Week/Month Views + Drag-to-Reschedule — Execution Checklist

**Status:** Complete
**Reference docs:** `docs/architecture.md`, `docs/glossary.md`

---

## Event templates

### Database (Rust)

- [x] `src-tauri/src/db/schema.rs` — `EP13_IDEMPOTENT_SQL`:
  - [x] `CREATE TABLE IF NOT EXISTS event_templates` (id, vault_id, name, title, description, location, duration_minutes, default_attendees_json, created_at)
  - [x] `CREATE INDEX IF NOT EXISTS idx_event_templates_vault`
- [x] `src-tauri/src/db/mod.rs` — `run_ep13_migrations()` called from `run_migrations()`
- [x] `src-tauri/src/db/queries.rs`
  - [x] `get_event_templates(vault_id)` → `Vec<JsonValue>`
  - [x] `upsert_event_template(payload)` / `delete_event_template(id)`
  - [x] `HydratePayload` extended with `event_templates: Vec<JsonValue>`
  - [x] `build_hydrate_payload` includes `event_templates`
  - [x] `apply_mutation_to_tables` — `SAVE_EVENT_TEMPLATE`, `DELETE_EVENT_TEMPLATE` arms

### IPC + TypeScript

- [x] `src-tauri/src/commands.rs` — `get_event_templates`, `save_event_template`, `delete_event_template`
- [x] `src-tauri/src/lib.rs` — all 3 commands registered
- [x] `src/storage/tauri.ts` — typed wrappers; `HydratePayload` extended with `eventTemplates`
- [x] `src/data/types.ts` — `EventTemplate` interface; `MutationKind` extended: `SAVE_EVENT_TEMPLATE`, `DELETE_EVENT_TEMPLATE`
- [x] `src/state/mutations.ts` — `saveEventTemplateMutation(tmpl)`, `deleteEventTemplateMutation(id)`; `apply()` handles both kinds
- [x] `src/storage/local.ts` — `localStore.eventTemplates: Map<string, EventTemplate>`; `putEventTemplate()`, `deleteEventTemplate()`; hydrate loads from snapshot
- [x] `src/storage/useStore.ts` — `useEventTemplates()` hook

### UI

- [x] `src/components/settings/EventTemplatesSettings.tsx` (new file) — CRUD settings; editor dialog with name, title, location, duration, description, attendees (one per line)
- [x] `src/components/settings/SettingsPanel.tsx` — "Calendar" nav item + `EventTemplatesSettings` render
- [x] `src/components/calendar/EventCreateModal.tsx` — "Use template" dropdown (rendered only when templates exist); `applyTemplate(tmpl)` fills all fields

---

## Calendar utilities

- [x] `src/lib/calendarUtils.ts` (new file):
  - [x] `getWeekBounds(iso): [number, number]` — Mon-anchored week start/end ms
  - [x] `weekMonday(iso): string` — ISO date of the Monday
  - [x] `getMonthBounds(iso): [number, number]` — calendar month start/end ms
  - [x] `monthStart(iso): string` — "YYYY-MM-01"
  - [x] `addWeeks(iso, n): string`, `addMonths(iso, n): string`
  - [x] `generateMonthCells(monthStartIso): string[]` — 42 ISO dates
  - [x] `generateWeekDays(mondayIso): string[]` — 7 ISO dates
  - [x] `minutesFromMidnight(ts, iso): number`

---

## Week view

- [x] `src/components/calendar/WeekView.tsx` (new file)
  - [x] Props: `{ events, focusDate, mondayIso }`
  - [x] `HOUR_HEIGHT = 56`, `TOTAL_HEIGHT = 1344`
  - [x] `layoutDayEvents(events): LayoutEvent[]` — greedy two-pass column assignment
  - [x] Day header row with today/focus highlights
  - [x] All-day strip (conditional on any all-day events existing)
  - [x] Scrollable time grid: hour lines as `onDragOver`/`onDrop` drop zones
  - [x] Current time indicator (red line + circle dot on today's column)
  - [x] Event chips: absolutely positioned by `top`/`height`/`left%`/`width%`, colored with `eventColor`
  - [x] Drag-to-reschedule: `draggable` when `!evt.recurringEventId`; `handleDrop` calls `rescheduleCalendarEvent` + `updateCalendarEvent` with rollback on failure
  - [x] Scroll to 8am on mount

---

## Month view

- [x] `src/components/calendar/MonthView.tsx` (new file)
  - [x] Props: `{ events, focusDate, monthStartIso, onSelectDate }`
  - [x] 42-cell grid from `generateMonthCells`; out-of-month cells at 40% opacity
  - [x] `MAX_VISIBLE = 3` pills per day + "+N more" button navigating to agenda
  - [x] Day number click → `onSelectDate(iso)` (navigates to agenda for that date)
  - [x] Drag-to-reschedule: day cells as drop zones; preserves time-of-day for timed events; `draggable` when `!evt.recurringEventId`; `handleDrop` with rollback on failure

---

## Drag-to-reschedule mutation + IPC

- [x] `src/state/mutations.ts` — `rescheduleCalendarEvent(store, eventId, newStartTs, newEndTs)` applies optimistic update to `localStore.calendarEvents`
- [x] `src/storage/tauri.ts` — `updateCalendarEvent({ accountId, externalId, startTs, endTs, allDay })` IPC wrapper

---

## CalendarPanel update

- [x] `src/state/workspace.ts` — `calendarViewMode: "agenda"|"week"|"month"`, `setCalendarViewMode`
- [x] `src/components/calendar/CalendarPanel.tsx` (fully updated)
  - [x] Segmented view mode control (Agenda / Week / Month)
  - [x] Prev/next period arrows (week/month only); "Today" button
  - [x] Dynamic event range: week bounds / month bounds / fixed 14+90 day window for agenda
  - [x] `MiniMonth` only rendered in agenda mode
  - [x] Conditionally renders `AgendaView` / `WeekView` / `MonthView`
