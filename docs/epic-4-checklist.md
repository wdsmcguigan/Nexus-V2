# EP-4 — Tauri 2 Shell + Gmail Sync — Execution Checklist

**Status:** Complete
**Branch:** `claude/nexus-ep3-execution`
**Reference docs:** `docs/architecture.md`, `docs/glossary.md`

---

## Phase 4a — Tauri 2 shell + vault on disk ✅

- [x] `src-tauri/Cargo.toml` — Tauri 2 dependencies added
  - [x] `rusqlite` with `bundled-sqlcipher` feature (encrypted vault DB)
  - [x] `chacha20poly1305`, `blake3`, `sha2` for crypto primitives
  - [x] `mailparse` for RFC2822 / MIME parsing
  - [x] `reqwest` for Gmail API HTTP calls
  - [x] `[patch.crates-io]` tao patch for macOS 15 MainThreadMarker crash fix
- [x] `src-tauri/src/lib.rs` — `AppState` struct
  - [x] `db: Mutex<Option<VaultDb>>` field
  - [x] `db_path: Mutex<String>` field
  - [x] Plugin init (shell, dialog, fs, http)
  - [x] `invoke_handler!` registration for all 11 EP-4 commands
- [x] `src-tauri/src/db/schema.rs` — full SQLite DDL
  - [x] Tables: vaults, accounts, folders, labels, statuses, custom_field_defs, custom_field_options
  - [x] Tables: messages, message_labels, message_tags, tag_usage, message_bodies, mutations
  - [x] Tables: contacts, contact_emails, contact_phones, saved_views
  - [x] FTS5 virtual table: messages_fts (subject, body, notes)
- [x] `src-tauri/src/db/mod.rs` — `VaultDb` struct
  - [x] Wraps `rusqlite::Connection`
  - [x] `VaultDb::open()` runs schema DDL + column migrations on first open
- [x] `src-tauri/src/db/queries.rs` — all DB read/write helpers
  - [x] `build_hydrate_payload()` — assembles `HydratePayload` (vault / accounts / folders / labels / statuses / customFieldDefs / messages / tagUsage / mutations / contacts / savedViews)
  - [x] `apply_mutation()` — persists record to mutations table
  - [x] `apply_mutation_to_tables()` — 50 mutation kind handlers (all `MutationKind` variants)
  - [x] `get_message_body()` — fetches HTML from message_bodies table
  - [x] `pending_outbound_mutations()` — returns mutations with `relay_seq = NULL`
  - [x] `mark_mutation_synced()` — sets relay_seq on a mutation row
  - [x] Contact CRUD helpers
  - [x] Saved view CRUD helpers
  - [x] Local `OptionalExt` blanket impl (blocks `use rusqlite::OptionalExtension` in this file)

**Gate 4a:** `cargo check -p nexus` clean ✅

---

## Phase 4b — IPC commands ✅

- [x] `src-tauri/src/commands.rs` — 11 IPC commands implemented
  - [x] `load_vault_data(vaultPath)` — opens VaultDb, calls `build_hydrate_payload()`, fires `vault:hydrate-needed` event
  - [x] `apply_mutation(kind, payload, deviceId, lamport)` — persists mutation + applies to tables
  - [x] `get_message_body(bodyRef)` — returns HTML string from message_bodies
  - [x] `list_accounts()` — returns accounts JSON array
  - [x] `get_vault_path()` — reads path from `~/.nexus/vault_path`
  - [x] `set_vault_path(path)` — writes path to `~/.nexus/vault_path`
  - [x] `disconnect_account(accountId)` — removes account from DB + Keychain
  - [x] `start_gmail_oauth()` — full OAuth 2.0 browser flow
  - [x] `sync_gmail_now(accountId)` — manual trigger for full / incremental Gmail sync
  - [x] `start_watcher(vaultPath)` — starts FS watcher background loop
  - [x] `send_message(accountId, rawEml)` — base64url-encoded RFC822 → Gmail send API

**Gate 4b:** `cargo check -p nexus` clean ✅

---

## Phase 4c — Gmail integration ✅

- [x] `src-tauri/src/gmail/oauth.rs` — OAuth 2.0 flow
  - [x] Opens system browser to Google consent URL
  - [x] Local TCP listener captures redirect with authorization code
  - [x] Exchanges code for access + refresh tokens via token endpoint
  - [x] Stores tokens in macOS Keychain via `keyring` crate (never in vault DB plaintext)
  - [x] Fetches authenticated user email address
- [x] `src-tauri/src/gmail/types.rs` — Gmail API structs
  - [x] `GmailMessage`, `GmailThread`, `GmailLabel`, `GmailHistoryResponse`
- [x] `src-tauri/src/gmail/label_map.rs` — Gmail label → Nexus label mapping
  - [x] Seeds system labels (INBOX, SENT, DRAFTS, TRASH, SPAM, STARRED, IMPORTANT, CATEGORY_*)
  - [x] Maps Gmail label IDs to Nexus `LabelId` records
- [x] `src-tauri/src/gmail/sync.rs` — sync engine
  - [x] Full sync: `messages.list` → per-message `messages.get` fetch
  - [x] Incremental sync: History API with `history_id` cursor
  - [x] RFC2822 header + MIME body parsing via `mailparse`
  - [x] Writes `.eml` files to vault directory
  - [x] Inserts into messages, message_labels, message_bodies tables
  - [x] Emits `gmail:sync-progress` event during sync
  - [x] Emits `gmail:new-messages` event on completion
- [x] `src-tauri/src/gmail/mutations.rs` — outbound mutation drainer
  - [x] Reads pending mutations (`relay_seq = NULL`) on 30s tick
  - [x] `ADD_LABEL` / `REMOVE_LABEL` → `messages.modify` Gmail API call
  - [x] `TRASH_MESSAGE` → `messages.trash` Gmail API call
  - [x] `ARCHIVE_MESSAGE` → `messages.modify` remove INBOX label
  - [x] `MARK_READ` / `MARK_UNREAD` → `messages.modify` add/remove UNREAD label

**Gate 4c:** `cargo check -p nexus` clean ✅

---

## Phase 4d — File system watcher ✅

- [x] `src-tauri/src/watcher/mod.rs` — vault directory watcher
  - [x] `notify` crate watcher on vault root directory
  - [x] 300ms debounce on filesystem events
  - [x] Emits `vault:hydrate-needed` Tauri event on any change
  - [x] Runs as background Tokio task (non-blocking)

**Gate 4d:** `cargo check -p nexus` clean ✅

---

## Phase 4e — Frontend Tauri integration ✅

- [x] `src/App.tsx` — vault check on mount
  - [x] Calls `getVaultPath()` IPC on mount
  - [x] Shows `VaultSetup` if vault path is null
  - [x] Shows `WorkspaceChrome` after hydrating via `loadVaultData()` when path is set
- [x] `src/components/onboarding/VaultSetup.tsx` (new)
  - [x] Vault path picker via Tauri dialog API
  - [x] Creates vault via `setVaultPath()` IPC
  - [x] Transitions to `GmailConnect` after vault is created
- [x] `src/components/onboarding/GmailConnect.tsx` (new)
  - [x] "Connect Gmail" button → `startGmailOAuth()` IPC
  - [x] Shows sync progress via `onSyncProgress()` event listener
  - [x] Transitions to workspace on sync completion
- [x] `src/components/chrome/WorkspaceChrome.tsx` (new)
  - [x] Wraps workspace layout
  - [x] Subscribes to `onHydrateNeeded()` event → calls `loadVaultData()` to re-hydrate
  - [x] Subscribes to `onNewMessages()` event → calls `loadVaultData()` to re-hydrate
- [x] `src/components/chrome/StatusBar.tsx` (new)
  - [x] Shows connected account email address
  - [x] Shows last sync timestamp
  - [x] Sync spinner during active sync
- [x] `src/components/settings/SettingsPanel.tsx` (new) — tabbed settings panel
  - [x] Accounts tab: connected Gmail account display, disconnect button, manual sync button
  - [x] Preferences tab
  - [x] Custom Fields tab (replaces EP-2 single-modal `CustomFieldsSettings`)
  - [x] Relay tab

**Gate 4e:** `pnpm typecheck` clean ✅

---

## Phase 4f — Contacts in SQLite ✅

- [x] `apply_mutation_to_tables()` handles contact mutation kinds
  - [x] `UPSERT_CONTACT` — INSERT OR REPLACE into contacts + contact_emails + contact_phones
  - [x] `UPDATE_CONTACT` — UPDATE fields on existing contact row
  - [x] `DELETE_CONTACT` — DELETE contact + cascade to contact_emails + contact_phones
- [x] `build_hydrate_payload()` includes full contacts array
- [x] Frontend `loadVaultData()` hydrates `localStore.contacts` map from payload

**Gate 4f:** `pnpm typecheck` clean ✅

---

## Phase 4g — Typed IPC wrappers ✅

- [x] `src/storage/tauri.ts` — typed frontend wrappers for all 11 EP-4 IPC commands
  - [x] `loadVaultData(vaultPath)` → `HydratePayload`
  - [x] `applyMutationIpc(kind, payload, deviceId, lamport)`
  - [x] `getMessageBody(bodyRef)` → `string`
  - [x] `listAccounts()` → `Account[]`
  - [x] `getVaultPath()` → `string | null`
  - [x] `setVaultPath(path)`
  - [x] `disconnectAccount(accountId)`
  - [x] `startGmailOAuth()`
  - [x] `syncGmailNow(accountId)`
  - [x] `startWatcher(vaultPath)`
  - [x] `sendMessage(accountId, rawEml)`
  - [x] `onHydrateNeeded(cb)` — event listener helper
  - [x] `onNewMessages(cb)` — event listener helper
  - [x] `onSyncProgress(cb)` — event listener helper

**Gate 4g:** `pnpm typecheck` clean ✅

---

## Phase 4h — Final verification ✅

- [x] `pnpm typecheck` — clean
- [x] `pnpm lint` — zero warnings
- [x] `pnpm test` — all passing
- [x] `cargo check -p nexus` — clean
- [x] This checklist written
- [x] Commit + push to `claude/nexus-ep3-execution`

**🚦 Gate 4h:** `pnpm typecheck && pnpm lint && pnpm test && cargo check -p nexus` all green ✅

---

## Deferred items (for EP-5 / later)

**→ EP-5 (E2EE relay):**
- CFD option drag-reorder (GripVertical shown in EP-2 but DnD not wired — carried from EP-2)
- CFD definition drag-reorder
- Native date picker in FlagPicker (currently `<input type="date">`)
- Offline body access when `.eml` not yet synced to disk
- FTS via SQLite-FTS5 (schema table `messages_fts` exists; MiniSearch still used by frontend)

---

## Decisions log

**Non-Send VaultDb — never hold `&VaultDb` across `.await`:**
`rusqlite::Connection` contains `RefCell<LruCache>` and is not `Send`. Async Tokio tasks require `Send` futures. Pattern established: pass `db_path: &str` into async functions, open a fresh `VaultDb::open()` after all await points. Never hold a `&VaultDb` reference across an `.await` boundary.

**OptionalExt conflict in `queries.rs`:**
`queries.rs` defines a local `OptionalExt` blanket impl that provides `.optional()` on `rusqlite::Result`. Adding `use rusqlite::OptionalExtension` in the same file triggers E0034 (ambiguous method call) because both traits provide `.optional()`. The `use` statement is banned in this file; the local impl handles all cases.

**macOS 15 tao patch:**
Tauri's window management accesses AppKit from a non-main thread on macOS 15, causing a crash at `MainThreadMarker` assertion. Patched via `[patch.crates-io]` in `src-tauri/Cargo.toml`. Do not remove this patch.

**SQLCipher for vault, plain SQLite for relay:**
The vault DB is encrypted at rest with SQLCipher (`bundled-sqlcipher` feature). The relay server uses plain `rusqlite` (`bundled` feature, no encryption) because the relay stores only ciphertext blobs — adding disk encryption on top of already-encrypted blobs would be redundant overhead.

**Keychain for Gmail tokens:**
Gmail access and refresh tokens are stored in the macOS Keychain via the `keyring` crate. They are never written to the vault DB in plaintext. `disconnect_account()` removes both the DB row and the Keychain entry.
