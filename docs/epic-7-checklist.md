# EP-7 Checklist — Native FTS5, Rules Engine & Quick Wins

Shipped: 2026-05-19

## EP-7-A: Native FTS5

- [x] `messages_fts` FTS5 virtual table triggers (INSERT/UPDATE/DELETE) in MIGRATION_SQL
- [x] One-time backfill: `INSERT OR IGNORE INTO messages_fts … SELECT … FROM messages`
- [x] `search_fts5()` in `queries.rs`: field-prefix operators (`from:`, `to:`, `tag:`, `label:`, `has:attachment`) + bare FTS5 MATCH + LIKE fallback
- [x] `search_messages` IPC command in `commands.rs` + `lib.rs`
- [x] `searchMessages()` typed wrapper in `tauri.ts`
- [x] `fts.ts` routes through Tauri IPC in native mode; keeps MiniSearch for web dev

## EP-7-B: Rules Engine

- [x] `Rule`, `RuleCondition`, `RuleAction`, `RuleConditionField`, `RuleConditionOp`, `RuleActionKind` types in `types.ts`
- [x] `CREATE_RULE`, `UPDATE_RULE`, `DELETE_RULE`, `REORDER_RULES` added to `MutationKind`
- [x] `rules` DB table in MIGRATION_SQL
- [x] `get_rules()`, `upsert_rule()`, `delete_rule()` in `queries.rs`
- [x] `apply_rules_to_message()` in `queries.rs`: AND/OR logic, all 9 action kinds, vault-scoped writes
- [x] Called from `upsert_message_from_gmail()` on new message receipt
- [x] `get_rules`, `save_rule`, `delete_rule` IPC commands
- [x] Typed wrappers in `tauri.ts`
- [x] Rules added to `HydratePayload` (Rust struct + TS interface)
- [x] `localStore.rules` map + `putRule`/`deleteRule` CRUD in `local.ts`
- [x] `applyMutation()` handles `CREATE_RULE`, `UPDATE_RULE`, `DELETE_RULE`
- [x] `saveRuleMutation()` / `deleteRuleMutation()` helpers in `mutations.ts`
- [x] `RulesSettings.tsx` — rule list with enable toggle
- [x] `RuleEditorDialog.tsx` — condition + action builder
- [x] Wired into `SettingsPanel.tsx` as "Rules" tab

## EP-7-C: Templates

- [x] `Template` type in `types.ts`
- [x] `CREATE_TEMPLATE`, `UPDATE_TEMPLATE`, `DELETE_TEMPLATE` added to `MutationKind`
- [x] `templates` DB table in MIGRATION_SQL
- [x] `get_templates()`, `upsert_template()`, `delete_template()` in `queries.rs`
- [x] `get_templates`, `save_template`, `delete_template` IPC commands
- [x] Typed wrappers in `tauri.ts`
- [x] Templates added to `HydratePayload`
- [x] `localStore.templates` map + `putTemplate`/`deleteTemplate` CRUD in `local.ts`
- [x] `applyMutation()` handles `CREATE_TEMPLATE`, `UPDATE_TEMPLATE`, `DELETE_TEMPLATE`
- [x] `saveTemplateMutation()` / `deleteTemplateMutation()` helpers in `mutations.ts`
- [x] `TemplatesSettings.tsx` — template CRUD list + inline editor dialog
- [x] Wired into `SettingsPanel.tsx` as "Templates" tab
- [x] Composer toolbar "Insert template" button → popover → applies subject + DOMPurify-sanitized body

## EP-7-D: Quick Wins

### D1 — System Notifications
- [x] `tauri-plugin-notification = "2"` in `Cargo.toml`
- [x] `.plugin(tauri_plugin_notification::init())` in `lib.rs`
- [x] `fire_notification()` calls `app.notification().builder()…show()` on new inbound messages

### D2 — List-Unsubscribe
- [x] `list_unsubscribe_json` column added to `messages` table
- [x] `list_unsubscribe` / `list_unsubscribe_post` fields on `ParsedMessage` (gmail/types.rs)
- [x] Headers extracted in `parse_gmail_message()` (gmail/sync.rs) and `ImapProvider` (providers/imap.rs)
- [x] Stored in `upsert_message_from_gmail()` as JSON `{ link, post }`
- [x] `listUnsubscribeJson?` field on `Message` in `types.ts`
- [x] "Unsubscribe" button in `EmailViewerPanel.tsx`: RFC 8058 POST (Tauri) or URL open (web)
- [x] `send_unsubscribe` IPC command with SSRF guard (HTTPS-only, blocks RFC-1918)
- [x] URL safety validation on frontend before `window.open`

### D3 — Multi-account From selector
- [x] `fromAccountId` state in `EmailComposerPanel.tsx`
- [x] Single-account: plain text; multi-account: `<select>` dropdown
- [x] `doActualSend` uses selected account instead of hardcoded first Gmail account

### D4 — Security hardening (audit findings)
- [x] DOMPurify on `marked.parse()` output in `NoteEditor.tsx`
- [x] DOMPurify on `tmpl.bodyHtml` before `editor.commands.setContent()`
- [x] `validate_unsubscribe_url()` SSRF guard in `commands.rs`
- [x] Vault-scoped writes in `apply_rules_to_message()` (`AND vault_id = ?`)
- [x] Poisoned mutex handling: all `state.db.lock().unwrap()` → `.map_err()` in `commands.rs`
- [x] `search_messages` uses `state.db` (not fresh `VaultDb::open` with hardcoded key)
- [x] Relay server: `.lock().unwrap()` → `lock_db()` helper in `routes.rs`
- [x] Relay server: enrollment `expires_at` computed server-side (10 min fixed TTL)
- [x] Relay server: `DefaultBodyLimit::max(1 MB)` request cap
- [x] Relay server: `UNIQUE INDEX` on `relay_mutations(vault_id, device_id, lamport)`
