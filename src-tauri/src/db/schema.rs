/// DDL executed on every startup (idempotent via IF NOT EXISTS).
pub const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS vaults (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    provider TEXT NOT NULL,  -- 'gmail' | 'jmap' | 'imap'
    email TEXT NOT NULL,
    display_name TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at INTEGER,
    history_id TEXT,          -- Gmail incremental sync cursor
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    disk_slug TEXT NOT NULL,
    color INTEGER,
    icon TEXT,
    system_kind TEXT,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_folders_vault ON folders(vault_id);

CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color INTEGER NOT NULL DEFAULT 1,
    kind TEXT NOT NULL DEFAULT 'user',  -- 'system' | 'user'
    system_kind TEXT,
    parent_id TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    provider_id TEXT   -- Gmail label id (e.g. "INBOX", "Label_123")
);
CREATE INDEX IF NOT EXISTS idx_labels_vault ON labels(vault_id);

CREATE TABLE IF NOT EXISTS statuses (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    is_terminal INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS custom_field_defs (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    default_value TEXT
);

CREATE TABLE IF NOT EXISTS custom_field_options (
    id TEXT PRIMARY KEY,
    field_id TEXT NOT NULL REFERENCES custom_field_defs(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    color INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    folder_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    snippet TEXT NOT NULL DEFAULT '',
    body_ref TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    status_id TEXT,
    priority INTEGER,
    star TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    flag_json TEXT,
    from_addr_json TEXT NOT NULL,
    to_addrs_json TEXT NOT NULL DEFAULT '[]',
    cc_addrs_json TEXT NOT NULL DEFAULT '[]',
    bcc_addrs_json TEXT NOT NULL DEFAULT '[]',
    attachment_refs_json TEXT NOT NULL DEFAULT '[]',
    custom_fields_json TEXT NOT NULL DEFAULT '{}',
    flags_read INTEGER NOT NULL DEFAULT 0,
    flags_answered INTEGER NOT NULL DEFAULT 0,
    flags_draft INTEGER NOT NULL DEFAULT 0,
    flags_flagged INTEGER NOT NULL DEFAULT 0,
    provider_id TEXT,          -- Gmail message id
    provider_account_id TEXT,
    eml_path TEXT              -- absolute path to .eml on disk
);
-- Primary sort for inbox load: vault → folder → time
CREATE INDEX IF NOT EXISTS idx_messages_vault_folder_time ON messages(vault_id, folder_id, received_at DESC);
-- Time-sorted listing across all folders in a vault
CREATE INDEX IF NOT EXISTS idx_messages_vault_time ON messages(vault_id, received_at DESC);
-- Thread grouping
CREATE INDEX IF NOT EXISTS idx_messages_vault_thread ON messages(vault_id, thread_id);
-- Unread count and filter (partial index — only indexes the unread rows)
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(vault_id, received_at DESC) WHERE flags_read = 0;
-- Kanban / status-grouped views
CREATE INDEX IF NOT EXISTS idx_messages_vault_status ON messages(vault_id, status_id);
-- Gmail sync duplicate check (hot path: called on every upsert)
CREATE INDEX IF NOT EXISTS idx_messages_provider ON messages(provider_account_id, provider_id);
-- Account-scoped bulk deletes (disconnect_account)
CREATE INDEX IF NOT EXISTS idx_messages_account ON messages(vault_id, provider_account_id);

CREATE TABLE IF NOT EXISTS message_labels (
    message_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY (message_id, label_id)
);
CREATE INDEX IF NOT EXISTS idx_ml_label ON message_labels(label_id);

CREATE TABLE IF NOT EXISTS message_tags (
    message_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (message_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_mt_tag ON message_tags(tag);

CREATE TABLE IF NOT EXISTS tag_usage (
    vault_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    last_used_at INTEGER NOT NULL,
    PRIMARY KEY (vault_id, tag)
);

CREATE TABLE IF NOT EXISTS message_bodies (
    body_ref TEXT PRIMARY KEY,
    html TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mutations (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    ts INTEGER NOT NULL,
    synced_at INTEGER,         -- NULL = pending Gmail outbound sync
    device_id TEXT NOT NULL DEFAULT '',
    lamport INTEGER NOT NULL DEFAULT 0,
    relay_seq INTEGER          -- NULL = not yet pushed to relay
);
CREATE INDEX IF NOT EXISTS idx_mutations_pending ON mutations(synced_at) WHERE synced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mutations_relay ON mutations(relay_seq) WHERE relay_seq IS NULL;

CREATE TABLE IF NOT EXISTS vault_key (
    vault_id TEXT PRIMARY KEY,
    key_hex  TEXT NOT NULL     -- 32-byte XChaCha20 key, hex-encoded
);

CREATE TABLE IF NOT EXISTS devices (
    device_id   TEXT PRIMARY KEY,
    nickname    TEXT NOT NULL,
    enrolled_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS relay_state (
    relay_url    TEXT PRIMARY KEY,
    last_seq     INTEGER NOT NULL DEFAULT 0,
    last_sync_at INTEGER,
    hosting_port INTEGER        -- non-NULL = this device is hosting relay on this port
);

CREATE TABLE IF NOT EXISTS enroll_sessions (
    code_hash           TEXT PRIMARY KEY,
    vault_id            TEXT NOT NULL,
    encrypted_vault_key BLOB NOT NULL,
    expires_at          INTEGER NOT NULL,
    attempts            INTEGER NOT NULL DEFAULT 0
);

-- FTS5 for subject + notes full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    message_id UNINDEXED,
    subject,
    notes,
    content='messages',
    content_rowid='rowid'
);

CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    name TEXT NOT NULL,
    company TEXT,
    title TEXT,
    website TEXT,
    location TEXT,
    notes TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_vault ON contacts(vault_id);

CREATE TABLE IF NOT EXISTS contact_emails (
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (contact_id, email)
);
CREATE INDEX IF NOT EXISTS idx_contact_emails_email ON contact_emails(email);

CREATE TABLE IF NOT EXISTS contact_phones (
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    label TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (contact_id, phone)
);

CREATE TABLE IF NOT EXISTS saved_views (
    id         TEXT PRIMARY KEY,
    vault_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    filter_json TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_views_vault ON saved_views(vault_id);
"#;

/// EP6 ALTER TABLE statements run individually so "duplicate column name" errors can be ignored.
pub const EP6_ALTER_SQL: &[&str] = &[
    "ALTER TABLE accounts ADD COLUMN sync_cursor TEXT",
    "ALTER TABLE accounts ADD COLUMN settings_json TEXT",
    "ALTER TABLE messages ADD COLUMN list_unsubscribe_json TEXT",
];

/// EP7 (Stage 2) ALTER TABLE statements for per-account user preferences and rich-text signatures.
pub const EP7_ALTER_SQL: &[&str] = &[
    "ALTER TABLE accounts ADD COLUMN signature_html TEXT",
    "ALTER TABLE accounts ADD COLUMN preferences_json TEXT",
];

/// EP8 ALTER TABLE statements — photo_url on accounts and contacts; always_show_images on contacts.
pub const EP8_ALTER_SQL: &[&str] = &[
    "ALTER TABLE accounts ADD COLUMN photo_url TEXT",
    "ALTER TABLE contacts ADD COLUMN photo_url TEXT",
    "ALTER TABLE contacts ADD COLUMN always_show_images INTEGER NOT NULL DEFAULT 0",
];

/// EP7 (Stage 4) idempotent DDL — vacation responder table.
pub const EP7_STAGE4_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS vacation_responders (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0,
    subject TEXT NOT NULL DEFAULT '',
    body_html TEXT NOT NULL DEFAULT '',
    start_date INTEGER,
    end_date INTEGER,
    contacts_only INTEGER NOT NULL DEFAULT 0,
    sent_to_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vacation_responders_account ON vacation_responders(account_id);
"#;

/// Idempotent EP6 DDL executed as a single batch on every startup.
/// Must NOT be split by ';' — trigger bodies contain semicolons inside BEGIN...END.
pub const EP6_IDEMPOTENT_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    name TEXT NOT NULL,
    conditions_json TEXT NOT NULL,
    condition_logic TEXT NOT NULL DEFAULT 'AND',
    actions_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rules_vault ON rules(vault_id, enabled);
CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    name TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    body_html TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_vault ON templates(vault_id);
CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, message_id, subject, notes)
    VALUES (new.rowid, new.id, new.subject, COALESCE(new.notes, ''));
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_ad BEFORE DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, message_id, subject, notes)
    VALUES ('delete', old.rowid, old.id, old.subject, COALESCE(old.notes, ''));
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, message_id, subject, notes)
    VALUES ('delete', old.rowid, old.id, old.subject, COALESCE(old.notes, ''));
  INSERT INTO messages_fts(rowid, message_id, subject, notes)
    VALUES (new.rowid, new.id, new.subject, COALESCE(new.notes, ''));
END;
"#;
