# Nexus Roadmap

Last updated: 2026-05-24

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
| UI | Relay settings: Self-Hosted mode, URL input + status, enrollment code + countdown, vault key export |
| Docs | CLAUDE.md, README.md, `docs/relay.md`, `docs/developer-guide.md`, `docs/user-guide.md` |
| Bug fixes | ~32 missing Rust mutation handlers; SAVE_VIEW family store replay; BCC/CC wiring in composer |

### EP-6 — Multi-provider mail support — **shipped**

> See `docs/epic-6-checklist.md` for the full checklist.

| Area | What shipped |
|------|-------------|
| IMAP | `ImapProvider`: folder sync, flag sync, message fetch. Real IMAP IDLE via `async-imap` `Session::idle()` (RFC 2177, 28-minute re-arm); 30s NOOP/EXAMINE polling is the documented fallback for servers without IDLE. |
| SMTP | SMTP outbound send (with TLS, STARTTLS, plain) |
| Outlook | Microsoft OAuth 2.0 flow; Outlook/Exchange account support (rides on IMAP plumbing) |
| Autodiscovery | Mozilla autoconfig + DNS SRV (`providers/autodiscovery.rs`) |
| JMAP | RFC 8620/8621 implementation with bearer-token auth: session discovery, `Mailbox/get`, `Email/{query,get,changes}`, mutation translation via `Email/set`. OAuth2 is a follow-up. |
| IPC | `discover_imap_settings`, `test_imap_connection`, `add_imap_account`, `add_jmap_account`, `start_outlook_oauth`, `sync_account_now` |

### EP-7 — Native FTS5, rules engine & quick wins

| Area | What shipped |
|------|-------------|
| FTS5 | SQLite FTS5 virtual table wired with INSERT/UPDATE/DELETE triggers + backfill migration; `search_messages` IPC with field-prefix operators (`from:`, `to:`, `tag:`, `label:`, `has:attachment`); `fts.ts` routes through Tauri IPC in native mode, keeps MiniSearch for web dev |
| Rules engine | `rules` DB table; `apply_rules_to_message()` called on every inbound message; supports ADD_LABEL, REMOVE_LABEL, SET_STATUS, SET_PRIORITY, ADD_TAG, STAR, MARK_READ, ARCHIVE, TRASH actions with AND/OR condition logic; full CRUD IPC + RulesSettings + RuleEditorDialog UI |
| Templates | `templates` DB table; full CRUD IPC + TemplatesSettings UI; composer toolbar button applies subject + body |
| Notifications | `tauri-plugin-notification`; fires on new inbound messages |
| List-Unsubscribe | `List-Unsubscribe` / `List-Unsubscribe-Post` headers stored per-message; "Unsubscribe" button in viewer; RFC 8058 one-click POST in Tauri mode |
| From selector | Multi-account From dropdown in composer (previously hardcoded to first Gmail account) |
| IPC | `search_messages`, `get_rules`, `save_rule`, `delete_rule`, `get_templates`, `save_template`, `delete_template`, `send_unsubscribe` |
| Security | SSRF guard on unsubscribe URLs; vault-scoped rule actions; DOMPurify sanitization on template HTML and markdown preview |

### EP-7 extension — Settings Parity

| Area | What shipped |
|------|-------------|
| App preferences | `src/lib/appPreferences.ts`; undo-send duration (Off/5s/10s/20s/30s), mark-as-read timing (immediately/1s/3s/10s/never), desktop notifications toggle, conversation view (threaded/flat), message snippets toggle; `set_notification_pref` IPC + `notifications_enabled` in AppState |
| Account settings | Per-account default reply (Reply / Reply All), external image loading (always show / ask); stored in `preferences_json TEXT` column on `accounts` table; `get_account_preferences` / `save_account_preferences` IPC commands |
| Rich-text signature | Tiptap editor (Bold/Italic/Underline) per account; stored in `signature_html TEXT` column on `accounts` table (localStorage migration on first save); `get_signature_html` / `save_signature_html` IPC commands |
| Stars management | `activeStars: StarStyle[]` in WorkspaceSnapshot; Settings → Preferences → Stars badge grid with click-to-toggle, drag-to-reorder, preset buttons (1 star, 4 stars, All); list star button cycles through active set in order and clears at end |
| Vacation responder | New `vacation_responders` DB table (enable toggle, subject, Tiptap body, optional date range, contacts-only); `get_vacation_responder` / `save_vacation_responder` / `delete_vacation_responder` IPC commands; UI in Accounts tab |
| Keyboard shortcuts | `src/lib/shortcuts.ts`; 10 rebindable `ShortcutAction` values; `keyBindings: Partial<Record<ShortcutAction, string>>` in WorkspaceSnapshot; Settings → Shortcuts tab with click-to-rebind, per-key clear, Reset all; list key handler routes through `actionForKey()`; ShortcutHelpModal shows effective bindings |

---

## Confirmed Planned Gaps

> **Canonical register has moved.** See `docs/known-gaps.md` for the up-to-date list of everything broken, stubbed, partial, or planned-but-not-shipped. The summary below is preserved for context only.

Highlights:
- **EP-8 iOS parity audit** — desktop/iOS feature coverage is not yet measured.
- **Conflict resolution UI** — planned EP-9; design draft at `docs/conflict-resolution-design.md`.
- **Encrypted FTS hardening** — planned EP-10.
- **Android shell** — after iOS parity.

---

## In Progress

### EP-8 — iOS app

- Swift reimplementation sharing the Nexus vault format
- FileProvider extension for native Files app access
- Relay sync over HTTPS (same protocol as desktop)
- Background push notifications for new messages
- Android to follow

---

## Upcoming Epics

### EP-9 — Conflict resolution UI

- `WSP-CONFLICT-CHIP` in message list when a merge conflict is detected
- Conflict resolution sheet for explicit user choice
- Per-folder sync log
- Advanced: operational transform for concurrent note edits

### EP-10 — Encrypted FTS hardening

- Move from at-rest encryption to true zero-knowledge encrypted index
- Blind index approach for subject/notes search
- Security audit + penetration test

---

## Documentation Map

| Doc | Audience | Location |
|-----|----------|----------|
| This roadmap | Everyone — what's built, what's next | `docs/roadmap.md` |
| **Known gaps register** | **Everyone — what's broken/unfinished** | **`docs/known-gaps.md`** |
| CLAUDE.md | AI agents + new contributors | `CLAUDE.md` |
| README | GitHub visitors, evaluators | `README.md` |
| Architecture | Engineers — design rationale + commitments + system diagrams | `docs/architecture.md` |
| Glossary | Engineers — stable IDs for every concept | `docs/glossary.md` |
| Developer guide | Engineers — day-to-day how-to recipes | `docs/developer-guide.md` |
| Contributing | Contributors — PR checklist + style | `docs/CONTRIBUTING.md` |
| IPC API reference | Engineers — all 57 IPC commands | `docs/ipc-api-reference.md` |
| Database reference | Engineers — 30 tables + ERD + migration model | `docs/database-reference.md` |
| Security model | Engineers + security reviewers — threat model + crypto | `docs/security-model.md` |
| User guide | End users | `docs/user-guide.md` |
| Relay setup | End users setting up sync | `docs/relay.md` |
| Relay deployment | Operators / self-hosters | `docs/nexus-relay-deployment.md` |
| UI design system | Frontend engineers + designers | `docs/UI-DESIGN-SYSTEM-SPEC.md` |
| Conflict resolution design | EP-9 contributors (draft) | `docs/conflict-resolution-design.md` |
| Epic checklists | Historical reference | `docs/epic-{0,1,2,3,4,5,6,7,8,11,12,13}-checklist.md` |
| macOS 15 crash investigation | Historical incident report | `docs/macos15-crash-investigation.md` |
| Informal notes / external analyses | Non-canonical reference | `docs/notes/` |
