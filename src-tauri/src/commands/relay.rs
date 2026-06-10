//! EP-5 relay commands: status, URL config, vault-key export, device
//! enrollment (start/complete), and starting the embedded relay host.
//!
//! Extracted from the former monolithic commands.rs. The relay protocol lives
//! in crate::relay; these are the thin IPC handlers over it.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::AppState;

use super::get_vault_id;

// ─── EP-5 Relay commands ──────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct RelayStatus {
    configured: bool,
    last_sync_at: Option<i64>,
    pending_count: usize,
    error: Option<String>,
    hosting_port: Option<u16>,
}

#[tauri::command]
pub async fn get_relay_status(state: State<'_, AppState>) -> std::result::Result<RelayStatus, String> {
    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;

    let configured = db.get_relay_url().map(|u| u.is_some()).unwrap_or(false);
    let last_sync_at = db.get_relay_last_sync_at().ok().flatten();
    let pending_count = db.pending_relay_count().unwrap_or(0);
    let error = state.relay.lock().map_err(|_| "relay lock poisoned".to_string())?.last_error.clone();

    Ok(RelayStatus { configured, last_sync_at, pending_count, error, hosting_port: None })
}

#[tauri::command]
pub async fn set_relay_url(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    url: String,
) -> std::result::Result<(), String> {
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let vault_path = state.vault_path.lock().map_err(|_| "vault_path lock poisoned".to_string())?.clone().ok_or("No vault")?;

    {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
        db.set_relay_url(&url).map_err(|e| e.to_string())?;
    }

    let relay_arc = Arc::clone(&state.relay);
    if let Err(e) = crate::relay::maybe_start_relay(&vault_path, &vault_id, app, relay_arc) {
        log::warn!("Relay restart failed: {e}");
    }
    Ok(())
}

#[tauri::command]
pub async fn get_vault_key_hex(state: State<'_, AppState>) -> std::result::Result<String, String> {
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
    db.get_vault_key_hex(&vault_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No vault key — connect an account first".to_string())
}

#[derive(Serialize)]
pub struct EnrollmentSessionResp {
    code: String,
    expires_at: i64,
}

#[tauri::command]
pub async fn start_enrollment_session(
    state: State<'_, AppState>,
) -> std::result::Result<EnrollmentSessionResp, String> {
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;

    let (relay_url, vault_key) = {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
        let url = db.get_relay_url().map_err(|e| e.to_string())?
            .ok_or_else(|| "Relay URL not configured".to_string())?;
        let key = db.get_or_create_vault_key(&vault_id).map_err(|e| e.to_string())?;
        (url, key)
    };

    let session = crate::relay::start_enrollment(&relay_url, &vault_id, &vault_key)
        .await
        .map_err(|e| e.to_string())?;

    Ok(EnrollmentSessionResp { code: session.code, expires_at: session.expires_at })
}

#[tauri::command]
pub async fn complete_enrollment(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    relay_url: String,
    code: String,
) -> std::result::Result<(), String> {
    let vault_path = state.vault_path.lock().map_err(|_| "vault_path lock poisoned".to_string())?.clone().ok_or("No vault")?;
    let db_path = format!("{vault_path}/nexus.db");

    let vault_id = crate::relay::complete_enrollment(&db_path, &relay_url, &code)
        .await
        .map_err(|e| e.to_string())?;

    let relay_arc = Arc::clone(&state.relay);
    if let Err(e) = crate::relay::maybe_start_relay(&vault_path, &vault_id, app, relay_arc) {
        log::warn!("Relay start after enrollment failed: {e}");
    }
    Ok(())
}

#[tauri::command]
pub async fn start_relay_hosting(
    state: State<'_, AppState>,
    port: u16,
) -> std::result::Result<u16, String> {
    let vault_path = state.vault_path.lock().map_err(|_| "vault_path lock poisoned".to_string())?.clone().ok_or("No vault")?;
    let relay_db_path = format!("{vault_path}/nexus.db/.nexus/relay.db");
    crate::relay::server::start(relay_db_path, port)
        .await
        .map_err(|e| e.to_string())
}

