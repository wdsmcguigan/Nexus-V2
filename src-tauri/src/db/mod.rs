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
        self.run_ep6_migrations()
            .context("running EP6 column migrations")?;
        self.run_ep7_migrations()
            .context("running EP7 column migrations")?;
        self.run_ep8_migrations()
            .context("running EP8 column migrations")?;
        self.run_ep9_migrations()
            .context("running EP9 column migrations")?;
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
        // One-time fix: received_at was stored in seconds; TypeScript expects ms.
        // Values < 1e10 are seconds-era rows; values >= 1e10 are already ms.
        let _ = self.conn.execute_batch(
            "UPDATE messages SET received_at = received_at * 1000 WHERE received_at < 10000000000;"
        );
        // One-time fix: bodies stored as <pre>plain text</pre> due to base64 padding bug.
        // Clearing them forces a fresh fetch with the fixed decoder on next view.
        let _ = self.conn.execute_batch(
            "DELETE FROM message_bodies WHERE html LIKE '<pre>%';"
        );
        Ok(())
    }

    /// Apply EP6 migrations (sync_cursor, settings_json columns on accounts).
    fn run_ep6_migrations(&self) -> Result<()> {
        for &sql in schema::EP6_ALTER_SQL {
            if let Err(e) = self.conn.execute_batch(sql) {
                if !e.to_string().contains("duplicate column name") {
                    return Err(e.into());
                }
            }
        }
        self.conn
            .execute_batch(schema::EP6_IDEMPOTENT_SQL)
            .context("EP6 idempotent DDL")?;
        // Backfill FTS index from pre-existing messages. FTS5 content tables do not support
        // INSERT OR IGNORE, so we use the built-in 'rebuild' command instead. Non-fatal.
        let _ = self.conn.execute_batch(
            "INSERT INTO messages_fts(messages_fts) VALUES('rebuild');",
        );
        Ok(())
    }

    /// Apply EP7 migrations (signature_html, preferences_json columns on accounts;
    /// vacation_responders table).
    fn run_ep7_migrations(&self) -> Result<()> {
        for &sql in schema::EP7_ALTER_SQL {
            if let Err(e) = self.conn.execute_batch(sql) {
                if !e.to_string().contains("duplicate column name") {
                    return Err(e.into());
                }
            }
        }
        self.conn
            .execute_batch(schema::EP7_STAGE4_SQL)
            .context("EP7 stage-4 DDL")?;
        Ok(())
    }

    /// Apply EP8 migrations (photo_url on accounts and contacts).
    fn run_ep8_migrations(&self) -> Result<()> {
        for &sql in schema::EP8_ALTER_SQL {
            if let Err(e) = self.conn.execute_batch(sql) {
                if !e.to_string().contains("duplicate column name") {
                    return Err(e.into());
                }
            }
        }
        Ok(())
    }

    /// Apply EP9 migrations (CRM fields on contacts; contact_groups, contacts_sync, calendar tables).
    fn run_ep9_migrations(&self) -> Result<()> {
        for &sql in schema::EP9_ALTER_SQL {
            if let Err(e) = self.conn.execute_batch(sql) {
                if !e.to_string().contains("duplicate column name") {
                    return Err(e.into());
                }
            }
        }
        self.conn
            .execute_batch(schema::EP9_IDEMPOTENT_SQL)
            .context("EP9 idempotent DDL")?;
        Ok(())
    }
}
