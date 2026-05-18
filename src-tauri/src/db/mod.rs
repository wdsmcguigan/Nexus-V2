pub mod queries;
pub mod schema;

use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::Path;

/// Encrypted SQLite vault database.
pub struct VaultDb {
    pub conn: Connection,
}

impl VaultDb {
    /// Open (or create) the encrypted vault DB at `<vault_path>/.nexus/db.sqlite`.
    pub fn open(vault_path: &str, key: &str) -> Result<Self> {
        let db_dir = Path::new(vault_path).join(".nexus");
        std::fs::create_dir_all(&db_dir)
            .with_context(|| format!("creating .nexus dir at {}", db_dir.display()))?;

        let db_path = db_dir.join("db.sqlite");
        let conn = Connection::open(&db_path)
            .with_context(|| format!("opening DB at {}", db_path.display()))?;

        // Set SQLCipher encryption key
        conn.execute_batch(&format!("PRAGMA key = '{}';", key.replace('\'', "''")))
            .context("setting SQLCipher key")?;

        // WAL mode for concurrent reads
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .context("enabling WAL mode")?;

        let db = Self { conn };
        db.run_migrations()?;
        Ok(db)
    }

    fn run_migrations(&self) -> Result<()> {
        self.conn
            .execute_batch(schema::SCHEMA_SQL)
            .context("running schema DDL")?;
        self.run_column_migrations()
            .context("running column migrations")?;
        Ok(())
    }

    /// Safely add new columns to existing tables (ignores "duplicate column" errors).
    fn run_column_migrations(&self) -> Result<()> {
        let alters = [
            "ALTER TABLE mutations ADD COLUMN device_id TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE mutations ADD COLUMN lamport INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE mutations ADD COLUMN relay_seq INTEGER",
        ];
        for sql in &alters {
            let _ = self.conn.execute_batch(sql);
        }
        Ok(())
    }
}
