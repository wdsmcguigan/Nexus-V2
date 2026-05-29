# EP-14 CalDAV — Live-Server Validation Checklist

> **Why this exists:** the CalDAV provider (discovery, sync, ICS parse/serialize,
> outbound writes) is fully **unit-tested** but has **never run against a real
> CalDAV server**. WebDAV servers differ in finicky ways unit tests can't cover —
> `href` resolution, ETag quoting, XML namespaces, `If-Match` semantics. This is
> the manual pass to confirm the wire protocol before CalDAV is trustworthy.
>
> **Status going in:** UNVERIFIED against a live server. Treat any failure here as
> expected-until-proven, not a regression.

Run from the **full desktop app** (`pnpm tauri:dev`) — the web dev server has no
IPC. There is no CalDAV settings UI yet, so the commands are invoked directly
from the devtools console via the global Tauri bridge (`withGlobalTauri: true`).

## 0. Pick a test server

Any of these work; **Radicale** (self-hosted, lenient) is the easiest first
target, then retest against a stricter hosted one.

| Server | `serverUrl` | Auth notes |
|---|---|---|
| Radicale (local) | `http://localhost:5232` | basic auth, any user you configure |
| Fastmail | `https://caldav.fastmail.com` | requires an **app password**, not your login password |
| iCloud | `https://caldav.icloud.com` | requires an **app-specific password** |

> Use a **throwaway / test calendar**, not your primary — step 5 writes and
> step 7 deletes real events.

## 1. Launch

```bash
pnpm tauri:dev
```

Open devtools (the app is a webview). All calls below use:

```js
const { invoke } = window.__TAURI__.core;
```

## 2. Discovery (read-only, safe)

```js
await invoke("discover_caldav", {
  serverUrl: "http://localhost:5232",
  username: "alice",
  password: "….",
});
```

- [ ] Returns an **array of calendars** (`[{ externalId, name, color, readOnly }]`).
- [ ] `externalId` looks like a real collection href (e.g. `/alice/<uuid>/`), not empty.
- [ ] Bad password → a clear error, not a panic / silent `[]`.

**If this fails:** the bug is in `discover_calendar_home` (`.well-known/caldav` →
`current-user-principal` → `calendar-home-set`) or the multistatus parser in
`src-tauri/src/providers/calendar/caldav.rs`. Capture the raw XML (see
Troubleshooting) — namespace/prefix handling is the usual culprit.

## 3. Add the account (persists)

```js
await invoke("add_caldav_account", {
  serverUrl: "http://localhost:5232",
  username: "alice",
  password: "….",
  displayName: "Test CalDAV",
});
// → { accountId: "acct-…", email: "alice" }
```

- [ ] Returns an `accountId`.
- [ ] The calendar list (left nav / `useCalendars()`) now shows the discovered
      calendars (provider `caldav`). A `vault:hydrate-needed` fires automatically.
- [ ] Re-opening the app keeps them (account + calendars persisted to the vault).

**Verify persistence directly (optional):** in the vault SQLite,
`SELECT id, provider, email FROM accounts WHERE provider='caldav';` and
`SELECT id, name, provider FROM calendars WHERE provider='caldav';`.

## 4. Inbound sync (read)

```js
await invoke("sync_caldav_calendar", {
  accountId: "acct-…",
  calendarExternalId: "/alice/<uuid>/",   // an externalId from step 2/3
});
// → number of events synced
```

- [ ] Returns a plausible count; events appear in the calendar grid.
- [ ] **Timed event** shows at the correct local time.
- [ ] **All-day event** shows on the right day in your timezone *and* if you can,
      check it in a timezone **west of UTC** — it must **not** shift a day back
      (the Phase 1 floating-date fix).
- [ ] A **recurring event** (create one server-side with an `RRULE` first) appears
      as **multiple occurrences** in the grid — confirms the Rust recurrence
      engine expanded the master.
- [ ] DST: a weekly event spanning a DST change keeps the same wall-clock time.

**If events are missing/malformed:** the issue is `ics_to_event_json` or the
`calendar-query` REPORT body. Log a raw VEVENT and compare.

## 5. Outbound create (write)

Create a local event on the CalDAV calendar (use the create modal, picking the
CalDAV calendar in the picker; or invoke the mutation). Then wait for the
drainer (≤30s) or trigger a sync.

- [ ] The event appears **on the server** (check via the server's own UI / another
      client).
- [ ] Locally the event now has an `externalId` + `href` + `etag` (it was pushed).
      Check: `SELECT title, external_id, href, etag, dirty FROM calendar_events
      WHERE title='<your test title>';` → `dirty=0`, `href`/`etag` populated.

**If create fails:** look at `drain_caldav_event` → `create_event` (PUT with
`If-None-Match: *`) and `event_to_ics`. ETag header parsing is a common snag.

## 6. Outbound update (write)

Edit that event's title/time (edit modal).

- [ ] Change reflects on the server after the drainer runs.
- [ ] `etag` in the DB **changed** (the PUT used `If-Match` with the old etag and
      got a new one back).
- [ ] Editing a **recurring occurrence** by dragging it creates an exception
      (original instance gone, moved one present) and does **not** scramble the
      rest of the series.

## 7. Outbound delete (write)

Delete the event.

- [ ] It disappears from the server.
- [ ] A `404 Not Found` or `410 Gone` from the server is treated as success
      (already deleted), not an error loop.

## 8. Conflict / edge cases (stretch)

- [ ] Edit the same event on the server, then locally → the `If-Match` PUT should
      fail with `412 Precondition Failed`. Confirm we don't silently lose data
      (currently the mutation stays pending and retries — note the behavior).
- [ ] Add a second CalDAV calendar and confirm events land on the right one.

---

## Troubleshooting

**See the actual HTTP traffic.** Run a local proxy (mitmproxy) or point at a
local Radicale with request logging. The four request shapes to eyeball:

1. `PROPFIND` `.well-known/caldav` (discovery) — Depth 0.
2. `PROPFIND` calendar-home — Depth 1 (lists calendars).
3. `REPORT` `calendar-query` (fetch events) — Depth 1.
4. `PUT` / `DELETE` (writes) with `If-Match` / `If-None-Match`.

**Most likely failure points** (all in
`src-tauri/src/providers/calendar/caldav.rs`):

- **Namespace prefixes** — our parser matches by *local name* (ignores `d:`/`cal:`
  prefixes). If a server uses unusual nesting, `parse_multistatus` may miss a
  field. Symptom: empty calendar list or events with blank fields.
- **ETag quoting** — servers return ETags with literal quotes (`"abc"`). We store
  and echo them verbatim; if a server is picky about quote handling on `If-Match`,
  updates may 412.
- **`href` relativity** — `abs_url()` joins relative hrefs onto `base_url`. A
  server returning absolute hrefs on a different host would break this.

**Where to file findings:** update `docs/epic-14-checklist.md` Phase 3 (flip the
"round-trip test against a live server" item and note any server-specific quirks),
and the Known-gaps note in `CLAUDE.md` if a real limitation surfaces.

## Bonus: the Google `singleEvents=false` flag

Separately, the Google recurrence-expansion path is implemented but gated off.
To validate it (needs a Google account with recurring events):

```bash
NEXUS_GCAL_EXPAND_RECURRENCES=1 pnpm tauri:dev
```

- [ ] Recurring Google events still render as multiple occurrences (now expanded
      by the local engine, not Google).
- [ ] **Known unimplemented:** modified/cancelled single occurrences (Google
      returns these as separate `recurringEventId` items) are **not** yet folded
      into the master as `RECURRENCE-ID` / `EXDATE`. Expect moved/cancelled
      one-off occurrences to be wrong until that's built. **Leave the flag off in
      production** until this is handled.
