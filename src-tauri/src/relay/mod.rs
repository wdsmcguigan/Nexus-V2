pub mod client;
pub mod server;

pub use client::{complete_enrollment, start_enrollment, RelaySyncer};

use anyhow::Result;
use std::sync::{Arc, Mutex};

// ─── AppState relay fields ────────────────────────────────────────────────────

/// Relay sync state held in AppState.
pub struct RelayState {
    pub syncer: Option<Arc<RelaySyncer>>,
    pub last_error: Option<String>,
}

impl Default for RelayState {
    fn default() -> Self {
        Self { syncer: None, last_error: None }
    }
}

// ─── Sync loop ────────────────────────────────────────────────────────────────

/// Start a 30-second push/pull loop. Replaces any existing loop (new Arc replaces old).
pub fn start_sync_loop(
    relay_url: String,
    vault_id: String,
    device_id: String,
    vault_key: [u8; 32],
    db_path: String,
    app: tauri::AppHandle,
    relay_state: Arc<Mutex<RelayState>>,
) {
    let syncer = Arc::new(RelaySyncer::new(
        relay_url,
        vault_id,
        device_id,
        vault_key,
    ));
    {
        let mut rs = relay_state.lock().unwrap();
        rs.syncer = Some(Arc::clone(&syncer));
        rs.last_error = None;
    }

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.tick().await; // skip first immediate tick — do an eager sync first

        // Eager first sync
        if let Err(e) = syncer.push_pending(&db_path).await {
            log::warn!("Relay initial push error: {e}");
        }
        if let Err(e) = syncer.pull_remote(&db_path, &app).await {
            log::warn!("Relay initial pull error: {e}");
        }

        loop {
            interval.tick().await;
            if let Err(e) = syncer.push_pending(&db_path).await {
                log::warn!("Relay push error: {e}");
                relay_state.lock().unwrap().last_error = Some(e.to_string());
            } else if let Err(e) = syncer.pull_remote(&db_path, &app).await {
                log::warn!("Relay pull error: {e}");
                relay_state.lock().unwrap().last_error = Some(e.to_string());
            } else {
                relay_state.lock().unwrap().last_error = None;
            }
        }
    });
}

/// Try to load relay config from DB and start the sync loop if configured.
pub fn maybe_start_relay(
    vault_path: &str,
    vault_id: &str,
    app: tauri::AppHandle,
    relay_state: Arc<Mutex<RelayState>>,
) -> Result<()> {
    // VaultDb::open takes the "vault_path" and appends /.nexus/db.sqlite internally.
    // The sync loop passes this same db_path to VaultDb::open each cycle.
    let db_path = format!("{vault_path}/nexus.db");
    let db = crate::db::VaultDb::open(&db_path, "nexus")?;

    let relay_url = match db.get_relay_url()? {
        Some(u) => u,
        None => return Ok(()), // relay not configured
    };

    let vault_key = db.get_or_create_vault_key(vault_id)?;
    let device_id = db.get_or_create_device_id()?;

    log::info!("Starting relay sync loop → {relay_url}");
    start_sync_loop(relay_url, vault_id.to_string(), device_id, vault_key, db_path, app, relay_state);
    Ok(())
}
