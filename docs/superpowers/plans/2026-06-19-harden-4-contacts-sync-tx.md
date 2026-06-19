# Hardening 4 — Atomic contacts sync (transaction)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Make Google contacts sync atomic. Today `sync_google_contacts` upserts contacts in a loop with no transaction (`src-tauri/src/commands/calendar.rs:63`), so a mid-batch failure leaves a partial write (some contacts committed, the sync token not advanced). Wrap the batch in a transaction in the DB layer.

**Architecture:** Add `VaultDb::upsert_contacts(&self, vault_id, &[Value])` in `queries.rs` that wraps the existing `upsert_contact` loop in a `unchecked_transaction` (all-or-nothing), and have the command call it. Transaction management stays in the DB layer (where `self.conn` is accessible), not the command.

**Tech Stack:** Rust (`cargo test -p nexus`, `cargo build -p nexus`). **DO NOT run `cargo fmt` or clippy** (repo isn't fmt-clean; ~32 pre-existing clippy violations). Verify diffs stay minimal.

---

## Verified current code

- `src-tauri/src/commands/calendar.rs` (~60-72): inside a block, opens `VaultDb`, then:
```rust
        for contact in &contacts {
            let mut contact = contact.clone();
            contact["sourceAccountId"] = serde_json::json!(account_id);
            db.upsert_contact(&vault_id, &contact).map_err(|e| e.to_string())?;
        }
        db.upsert_contacts_sync(&account_id, next_sync_token.as_deref(), now)
            .map_err(|e| e.to_string())?;
```
- `src-tauri/src/db/queries.rs`: `pub fn upsert_contact(&self, vault_id: &str, contact: &serde_json::Value) -> Result<()>` (`:631`), `pub fn load_contacts(&self, vault_id: &str) -> Result<Vec<JsonValue>>` (`:546`). The `#[cfg(test)] mod tests` (from substrate Plan 4) has a `temp_vault()` helper returning `(TempDir, VaultDb, String)`.
- `VaultDb.conn` is a `rusqlite::Connection`; `Connection::unchecked_transaction(&self) -> Result<Transaction>` gives a transaction from a shared ref (rollback on drop, commit on `.commit()`).

---

### Task 1: Atomic `upsert_contacts` + wire the command

**Files:**
- Modify: `src-tauri/src/db/queries.rs` (add `upsert_contacts` method + a test)
- Modify: `src-tauri/src/commands/calendar.rs` (call the atomic method)

- [ ] **Step 1: Add the failing test**

In the `#[cfg(test)] mod tests` block at the end of `src-tauri/src/db/queries.rs`, add (inside the module):

```rust

    #[test]
    fn upsert_contacts_writes_a_batch_atomically() {
        let (_dir, db, vault_id) = temp_vault();
        let contacts = vec![
            serde_json::json!({
                "id": "k1", "name": "Ada", "emails": ["ada@x.com"], "phones": [],
                "tags": [], "socialProfiles": [], "addresses": [],
                "source": "google", "importance": "normal", "createdAt": 0, "updatedAt": 0
            }),
            serde_json::json!({
                "id": "k2", "name": "Bob", "emails": [], "phones": [],
                "tags": [], "socialProfiles": [], "addresses": [],
                "source": "google", "importance": "normal", "createdAt": 0, "updatedAt": 0
            }),
        ];
        db.upsert_contacts(&vault_id, &contacts).expect("upsert batch");
        let loaded = db.load_contacts(&vault_id).expect("load");
        assert_eq!(loaded.len(), 2);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run from `src-tauri/`: `cargo test -p nexus --lib upsert_contacts_writes_a_batch_atomically`
Expected: COMPILE FAILURE — `upsert_contacts` does not exist.

- [ ] **Step 3: Add the `upsert_contacts` method**

In `src-tauri/src/db/queries.rs`, near `upsert_contact` (in the same `impl VaultDb`), add:

```rust
    /// Upsert a batch of contacts atomically: either all are written or, on any
    /// error, none are (the transaction rolls back). Used by provider sync so a
    /// mid-batch failure never leaves a partial write.
    pub fn upsert_contacts(&self, vault_id: &str, contacts: &[serde_json::Value]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        for contact in contacts {
            self.upsert_contact(vault_id, contact)?;
        }
        tx.commit()?;
        Ok(())
    }
```

(If `unchecked_transaction` is unavailable on this rusqlite version, STOP and report — do not hand-roll BEGIN/COMMIT without rollback-on-error.)

- [ ] **Step 4: Run to verify the test passes**

Run from `src-tauri/`: `cargo test -p nexus --lib upsert_contacts_writes_a_batch_atomically`
Expected: PASS.

- [ ] **Step 5: Wire the command to the atomic method**

In `src-tauri/src/commands/calendar.rs`, replace the `for contact in &contacts { ... }` loop (the one that clones, tags `sourceAccountId`, and calls `db.upsert_contact`) with:

```rust
        let tagged: Vec<serde_json::Value> = contacts
            .iter()
            .map(|c| {
                let mut c = c.clone();
                c["sourceAccountId"] = serde_json::json!(account_id);
                c
            })
            .collect();
        db.upsert_contacts(&vault_id, &tagged).map_err(|e| e.to_string())?;
```

Leave the subsequent `db.upsert_contacts_sync(...)` call unchanged. (Note: `upsert_contacts_sync` stays outside the contact transaction — the sync-token advance is intentionally separate; if the batch fails, the early `?` return means the token is not advanced, so the next sync retries.)

- [ ] **Step 6: Build + test + verify clean diff**

Run from `src-tauri/`: `cargo build -p nexus` (compiles) and `cargo test -p nexus --lib` (all pass).
Then from repo root: `pnpm test && pnpm typecheck && pnpm lint` (frontend unaffected — all green).
Then `git status --porcelain` — ONLY `src-tauri/src/db/queries.rs` and `src-tauri/src/commands/calendar.rs` modified (plus untracked docs). If any other `.rs` file is dirty (stray fmt), `git restore` it. `git diff --stat` on each touched file should show only the added/changed lines, no mass churn.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db/queries.rs src-tauri/src/commands/calendar.rs
git commit -m "fix(contacts): make Google contacts sync atomic via a transaction"
```

---

## Self-Review (completed by author)

**Spec coverage:** partial-write-on-failure → `upsert_contacts` wraps the loop in a transaction (all-or-nothing); the command calls it with the same `sourceAccountId` tagging it did before; the sync-token advance stays separate so a failed batch isn't recorded as synced.

**Out of scope (per user decision):** the Gmail mutation-drainer drop (behavioral change), error logging, and sync-error UI surfacing.

**Placeholder scan:** none — full Rust code and exact commands in every step.

**Type consistency:** `upsert_contacts(&self, vault_id: &str, contacts: &[serde_json::Value]) -> Result<()>` reuses the existing `upsert_contact` per element; `tagged` is `Vec<serde_json::Value>` matching the slice param. The harness `temp_vault()` and `load_contacts` are reused from the substrate test module.

---

## Execution Handoff
One task, mostly Rust. Ends green + committed.
