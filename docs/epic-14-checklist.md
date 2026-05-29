# EP-14 — Standalone, Provider-Independent Calendar — Execution Checklist

**Status:** Phases 0–3 implemented (Rust unverified — see note); polish items deferred
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
- [x] `db/queries.rs` — `calendars` CRUD (`load_calendars`, `upsert_calendar`, `delete_calendar`); `ensure_default_calendar` seeds a `provider='local'` default
- [x] `db/queries.rs` — `upsert_calendar_event` persists `calendar_local_id` / `dirty` / tzids / `ical_raw`; `load_calendar_events` returns them
- [x] Drainer push: `gmail/mutations.rs` `drain_calendar_event` handles `UPSERT/DELETE/UPDATE_CALENDAR_EVENT` — pushes to Google when the account is Google and `external_id IS NULL`, then back-writes `external_id`

### Frontend

- [x] `EventCreateModal.tsx` — removed the hard Gmail gate; events are created locally via `UPSERT_CALENDAR_EVENT` (client UUID, `externalId` undefined) when no account is connected; Google push retained when an account exists
- [x] `EventEditModal.tsx` — no longer hard-blocks local events (provider push only when `externalId` exists); records the edit through the mutation pipeline either way; threads the IANA timezone
- [x] `types.ts` / `mutations.ts` / `tauri.ts` — `Calendar` type + `UPSERT_CALENDAR` / `DELETE_CALENDAR` / `UPDATE_CALENDAR` mutation kinds
- [x] `useStore.ts` — `useCalendars()` hook + `calendars` store map; loaded in `loadVaultData`
- [x] Calendar picker in create/edit modals — `<select>` bound to `useCalendars()`, writes `calendarLocalId` (shown only when >1 calendar; defaults to `local-default`)

## Phase 1 — Timezone correctness

- [x] `gmail/calendar.rs` — all-day parsed as floating (UTC-anchored, no offset shift); `parse_google_datetime` captures `timeZone` into `start_tzid`/`end_tzid`; write path threads originating TZID (param), not hard-coded `"UTC"`
- [~] User default-tz preference — create modal sends `Intl…timeZone`; a stored per-account default is *deferred*
- [x] Frontend — added `luxon`; `calendarUtils` gained `allDayDateKey`/`formatAllDayDate` (UTC components); `EventDetailPopover` renders all-day by UTC date
- [x] **Regression test:** `src/lib/__tests__/calendarUtils.test.ts` — all-day 2026-06-01 renders June 1 (not May 31)

## Phase 2 — Recurrence engine (Rust)

- [x] `Cargo.toml` — added `rrule`, `icalendar`, `chrono-tz`
- [x] `src-tauri/src/calendar/recurrence.rs` — `expand_rrule(master, window)` with EXDATE exclusion; `lib.rs` registers `mod calendar`
- [x] `queries.rs` — `edit_event_occurrence` (detached exception + master EXDATE), `edit_event_series` (merge into master); `EDIT_EVENT_OCCURRENCE`/`EDIT_EVENT_SERIES` mutation kinds + dispatch + frontend helpers
- [x] `queries.rs:load_calendar_events` — expands recurring masters within the window; instances tagged `masterId` + `occurrenceStart`, keyed `${masterId}::${occStart}`
- [x] Rust unit tests: weekly expansion, COUNT bound, EXDATE, **DST** (9am stays 9am across the transition)
- [x] `edit_this_and_following` → typed `Unsupported` — Rust `EditScope` enum (`ensure_supported()` errors on `ThisAndFollowing`); frontend `EditScope` + `applyEventEdit` throws `UnsupportedEditScopeError`; tests both sides
- [ ] Switch Google fetch to `singleEvents=false` behind a flag — *deferred* (larger refactor; still uses `singleEvents=true`)
- [ ] Relax recurring-event drag guard once occurrence-edit is proven — *deferred*

## Phase 3 — CalDAV provider abstraction

- [x] `providers/calendar/mod.rs` — `CalendarProvider` trait (mirrors `MailProvider`) + `CalendarInfo`/`RawEvent`/`RemoteRef`/`FetchResult`
- [x] `providers/calendar/google.rs` — `GoogleCalendarProvider` wraps `gmail/calendar.rs` (list + fetch + delete; writes documented as going through the JSON command path)
- [x] `providers/calendar/caldav.rs` — hand-rolled CalDAV over `reqwest` + `quick-xml`: discovery (`discover_calendar_home`), `calendar-query` REPORT, ETag-guarded PUT/DELETE, multistatus parser (with unit tests)
- [x] Discovery folded into `caldav.rs` (`.well-known/caldav` → principal → calendar-home-set); adapts velo's Apache-2.0 structure **with attribution** noted in the file header
- [x] Command `discover_caldav` (registered in `lib.rs`, wrapper in `tauri.ts`) — validates creds + lists calendars
- [x] `add_caldav_account` — persists an `accounts` row (provider `caldav`) + encrypted password + settings JSON (server/username/calendar-home), seeds a local `Calendar` per discovered collection (mirrors `add_imap_account`)
- [x] `sync_caldav_calendar` — fetches a ±1y window, parses each VEVENT via `ics_to_event_json` (icalendar crate; keeps RRULE, floating all-day, DST-aware TZID resolution), upserts events; opens a fresh `VaultDb` after all awaits
- [x] Drainer dispatch by `provider` for CalDAV **writes** — `drain_calendar_event` resolves the owning account's provider and routes CalDAV events to `drain_caldav_event` (PUT for create/update, DELETE for removal), with `If-Match` ETag guarding and href/etag write-back. New `event_to_ics` serializer + `caldav_event_identity`/`set_caldav_event_ref`/`decrypt_account_credential` query helpers; `href`/`etag` now persisted by `upsert_calendar_event`. Round-trip unit test (serialize → parse).
- [ ] CalDAV round-trip test against a live server — *still deferred* (parser, ICS mapping, and serializer round-trip all have unit tests; the wire protocol remains unvalidated against a real server — needs desktop)

> **Phase 3 is a foundation, not a finished CalDAV client.** The request/response
> shapes follow RFC 4791 but were written without a live server to test against;
> validate against Fastmail/iCloud/Radicale before relying on sync.

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
