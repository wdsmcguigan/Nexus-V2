use anyhow::{anyhow, Context, Result};
use serde_json::Value as JsonValue;
use tauri::{Emitter, Manager, State};

use crate::db::{queries::HydratePayload, VaultDb};
use crate::gmail::{GmailOAuth, GmailSyncer};
use crate::gmail::types::{OAuthResult, SyncStats};
use crate::AppState;

// ─── Vault / DB commands ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn load_vault_data(
    state: State<'_, AppState>,
    vault_path: String,
) -> std::result::Result<HydratePayload, String> {
    let vault_id = init_vault_inner(&state, &vault_path)
        .await
        .map_err(|e| e.to_string())?;
    let db = state.db.lock().unwrap();
    db.as_ref()
        .ok_or_else(|| "DB not open".to_string())?
        .build_hydrate_payload(&vault_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn apply_mutation(
    state: State<'_, AppState>,
    kind: String,
    payload: JsonValue,
) -> std::result::Result<(), String> {
    let payload_str = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let db = state.db.lock().unwrap();
    db.as_ref()
        .ok_or_else(|| "DB not open".to_string())?
        .apply_mutation(&vault_id, &kind, &payload_str)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_message_body(
    state: State<'_, AppState>,
    body_ref: String,
) -> std::result::Result<Option<String>, String> {
    let db = state.db.lock().unwrap();
    db.as_ref()
        .ok_or_else(|| "DB not open".to_string())?
        .get_body(&body_ref)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_accounts(
    state: State<'_, AppState>,
) -> std::result::Result<Vec<JsonValue>, String> {
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let db = state.db.lock().unwrap();
    db.as_ref()
        .ok_or_else(|| "DB not open".to_string())?
        .load_accounts(&vault_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_vault_path(
    state: State<'_, AppState>,
) -> std::result::Result<Option<String>, String> {
    Ok(state.vault_path.lock().unwrap().clone())
}

#[tauri::command]
pub async fn set_vault_path(
    state: State<'_, AppState>,
    path: String,
) -> std::result::Result<(), String> {
    *state.vault_path.lock().unwrap() = Some(path.clone());
    save_vault_path_to_disk(&path).map_err(|e| e.to_string())
}

// ─── Gmail OAuth + sync commands ──────────────────────────────────────────────

#[tauri::command]
pub async fn start_gmail_oauth(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> std::result::Result<OAuthResult, String> {
    let client_id = std::env::var("NEXUS_GMAIL_CLIENT_ID")
        .map_err(|_| "NEXUS_GMAIL_CLIENT_ID env var not set")?;
    let client_secret = std::env::var("NEXUS_GMAIL_CLIENT_SECRET")
        .map_err(|_| "NEXUS_GMAIL_CLIENT_SECRET env var not set")?;

    let oauth = GmailOAuth::new(client_id, client_secret);
    let (auth_url, code_rx) = oauth.start_flow().await.map_err(|e| e.to_string())?;

    open_browser(&app, &auth_url).map_err(|e| e.to_string())?;

    let code = code_rx
        .await
        .map_err(|_| "OAuth receiver dropped")?
        .map_err(|e| e.to_string())?;

    let token_resp = oauth.exchange_code(&code).await.map_err(|e| e.to_string())?;

    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let account_id = format!("acct-{}", uuid::Uuid::new_v4());
    let expires_at = chrono::Utc::now().timestamp() + token_resp.expires_in;

    {
        let db = state.db.lock().unwrap();
        let db = db.as_ref().ok_or_else(|| "DB not open".to_string())?;
        db.upsert_account(&account_id, &vault_id, "gmail", &token_resp.email, Some(&token_resp.email))
            .map_err(|e| e.to_string())?;
        if let Some(rt) = &token_resp.refresh_token {
            db.save_tokens(&account_id, &token_resp.access_token, rt, expires_at)
                .map_err(|e| e.to_string())?;
        }
    }

    // Kick off initial sync in background — fully async, no DB reference held across await
    let vault_path = state.vault_path.lock().unwrap().clone().unwrap_or_default();
    let access_token = token_resp.access_token.clone();
    let vault_id_clone = vault_id.clone();
    let account_id_clone = account_id.clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        let db_path = std::path::Path::new(&vault_path)
            .join("nexus.db")
            .to_string_lossy()
            .into_owned();

        let syncer = GmailSyncer::new(
            account_id_clone,
            vault_id_clone,
            access_token,
            std::path::Path::new(&vault_path),
        );

        match syncer.initial_sync_with_db(&db_path).await {
            Ok(stats) => {
                log::info!("Initial sync complete: {stats:?}");
                let _ = app_handle.emit("vault:hydrate-needed", ());
            }
            Err(e) => log::error!("Initial sync failed: {e}"),
        }
    });

    Ok(OAuthResult {
        account_id,
        email: token_resp.email,
    })
}

#[tauri::command]
pub async fn sync_gmail_now(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    account_id: String,
) -> std::result::Result<SyncStats, String> {
    let vault_path = state
        .vault_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("No vault loaded")?;
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;

    // Refresh access token (involves holding db lock briefly, then releasing before await)
    let (access_token, refresh_token) = {
        let db = state.db.lock().unwrap();
        let db = db.as_ref().ok_or_else(|| "DB not open".to_string())?;
        let rt = db.get_refresh_token(&account_id).map_err(|e| e.to_string())?
            .ok_or_else(|| "No refresh token stored".to_string())?;
        let at = db.get_access_token(&account_id).map_err(|e| e.to_string())?
            .unwrap_or_default();
        (at, rt)
    };

    let client_id = std::env::var("NEXUS_GMAIL_CLIENT_ID")
        .map_err(|_| "NEXUS_GMAIL_CLIENT_ID not set")?;
    let client_secret = std::env::var("NEXUS_GMAIL_CLIENT_SECRET")
        .map_err(|_| "NEXUS_GMAIL_CLIENT_SECRET not set")?;

    // Refresh token (async — no DB reference held)
    let oauth = GmailOAuth::new(client_id, client_secret);
    let (new_token, expires_in) = oauth
        .refresh_access_token(&refresh_token)
        .await
        .map_err(|e| e.to_string())?;

    let expires_at = chrono::Utc::now().timestamp() + expires_in;
    {
        let db = state.db.lock().unwrap();
        let db = db.as_ref().ok_or_else(|| "DB not open".to_string())?;
        db.save_tokens(&account_id, &new_token, &refresh_token, expires_at)
            .map_err(|e| e.to_string())?;
    }
    drop(access_token); // replaced by new_token

    let db_path = std::path::Path::new(&vault_path)
        .join("nexus.db")
        .to_string_lossy()
        .into_owned();

    let syncer = GmailSyncer::new(
        account_id,
        vault_id,
        new_token,
        std::path::Path::new(&vault_path),
    );

    let stats = syncer
        .incremental_sync_with_db(&db_path)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit("vault:hydrate-needed", ());
    Ok(stats)
}

// ─── Watcher command ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_watcher(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    vault_path: String,
) -> std::result::Result<(), String> {
    crate::watcher::start(app, vault_path, state.inner())
        .map_err(|e| e.to_string())
}

// ─── Send command (Phase 4e stub) ─────────────────────────────────────────────

#[tauri::command]
pub async fn send_message(
    _state: State<'_, AppState>,
    _account_id: String,
    _raw_eml: String,
) -> std::result::Result<(), String> {
    Err("send_message not yet implemented".into())
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

fn get_vault_id(state: &AppState) -> Result<String> {
    let path = state
        .vault_path
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| anyhow!("No vault loaded"))?;
    let base = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("default");
    Ok(format!("vault-{base}"))
}

async fn init_vault_inner(state: &AppState, vault_path: &str) -> Result<String> {
    let db_path = std::path::Path::new(vault_path).join("nexus.db");
    std::fs::create_dir_all(vault_path).context("creating vault directory")?;

    let db = VaultDb::open(db_path.to_str().unwrap_or_default(), "nexus")?;

    let base = std::path::Path::new(vault_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("default");
    let vault_id = format!("vault-{base}");

    db.ensure_vault(&vault_id, vault_path)?;

    *state.db.lock().unwrap() = Some(db);
    *state.vault_path.lock().unwrap() = Some(vault_path.to_string());
    save_vault_path_to_disk(vault_path)?;

    Ok(vault_id)
}

pub async fn init_vault(app: &tauri::AppHandle, vault_path: &str) -> Result<()> {
    let state = app.state::<AppState>();
    init_vault_inner(&state, vault_path).await.map(|_| ())
}

pub fn load_saved_vault_path(_app: &tauri::AppHandle) -> Option<String> {
    dirs::data_local_dir()
        .map(|d| d.join("Nexus").join("vault_path.txt"))
        .and_then(|p| std::fs::read_to_string(p).ok())
}

fn save_vault_path_to_disk(path: &str) -> Result<()> {
    let dir = dirs::data_local_dir()
        .ok_or_else(|| anyhow!("no local data dir"))?
        .join("Nexus");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("vault_path.txt"), path)?;
    Ok(())
}

fn open_browser(app: &tauri::AppHandle, url: &str) -> Result<()> {
    use tauri_plugin_shell::ShellExt;
    app.shell().open(url, None).context("opening system browser")
}
