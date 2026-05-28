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
| 1 | `REORDER_RULES` mutation has no handler | Defined: `src/data/types.ts:490`. Missing: case in `src/state/mutations.ts:applyMutation()`; no helper in `mutations.ts`; no Rust-side handling in `commands.rs` / `queries.rs`. | Saving a reordered rule list does nothing — optimistic update no-ops and no row lands in `mutations` table. | Add case to `applyMutation()` switch that reorders `store.rules` by `payload.orderedIds`; add helper `reorderRulesMutation(orderedIds)`; mirror the pattern of `REORDER_LABELS` (line 389) and `REORDER_STATUSES` (line 479). Add `rules.position` column persistence in `queries.rs` if not already there. | S |

---

## 🟡 Stubbed implementations (claimed shipped or named, actually partial)

| # | Item | Where | What's wrong | Definition of done | Effort |
|---|---|---|---|---|---|
| 2 | **JMAP provider** | `src-tauri/src/providers/jmap.rs` (entire 46-line file) | Every `MailProvider` method returns `Err(anyhow!("JMAP coming in EP7"))`. The `AddAccountModal` already marks the JMAP card `disabled`. The reference list in `docs/architecture.md` mentions JMAP as a target without flagging it as unimplemented. | Either implement JMAP (Fastmail-style: discover via `.well-known/jmap`, OAuth flow, real `fetch_initial`/`fetch_incremental`, mutation translation) or formally remove the stub and the UI card. | L |
| 3 | **IMAP IDLE** | `src-tauri/src/providers/imap_idle.rs:7-30` | Function is named `start_idle_watcher` but the body is a 30-second polling loop with exponential-backoff reconnect. No `IDLE` command is issued; no server-pushed updates. Comment line 7 ("Falls back to 30-second polling if server doesn't support IDLE") is misleading — there is no IDLE path to fall back from. | Implement real IDLE via `async-imap` `idle()` futures, with the existing polling loop as the documented fallback only. Or: rename the file/function to `imap_poller.rs` / `start_poll_watcher` and update docs to admit polling is the only mode. | M |
| 4 | **Hosted "Nexus Relay"** option | UI stub at `src/components/settings/SettingsPanel.tsx:440-460` | Visible "Nexus Relay — coming soon" card with `opacity-50 cursor-not-allowed`. The `nexus-relay` binary is already provider-agnostic; this is infra/ops work, not client code. | Stand up the hosted infrastructure and wire the card to a real provisioning flow (or remove the card). | M (infra) |
| 5 | **CFD option drag-reorder** | `src/components/settings/CustomFieldsSettings.tsx` | `GripVertical` icon is rendered on option rows but no `dnd-kit` handlers are attached — drag does nothing. Listed as deferred in EP-2. | Wire `dnd-kit` `useSortable` on option rows and persist via a new `REORDER_CUSTOM_FIELD_OPTIONS` mutation. | S |
| 6 | **CFD definition drag-reorder** | `src/components/settings/CustomFieldsSettings.tsx` | Same as above at field-definition level. | Same as above with `REORDER_CUSTOM_FIELD_DEFS`. | S |
| 7 | **Native date picker** in `FlagPicker` | `src/components/inspector/FlagPicker.tsx` | Uses raw `<input type="date">` / `<input type="datetime-local">` — appearance is browser-default, not styled to design system. | Replace with `react-day-picker` (already pattern-fit) styled with `docs/UI-DESIGN-SYSTEM-SPEC.md` tokens. Cosmetic only — no data model change. | S |
| 8 | **EP-6 marked "shipped"** | `docs/architecture.md` phasing table; `docs/roadmap.md` | Should be "shipped — partial" because JMAP and IDLE gaps (items 2 + 3) are real. | Update the phasing tag to "Shipped (partial — IDLE polls, JMAP stub)". (Fixed in this pass.) | — (done) |
| 9 | **EP-8 iOS parity** | `/ios/` (29 Swift files) | EP-8 is "in progress". Desktop has 56 IPC commands and 15 UI feature areas; iOS has 15 UI screens but no claim of feature parity has been verified. `MutationEngine.swift` exists but coverage vs `src/state/mutations.ts:applyMutation()` is unmeasured. | Produce a parity audit: list every desktop feature and which iOS screen (if any) covers it. Currently captured at a high level in `docs/epic-8-checklist.md`. | L |

---

## 🟠 Planned gaps (acknowledged, scheduled)

| # | Item | Owner epic | Notes |
|---|---|---|---|
| 10 | Android shell | EP-8 follow-up | iOS first; Android after parity is reached. |
| 11 | Conflict resolution UI | EP-9 | Conflicts are currently silent last-write-wins via Lamport ordering. No user-visible conflict chips. Design draft: `docs/conflict-resolution-design.md`. |
| 12 | Encrypted FTS hardening | EP-10 | Move from at-rest encryption (SQLCipher of the whole `messages_fts` table) to true zero-knowledge encrypted index (e.g., blind index for subject/notes). |
| 13 | Sync state UI (per-folder progress, error surfacing) | EP-9 or later | `relay_state.last_error` is captured (`src-tauri/src/relay/mod.rs`) but no per-folder progress surface exists. |
| 14 | Sender reputation / spam panel | Future | Mentioned in `docs/notes/panels-brainstorm.md` only. |

---

## 🟢 Documentation drift (fixed in this pass — listed for traceability)

| # | Item | Fix |
|---|---|---|
| 15 | `CLAUDE.md` said "44+ IPC commands" | Updated to **56** (verified against `src-tauri/src/lib.rs:invoke_handler!`). |
| 16 | `CLAUDE.md` said "MutationKind enum (45+ kinds)" | Updated to **70** (verified against `src/data/types.ts` enum block). |
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
