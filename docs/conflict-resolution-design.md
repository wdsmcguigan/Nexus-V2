# Conflict Resolution — Design Draft (EP-9)

**Status: 🟠 DRAFT — not yet shipped.** This is a design conversation starter, not a ship checklist. It captures the model so anyone picking up EP-9 has a starting point.

Tracked in `docs/known-gaps.md` item 11.

---

## Current behavior (as of 2026-05-28)

Nexus today is **silent last-write-wins** ordered by Lamport clock.

What's actually in place:
- Every mutation carries `device_id` (stable per device) and `lamport` (monotonic logical clock) — see `mutations` table in `docs/database-reference.md`.
- The relay assigns each blob a `relay_seq` (monotonic per vault on the relay).
- On pull, devices apply mutations in `relay_seq` order. Within the same logical second, `lamport` breaks ties.
- The local optimistic update happens first (`recordMutation` updates Zustand store before the IPC even fires) — so a user typing on Device A sees their own change instantly, then the relay round-trip may or may not converge with Device B.

**Result:** if Device A and Device B both label message M with different colors concurrently, the lower-seq wins silently and the loser sees their label flip on the next sync. **No UI feedback. No conflict log. No undo.**

This is acceptable for most operations (statuses, stars, reads, archives) — losing 1 second of work is a non-issue. It's painful for:
- **Note edits** (concurrent free-text edits)
- **Custom field value writes** (especially long text)
- **Rule and template edits** (whole-object overwrites)
- **Renames** (folder, label, status, tag, view)

---

## Proposed model

### Categorize mutations by conflict semantics

| Class | Examples | Resolution |
|---|---|---|
| **Idempotent** | `READ`, `UNREAD`, `ARCHIVE`, `TRASH`, `SET_PINNED`, `SET_MUTED`, `ADD_LABEL`, `REMOVE_LABEL`, `ADD_TAG`, `REMOVE_TAG` | LWW is fine; no UI surface. |
| **Last-writer-wins on small fields** | `SET_PRIORITY`, `CLEAR_PRIORITY`, `SET_STAR`, `CLEAR_STAR`, `SET_STATUS`, `CLEAR_STATUS`, `SET_FLAG`/`UPDATE_FLAG`/`CLEAR_FLAG` | LWW is fine for transactional metadata. Optional: log to per-folder sync log. |
| **Whole-object overwrite — needs UI** | `UPDATE_RULE`, `UPDATE_TEMPLATE`, `SAVE_EVENT_TEMPLATE`, `UPDATE_CONTACT`, `UPDATE_CONTACT_GROUP` | Detect concurrent edits via lamport-vs-baseline; surface a conflict chip; let user pick "keep mine" / "keep theirs" / "merge". |
| **Free-text — needs special handling** | `SET_NOTE`, `UPDATE_CALENDAR_EVENT_NOTES`, `SET_CUSTOM_FIELD_VALUE` (text-typed) | Same as above, plus: optionally apply operational transform (OT) or CRDT (Yjs) for inline merge. |
| **Rename ops — needs UI** | `RENAME_FOLDER`, `RENAME_LABEL`, `RENAME_STATUS`, `RENAME_TAG_GLOBAL`, `RENAME_VIEW` | Last-writer-wins acceptable since the user can re-rename, BUT show a chip for at least 24 hours so they know the name flipped. |
| **Delete vs concurrent update** | `DELETE_*` racing `UPDATE_*` | Delete wins (tombstone). UI surfaces "deleted by other device" notice. |
| **Position ops — undefined today** | `REORDER_LABELS`, `REORDER_STATUSES`, `REORDER_RULES` (the last has no handler at all — see `docs/known-gaps.md` item 1) | Order array LWW; visible disruption is mild. |

### Schema additions

```sql
-- Track which lamport version a UI surface saw when it began editing.
-- This is the "baseline" against which conflict detection runs.
ALTER TABLE messages ADD COLUMN seen_lamport_for_notes INTEGER;
ALTER TABLE rules ADD COLUMN seen_lamport INTEGER;
ALTER TABLE templates ADD COLUMN seen_lamport INTEGER;
ALTER TABLE event_templates ADD COLUMN seen_lamport INTEGER;
ALTER TABLE contacts ADD COLUMN seen_lamport INTEGER;
ALTER TABLE contact_groups ADD COLUMN seen_lamport INTEGER;

-- Conflict log
CREATE TABLE IF NOT EXISTS conflicts (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    target_kind TEXT NOT NULL,        -- 'rule' | 'template' | 'message_note' | ...
    target_id TEXT NOT NULL,
    mine_lamport INTEGER NOT NULL,
    theirs_lamport INTEGER NOT NULL,
    mine_payload_json TEXT NOT NULL,
    theirs_payload_json TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    detected_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conflicts_unresolved ON conflicts(vault_id) WHERE resolved = 0;
```

### Detection logic

In the inbound apply path (when consuming a mutation pulled from the relay):

```
incoming = mutation pulled from relay
local_baseline = SELECT seen_lamport FROM <target_table> WHERE id = incoming.target_id

if local_baseline > incoming.lamport:
    # The device that wrote `incoming` had not yet seen the local edit
    # → log to `conflicts` table, do NOT apply incoming silently
    INSERT INTO conflicts(...)
else:
    apply normally; update seen_lamport
```

For idempotent and small-LWW operations, skip the check (the conflict has no user-visible cost).

### UI

- New surface `WSP-CONFLICT-CHIP` in `docs/glossary.md` §4 — small badge on rows/objects that have an unresolved conflict.
- A "Conflicts" view in the navigation sidebar (system-kind), behavior like an inbox: list each conflict, click to open a resolution sheet.
- Resolution sheet: side-by-side diff (mine | theirs) with three buttons: Keep mine, Keep theirs, Merge manually (free-text editor pre-populated with both).
- After resolution, the chosen payload becomes a new mutation (`device_id = this device`, `lamport = max(mine,theirs) + 1`) so all other devices converge.

---

## Out of scope for first cut

- True CRDT/OT (Yjs in `SET_NOTE` would be lovely but is a larger undertaking)
- Calendar event attendee-list conflicts (Google's own conflict UX takes precedence)
- Provider-vs-Nexus conflicts (e.g., Gmail server flips a label while user is offline) — these aren't relay conflicts; they're already handled by Gmail's History API ordering.

---

## Verification plan

When this ships:
- Two-device test: turn off relay sync on Device B, make conflicting edits on both for each conflict class above, turn relay back on, verify the right thing happens (silent LWW for idempotent; chip + resolution UI for whole-object).
- Property-test the lamport+device_id ordering: any permutation of N concurrent mutations must converge to the same state on all devices given they all eventually see the same set of mutations.

---

## Related

- `docs/known-gaps.md` items 1 (REORDER_RULES — pre-requisite), 11 (this), 13 (sync state UI)
- `docs/architecture.md` §Sync engine
- `docs/glossary.md` §5 `WF-CONFLICT-RESOLVE`
