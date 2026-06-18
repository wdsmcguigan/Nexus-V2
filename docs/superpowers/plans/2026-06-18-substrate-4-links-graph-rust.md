# Substrate Plan 4 — Links Graph: Rust persistence + hydration + test harness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Make links durable: a `links` table, `CREATE_LINK`/`DELETE_LINK` SQL handlers, hydration into the load payload, plus a reusable `VaultDb` test harness — which also lets us land the regression test deferred from Plan 1 (unknown/module kinds are recorded in the log, never errored).

**Architecture:** Mirror the existing `saved_views` persistence pattern exactly. `CREATE_LINK`/`DELETE_LINK` already flow through the mutation pipeline (Plan 3); this plan adds their table side-effects in `apply_mutation_to_tables`, a `load_links` hydration helper wired into `build_hydrate_payload`, and the `links` field on `HydratePayload`. The TS `LocalStore.hydrate` already consumes `snap.links` (Plan 3 Task 2), so the loop closes. A same-crate `#[cfg(test)] mod` provides a `VaultDb` harness built on the existing `VaultDb::open` + `ensure_vault`. (substrate-design.md §6.2.)

**Tech Stack:** Rust (`cargo test -p nexus`, `cargo check -p nexus`, `cargo fmt`, `cargo clippy -p nexus -- -D warnings`), SQLCipher via rusqlite. One small TS change (`pnpm typecheck`). Builds on Plan 3.

---

## Verified current patterns (mirror these)

- `src-tauri/src/db/schema.rs` — `SCHEMA_SQL` is a `&str` of `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` run on every open. Example: the `saved_views` table + `CREATE INDEX IF NOT EXISTS idx_saved_views_vault ON saved_views(vault_id);`.
- `src-tauri/src/db/queries.rs`:
  - `apply_mutation_to_tables(&self, kind: &str, payload: &str)` — parses `let p: JsonValue = serde_json::from_str(payload)?;`, then `match kind { ... }`. The `"SAVE_VIEW"`/`"DELETE_VIEW"` arms use `p["..."].as_str()`, `params![...]`, `self.conn.execute(...)`, `chrono::Utc::now().timestamp_millis()`. A catch-all `other => log::debug!("apply_mutation: unhandled kind '{other}' (recorded in log only)")` ends the match.
  - `load_saved_views(&self, vault_id) -> Result<Vec<JsonValue>>` — `prepare` SELECT, `query_map` building `serde_json::json!({...})` with camelCase keys, `.collect()`.
  - `pub struct HydratePayload { ... pub saved_views: Vec<JsonValue>, ... }` with `#[serde(rename_all = "camelCase")]`.
  - `build_hydrate_payload(&self, vault_id) -> Result<HydratePayload>` builds the struct field-by-field (`saved_views: self.load_saved_views(vault_id)?,`).
  - `pub fn apply_mutation(&self, vault_id, kind, payload, device_id, lamport)` always INSERTs the mutations row, then calls `apply_mutation_to_tables`.
  - `pub fn ensure_vault(&self, vault_id, vault_path) -> Result<()>` (`:833`) inserts a vaults row.
  - `pub fn VaultDb::open(vault_path: &str, key: &str) -> Result<Self>` (`db/mod.rs:15`) creates `.nexus/db.sqlite`, runs `SCHEMA_SQL`. `conn` is a private field accessible from a child `#[cfg(test)] mod`.
- `mutations` table has **no** FK to `vaults` (so applying a mutation doesn't require a vault row — but the harness creates one anyway for realism).
- TS `HydratePayload` interface in `src/storage/tauri.ts` lists each payload field (e.g. `savedViews: unknown[];`).

---

### Task 1: `VaultDb` test harness + the deferred Plan 1 regression test

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `tempfile` dev-dependency)
- Modify: `src-tauri/src/db/queries.rs` (add a `#[cfg(test)] mod tests` at end of file)

- [ ] **Step 1: Add the dev-dependency**

In `src-tauri/Cargo.toml`, find the `[dev-dependencies]` section. If it exists, add under it; if it does not exist, add the section at the end of the file:

```toml
[dev-dependencies]
tempfile = "3"
```

(If `[dev-dependencies]` already has entries, just add the `tempfile = "3"` line — do not remove existing entries.)

- [ ] **Step 2: Write the failing test (harness + regression)**

At the END of `src-tauri/src/db/queries.rs`, append:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Open a fresh encrypted vault in a temp dir with one vault row.
    /// Keep the returned `TempDir` alive for the test's duration.
    fn temp_vault() -> (TempDir, VaultDb, String) {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().to_str().expect("utf8 path").to_string();
        let db = VaultDb::open(&path, "testkey").expect("open vault");
        let vault_id = "test-vault".to_string();
        db.ensure_vault(&vault_id, &path).expect("ensure vault");
        (dir, db, vault_id)
    }

    #[test]
    fn unknown_namespaced_kind_is_recorded_not_errored() {
        let (_dir, db, vault_id) = temp_vault();
        // A module kind with no table handler must record in the log and not error.
        let res = db.apply_mutation(&vault_id, "com.acme.timer/START", "{\"id\":\"t1\"}", "dev", 1);
        assert!(res.is_ok(), "unknown kind should not error: {res:?}");
        let count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM mutations WHERE kind = ?1",
                params!["com.acme.timer/START"],
                |r| r.get(0),
            )
            .expect("count mutations");
        assert_eq!(count, 1, "the unknown-kind mutation must be in the log");
    }
}
```

- [ ] **Step 3: Run the test**

Run: `cargo test -p nexus --lib unknown_namespaced_kind_is_recorded_not_errored`
Expected: PASS. (This characterizes already-correct behavior — the Rust write path was verified namespace-safe in Plan 1. It goes green immediately and locks the behavior against future refactors.) Note: first compile may take 1–3 minutes.

- [ ] **Step 4: Format, lint, commit**

Run: `cargo fmt -p nexus && cargo clippy -p nexus --tests -- -D warnings`
Expected: no diff from fmt beyond the new code; clippy clean.

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/db/queries.rs
git commit -m "test(substrate): VaultDb harness + namespaced-kind regression test"
```

(If `cargo` updated `Cargo.lock`, include it in the commit. If there is no `src-tauri/Cargo.lock` (workspace lock at repo root), add that path instead: run `git status --porcelain` and stage whichever lock file changed.)

---

### Task 2: `links` table, SQL handlers, and hydration

**Files:**
- Modify: `src-tauri/src/db/schema.rs` (add `links` table + indexes)
- Modify: `src-tauri/src/db/queries.rs` (`CREATE_LINK`/`DELETE_LINK` arms, `load_links`, `HydratePayload.links`, `build_hydrate_payload`, 3 tests)

- [ ] **Step 1: Write the failing tests**

In the `#[cfg(test)] mod tests` block in `src-tauri/src/db/queries.rs` (created in Task 1), add three tests inside the module:

```rust
    fn link_payload(id: &str, vault_id: &str) -> String {
        serde_json::json!({
            "id": id,
            "vaultId": vault_id,
            "srcType": "nexus/email.message",
            "srcId": "m-1",
            "linkType": "derived-from",
            "dstType": "org.nexus.tasks/task",
            "dstId": "t-1",
            "createdAt": 0
        })
        .to_string()
    }

    #[test]
    fn create_link_persists_and_loads() {
        let (_dir, db, vault_id) = temp_vault();
        db.apply_mutation(&vault_id, "CREATE_LINK", &link_payload("lnk-1", &vault_id), "dev", 1)
            .expect("apply create_link");
        let links = db.load_links(&vault_id).expect("load links");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0]["dstId"], "t-1");
        assert_eq!(links[0]["linkType"], "derived-from");
        assert_eq!(links[0]["srcType"], "nexus/email.message");
    }

    #[test]
    fn delete_link_removes_it() {
        let (_dir, db, vault_id) = temp_vault();
        db.apply_mutation(&vault_id, "CREATE_LINK", &link_payload("lnk-1", &vault_id), "dev", 1)
            .expect("apply create_link");
        db.apply_mutation(&vault_id, "DELETE_LINK", "{\"linkId\":\"lnk-1\"}", "dev", 2)
            .expect("apply delete_link");
        let links = db.load_links(&vault_id).expect("load links");
        assert_eq!(links.len(), 0);
    }

    #[test]
    fn hydrate_payload_includes_links() {
        let (_dir, db, vault_id) = temp_vault();
        db.apply_mutation(&vault_id, "CREATE_LINK", &link_payload("lnk-1", &vault_id), "dev", 1)
            .expect("apply create_link");
        let hp = db.build_hydrate_payload(&vault_id).expect("hydrate");
        assert_eq!(hp.links.len(), 1);
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p nexus --lib`
Expected: FAIL to **compile** — `db.load_links` and `hp.links` do not exist yet. (Compile failure is the red state.)

- [ ] **Step 3: Add the `links` table to `SCHEMA_SQL`**

In `src-tauri/src/db/schema.rs`, find the `saved_views` block ending with:
```sql
CREATE INDEX IF NOT EXISTS idx_saved_views_vault ON saved_views(vault_id);
```
Immediately after that line, add:
```sql

CREATE TABLE IF NOT EXISTS links (
    id         TEXT PRIMARY KEY,
    vault_id   TEXT NOT NULL,
    src_type   TEXT NOT NULL,
    src_id     TEXT NOT NULL,
    link_type  TEXT NOT NULL,
    dst_type   TEXT NOT NULL,
    dst_id     TEXT NOT NULL,
    meta_json  TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_src ON links(vault_id, src_type, src_id);
CREATE INDEX IF NOT EXISTS idx_links_dst ON links(vault_id, dst_type, dst_id);
```

- [ ] **Step 4: Add `CREATE_LINK`/`DELETE_LINK` arms**

In `apply_mutation_to_tables` in `src-tauri/src/db/queries.rs`, add these arms near the `"SAVE_VIEW"`/`"DELETE_VIEW"` arms (before the catch-all `other =>`):

```rust
            "CREATE_LINK" => {
                let id = p["id"].as_str().unwrap_or_default();
                let vault_id = p["vaultId"].as_str().unwrap_or("local");
                let src_type = p["srcType"].as_str().unwrap_or_default();
                let src_id = p["srcId"].as_str().unwrap_or_default();
                let link_type = p["linkType"].as_str().unwrap_or_default();
                let dst_type = p["dstType"].as_str().unwrap_or_default();
                let dst_id = p["dstId"].as_str().unwrap_or_default();
                let meta_json = if p["meta"].is_null() {
                    None
                } else {
                    Some(p["meta"].to_string())
                };
                let created_at = p["createdAt"]
                    .as_i64()
                    .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
                self.conn.execute(
                    "INSERT OR REPLACE INTO links (id, vault_id, src_type, src_id, link_type, dst_type, dst_id, meta_json, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![id, vault_id, src_type, src_id, link_type, dst_type, dst_id, meta_json, created_at],
                )?;
            }
            "DELETE_LINK" => {
                let link_id = p["linkId"].as_str().unwrap_or_default();
                self.conn
                    .execute("DELETE FROM links WHERE id = ?1", params![link_id])?;
            }
```

- [ ] **Step 5: Add `load_links` helper**

In `src-tauri/src/db/queries.rs`, near `load_saved_views`, add:

```rust
    fn load_links(&self, vault_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, src_type, src_id, link_type, dst_type, dst_id, meta_json, created_at
             FROM links WHERE vault_id = ?1 ORDER BY created_at",
        )?;
        let rows = stmt.query_map(params![vault_id], |r| {
            let meta_json: Option<String> = r.get(6)?;
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "vaultId": vault_id,
                "srcType": r.get::<_, String>(1)?,
                "srcId": r.get::<_, String>(2)?,
                "linkType": r.get::<_, String>(3)?,
                "dstType": r.get::<_, String>(4)?,
                "dstId": r.get::<_, String>(5)?,
                "meta": meta_json.and_then(|s| serde_json::from_str::<JsonValue>(&s).ok()),
                "createdAt": r.get::<_, i64>(7)?
            }))
        })?;
        rows.map(|r| r.context("loading link row")).collect()
    }
```

- [ ] **Step 6: Wire `links` into `HydratePayload`**

(a) In the `pub struct HydratePayload { ... }`, add after `pub saved_views: Vec<JsonValue>,`:
```rust
    pub links: Vec<JsonValue>,
```
(b) In `build_hydrate_payload`, add after `saved_views: self.load_saved_views(vault_id)?,`:
```rust
            links: self.load_links(vault_id)?,
```

- [ ] **Step 7: Run the tests**

Run: `cargo test -p nexus --lib`
Expected: PASS — all four tests (Task 1's regression + the three link tests) green.

- [ ] **Step 8: Format, lint, commit**

Run: `cargo fmt -p nexus && cargo clippy -p nexus --tests -- -D warnings` (clean).

```bash
git add src-tauri/src/db/schema.rs src-tauri/src/db/queries.rs
git commit -m "feat(substrate): persist and hydrate the links table"
```

---

### Task 3: Declare `links` in the TS hydrate payload type

**Files:**
- Modify: `src/storage/tauri.ts` (add `links` to the `HydratePayload` interface)
- Test: `src/storage/__tests__/links.hydrate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/storage/__tests__/links.hydrate.test.ts
import { describe, it, expect } from "vitest";
import { LocalStore } from "@/storage/local";
import type { HydratePayload } from "@/storage/tauri";
import type { Link } from "@/data/types";

describe("links in the hydrate payload", () => {
  it("hydrates a store from a payload carrying links", () => {
    const link: Link = {
      id: "lnk-1",
      vaultId: "v",
      srcType: "nexus/email.message",
      srcId: "m-1",
      linkType: "derived-from",
      dstType: "org.nexus.tasks/task",
      dstId: "t-1",
      createdAt: 0,
    };
    const payload: Partial<HydratePayload> = { links: [link] };
    const store = new LocalStore();
    store.hydrate(payload as Parameters<typeof store.hydrate>[0]);
    expect(store.links.get("lnk-1")?.dstId).toBe("t-1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm typecheck`
Expected: FAIL — `links` is not a property of `HydratePayload`.

- [ ] **Step 3: Add `links` to the TS `HydratePayload` interface**

In `src/storage/tauri.ts`, in the `HydratePayload` interface, add alongside `savedViews: unknown[];`:
```ts
  links: unknown[];
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm typecheck && pnpm test -- src/storage/__tests__/links.hydrate.test.ts`
Expected: 0 type errors; test PASS.

- [ ] **Step 5: Full check + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint` (all green). Then:
```bash
git add src/storage/tauri.ts src/storage/__tests__/links.hydrate.test.ts
git commit -m "feat(substrate): declare links in the hydrate payload type"
```

---

## Self-Review (completed by author)

**Spec coverage** (design §6.2 durability + deferred Plan 1 item): `links` table → Task 2 Step 3; SQL handlers → Task 2 Step 4 (camelCase payload keys match the TS `createLink` builder: `id`, `vaultId`, `srcType`, `srcId`, `linkType`, `dstType`, `dstId`, `meta`, `createdAt`; `DELETE_LINK` reads `linkId`); hydration → Task 2 Steps 5–6 + Task 3 (TS type) closing the loop into `LocalStore.hydrate` (already consuming `snap.links` from Plan 3); reusable `VaultDb` harness + the deferred namespaced-kind regression test → Task 1.

**Placeholder scan:** none — full Rust/TS code and exact `cargo`/`pnpm` commands in every step.

**Type consistency:** Rust INSERT columns (`src_type`,`src_id`,`link_type`,`dst_type`,`dst_id`,`meta_json`,`created_at`) ↔ `load_links` SELECT ↔ camelCase JSON keys (`srcType`,`srcId`,`linkType`,`dstType`,`dstId`,`meta`,`createdAt`) ↔ the TS `Link` interface (Plan 3). `HydratePayload.links` (Rust `Vec<JsonValue>`, serde camelCase → `links`) ↔ TS `HydratePayload.links: unknown[]` ↔ `LocalStore.hydrate` `snap.links`. `DELETE_LINK` payload `{ linkId }` matches the TS `deleteLink` helper.

**Risk note:** `cargo test`/`clippy` compile the full crate — first run is slow (1–3 min). If `tempfile` cannot be fetched (offline), Task 1 is BLOCKED — report rather than vendoring.

---

## Execution Handoff

Execute with superpowers:subagent-driven-development or inline. Three tasks; mostly Rust. After this, **Pillar 3 (links graph) is fully durable** end-to-end. Remaining substrate work: Pillar 4 (module manifest, contribution points, capability vocabulary, namespaced storage, surface taxonomy).
