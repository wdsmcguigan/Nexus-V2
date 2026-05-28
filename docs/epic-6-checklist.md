# Epic 6 — Multi-Provider Support

**Status: ✅ Shipped** — Gmail, IMAP (with real IDLE), Outlook, and JMAP (bearer-token auth) are all usable.

This checklist was reconstructed retroactively from code on 2026-05-28. Compare entries here against the actual files cited; if they diverge, the code wins.

---

## Goal

Allow Nexus to connect to any IMAP-speaking provider (Fastmail, iCloud, ProtonMail Bridge, Yahoo, self-hosted) in addition to Gmail, plus a first-class Outlook OAuth flow.

---

## What shipped

### Account types

| Provider | Status | Files |
|---|---|---|
| **Gmail** (OAuth) | ✅ Full — OAuth, History API sync, attachments, send, calendar, contacts | `src-tauri/src/gmail/` (9 files) |
| **IMAP** (password) | ✅ Full — autodiscovery, sync, attachments, SMTP send | `src-tauri/src/providers/imap.rs` (16.6 KB), `src-tauri/src/providers/autodiscovery.rs` (8.7 KB), `src-tauri/src/smtp.rs` |
| **Outlook** (OAuth) | ✅ Full — Microsoft v2.0 OAuth → IMAP scopes → IMAP plumbing underneath | `src-tauri/src/providers/outlook_oauth.rs` (4.3 KB) |
| **JMAP** (bearer token) | ✅ Shipped — RFC 8620/8621: session discovery, `Mailbox/get`, `Email/{query,get,changes}`, `Email/set` mutation translation | `src-tauri/src/providers/jmap.rs`, `src-tauri/src/providers/jmap_types.rs` |

### Provider abstraction

- `src-tauri/src/providers/mod.rs` defines the `MailProvider` trait: `fetch_labels`, `fetch_initial`, `fetch_incremental`, `fetch_message_body`, `apply_mutation`.
- All four providers above implement the trait against real backends.

### IPC commands (6)

| Command | Purpose |
|---|---|
| `discover_imap_settings(email)` | Mozilla autoconfig + DNS SRV discovery for IMAP/SMTP settings. |
| `test_imap_connection(host, port, security, username, password)` | Validates creds before saving. |
| `add_imap_account(ImapAccountInput)` | Persists creds, schedules first sync, spawns IDLE watcher. |
| `add_jmap_account({email, displayName, sessionUrl, token})` | Discovers JMAP session, persists encrypted token, schedules first sync. |
| `sync_account_now(accountId)` | Manual sync for IMAP, Outlook, and JMAP (Gmail uses `sync_gmail_now`). |
| `start_outlook_oauth()` | Microsoft v2.0 OAuth flow → IMAP-style storage. |

All six are registered in `src-tauri/src/lib.rs:invoke_handler!` and wrapped in `src/storage/tauri.ts`.

### UI

- `src/components/onboarding/AddAccountModal.tsx` — provider chooser with Gmail / Outlook / IMAP / JMAP, plus dedicated flow components per provider.
- IMAP-specific form for host/port/security/username/password.
- JMAP-specific form for email, session URL, and bearer token (with show/hide).
- "Test connection" button calls `test_imap_connection`.

### Schema additions (ALTER blocks in `src-tauri/src/db/schema.rs`)

```rust
EP6_ALTER_SQL: &[&str] = &[
    "ALTER TABLE accounts ADD COLUMN sync_cursor TEXT",
    "ALTER TABLE accounts ADD COLUMN settings_json TEXT",
    "ALTER TABLE messages ADD COLUMN list_unsubscribe_json TEXT",
];
```

Plus the EP6 idempotent block defining `rules`, `templates`, and FTS5 sync triggers (the rules engine arrived in EP-7 but its tables were prepared here).

---

## Follow-ups

| # | Item | Severity | File |
|---|---|---|---|
| 1 | **JMAP OAuth2 flow** | 🟠 Planned | Today JMAP onboarding uses a bearer token the user pastes; OAuth2 with PKCE would mirror Outlook/Gmail. |
| 2 | **CalDAV / CardDAV** | 🟠 Out of scope | Not started |

---

## Verification (was done at ship time; re-run any time)

```bash
# Backend
cargo check -p nexus
cargo test -p nexus --tests imap   # if/when tests exist

# Frontend
pnpm typecheck
pnpm lint

# Manual
# 1. Open AddAccountModal, choose IMAP, enter Fastmail credentials
# 2. Click "Test connection" — must return true
# 3. Add account, observe initial sync populates messages
# 4. Send a message via SMTP, verify provider sees it
# 5. Make a label change locally → cmd-Z (undo) → verify mutation pipeline works on IMAP-backed account just like Gmail
```

---

## Related docs

- `docs/architecture.md` §Provider adapters
- `docs/ipc-api-reference.md` §IMAP / Outlook (EP-6)
- `docs/known-gaps.md` items 2, 3
