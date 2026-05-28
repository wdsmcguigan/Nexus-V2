# EP-14 — Standalone, Provider-Independent Calendar — Execution Checklist

**Status:** In progress
**Plan:** `~/.claude/plans/maybe-we-should-document-valiant-sky.md` (approved)
**Reference docs:** `docs/prior-art.md`, `docs/architecture.md`, `docs/glossary.md`

Goal: the calendar (and, by precedent, contacts/future features) must work fully
**standalone** — Google and CalDAV are *sync targets, not dependencies*. Built on
an **ICS-canonical hybrid** model with recurrence expansion in the **Rust core**.
See `docs/prior-art.md` for the references (Mailspring, velo, Pebble) and their
license constraints.

---

## Phase 0 — Standalone local event lifecycle

### Database (Rust)

- [x] `schema.rs` — `EP14_IDEMPOTENT_SQL`: `CREATE TABLE calendars` (id, vault_id, account_id NULL=local, external_id, name, color, enabled, read_only, provider, sync_token, ctag, timestamps) + `idx_calendars_vault`
- [x] `schema.rs` — `EP14_ALTER_SQL` on `calendar_events`: `calendar_local_id`, `dirty` (Phase 0); `start_tzid`, `end_tzid` (Phase 1); `ical_raw` (Phase 2); `href`, `etag` (Phase 3)
- [x] `db/mod.rs` — `run_ep14_migrations()` wired into `run_migrations()` after EP13
- [ ] `db/queries.rs` — `calendars` CRUD (`load_calendars`, `upsert_calendar`, `delete_calendar`); seed a `provider='local'` default calendar
- [ ] `db/queries.rs` — `upsert_calendar_event` persists `calendar_local_id` / `dirty`; `load_calendar_events` returns them
- [ ] Drainer push: `gmail/mutations.rs` handles `UPSERT/DELETE/UPDATE_CALENDAR_EVENT` — push to Google when the calendar resolves to a provider account and `external_id IS NULL`, then back-write `external_id`

### Frontend

- [x] `EventCreateModal.tsx` — removed the hard Gmail gate; events are created locally via `UPSERT_CALENDAR_EVENT` (client UUID, `externalId` undefined) when no account is connected; Google push retained when an account exists
- [ ] `EventEditModal.tsx` — identify events by **internal id**, not `externalId` (local events have none)
- [ ] `types.ts` / `mutations.ts` / `tauri.ts` — `Calendar` type + `UPSERT_CALENDAR` / `DELETE_CALENDAR` / `UPDATE_CALENDAR` mutation kinds
- [ ] `useStore.ts` — `useCalendars()` hook + store map; loaded in `loadVaultData`; calendar picker in create/edit modals

## Phase 1 — Timezone correctness

- [ ] `gmail/calendar.rs` — fix all-day parse (floating DATE, not midnight UTC); capture `start.timeZone` into `start_tzid`; write path sends originating TZID, not hard-coded `"UTC"`
- [ ] User default-tz preference (EP-7 `preferences_json` precedent)
- [ ] Frontend — add `luxon`; route `calendarUtils.ts` + modals + `EventDetailPopover.tsx` through tz-aware rendering; floating all-day rendered by date components
- [ ] **Regression test:** all-day `2026-06-01` in `America/Los_Angeles` renders June 1 (not May 31)

## Phase 2 — Recurrence engine (Rust)

- [ ] `Cargo.toml` — add `rrule` + `icalendar` crates (spike TZID/floating semantics first)
- [ ] `src-tauri/src/calendar/recurrence.rs` — `parse_ics`, `expand(master, window)` (EXDATE + RECURRENCE-ID overlay), `edit_this_occurrence`, `edit_all`; `edit_this_and_following` → typed `Unsupported`
- [ ] `queries.rs:load_calendar_events` — expand `ical_raw`/`rrule` rows within window; tag instances `masterId` + `occurrenceStart`
- [ ] Mutation kinds `EDIT_EVENT_OCCURRENCE` / `EDIT_EVENT_SERIES`; relax the recurring-event drag guard once occurrence-edit is proven
- [ ] Switch Google fetch to `singleEvents=false` (masters + recurrence), behind a flag
- [ ] Rust unit tests: expansion, COUNT/UNTIL, EXDATE, exception overlay, **DST**, `edit_all` delta

## Phase 3 — CalDAV provider abstraction

- [ ] `providers/calendar/mod.rs` — `CalendarProvider` trait (mirrors `MailProvider`)
- [ ] `providers/calendar/google.rs` — wrap existing `gmail/calendar.rs`
- [ ] `providers/calendar/caldav.rs` — CalDAV client (evaluate `reqwest_dav` vs hand-rolled REPORT); ETag/ctag/sync-token delta sync
- [ ] `providers/calendar/{factory,autodiscovery}.rs` — discovery (Fastmail/iCloud/Yahoo); adapt velo's Apache-2.0 structure **with attribution**
- [ ] Commands `add_caldav_account`, `discover_caldav`, `sync_caldav_calendar`; drainer dispatch by `provider`
- [ ] CalDAV round-trip test behind a feature flag

## Cross-cutting — docs

- [x] `docs/prior-art.md` — references (Mailspring/velo/Pebble/Cal.com) + license cheat-sheet
- [x] `docs/epic-14-checklist.md` — this file
- [ ] Update `docs/known-gaps.md` (all-day UTC bug, never-read `rrule`, Google-required-create), `docs/architecture.md`, `docs/database-reference.md`, `docs/ipc-api-reference.md`

---

## Notes / decisions

- **`account_id` sentinel:** `calendar_events.account_id` is NOT NULL; local-only
  events use `'local'` rather than rebuilding the table to drop the constraint.
- **Could not compile-verify Rust changes** in the web container — the Tauri
  backend needs GTK system libs (`gdk-3.0`) absent here. Schema/migration changes
  mirror the existing `EPxx` pattern exactly; verify with `cargo check -p nexus`
  on macOS.
