use anyhow::{Context, Result};
use rusqlite::Connection;

pub struct RelayDb {
    pub conn: Connection,
}

impl RelayDb {
    pub fn open(path: &str) -> Result<Self> {
        let conn = Connection::open(path).with_context(|| format!("opening {path}"))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS relay_mutations (
                 seq         INTEGER PRIMARY KEY AUTOINCREMENT,
                 vault_id    TEXT NOT NULL,
                 device_id   TEXT NOT NULL,
                 lamport     INTEGER NOT NULL,
                 ciphertext  BLOB NOT NULL,
                 received_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_rm_vault_seq ON relay_mutations(vault_id, seq);
             CREATE TABLE IF NOT EXISTS enroll_sessions (
                 code_hash           TEXT PRIMARY KEY,
                 vault_id            TEXT NOT NULL,
                 encrypted_vault_key BLOB NOT NULL,
                 expires_at          INTEGER NOT NULL,
                 attempts            INTEGER NOT NULL DEFAULT 0
             );",
        )
        .context("relay schema")?;
        Ok(Self { conn })
    }
}
