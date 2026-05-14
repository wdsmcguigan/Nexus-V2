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
    synced_at INTEGER         -- NULL = pending outbound sync
);
CREATE INDEX IF NOT EXISTS idx_mutations_pending ON mutations(synced_at) WHERE synced_at IS NULL;

-- FTS5 for subject + notes full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    message_id UNINDEXED,
    subject,
    notes,
    content='messages',
    content_rowid='rowid'
);
"#;
