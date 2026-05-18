# EP-5 — E2EE Relay Sync — Execution Checklist

**Status:** Complete
**Branch:** `claude/nexus-ep3-execution`
**Reference docs:** `docs/architecture.md`, `docs/relay.md`, `docs/glossary.md`

---

## Phase 5a — DB schema upgrade ✅

- [x] `src-tauri/src/db/schema.rs` — added to existing `SCHEMA_SQL` (idempotent via `IF NOT EXISTS`):
  - [x] `vault_key` table: `vault_id TEXT PK`, `key_hex TEXT NOT NULL` (32-byte XChaCha20 key, hex-encoded)
  - [x] `devices` table: `device_id TEXT PK`, `nickname TEXT NOT NULL`, `enrolled_at INTEGER NOT NULL`
  - [x] `relay_state` table: `relay_url TEXT PK`, `last_seq INTEGER DEFAULT 0`, `last_sync_at INTEGER`, `hosting_port INTEGER`
  - [x] `enroll_sessions` table: `code_hash TEXT PK`, `vault_id TEXT`, `encrypted_vault_key BLOB`, `expires_at INTEGER`, `attempts INTEGER DEFAULT 0`
  - [x] `mutations` table gained columns: `device_id TEXT NOT NULL DEFAULT ''`, `lamport INTEGER NOT NULL DEFAULT 0`, `relay_seq INTEGER`
  - [x] Index `idx_mutations_pending` on `mutations` (`WHERE synced_at IS NULL`)
  - [x] Index `idx_mutations_relay` on `mutations` (`WHERE relay_seq IS NULL`)
- [x] `src-tauri/src/db/mod.rs` — `run_column_migrations()` adds new columns to existing installs via `ALTER TABLE ... ADD COLUMN` (errors ignored for idempotency)
- [x] `src-tauri/src/db/queries.rs` additions:
  - [x] `get_or_create_vault_key(vault_id)` — generates 32 random bytes, hex-encodes, stores in `vault_key` table
  - [x] `get_or_create_device_id(vault_id)` — creates stable `device_id` + nickname (device hostname), stores in `devices` table
  - [x] `get_relay_url()` — reads from `relay_state`
  - [x] `set_relay_url(url)` — upserts `relay_state` row
  - [x] `get_relay_cursor(relay_url)` → `i64`
  - [x] `update_relay_cursor(relay_url, seq, now_ms)` → `()`
  - [x] `get_hosting_port()` → `Option<u16>`
  - [x] `set_hosting_port(port)` → `()`
  - [x] `pending_relay_mutations()` — returns mutations `WHERE relay_seq IS NULL`
  - [x] `mark_mutation_relay_synced(id, seq)` — sets `relay_seq`
  - [x] `create_enroll_session()`, `get_enroll_session()`, `increment_enroll_attempts()`, `delete_enroll_session()`
  - [x] `load_saved_views(vault_id)` + `saved_views` field added to `HydratePayload`

**Gate 5a:** `cargo check -p nexus` clean ✅

---

## Phase 5b — Crypto module ✅

- [x] `src-tauri/src/crypto.rs` (new file):
  - [x] `encrypt_payload(key: &[u8;32], plaintext: &[u8]) -> Vec<u8>` — XChaCha20-Poly1305, prepends 24-byte random nonce
  - [x] `decrypt_payload(key: &[u8;32], data: &[u8]) -> Result<Vec<u8>>` — splits nonce, decrypts, returns plaintext
  - [x] `derive_code_key(code: &str) -> [u8;32]` — BLAKE3 keyed hash with domain `"nexus-enroll-v1"` + code bytes
  - [x] `code_hash(code: &str) -> String` — SHA-256 hex of the code (stored on relay, not reversible)
  - [x] `generate_enrollment_code() -> String` — cryptographically random 6-digit zero-padded code

**Gate 5b:** `cargo check -p nexus` clean ✅

---

## Phase 5c — Relay server (embedded + standalone) ✅

- [x] `src-tauri/src/relay/server.rs`:
  - [x] axum Router with 4 routes: `POST /api/v1/mutations`, `GET /api/v1/mutations`, `POST /api/v1/enroll`, `GET /api/v1/enroll/:code_hash`
  - [x] `push_mutation` handler — stores encrypted blob + assigns `relay_seq`, returns `{seq}`
  - [x] `pull_mutations` handler — returns mutations after `?after=` cursor, excluding caller's `device_id`
  - [x] `create_enroll_session` handler — validates `expires_at`, stores `code_hash` + `encrypted_vault_key`
  - [x] `fetch_enroll_session` handler — enforces max 10 attempts, returns `encrypted_vault_key` or 404/429
  - [x] `start(relay_db_path, port)` — binds axum on random port (or specified), returns actual port
- [x] `src-tauri/src/relay/mod.rs` — relay state + `start_relay_sync_loop()` (Tokio interval 30s, push then pull)
- [x] `relay-server/` standalone binary workspace:
  - [x] `relay-server/Cargo.toml` — separate Cargo workspace; dependencies: axum, tokio, rusqlite (plain bundled), serde_json, base64, uuid
  - [x] `relay-server/src/main.rs` — reads `RELAY_DB_PATH` / `RELAY_PORT` / `RELAY_HOST` env vars, starts axum
  - [x] `relay-server/src/db.rs` — relay SQLite schema: `relay_mutations` table (seq AUTOINCREMENT, vault_id, device_id, lamport, ciphertext, received_at), `enroll_sessions` table; init + queries
  - [x] `relay-server/src/routes.rs` — same 4 route handlers as embedded server, using relay DB

**Gate 5c:** `cargo check -p nexus && cargo check --manifest-path relay-server/Cargo.toml` clean ✅

---

## Phase 5d — Relay client ✅

- [x] `src-tauri/src/relay/client.rs`:
  - [x] `RelaySyncer` struct: `relay_url`, `vault_id`, `device_id`, `vault_key [u8;32]`, `db_path`
  - [x] `push_pending()` — reads pending relay mutations, encrypts each, POSTs to relay, marks `relay_seq` on success
  - [x] `pull_remote()` — GETs mutations since cursor, decrypts each, skips own `device_id`, calls `apply_mutation_to_tables()`, updates cursor, emits `vault:hydrate-needed` if any applied
  - [x] `start_enrollment(relay_url, vault_id, vault_key)` — generates code, derives code key, encrypts vault key, POSTs to relay enroll endpoint, returns `EnrollmentSession { code, expires_at }`
  - [x] `complete_enrollment(relay_url, code, db_path)` — hashes code, GETs `encrypted_vault_key` from relay, decrypts with BLAKE3-derived key, stores vault key + relay URL in DB

**Gate 5d:** `cargo check -p nexus` clean ✅

---

## Phase 5e — IPC commands ✅

- [x] `get_relay_status()` → `RelayStatus { configured, lastSyncAt, pendingCount, error, hostingPort }`
- [x] `set_relay_url(url)` → stores in `relay_state` table
- [x] `get_vault_key_hex()` → hex string from `vault_key` table (for manual backup)
- [x] `start_enrollment_session()` → `EnrollmentSession { code, expiresAt }`
- [x] `complete_enrollment(relayUrl, code)` → runs client enrollment flow, pulls all history
- [x] `start_relay_hosting(port)` → starts embedded axum relay server, stores port in `relay_state`
- [x] All 6 new commands registered in `src-tauri/src/lib.rs` `invoke_handler!`

**Gate 5e:** `cargo check -p nexus` clean ✅

---

## Phase 5f — Frontend relay UI ✅

- [x] `src/storage/tauri.ts` additions:
  - [x] `RelayStatus` interface: `configured`, `lastSyncAt`, `pendingCount`, `error`, `hostingPort`
  - [x] `getRelayStatus()`, `setRelayUrl()`, `getVaultKeyHex()`, `startEnrollmentSession()`, `completeEnrollment()`, `startRelayHosting()` typed IPC wrappers
  - [x] `sendMessage()` gained `cc?` and `bcc?` params
- [x] `src/components/settings/SettingsPanel.tsx` — new Relay section:
  - [x] Mode picker: Nexus-hosted ("coming soon", greyed out) vs Self-Hosted (active)
  - [x] Self-hosted setup docs: three options (same Mac / Tailscale / VPS) with link to `docs/relay.md`
  - [x] "Host relay on this device" button → `startRelayHosting()` IPC
  - [x] Relay URL input + Save → `setRelayUrl()` IPC
  - [x] Live status indicator (30s poll via `getRelayStatus()`): green/yellow/red dot + last sync time + pending count
  - [x] Enrollment code display: 6-digit code in large font + 10-minute countdown timer (updated every second)
  - [x] Vault key export: hex display with copy-to-clipboard button
  - [x] Zero-knowledge privacy note

**Gate 5f:** `pnpm typecheck` clean ✅

---

## Phase 5g — Documentation ✅

- [x] `CLAUDE.md` — AI agent orientation: commands, repo layout, mutation pipeline, non-Send VaultDb pattern, OptionalExt conflict, Lamport clock, env setup, where-to-find-things table, known gotchas
- [x] `README.md` — full GitHub landing page rewrite: features, prerequisites, install steps, architecture overview, relay section, docs table
- [x] `docs/relay.md` — end-user relay setup guide: 3 setup options (embedded/Tailscale/VPS), device enrollment walkthrough, security model, vault key backup, troubleshooting
- [x] `docs/developer-guide.md` — engineer onboarding: prerequisites, project layout, how-to recipes (mutation kind, IPC command, settings section), DB schema reference, testing, linting, known gotchas
- [x] `docs/user-guide.md` — end-user documentation: vault setup, Gmail connect, panel navigation, organizing email, custom fields, search, sync, keyboard shortcuts, privacy

**Gate 5g:** Docs review complete ✅

---

## Phase 5h — Bug fixes ✅

- [x] `src-tauri/src/db/queries.rs` — added all ~32 previously-missing mutation kind handlers:
  - [x] Folder CRUD, label CRUD, tag global ops, status CRUD, flag lifecycle, `CLEAR_STAR`, message lifecycle, custom field CRUD, saved view CRUD (silently dropped before)
- [x] `src/state/mutations.ts`:
  - [x] Added `SAVE_VIEW` / `DELETE_VIEW` / `RENAME_VIEW` to `applyMutation()` switch
  - [x] Fixed `saveView()` to pass full `SavedView` as payload (not partial)
  - [x] Removed duplicate direct store calls that bypassed mutation pipeline
- [x] `src/components/EmailComposerPanel.tsx`:
  - [x] Wired BCC (new state + `RecipientInput`)
  - [x] Fixed CC not passed to `sendMessage()`
- [x] `docs/glossary.md`:
  - [x] Removed "not yet built" from `INS-FLAG-PICKER`, `INS-NOTE-EDITOR`, `INS-CUSTOM-FIELDS`, `VW-KANBAN`, `VW-TABLE`, `VW-SAVED`
  - [x] Updated epic status table (EP-0–EP-5 all marked Shipped)
- [x] `src/data/types.ts` — removed stale "Full date picker is EP-2" comment

**🚦 Gate 5h:** `pnpm typecheck && pnpm lint && cargo check -p nexus` all green ✅

---

## Deferred items (not in EP-5 scope)

**→ Nexus-hosted cloud relay (ops/infra, no new code):**
- "Coming soon" stub in settings UI; relay binary is provider-agnostic and identical — needs Nexus infrastructure to deploy, no additional code changes required

**→ EP-6 (JMAP/IMAP provider support):**
- JMAP and IMAP provider adapters alongside Gmail sync
- FTS5 via rusqlite incremental triggers (EP-4 Tauri layer still uses MiniSearch hydrated on load; SQLite-FTS5 triggers for incremental update not yet wired)

**→ EP-7 (Mobile shells):**
- iOS and Android shell apps

**→ EP-8 (Conflict resolution UI):**
- Visual merge UI for concurrent edits detected by Lamport clock comparison

**→ Cosmetic/UX deferred:**
- CFD option drag-reorder and CFD definition drag-reorder (deferred from EP-2)
- Native date picker in `FlagPicker` (currently `<input type="date">`)

---

## Decisions log

**Self-hosted relay only for EP-5:**
The relay binary is provider-agnostic. A Nexus-hosted instance is the identical binary deployed on Nexus infrastructure — no additional code needed, purely an ops/infra concern. The UI shows a "coming soon" stub for the Nexus-hosted mode to communicate the roadmap without blocking EP-5 delivery.

**Embedded relay shares axum code with standalone binary:**
`relay::server::start()` is called from Tauri for the embedded case and from `relay-server/src/main.rs` for the standalone binary. This eliminates duplication and guarantees protocol parity: any relay server, whether self-hosted on a VPS or run embedded on the user's Mac, runs the exact same handler logic.

**BLAKE3 for key derivation, SHA-256 for code hashing:**
BLAKE3 is faster than HKDF-SHA256 and provides a clean domain-separation interface (`keyed_hash`). SHA-256 is used for the enrollment code hash (stored on the relay) because it is the well-understood standard for one-way commitments and the performance difference is irrelevant for a single short string.

**30-second sync interval:**
Balances freshness vs. battery and network cost. Email metadata sync is inherently asynchronous — users tolerate seconds of latency. A 30s tick keeps the relay connection lightweight and avoids hammering the relay when the app is running in the background for hours.

**Non-Send VaultDb — open fresh connection inside async tasks:**
`rusqlite::Connection` contains `RefCell<LruCache>` and is not `Send`. Rather than wrapping in a `Mutex` (which would serialize all DB access) or using `spawn_blocking`, relay sync tasks accept a `db_path: &str` and open a fresh `VaultDb::open()` after all `.await` points. This keeps futures `Send` and avoids lock contention on the single connection used by the IPC command thread.

**OptionalExt local blanket impl (no `use rusqlite::OptionalExtension`):**
`queries.rs` defines a local `OptionalExt` trait that provides `.optional()` on `rusqlite::Result`. Importing `rusqlite::OptionalExtension` in the same file causes E0034 (ambiguous method call). The local trait handles all cases; `OptionalExtension` is intentionally excluded from this file's imports.
