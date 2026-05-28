# EP-12 — Calendar Field Completeness + Compose→Event — Execution Checklist

**Status:** Complete
**Reference docs:** `docs/architecture.md`, `docs/glossary.md`

---

## Database migration (Rust)

- [x] `src-tauri/src/db/schema.rs` — `EP12_ALTER_SQL` with 9 new columns on `calendar_events`:
  - `conference_url TEXT`, `color_id TEXT`, `ical_uid TEXT`, `recurring_event_id TEXT`
  - `creator_email TEXT`, `visibility TEXT`, `transparency TEXT`
  - `reminders_json TEXT`, `attachments_json TEXT`
- [x] `src-tauri/src/db/mod.rs` — `run_ep12_migrations()` with ignore-duplicate-column pattern
- [x] `src-tauri/src/db/queries.rs`
  - [x] `upsert_calendar_event` binds all 9 new columns
  - [x] `load_calendar_events` reads all 9 new columns into JSON output

## Gmail Calendar sync (Rust)

- [x] `src-tauri/src/gmail/calendar.rs` — `map_event()` extended to capture:
  - [x] `conferenceData.entryPoints[video].uri` → `conference_url`
  - [x] `colorId` → `color_id`
  - [x] `iCalUID` → `ical_uid`
  - [x] `recurringEventId` → `recurring_event_id`
  - [x] `creator.email` → `creator_email`
  - [x] `visibility`, `transparency`
  - [x] `reminders.overrides` → `reminders_json` (JSON blob)
  - [x] `attachments` → `attachments_json` (JSON blob)
  - [x] `created` / `updated` RFC3339 strings parsed to `created_at` / `updated_at` ms timestamps

## TypeScript types

- [x] `src/data/types.ts`
  - [x] `CalendarAttachment` interface (`fileUrl`, `title`, `mimeType`, `iconLink?`, `fileId?`)
  - [x] `CalendarReminder` interface (`method: "email"|"popup"`, `minutes: number`)
  - [x] `CalendarEvent` extended with 9 new optional fields
  - [x] `MutationKind` extended: `UPDATE_CALENDAR_EVENT`

## Color utility

- [x] `src/lib/calendarColors.ts` (new file)
  - [x] `GOOGLE_COLOR_MAP: Record<string, string>` — colorIds "1"–"11" → hex
  - [x] `eventColor(colorId?: string): string` — falls back to `var(--color-accent)`

## UI updates

- [x] `src/components/calendar/EventDetailPopover.tsx`
  - [x] "Join meeting" link (only when `event.conferenceUrl` set); `Video` lucide icon
  - [x] Drive attachments list with `Paperclip` icon; links open in new tab
  - [x] Private lock icon (`<span title="Private"><Lock .../></span>`) when `visibility = "private"|"confidential"`
  - [x] Creator line when `creatorEmail !== organizerEmail`
- [x] `src/components/calendar/AgendaView.tsx` — event dot uses `eventColor(event.colorId)` inline style
- [x] `src/components/calendar/MiniMonth.tsx` — `eventDates: Map<string, string|undefined>` (date → first colorId); dot uses `eventColor()`

## Compose→Event flow

- [x] `src/state/workspace.ts` — `eventCreateModalPrefill: { attendees?, title?, date? } | null`; `openEventCreateModal(prefill?)` signature; `closeEventCreateModal` clears prefill
- [x] `src/components/calendar/EventCreateModal.tsx` — `prefillAttendees?: string[]`, `prefillTitle?: string` props; reset `useEffect` on `[open, prefillTitle, prefillAttendees, prefillDate]`
- [x] `src/components/calendar/CalendarPanel.tsx` — `<EventCreateModal>` removed; `openEventCreateModal({ date: focusDate })` passed to "+" button
- [x] `src/components/Workspace.tsx` — `<EventCreateModal>` mounted at root with `prefillDate/prefillAttendees/prefillTitle` from workspace state
- [x] `src/components/email/EmailComposerPanel.tsx` — `CalendarDays` toolbar button → `openEventCreateModal({ attendees: [...recipients, ...ccRecipients] })`
- [x] `src/components/palette/CommandPalette.tsx` — "New Calendar Event" calls `openEventCreateModal()` with no args (modal now always mounted)
