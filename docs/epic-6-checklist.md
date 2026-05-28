# Epic 6 — Multi-Provider Support

**Status: ✅ Shipped (partial)** — Gmail, IMAP, and Outlook are usable; JMAP and real IMAP IDLE are deferred. See `docs/known-gaps.md` items 2 + 3 for the explicit gaps.

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
| **JMAP** | ❌ **Stub only** — every method returns `Err(anyhow!("JMAP coming in EP7"))` | `src-tauri/src/providers/jmap.rs` (46 lines) |

### Provider abstraction

- `src-tauri/src/providers/mod.rs` defines the `MailProvider` trait: `fetch_labels`, `fetch_initial`, `fetch_incremental`, `fetch_message_body`, `apply_mutation`.
- All four providers above implement the trait. Gmail and IMAP/Outlook implementations are real; JMAP is a placeholder.

### IPC commands (5)

| Command | Purpose |
|---|---|
| `discover_imap_settings(email)` | Mozilla autoconfig + DNS SRV discovery for IMAP/SMTP settings. |
| `test_imap_connection(host, port, security, username, password)` | Validates creds before saving. |
| `add_imap_account(ImapAccountInput)` | Persists creds, schedules first sync. |
| `sync_account_now(accountId)` | Manual sync for IMAP and Outlook (Gmail uses `sync_gmail_now`). |
| `start_outlook_oauth()` | Microsoft v2.0 OAuth flow → IMAP-style storage. |

All five are registered in `src-tauri/src/lib.rs:invoke_handler!` and wrapped in `src/storage/tauri.ts`.

### UI

- `src/components/onboarding/AddAccountModal.tsx` — provider chooser with Gmail / Outlook / IMAP / JMAP (latter disabled).
- IMAP-specific form for host/port/security/username/password.
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

## What did **not** ship (still partial)

| # | Item | Severity | File |
|---|---|---|---|
| 1 | **JMAP provider** | 🟡 Stubbed | `providers/jmap.rs` |
| 2 | **Real IMAP IDLE** | 🟡 Stubbed | `providers/imap_idle.rs` — function is `start_idle_watcher` but body is a 30s polling loop. The UI does not surface "real-time" claims so this is mostly an internal misnomer, but anyone implementing push notifications based on the file name will be misled. |
| 3 | **CalDAV / CardDAV** | 🟠 Out of scope | Not started |

See `docs/known-gaps.md` for the canonical status of each.

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
