# EP-11 — Calendar Foundation — Execution Checklist

**Status:** Complete
**Reference docs:** `docs/architecture.md`, `docs/glossary.md`

---

## Database (Rust)

- [x] `src-tauri/src/db/schema.rs` — EP11 DDL
  - [x] `calendars` table (id, vault_id, account_id, external_id, name, color, enabled)
  - [x] `calendar_events` table (id, vault_id, account_id, calendar_id, external_id, title, start_ts, end_ts, all_day, description, location, attendees_json, organizer_email, status, notes, created_at, updated_at)
  - [x] Indexes: `idx_calendar_events_vault`, `idx_calendar_events_range`
- [x] `src-tauri/src/db/mod.rs` — `run_ep11_migrations()` called from `run_migrations()`
- [x] `src-tauri/src/db/queries.rs`
  - [x] `upsert_calendar_event()` / `delete_calendar_event()` / `load_calendar_events(start, end)`
  - [x] `upsert_calendar()` / `load_calendars()`
  - [x] `HydratePayload` extended with `calendar_events` and `calendars` vecs
  - [x] `apply_mutation_to_tables` — `UPSERT_CALENDAR_EVENT`, `DELETE_CALENDAR_EVENT`, `UPDATE_CALENDAR_EVENT_NOTES` arms

## Gmail Calendar Sync (Rust)

- [x] `src-tauri/src/gmail/calendar.rs` — `GmailCalendarSyncer`
  - [x] OAuth token reuse from account record
  - [x] Fetch calendar list → `upsert_calendar`
  - [x] Fetch events with `singleEvents=true`, `timeMin`/`timeMax` window → `upsert_calendar_event`
  - [x] `map_event()` maps Google API response to DB insert
  - [x] `CalendarAttendee` mapped from `event.attendees[]`

## IPC Commands (Rust + TypeScript)

- [x] `src-tauri/src/commands.rs` — `get_calendar_events`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`, `sync_google_calendar`
- [x] `src-tauri/src/lib.rs` — all 5 commands registered in `invoke_handler!`
- [x] `src/storage/tauri.ts` — typed wrappers for all 5 commands; `HydratePayload` extended

## TypeScript types

- [x] `src/data/types.ts`
  - [x] `CalendarEvent`, `Calendar`, `CalendarAttendee` interfaces
  - [x] `MutationKind` extended: `UPSERT_CALENDAR_EVENT`, `DELETE_CALENDAR_EVENT`, `UPDATE_CALENDAR_EVENT_NOTES`

## Frontend state

- [x] `src/state/mutations.ts` — `upsertCalendarEventMutation`, `deleteCalendarEventMutation`, `updateCalendarEventNotesMutation`; `apply()` handles all 3 kinds on `localStore`
- [x] `src/storage/local.ts` — `localStore.calendarEvents: Map<string, CalendarEvent>`, `localStore.calendars: Map<string, Calendar>`; `hydrate()` loads both; `putCalendarEvent()`, `deleteCalendarEvent()`, `putCalendar()`
- [x] `src/storage/useStore.ts` — `useCalendarEvents(startMs, endMs)`, `useCalendars()` hooks
- [x] `src/state/workspace.ts` — `eventCreateModalOpen`, `openEventCreateModal()`, `closeEventCreateModal()`, `calendarFocusDate`, `setCalendarFocusDate`

## UI components

- [x] `src/components/calendar/CalendarPanel.tsx` — container with view toggle, sync/new-event buttons
- [x] `src/components/calendar/AgendaView.tsx` — chronological day-grouped event list
- [x] `src/components/calendar/MiniMonth.tsx` — compact month navigator with event dots
- [x] `src/components/calendar/EventDetailPopover.tsx` — hover/click popover with notes editor, attendees, actions
- [x] `src/components/calendar/EventCreateModal.tsx` — create modal with date/time/attendees/location fields
- [x] `src/components/calendar/EventEditModal.tsx` — edit modal pre-filled from existing event
- [x] `src/components/calendar/CalendarManagementSection.tsx` — per-calendar enable/disable toggles
- [x] `src/components/chrome/WorkspaceChrome.tsx` — Calendar nav button added
- [x] `src/components/palette/CommandPalette.tsx` — "New Calendar Event" + "Open Calendar" + "Open Contacts" items; calendar event FTS results group
