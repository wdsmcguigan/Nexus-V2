# Nexus Roadmap

Last updated: 2026-05-18

Single reference for shipped work, confirmed deferred items, and upcoming epics. For design rationale see `docs/architecture.md`; for terminology see `docs/glossary.md`.

---

## Shipped Epics

### EP-0 — Data model overhaul (web)

| Area | What shipped |
|------|-------------|
| Schema | Full metadata schema: folders, labels, tags, statuses, priorities, stars, flags, pins, mutes, notes, custom fields + values |
| Mutations | Mutation log covering every axis — 50 `MutationKind` variants |
| Queries | `queryMessages` filter builder with all axes |
| Persistence | OPFS persistence for LocalStore |
| Dev data | Fixture seed with 60 realistic messages |

### EP-1 — Filter, saved views, kanban, table (web)

| Area | What shipped |
|------|-------------|
| Filtering | FilterBar with multi-axis AND logic, pill UI |
| Views | SavedView persistence (nav sidebar, command palette) |
| Kanban | KanbanView: drag messages between status columns |
| Table | TableView: sortable columns, custom field columns |

### EP-2 — Custom fields UI + notes + flag-with-due-date (web)

| Area | What shipped |
|------|-------------|
| Flags | FlagPicker with due date + reminder (`INS-FLAG-PICKER`) |
| Notes | NoteEditor with markdown preview (`INS-NOTE-EDITOR`) |
| Custom fields | CustomFieldStrip: type-appropriate editors for all 11 CFD types (`INS-CUSTOM-FIELDS`) |
| Settings | CustomFieldsSettings: full field definition CRUD with options management |
| Cosmetics | ColorPicker primitive; recolor labels and folders |

### EP-3 — FTS + contacts (web)

| Area | What shipped |
|------|-------------|
| Search | MiniSearch BM25 FTS (subject ×3, notes ×2, body ×1 boost) — 200ms debounce search bar |
| Persistence | OPFS persistence + body store |
| Notes | Markdown rendering in NoteEditor |
| Contacts | ContactsPanel, ContactCard, contact CRUD mutations |
| Tests | 118 passing tests |

### EP-4 — Tauri shell + Gmail sync (desktop)

| Area | What shipped |
|------|-------------|
| App shell | Tauri 2 native macOS app (.app + .dmg bundles) |
| Storage | SQLite vault with SQLCipher encryption (VaultDb, schema + queries) |
| Onboarding | VaultSetup + GmailConnect flows |
| Auth | Gmail OAuth 2.0 (tokens stored in macOS Keychain) |
| Sync — initial | Full Gmail sync: messages.list → messages.get + MIME parse + .eml write |
| Sync — incremental | Incremental Gmail sync via History API (history_id cursor) |
| Sync — outbound | Mutation drainer: label changes, archive, trash, read/unread → Gmail API |
| FS watcher | `notify` crate; emits `vault:hydrate-needed` events |
| IPC | 11 commands: `load_vault_data`, `apply_mutation`, `get_message_body`, `list_accounts`, `get/set_vault_path`, `disconnect_account`, `start_gmail_oauth`, `sync_gmail_now`, `start_watcher`, `send_message` |
| UI | SettingsPanel (Accounts, Preferences, Custom Fields, Relay tabs); StatusBar sync indicator; ShortcutHelpModal |
| Stability | macOS 15 tao patch for AppKit off-main-thread crash |

### EP-5 — E2EE relay sync

| Area | What shipped |
|------|-------------|
| Crypto | XChaCha20-Poly1305 mutation encryption (`crypto.rs`) |
| Key derivation | BLAKE3 enrollment key derivation; SHA-256 code hashing |
| Relay (embedded) | Embedded relay server (axum, runs inside Tauri process) |
| Relay (standalone) | `nexus-relay` binary in `relay-server/` Cargo workspace |
| Relay API | Push/pull mutations; enrollment session endpoints |
| Sync loop | 30s background sync: push then pull |
| Enrollment | 6-digit code, 10-minute expiry, max 10 attempts |
| IPC | 6 commands: `get_relay_status`, `set_relay_url`, `get_vault_key_hex`, `start_enrollment_session`, `complete_enrollment`, `start_relay_hosting` |
| UI | Relay settings: mode picker (Nexus-hosted "coming soon" stub + Self-Hosted active), URL input + status, enrollment code + countdown, vault key export |
| Docs | CLAUDE.md, README.md, `docs/relay.md`, `docs/developer-guide.md`, `docs/user-guide.md` |
| Bug fixes | ~32 missing Rust mutation handlers; SAVE_VIEW family store replay; BCC/CC wiring in composer |

---

## Confirmed Planned Gaps

These are known deferred items from completed epics. None block current function; all are tracked for future work.

| # | Item | Details | Relevant file(s) |
|---|------|---------|-----------------|
| 1 | **Nexus-hosted cloud relay** | "Coming soon" stub in relay settings. The `nexus-relay` binary is already provider-agnostic; this is an infrastructure/ops step with no additional client code needed. EP-5 scope was self-hosted only. | `src/components/settings/` |
| 2 | **CFD option drag-reorder** | GripVertical icon is rendered but drag-and-drop is not wired. Deferred from EP-2. | `src/components/settings/CustomFieldsSettings.tsx` |
| 3 | **CFD definition drag-reorder** | Same as above for field-level ordering. Deferred from EP-2. | `src/components/settings/CustomFieldsSettings.tsx` |
| 4 | **SQLite FTS5 search command (Tauri)** | `messages_fts` virtual table and triggers exist in the schema. The Rust query layer does not yet expose an FTS5 search IPC command. MiniSearch continues to work as the active search path. Deferred from EP-4. | `src-tauri/src/db/schema.rs`, `src-tauri/src/commands.rs` |
| 5 | **Native date picker in FlagPicker** | Currently uses `<input type="date">` / `<input type="datetime-local">`. A styled calendar picker (react-day-picker or similar) is a cosmetic upgrade. Deferred from EP-2. | `src/components/` |
| 6 | **FTS5 incremental relay update** | Inbound relay mutations do not update the SQLite FTS5 index live. The `ftsIndex.addMessage()` stub is wired in MiniSearch but the Tauri-side FTS5 path is not. Deferred from EP-5. | `src-tauri/src/db/`, `src/` |
| 7 | **JMAP / IMAP provider support** | Architecture is designed for this; label model matches JMAP RFC 8621 semantics. Planned for EP-6. | — |
| 8 | **Mobile shells (iOS / Android)** | Relay protocol is plain HTTPS + XChaCha20-Poly1305 blobs — mobile only needs HTTP polling, decryption, and the mutation format. Planned for EP-7. | — |
| 9 | **Conflict resolution UI** | Conflicts are currently silent last-write-wins via Lamport ordering. No user-visible conflict chips or resolution UI. Planned for EP-8. | — |

---

## Upcoming Epics

### EP-6 — Provider workers (Gmail + JMAP + IMAP)

- Gmail API already in place (EP-4); EP-6 adds a JMAP adapter (Fastmail, Stalwart, Apache James) and an IMAP fallback
- Reconciler for bidirectional sync conflicts at the provider level
- Outbound writes for all mutation kinds (currently only label/read/archive/trash for Gmail)
- Provider-foreign metadata (tags, status, notes, CFDs) stays Nexus-local

### EP-7 — Mobile (iOS, then Android)

- iOS app with FileProvider extension for vault access
- Same data model and mutation format as desktop
- Relay sync over HTTPS — no relay changes needed
- Background push notifications for new messages
- Android to follow

### EP-8 — Conflict resolution UI

- `WSP-CONFLICT-CHIP` in message list when a merge conflict is detected
- Conflict resolution sheet for explicit user choice
- Per-folder sync log
- Advanced: operational transform for concurrent note edits

### EP-9 — Encrypted FTS hardening

- Move from at-rest encryption to true zero-knowledge encrypted index
- Blind index approach for subject/notes search
- Security audit + penetration test

---

## Documentation Map

| Doc | Audience | Location |
|-----|----------|----------|
| This roadmap | Everyone — what's built, what's next | `docs/roadmap.md` |
| CLAUDE.md | AI agents + new contributors | `CLAUDE.md` |
| README | GitHub visitors, evaluators | `README.md` |
| Architecture | Engineers — design rationale + commitments | `docs/architecture.md` |
| Glossary | Engineers — stable IDs for every concept | `docs/glossary.md` |
| Developer guide | Engineers — day-to-day how-to recipes | `docs/developer-guide.md` |
| User guide | End users | `docs/user-guide.md` |
| Relay setup | End users setting up sync | `docs/relay.md` |
| UI design system | Frontend engineers + designers | `docs/UI-DESIGN-SYSTEM-SPEC.md` |
| Epic checklists | Historical reference | `docs/epic-{0,1,2,3,4,5}-checklist.md` |
