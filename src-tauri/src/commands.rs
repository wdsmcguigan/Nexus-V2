use anyhow::{anyhow, Context, Result};
use base64::Engine;
use serde::Serialize;
use serde_json::Value as JsonValue;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

use crate::db::{queries::HydratePayload, VaultDb};
use crate::gmail::{GmailOAuth, GmailSyncer};
use crate::gmail::types::{OAuthResult, SyncStats};
use crate::AppState;

// ─── Vault / DB commands ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn load_vault_data(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    vault_path: String,
) -> std::result::Result<HydratePayload, String> {
    let vault_id = init_vault_inner_with_app(&state, &vault_path, &app)
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
    device_id: String,
    lamport: i64,
) -> std::result::Result<(), String> {
    let payload_str = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let db = state.db.lock().unwrap();
    db.as_ref()
        .ok_or_else(|| "DB not open".to_string())?
        .apply_mutation(&vault_id, &kind, &payload_str, &device_id, lamport)
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
    let expanded = expand_tilde(&path);
    *state.vault_path.lock().unwrap() = Some(expanded.clone());
    save_vault_path_to_disk(&expanded).map_err(|e| e.to_string())
}

/// Remove an account from the vault with a caller-chosen data policy.
///
/// `data_action`:
///   "keep"             — revoke OAuth only; messages and labels remain (offline read-only)
///   "delete_messages"  — delete messages + bodies; keep label structure for reconnecting
///   "delete_all"       — delete messages + bodies + all Gmail-synced labels
///
/// After removal, emits `vault:hydrate-needed` so the frontend refreshes.
#[tauri::command]
pub async fn disconnect_account(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    account_id: String,
    data_action: String,
) -> std::result::Result<(), String> {
    let valid = matches!(data_action.as_str(), "keep" | "delete_messages" | "delete_all");
    if !valid {
        return Err(format!("Unknown data_action: {data_action}"));
    }
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    {
        let db = state.db.lock().unwrap();
        let db = db.as_ref().ok_or_else(|| "DB not open".to_string())?;
        db.delete_account(&vault_id, &account_id, &data_action)
            .map_err(|e| e.to_string())?;
    }
    let _ = app.emit("vault:hydrate-needed", ());
    Ok(())
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
            app_handle.clone(),
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
        app.clone(),
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

// ─── Send command ─────────────────────────────────────────────────────────────

/// Send a pre-composed RFC822 message via Gmail.
/// `raw_eml` must be base64url-encoded (no padding).
#[tauri::command]
pub async fn send_message(
    state: State<'_, AppState>,
    account_id: String,
    raw_eml: String,
) -> std::result::Result<String, String> {
    let client_id = std::env::var("NEXUS_GMAIL_CLIENT_ID")
        .map_err(|_| "NEXUS_GMAIL_CLIENT_ID not set")?;
    let client_secret = std::env::var("NEXUS_GMAIL_CLIENT_SECRET")
        .map_err(|_| "NEXUS_GMAIL_CLIENT_SECRET not set")?;

    let refresh_token = {
        let db = state.db.lock().unwrap();
        db.as_ref()
            .ok_or_else(|| "DB not open".to_string())?
            .get_refresh_token(&account_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "No refresh token".to_string())?
    };

    let oauth = GmailOAuth::new(client_id, client_secret);
    let (access_token, expires_in) = oauth
        .refresh_access_token(&refresh_token)
        .await
        .map_err(|e| e.to_string())?;

    let expires_at = chrono::Utc::now().timestamp() + expires_in;
    {
        let db = state.db.lock().unwrap();
        let db = db.as_ref().ok_or_else(|| "DB not open".to_string())?;
        db.save_tokens(&account_id, &access_token, &refresh_token, expires_at)
            .map_err(|e| e.to_string())?;
    }

    let client = reqwest::Client::new();
    let gmail_id = crate::gmail::mutations::send_raw(&client, &access_token, &raw_eml)
        .await
        .map_err(|e| e.to_string())?;

    Ok(gmail_id)
}

// ─── File system helpers ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn save_file_to_downloads(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> std::result::Result<String, String> {
    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?;

    // Avoid clobbering — append (1), (2), etc. if file exists
    let mut dest = downloads_dir.join(&filename);
    if dest.exists() {
        let stem = std::path::Path::new(&filename)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&filename);
        let ext = std::path::Path::new(&filename)
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| format!(".{s}"))
            .unwrap_or_default();
        let mut n = 1u32;
        loop {
            dest = downloads_dir.join(format!("{stem} ({n}){ext}"));
            if !dest.exists() { break; }
            n += 1;
        }
    }

    std::fs::write(&dest, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

// ─── Attachment download ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn download_attachment(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    message_id: String,   // Nexus message ID (e.g. "msg-...")
    attachment_id: String, // Gmail attachment part ID
    filename: String,
) -> std::result::Result<String, String> {
    let client_id = std::env::var("NEXUS_GMAIL_CLIENT_ID")
        .map_err(|_| "NEXUS_GMAIL_CLIENT_ID not set")?;
    let client_secret = std::env::var("NEXUS_GMAIL_CLIENT_SECRET")
        .map_err(|_| "NEXUS_GMAIL_CLIENT_SECRET not set")?;

    let (provider_msg_id, account_id, refresh_token) = {
        let db = state.db.lock().unwrap();
        let db = db.as_ref().ok_or_else(|| "DB not open".to_string())?;
        let (pid, aid) = db.get_provider_id(&message_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Message not found".to_string())?;
        let rt = db.get_refresh_token(&aid)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "No refresh token".to_string())?;
        (pid, aid, rt)
    };

    let oauth = GmailOAuth::new(client_id, client_secret);
    let (access_token, expires_in) = oauth
        .refresh_access_token(&refresh_token)
        .await
        .map_err(|e| e.to_string())?;

    let expires_at = chrono::Utc::now().timestamp() + expires_in;
    {
        let db = state.db.lock().unwrap();
        let db = db.as_ref().ok_or_else(|| "DB not open".to_string())?;
        db.save_tokens(&account_id, &access_token, &refresh_token, expires_at)
            .map_err(|e| e.to_string())?;
    }

    // Fetch the attachment bytes from Gmail
    let client = reqwest::Client::new();
    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}/attachments/{}",
        provider_msg_id, attachment_id
    );
    let resp = client
        .get(&url)
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Gmail API error: {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let data_b64 = body["data"].as_str().ok_or("Missing data field")?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(data_b64)
        .map_err(|e| e.to_string())?;

    // Write to ~/Downloads
    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?;
    let dest = downloads_dir.join(&filename);
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;

    Ok(dest.to_string_lossy().into_owned())
}

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
    let db = state.db.lock().unwrap();
    let db = db.as_ref().ok_or_else(|| "DB not open".to_string())?;

    let configured = db.get_relay_url().map(|u| u.is_some()).unwrap_or(false);
    let last_sync_at = db.get_relay_last_sync_at().ok().flatten();
    let pending_count = db.pending_relay_count().unwrap_or(0);
    let error = state.relay.lock().unwrap().last_error.clone();

    Ok(RelayStatus { configured, last_sync_at, pending_count, error, hosting_port: None })
}

#[tauri::command]
pub async fn set_relay_url(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    url: String,
) -> std::result::Result<(), String> {
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let vault_path = state.vault_path.lock().unwrap().clone().ok_or("No vault")?;

    {
        let db = state.db.lock().unwrap();
        let db = db.as_ref().ok_or_else(|| "DB not open".to_string())?;
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
    let db = state.db.lock().unwrap();
    let db = db.as_ref().ok_or_else(|| "DB not open".to_string())?;
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
        let db = state.db.lock().unwrap();
        let db = db.as_ref().ok_or_else(|| "DB not open".to_string())?;
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
    let vault_path = state.vault_path.lock().unwrap().clone().ok_or("No vault")?;
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
    let vault_path = state.vault_path.lock().unwrap().clone().ok_or("No vault")?;
    let relay_db_path = format!("{vault_path}/nexus.db/.nexus/relay.db");
    crate::relay::server::start(relay_db_path, port)
        .await
        .map_err(|e| e.to_string())
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
    let vault_path = &expand_tilde(vault_path);
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

    // Start outbound mutation drainer (no-op if Gmail creds not set)
    maybe_start_drainer(vault_path);

    Ok(vault_id)
}

async fn init_vault_inner_with_app(state: &AppState, vault_path: &str, app: &tauri::AppHandle) -> Result<String> {
    let vault_id = init_vault_inner(state, vault_path).await?;

    // Start 60s inbound poller if Gmail credentials are configured.
    if let (Ok(client_id), Ok(client_secret)) = (
        std::env::var("NEXUS_GMAIL_CLIENT_ID"),
        std::env::var("NEXUS_GMAIL_CLIENT_SECRET"),
    ) {
        start_inbox_poller(vault_path.to_string(), app.clone(), client_id, client_secret);
    }

    // Start relay sync loop if configured.
    let relay_arc = Arc::clone(&state.relay);
    if let Err(e) = crate::relay::maybe_start_relay(vault_path, &vault_id, app.clone(), relay_arc) {
        log::warn!("Relay init skipped: {e}");
    }

    Ok(vault_id)
}

pub async fn init_vault(app: &tauri::AppHandle, vault_path: &str) -> Result<()> {
    let state = app.state::<AppState>();
    init_vault_inner_with_app(&state, vault_path, app).await.map(|_| ())?;
    // Tell the JS layer to hydrate from SQLite now that the vault is ready.
    // This covers the startup race: JS may have fallen back to fixtures while
    // Rust was still opening the DB — this event corrects it.
    let _ = app.emit("vault:hydrate-needed", ());
    Ok(())
}

/// Start the outbound mutation drainer if Gmail credentials are available.
pub fn maybe_start_drainer(vault_path: &str) {
    let client_id = match std::env::var("NEXUS_GMAIL_CLIENT_ID") {
        Ok(v) => v,
        Err(_) => return, // no credentials, drainer not needed
    };
    let client_secret = match std::env::var("NEXUS_GMAIL_CLIENT_SECRET") {
        Ok(v) => v,
        Err(_) => return,
    };
    let db_path = std::path::Path::new(vault_path)
        .join("nexus.db")
        .to_string_lossy()
        .into_owned();
    crate::gmail::mutations::start_drainer(db_path, client_id, client_secret);
}

/// Start a background 60-second polling loop that incrementally syncs all
/// connected Gmail accounts and emits `vault:hydrate-needed` when new mail arrives.
pub fn start_inbox_poller(
    vault_path: String,
    app: tauri::AppHandle,
    client_id: String,
    client_secret: String,
) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        interval.tick().await; // skip immediate first tick — initial sync already runs on connect

        loop {
            interval.tick().await;
            if let Err(e) = poll_all_accounts(&vault_path, &app, &client_id, &client_secret).await {
                log::warn!("Inbox poll error: {e}");
            }
        }
    });
}

/// One polling pass: sync every Gmail account found in the DB.
async fn poll_all_accounts(
    vault_path: &str,
    app: &tauri::AppHandle,
    client_id: &str,
    client_secret: &str,
) -> Result<()> {
    let db_path = std::path::Path::new(vault_path)
        .join("nexus.db")
        .to_string_lossy()
        .into_owned();

    // Load all Gmail accounts synchronously — DB not held across await.
    let accounts: Vec<(String, String)> = {
        let db = crate::db::VaultDb::open(&db_path, "nexus")?;
        db.all_gmail_accounts()?
    };

    if accounts.is_empty() {
        return Ok(());
    }

    let mut new_count: u32 = 0;

    for (account_id, vault_id) in accounts {
        // Refresh token (async — no DB reference held).
        let access_token = match crate::gmail::mutations::ensure_fresh_token_pub(
            &db_path,
            &account_id,
            client_id,
            client_secret,
        )
        .await
        {
            Ok(t) => t,
            Err(e) => {
                log::warn!("Token refresh failed for {account_id}: {e}");
                continue;
            }
        };

        let syncer = crate::gmail::GmailSyncer::new(
            account_id.clone(),
            vault_id,
            access_token,
            std::path::Path::new(vault_path),
            app.clone(),
        );

        match syncer.incremental_sync_with_db(&db_path).await {
            Ok(stats) => {
                log::info!("Poll: {} new, {} updated for {account_id}", stats.inserted, stats.updated);
                new_count += stats.inserted;
            }
            Err(e) => log::warn!("Incremental sync failed for {account_id}: {e}"),
        }
    }

    // Always re-hydrate after every poll so labels and other metadata stay fresh,
    // even on runs where no new messages arrived (e.g. first poll after restart).
    let _ = app.emit("vault:hydrate-needed", ());
    if new_count > 0 {
        fire_notification(app, new_count);
    }

    Ok(())
}

/// Expand a leading `~` to the user's home directory.
fn expand_tilde(path: &str) -> String {
    if path == "~" {
        return dirs::home_dir()
            .map(|h| h.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().into_owned();
        }
    }
    path.to_string()
}

pub fn load_saved_vault_path(_app: &tauri::AppHandle) -> Option<String> {
    dirs::data_local_dir()
        .map(|d| d.join("Nexus").join("vault_path.txt"))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| expand_tilde(s.trim()))
}

fn save_vault_path_to_disk(path: &str) -> Result<()> {
    let expanded = expand_tilde(path);
    let dir = dirs::data_local_dir()
        .ok_or_else(|| anyhow!("no local data dir"))?
        .join("Nexus");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("vault_path.txt"), &expanded)?;
    Ok(())
}

/// Forget the vault path so the app returns to onboarding on next launch.
/// The vault data on disk is left untouched — this only clears the stored path.
#[tauri::command]
pub async fn reset_vault(state: State<'_, AppState>) -> std::result::Result<(), String> {
    *state.vault_path.lock().unwrap() = None;
    let path = dirs::data_local_dir()
        .ok_or_else(|| "no local data dir".to_string())?
        .join("Nexus")
        .join("vault_path.txt");
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn open_browser(app: &tauri::AppHandle, url: &str) -> Result<()> {
    use tauri_plugin_shell::ShellExt;
    app.shell().open(url, None).context("opening system browser")
}

fn fire_notification(_app: &tauri::AppHandle, _count: u32) {
    // Notifications wired up in Phase 4c when app is properly signed
}
