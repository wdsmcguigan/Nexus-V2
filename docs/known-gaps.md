# Known Gaps

**Single canonical register of what is broken, partial, stubbed, mis-tagged, or planned-but-not-shipped.**

Read this before claiming a feature is "done". When you ship a fix, **delete the row**. When you discover a new gap, **add a row**. This file is the SLA between code reality and documentation reality.

This document supersedes the ad-hoc "Confirmed Planned Gaps" section that used to live in `roadmap.md`; `roadmap.md` now links here instead of duplicating.

Last verified against source: 2026-05-28.

---

## Severity legend

| | Meaning |
|---|---|
| 🔴 | **Broken or incorrect** — code/docs claim something that is not true. Fix soon. |
| 🟡 | **Stubbed** — declared, named, or shipped behind a UI, but the implementation is incomplete or fake. |
| 🟠 | **Planned** — acknowledged future work, not yet started. |
| 🟢 | **Drift** — documentation lagged code; fixed in the current pass but listed for traceability. |

Effort tag: **S** (≤ 1 day) / **M** (1-5 days) / **L** (≥ 1 week).

---

## 🔴 Broken or incorrect

| # | Item | Where | Symptom | Definition of done | Effort |
|---|---|---|---|---|---|
| 28 | `FTSIndex > prefix search works` test fails | `src/storage/__tests__/ep3.test.ts:119-122` | `pnpm test` reports 1 failed / 117 passed. The MiniSearch prefix search for `"plan"` no longer returns the seeded message `m2` whose body contains "Planning". Failure is reproducible on a clean checkout (predates the known-gaps closure work). | Either fix the prefix-match behavior in `src/storage/fts.ts` so the assertion passes, or update the test to reflect the intended search semantics. Whichever way it goes, the test suite needs to be green. | S |

---

## 🟡 Stubbed implementations (claimed shipped or named, actually partial)

| # | Item | Where | What's wrong | Definition of done | Effort |
|---|---|---|---|---|---|
| 9 | **EP-8 iOS parity** | `/ios/` (29 Swift files) | EP-8 is "in progress". Desktop has 57 IPC commands and 15 UI feature areas; iOS has 15 UI screens but no claim of feature parity has been verified. `MutationEngine.swift` exists but coverage vs `src/state/mutations.ts:applyMutation()` is unmeasured. | Produce a parity audit: list every desktop feature and which iOS screen (if any) covers it. Currently captured at a high level in `docs/epic-8-checklist.md`. | L |

---

## 🟠 Planned gaps (acknowledged, scheduled)

| # | Item | Owner epic | Notes |
|---|---|---|---|
| 10 | Android shell | EP-8 follow-up | iOS first; Android after parity is reached. |
| 11 | Conflict resolution UI | EP-9 | Conflicts are currently silent last-write-wins via Lamport ordering. No user-visible conflict chips. Design draft: `docs/conflict-resolution-design.md`. |
| 12 | Encrypted FTS hardening | EP-10 | Move from at-rest encryption (SQLCipher of the whole `messages_fts` table) to true zero-knowledge encrypted index (e.g., blind index for subject/notes). |
| 13 | Sync state UI (per-folder progress, error surfacing) | EP-9 or later | `relay_state.last_error` is captured (`src-tauri/src/relay/mod.rs`) but no per-folder progress surface exists. |
| 14 | Sender reputation / spam panel | Future | Mentioned in `docs/notes/panels-brainstorm.md` only. |
| 29 | JMAP OAuth2 + PKCE flow | EP-6 follow-up | JMAP auth today is bearer-token only (user pastes an API token in `JmapFlow`). Add an OAuth2 + PKCE flow mirroring `start_outlook_oauth` so Fastmail / Stalwart users don't have to generate tokens manually. Provider impl in `src-tauri/src/providers/jmap.rs` is unchanged — only the onboarding + token refresh layer needs work. |

---

## 🟢 Documentation drift (fixed in this pass — listed for traceability)

| # | Item | Fix |
|---|---|---|
| 15 | `CLAUDE.md` said "44+ IPC commands" | Updated to **57** (verified against `src-tauri/src/lib.rs:invoke_handler!`). |
| 16 | `CLAUDE.md` said "MutationKind enum (45+ kinds)" | Updated to **72** (verified against `src/data/types.ts` enum block). |
| 17 | `CLAUDE.md` claimed EP-11 IPC `get_calendar_events` and `delete_calendar_event` | Neither exists. Hydration happens via `load_vault_data`; deletion uses the `DELETE_CALENDAR_EVENT` mutation kind. CLAUDE.md updated. |
| 18 | `src/data/types.ts:495` tagged calendar mutations as `// Calendar ops (EP-10)` | Re-tagged to EP-11 (EP-10 is conflict UI). |
| 19 | Missing `epic-6-checklist.md` | Created — with explicit JMAP/IDLE gap callouts. |
| 20 | Missing `epic-8-checklist.md` | Created — captures current iOS state as of 2026-05-28. |
| 21 | No `CONTRIBUTING.md` | Created. |
| 22 | No canonical IPC reference | Created `docs/ipc-api-reference.md`. |
| 23 | No canonical DB reference | Created `docs/database-reference.md`. |
| 24 | Security model scattered across `relay.md` / `user-guide.md` / `architecture.md` | Consolidated into `docs/security-model.md`. |
| 25 | No diagrams anywhere | Added mermaid diagrams to `CLAUDE.md`, `architecture.md`, `developer-guide.md`, `relay.md`. |
| 26 | `epic-{0,1,2,3,7,11,12,13}` list in CLAUDE.md "Where to Find Things" | Updated to include 4, 5, 6, 8. |
| 27 | Repository Layout block did not mention `src-tauri/src/providers/` or `smtp.rs` | Added. |

---

## Maintenance rule

When you submit a PR that fixes an item:
1. **Delete the row** from this file (don't strike-through, don't move to a "fixed" section — just delete).
2. If the fix changes documented behavior elsewhere, update that doc in the same PR.

When you discover a new gap:
1. Add a row to the appropriate severity section.
2. Cite the file path and line number — anonymous "TODO somewhere" entries get deleted on sight.
3. Define what "done" means in concrete, verifiable terms.
