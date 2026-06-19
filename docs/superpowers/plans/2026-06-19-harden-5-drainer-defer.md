# Hardening 5 — Stop the drainer silently dropping unsynced mutations

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** `src-tauri/src/gmail/mutations.rs:204` marks an outbound mutation "synced" (permanently dropping the user's label/read/archive change) the moment its target message has no `provider_id`. A message that is merely *pending initial sync* loses the change forever. Fix: **defer-and-retry, bounded by an age cap** — preserve the mutation while the message is pending, and drop it (with a WARN, not silently) only once it has aged past the cap, so there's no infinite-retry regression.

**Architecture:** The drain loop already uses "leave pending = retry next cycle" for transient failures (calendar push errors, token errors). Apply the same for the no-`provider_id` case, bounded by a max age computed from the mutation's `ts`. Add a `VaultDb::mutation_age_ms` query and a pure `drop_unsynced_mutation(age)` decision fn (both unit-tested); wire the `None` branch to defer-or-drop.

**Tech Stack:** Rust. `cargo test -p nexus`, `cargo build -p nexus` from `src-tauri/`. **DO NOT run `cargo fmt`/clippy** (repo isn't fmt-clean). Keep diffs minimal; `git restore` any stray-fmt files before committing.

---

## Verified current code

- `src-tauri/src/gmail/mutations.rs` drain loop (`drain_once`), the message-modify path:
```rust
        let (gmail_msg_id, account_id) = {
            let db = VaultDb::open(db_path, "nexus")?;
            match db.get_provider_id(nexus_msg_id)? {
                Some(p) => p,
                None => {
                    log::debug!("No provider_id for {nexus_msg_id}, skipping {mut_id}");
                    let _ = db.mark_mutation_synced(mut_id);
                    continue;
                }
            }
        };
```
- `pending_outbound_mutations() -> Result<Vec<(String,String,String,String)>>` (mut_id, kind, payload_json, vault_id) — no `ts`. `mark_mutation_synced(&self, &str)`, `get_provider_id(&self, &str) -> Result<Option<(String,String)>>` exist. The `mutations` table has `ts INTEGER NOT NULL`.
- `queries.rs` provides `.optional()` via a local `OptionalExt` (do NOT `use rusqlite::OptionalExtension`). Its `#[cfg(test)] mod tests` has `temp_vault() -> (TempDir, VaultDb, String)` and `apply_mutation`.
- `mutations.rs` has NO existing test module. It imports `anyhow::{Context, Result}`, `VaultDb`. `chrono` is a crate dep (use full path `chrono::...`).

---

### Task 1: `VaultDb::mutation_age_ms`

**Files:**
- Modify: `src-tauri/src/db/queries.rs` (add method + test)

- [ ] **Step 1: Add the failing test** (inside the existing `#[cfg(test)] mod tests`):

```rust

    #[test]
    fn mutation_age_ms_reflects_recent_timestamp_and_none_for_missing() {
        let (_dir, db, vault_id) = temp_vault();
        db.apply_mutation(&vault_id, "READ", "{\"messageId\":\"m1\"}", "dev", 1)
            .expect("apply");
        let mut_id: String = db
            .conn
            .query_row("SELECT id FROM mutations WHERE kind = 'READ'", [], |r| r.get(0))
            .expect("select id");
        let age = db.mutation_age_ms(&mut_id).expect("age").expect("some age");
        assert!((0..60_000).contains(&age), "recent mutation age should be small, got {age}");
        assert!(db.mutation_age_ms("does-not-exist").expect("age").is_none());
    }
```

- [ ] **Step 2: Run (from `src-tauri/`)** `cargo test -p nexus --lib mutation_age_ms_reflects_recent_timestamp_and_none_for_missing` → COMPILE FAILURE (method missing).

- [ ] **Step 3: Add the method** in `queries.rs` (in `impl VaultDb`, near `mark_mutation_synced`):

```rust
    /// Age in milliseconds of an outbound mutation (`now - ts`), or `None` if the
    /// mutation row is gone. Used by the drainer to bound retries of mutations
    /// whose target message has not yet been assigned a provider id.
    pub fn mutation_age_ms(&self, mutation_id: &str) -> Result<Option<i64>> {
        let ts: Option<i64> = self
            .conn
            .query_row(
                "SELECT ts FROM mutations WHERE id = ?1",
                params![mutation_id],
                |r| r.get(0),
            )
            .optional()?;
        Ok(ts.map(|t| chrono::Utc::now().timestamp_millis() - t))
    }
```

- [ ] **Step 4: Run** `cargo test -p nexus --lib mutation_age_ms_reflects_recent_timestamp_and_none_for_missing` → PASS.

- [ ] **Step 5: Verify minimal diff + commit.** `git status --porcelain` shows only `queries.rs` (+ untracked docs). `git restore` any stray-fmt file.
```bash
git add src-tauri/src/db/queries.rs
git commit -m "feat(gmail): add VaultDb::mutation_age_ms for drainer retry bounding"
```

---

### Task 2: Defer-or-drop decision + wire the drain loop

**Files:**
- Modify: `src-tauri/src/gmail/mutations.rs` (const + decision fn + test module + wire the `None` branch)

- [ ] **Step 1: Add the failing test.** At the END of `src-tauri/src/gmail/mutations.rs`, add:

```rust

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_unsynced_mutation_only_after_the_age_cap() {
        assert!(!drop_unsynced_mutation(0));
        assert!(!drop_unsynced_mutation(MAX_UNSYNCED_MUTATION_AGE_MS - 1));
        assert!(drop_unsynced_mutation(MAX_UNSYNCED_MUTATION_AGE_MS));
        assert!(drop_unsynced_mutation(MAX_UNSYNCED_MUTATION_AGE_MS + 1));
    }
}
```

- [ ] **Step 2: Run (from `src-tauri/`)** `cargo test -p nexus --lib drops_unsynced_mutation_only_after_the_age_cap` → COMPILE FAILURE (`drop_unsynced_mutation`/`MAX_UNSYNCED_MUTATION_AGE_MS` missing).

- [ ] **Step 3: Add the const + decision fn** near the top of `mutations.rs` (after the `GMAIL_API` const):

```rust
/// Outbound mutations whose target message still has no provider id are deferred
/// and retried until this age cap, then dropped (with a warning) so a message
/// that never syncs cannot pin a mutation in the queue forever. 7 days.
const MAX_UNSYNCED_MUTATION_AGE_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// Whether an unsynced outbound mutation (its target message has no provider id
/// yet) should be dropped rather than deferred for retry, given its age in ms.
fn drop_unsynced_mutation(age_ms: i64) -> bool {
    age_ms >= MAX_UNSYNCED_MUTATION_AGE_MS
}
```

- [ ] **Step 4: Run** `cargo test -p nexus --lib drops_unsynced_mutation_only_after_the_age_cap` → PASS.

- [ ] **Step 5: Wire the `None` branch.** In `drain_once`, replace the `None => { ... }` arm (the one that logs "No provider_id ... skipping" and calls `mark_mutation_synced`) with:

```rust
                None => {
                    let age = db.mutation_age_ms(mut_id)?.unwrap_or(i64::MAX);
                    if drop_unsynced_mutation(age) {
                        log::warn!(
                            "Dropping outbound mutation {mut_id}: message {nexus_msg_id} still has no provider_id after {age}ms"
                        );
                        let _ = db.mark_mutation_synced(mut_id);
                    } else {
                        // Message is pending initial sync — leave the mutation in
                        // the queue and retry next cycle once it gets a provider id.
                        log::debug!(
                            "No provider_id yet for {nexus_msg_id}; deferring {mut_id} for retry (age {age}ms)"
                        );
                    }
                    continue;
                }
```

- [ ] **Step 6: Build + test + verify.** From `src-tauri/`: `cargo build -p nexus` (compiles) and `cargo test -p nexus --lib` (all pass). From repo root: `pnpm test && pnpm typecheck && pnpm lint` (frontend unaffected). `git status --porcelain` shows only `mutations.rs` modified (+ untracked docs); `git restore` any stray-fmt file. `git diff --stat` minimal.

- [ ] **Step 7: Commit.**
```bash
git add src-tauri/src/gmail/mutations.rs
git commit -m "fix(gmail): defer unsynced outbound mutations instead of dropping them"
```

---

## Self-Review (completed by author)

**Spec coverage:** silent drop of a user's outbound change when the target message is pending sync → now deferred-and-retried (preserved) until an age cap, then dropped with a WARN (bounded, surfaced — no infinite retry). The decision is unit-tested (`drop_unsynced_mutation` boundary) and the age source is unit-tested (`mutation_age_ms`). Full drain integration (network) is out of unit-test scope; the wiring is review-verified.

**Behavioral change & risk:** previously ALL no-provider_id → immediate drop; now recent ones defer (the fix). A permanently-unsynced message re-processes each 30s cycle (cheap DB lookup + continue) for ≤ 7 days, then drops with a warning. No schema change. The `?` on `mutation_age_ms` means a transient DB error aborts the cycle and retries next tick (mutation stays pending) — safe.

**Type consistency:** `mutation_age_ms(&self, &str) -> Result<Option<i64>>`; `drop_unsynced_mutation(i64) -> bool`; `MAX_UNSYNCED_MUTATION_AGE_MS: i64`. `unwrap_or(i64::MAX)` makes a missing mutation row drop (age = max).

---

## Execution Handoff
Two Rust tasks. No `cargo fmt`/clippy. Each green + committed.
