# Prior Art & References

This document records the external projects we study for inspiration, what each
one teaches us, and — critically — **what their licenses allow us to do with
their code**. It exists so contributors don't accidentally copy copyleft code
into Nexus, and so design decisions can cite where the idea came from.

> **Golden rule:** AGPL/GPL projects are **study-only** — read them to learn the
> design, then write our own implementation. Permissively licensed projects
> (MIT/Apache-2.0/BSD) may have code **adapted with attribution**. When in
> doubt, treat it as study-only.

---

## Quick reference

| Project | License | Has a calendar? | Copy code? | What it teaches us |
|---|---|---|---|---|
| [Mailspring](https://github.com/Foundry376/Mailspring) | GPL-3.0 | ✅ Yes (real) | ❌ Study only | Recurrence + timezone done right (raw ICS, inline exceptions, DST) |
| [velo](https://github.com/avihaymenahem/velo) | Apache-2.0 | ⚠️ Partial | ✅ Adapt w/ attribution | Calendar provider abstraction (CalDAV + Google) |
| [Pebble](https://github.com/QingJ01/Pebble) | AGPL-3.0 | ❌ No | ❌ Study only | Architectural peer (same Tauri/Rust/React stack) |
| [Cal.com](https://github.com/calcom/cal.com) | AGPL-3.0 (+ `/ee` commercial) | ✅ Booking-focused | ❌ Study only | RRULE expansion patterns (rrule.js) |

---

## Mailspring — the recurrence & timezone reference

- **Repo:** https://github.com/Foundry376/Mailspring
- **License:** **GPL-3.0** → **study only, never copy code.**
- **Stack:** TypeScript + React + Electron UI; a separate C++ sync engine
  (`Mailspring-Sync`, different repo) does IMAP/CalDAV.

**Why it matters:** it is the only one of our references that solves the *hard*
calendar problems. We model our recurrence and timezone design on it:

- **Raw iCalendar as the source of truth.** Each event stores its full ICS. A
  master VEVENT holds the `RRULE`; modified occurrences are stored as **inline
  exception VEVENTs** carrying a `RECURRENCE-ID` (RFC 4791 §4.1), in the same
  `VCALENDAR`. Deleted occurrences use `EXDATE`.
- **Client-side expansion.** It expands the master into concrete occurrences with
  `ical.js` + `ical-expander`, overlaying exceptions and applying `EXDATE`. It
  also stores `recurrenceStart`/`recurrenceEnd` unix timestamps purely for fast
  range queries — the model we copy as our "hybrid" approach.
- **Timezones.** Timed events are stored as wall-clock time + a `TZID`; all-day
  events are **floating `DATE` values** (no time, never converted through UTC).
  DST is handled via `ical.js`'s `TimezoneService`.
- **Edit scope.** "This occurrence" creates an inline exception; "all events"
  shifts the master and shifts each exception's `RECURRENCE-ID` by the same
  delta. **"This and following" is *not* implemented even in Mailspring** — we
  defer it too.

**Caveat:** because its sync engine is a separate process, Mailspring's calendar
is still effectively **read-only / Google-only**. That architectural split is
*why* we chose to put expansion in our in-process Rust core instead of the
frontend (see EP-14 plan, Decision 2).

---

## velo — the provider-abstraction reference

- **Repo:** https://github.com/avihaymenahem/velo
- **License:** **Apache-2.0** → **code may be adapted, with attribution** (keep
  the Apache notice / credit velo in comments where we port structure).
- **Stack:** Tauri 2 + React 19 + TypeScript (very close to ours).

**Why it matters:** velo has a clean **calendar provider abstraction** that maps
directly onto our EP-6 mail-provider pattern:

- A `CalendarProvider` interface with concrete `caldavProvider` (using the
  `tsdav` library) and `googleCalendarProvider` implementations.
- A `providerFactory` for instantiation and an `autoDiscovery` module for CalDAV
  endpoint discovery (Fastmail/iCloud/Yahoo).

**Limits:** velo does **not** implement recurrence (RRULE), exceptions, or
timezones (it's UTC-only) — it leans on server-side expansion. So we take its
*architecture*, not its calendar feature depth.

---

## Pebble — architectural peer (no calendar)

- **Repo:** https://github.com/QingJ01/Pebble
- **License:** **AGPL-3.0** → study only.
- **Stack:** Tauri 2 + Rust + React 19 + SQLite + Tantivy — **almost identical to
  Nexus.**

**Why it's listed:** it currently has **no calendar** (open feature request #47),
so it teaches us nothing about calendars specifically. It's a useful peer for
general architecture comparisons (search, rules engine, crypto, OAuth module
layout), but for calendar work it is not a reference.

---

## Cal.com — booking SaaS (different shape)

- **Repo:** https://github.com/calcom/cal.com
- **License:** **AGPL-3.0**, with a commercial Enterprise Edition under
  `/packages/features/ee`. → **study only; never copy** (the `/ee` folder isn't
  even open source).
- **Why it's the wrong primary reference:** Cal.com is a *server-side booking
  platform* (open-source Calendly) — its core domain is availability rules and
  public booking pages, not a local-first personal calendar. The overlap with
  Nexus is thin.
- **What's still useful:** its client-side RRULE expansion with `rrule.js` is a
  reasonable read if we ever expand recurrences in TypeScript. We don't (we
  expand in Rust), so this is low priority.

---

## License cheat-sheet for contributors

- **MIT / BSD / Apache-2.0** — permissive. Code may be adapted; preserve license
  headers / attribution. (e.g. velo, the `rrule`/`icalendar` crates, Luxon.)
- **GPL-3.0 / AGPL-3.0** — strong copyleft. **Do not paste their code into
  Nexus.** Read the design, then implement independently. (e.g. Mailspring,
  Pebble, Cal.com.)
- Always cite the project in a code comment when a design is directly inspired by
  one of these references.
