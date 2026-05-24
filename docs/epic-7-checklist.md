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

---

## EP-7-E: Settings Parity

Shipped: 2026-05-24

### E1 — Preferences Expansion

- [x] `src/lib/appPreferences.ts` — new app-global prefs module (`nexus_app_prefs_v1` localStorage key)
- [x] `AppPreferences` interface: `notificationsEnabled`, `undoSendSeconds`, `markReadAfterMs`, `buttonLabels`
- [x] `getAppPreferences()` / `saveAppPreferences()` helpers (synchronous, no Zustand)
- [x] `showSnippets: boolean` added to `WorkspaceSnapshot` + `makeDefaultWorkspace()`
- [x] `showSnippets` / `setShowSnippets` added to `WorkspaceState` (Zustand)
- [x] `threadedView` toggle, `showSnippets` toggle, button labels radio in Preferences tab
- [x] Undo-send duration control in Preferences tab (reads `AppPreferences.undoSendSeconds`)
- [x] Mark-as-read timing control in Preferences tab (wired to `EmailViewerPanel`)
- [x] Desktop notifications toggle in Preferences tab
- [x] `EmailComposerPanel.tsx` reads `undoSendSeconds` from `AppPreferences` instead of hardcoded `5`
- [x] `EmailViewerPanel.tsx` delays `markRead` call by `markReadAfterMs` (or skips if `-1`)
- [x] `EmailRow.tsx` hides snippet span when `showSnippets` is false

### E2 — Account-Level Settings + Signature Upgrade

- [x] `signature_html TEXT` column added to `accounts` table (ALTER TABLE migration)
- [x] `preferences_json TEXT` column added to `accounts` table (ALTER TABLE migration)
- [x] `AccountPreferences` type in `src/data/types.ts`: `defaultReplyAll`, `externalImages`
- [x] `get_account_preferences` / `save_account_preferences` IPC commands in `commands.rs`
- [x] `get_account_signature` / `save_account_signature` IPC commands in `commands.rs`
- [x] All four commands registered in `lib.rs` `invoke_handler!`
- [x] Typed wrappers in `src/storage/tauri.ts`
- [x] "Default reply" (Reply / Reply All) control per account in Settings > Accounts
- [x] "External images" (Always / Ask) control per account in Settings > Accounts
- [x] Signature editor upgraded from `<textarea>` to Tiptap rich-text editor, persisted via IPC
- [x] `EmailComposerPanel.tsx` reads `defaultReplyAll` from account preferences at open time
- [x] `EmailViewerPanel.tsx` blocks external images with "Load images" banner when `externalImages: "ask"`

### E3 — Stars Management UI

- [x] `STAR_ENTRIES` array and `StarEntry` interface exported from `src/components/inspector/StarPalette.tsx`
- [x] `activeStars: StarStyle[]` added to `WorkspaceSnapshot` + `makeDefaultWorkspace()` (default: `[]` = all 12)
- [x] `activeStars` / `setActiveStars` / `cycleStar` added to `WorkspaceState` (Zustand)
- [x] `cycleStar(messageId)` advances through `activeStars` list (or all 12 if empty), clears at end
- [x] Stars section in Settings > Preferences: click-to-toggle between "In use" and "Not in use"
- [x] Preset buttons: "1 star" (yellow only), "4 stars", "All"
- [x] `EmailListPanel.tsx` star keyboard shortcut (`s`) calls `cycleStar` instead of boolean toggle
- [x] `onToggleStar` callback updated to use `cycleStar`

### E4 — Vacation Responder

- [x] `vacation_responders` table added via `EP7_STAGE4_SQL` in `schema.rs` (`CREATE TABLE IF NOT EXISTS`)
- [x] `run_ep7_migrations()` in `mod.rs` executes `EP7_STAGE4_SQL`
- [x] `VacationResponder` interface in `src/storage/tauri.ts`
- [x] `get_vacation_responder` / `save_vacation_responder` / `delete_vacation_responder` queries in `queries.rs`
- [x] Three IPC commands implemented in `commands.rs` and registered in `lib.rs`
- [x] Typed wrappers in `src/storage/tauri.ts`
- [x] `VacationResponderSection` component in `SettingsPanel.tsx`: enable toggle, subject, Tiptap body, date pickers, contacts-only checkbox
- [x] Vacation responder section rendered per account in Settings > Accounts tab

### E5 — Keyboard Shortcut Customization

- [x] `src/lib/shortcuts.ts` — new canonical shortcut registry (10 rebindable actions)
- [x] `ShortcutAction` type, `ShortcutDef` interface, `DEFAULT_SHORTCUTS` array
- [x] `effectiveKey(action, keyBindings)` — returns custom or default key for an action
- [x] `actionForKey(key, keyBindings)` — maps a keypress to an action (custom bindings take priority)
- [x] `keyBindings: Partial<Record<ShortcutAction, string>>` added to `WorkspaceSnapshot` + `makeDefaultWorkspace()`
- [x] `keyBindings` / `setKeyBinding` / `clearKeyBinding` / `resetAllKeyBindings` added to `WorkspaceState`
- [x] "Shortcuts" tab added to Settings panel with click-to-rebind UI per action
- [x] Per-row "×" button to clear custom binding (restores default)
- [x] "Reset all to defaults" button at top of Shortcuts tab
- [x] `EmailListPanel.tsx` keyboard handler calls `actionForKey()` to resolve actions from keypresses
- [x] `ShortcutHelpModal.tsx` reads `keyBindings` from workspace state and shows effective keys
