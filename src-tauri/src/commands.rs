use anyhow::{anyhow, Context, Result};
use base64::Engine;
use serde::Serialize;
use serde_json::Value as JsonValue;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

use crate::db::{queries::HydratePayload, VaultDb};
use crate::gmail::{GmailOAuth, GmailSyncer};
use crate::gmail::types::{OAuthResult, SyncStats};
use crate::providers::autodiscovery::DiscoveryResult;
use crate::providers::imap::{ImapConfig, ImapProvider, Security};
use crate::AppState;

// ─── Vault / DB commands ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn load_vault_data(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    vault_path: String,
) -> std::result::Result<HydratePayload, String> {
    // If the setup hook already opened this vault, skip re-initialization to avoid
    // spawning duplicate background pollers and contending on the DB lock.
    let already_open = state
        .db
        .lock()
        .map_err(|_| "vault lock poisoned".to_string())?
        .is_some();

    let vault_id = if already_open {
        get_vault_id(&state).map_err(|e| e.to_string())?
    } else {
        init_vault_inner_with_app(&state, &vault_path, &app)
            .await
            .map_err(|e| e.to_string())?
    };

    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    db_guard
        .as_ref()
        .ok_or_else(|| "DB not open".to_string())?
        .build_hydrate_payload(&vault_id)
        .map_err(|e| e.to_string())
}

/// Read the client mode from the vault's .nexus-mode file.
/// Returns "traditional" if the file is absent or unreadable (safe default).
pub fn read_client_mode(vault_path: &str) -> String {
    let mode = std::fs::read_to_string(std::path::Path::new(vault_path).join(".nexus-mode"))
        .unwrap_or_default();
    let mode = mode.trim();
    if mode == "local-first" { "local-first".to_string() } else { "traditional".to_string() }
}

#[tauri::command]
pub async fn get_client_mode(state: State<'_, AppState>) -> std::result::Result<String, String> {
    Ok(state.client_mode.lock().map_err(|_| "lock poisoned".to_string())?.clone())
}

#[tauri::command]
pub async fn set_client_mode(
    mode: String,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    if mode != "traditional" && mode != "local-first" {
        return Err(format!("Invalid client mode: {mode}"));
    }
    let vault_path = state.vault_path.lock().map_err(|_| "lock poisoned".to_string())?.clone().unwrap_or_default();
    if !vault_path.is_empty() {
        let mode_file = std::path::Path::new(&vault_path).join(".nexus-mode");
        std::fs::write(&mode_file, &mode).map_err(|e| e.to_string())?;
        // In local-first mode, ensure the mail directory exists.
        if mode == "local-first" {
            let _ = std::fs::create_dir_all(std::path::Path::new(&vault_path).join("mail"));
        }
    }
    *state.client_mode.lock().map_err(|_| "lock poisoned".to_string())? = mode;
    Ok(())
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
    let client_mode = state.client_mode.lock().map_err(|_| "lock poisoned".to_string())?.clone();
    let vault_path = state.vault_path.lock().map_err(|_| "lock poisoned".to_string())?.clone().unwrap_or_default();
    let local_first = client_mode == "local-first" && !vault_path.is_empty();

    // Pre-mutation reads needed for filesystem side-effects.
    let pre_folder_disk_path: Option<String> = if local_first && (kind == "RENAME_FOLDER" || kind == "RECOLOR_FOLDER") {
        let folder_id = payload["folderId"].as_str().unwrap_or_default().to_string();
        let guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        guard.as_ref().map(|db| db.folder_disk_path(&folder_id))
    } else {
        None
    };
    let pre_eml_path: Option<String> = if local_first && kind == "MOVE_TO_FOLDER" {
        let msg_id = payload["messageId"].as_str().unwrap_or_default().to_string();
        let guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        guard.as_ref().and_then(|db| {
            db.conn.query_row(
                "SELECT eml_path FROM messages WHERE id = ?1",
                rusqlite::params![msg_id.as_str()],
                |r| r.get::<_, Option<String>>(0),
            ).ok().flatten()
        })
    } else {
        None
    };

    // Apply DB mutation.
    {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        db_guard
            .as_ref()
            .ok_or_else(|| "DB not open".to_string())?
            .apply_mutation(&vault_id, &kind, &payload_str, &device_id, lamport)
            .map_err(|e| e.to_string())?;
    }

    // Local-first filesystem side-effects (non-fatal — log only).
    if local_first {
        let mail_root = std::path::Path::new(&vault_path).join("mail");
        if let Err(e) = apply_local_first_fs(
            &state, &mail_root, &kind, &payload,
            pre_folder_disk_path.as_deref(), pre_eml_path.as_deref(),
        ) {
            log::warn!("local-first FS effect failed ({kind}): {e}");
        }
    }

    Ok(())
}

/// Execute filesystem side-effects for mutations in local-first mode.
fn apply_local_first_fs(
    state: &AppState,
    mail_root: &std::path::Path,
    kind: &str,
    payload: &JsonValue,
    pre_folder_disk_path: Option<&str>,
    pre_eml_path: Option<&str>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match kind {
        "CREATE_FOLDER" => {
            let disk_path = payload["diskPath"].as_str().unwrap_or_default();
            if !disk_path.is_empty() {
                std::fs::create_dir_all(mail_root.join(disk_path))?;
            }
        }
        "RENAME_FOLDER" => {
            if let Some(old_path) = pre_folder_disk_path {
                let folder_id = payload["folderId"].as_str().unwrap_or_default();
                let new_path = {
                    let guard = state.db.lock().map_err(|_| "lock poisoned")?;
                    guard.as_ref().map(|db| db.folder_disk_path(folder_id)).unwrap_or_default()
                };
                if !new_path.is_empty() && old_path != new_path {
                    let old_dir = mail_root.join(old_path);
                    let new_dir = mail_root.join(&new_path);
                    if old_dir.exists() {
                        std::fs::rename(&old_dir, &new_dir)?;
                        // Update eml_paths in DB for all messages that had the old prefix.
                        let old_prefix = old_dir.to_string_lossy();
                        let new_prefix = new_dir.to_string_lossy();
                        if let Ok(guard) = state.db.lock() {
                            if let Some(db) = guard.as_ref() {
                                let _ = db.conn.execute(
                                    "UPDATE messages SET eml_path = ?1 || SUBSTR(eml_path, LENGTH(?2) + 1) \
                                     WHERE eml_path LIKE ?2 || '%'",
                                    rusqlite::params![new_prefix.as_ref(), old_prefix.as_ref()],
                                );
                            }
                        }
                    } else {
                        std::fs::create_dir_all(&new_dir)?;
                    }
                }
            }
        }
        "MOVE_TO_FOLDER" => {
            if let Some(old_eml) = pre_eml_path {
                let msg_id = payload["messageId"].as_str().unwrap_or_default();
                let folder_id = payload["folderId"].as_str().unwrap_or_default();
                let new_folder_path = {
                    let guard = state.db.lock().map_err(|_| "lock poisoned")?;
                    guard.as_ref().map(|db| db.folder_disk_path(folder_id)).unwrap_or_default()
                };
                if !new_folder_path.is_empty() {
                    let new_dir = mail_root.join(&new_folder_path);
                    std::fs::create_dir_all(&new_dir)?;
                    if let Some(fname) = std::path::Path::new(old_eml).file_name() {
                        let new_eml_path = new_dir.join(fname);
                        if std::path::Path::new(old_eml).exists() {
                            std::fs::rename(old_eml, &new_eml_path)?;
                        }
                        if let Ok(guard) = state.db.lock() {
                            if let Some(db) = guard.as_ref() {
                                let _ = db.conn.execute(
                                    "UPDATE messages SET eml_path = ?1 WHERE id = ?2",
                                    rusqlite::params![new_eml_path.to_str().unwrap_or_default(), msg_id],
                                );
                            }
                        }
                    }
                }
            }
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub async fn get_message_body(
    state: State<'_, AppState>,
    body_ref: String,
) -> std::result::Result<Option<String>, String> {
    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    db_guard
        .as_ref()
        .ok_or_else(|| "DB not open".to_string())?
        .get_body(&body_ref)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_accounts(
    state: State<'_, AppState>,
) -> std::result::Result<Vec<JsonValue>, String> {
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    db_guard
        .as_ref()
        .ok_or_else(|| "DB not open".to_string())?
        .load_accounts(&vault_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_vault_path(
    state: State<'_, AppState>,
) -> std::result::Result<Option<String>, String> {
    Ok(state.vault_path.lock().map_err(|_| "vault_path lock poisoned".to_string())?.clone())
}

#[tauri::command]
pub async fn set_vault_path(
    state: State<'_, AppState>,
    path: String,
) -> std::result::Result<(), String> {
    let expanded = expand_tilde(&path);
    *state.vault_path.lock().map_err(|_| "vault_path lock poisoned".to_string())? = Some(expanded.clone());
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
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
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
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
        db.upsert_account(&account_id, &vault_id, "gmail", &token_resp.email, Some(&token_resp.email))
            .map_err(|e| e.to_string())?;
        if let Some(rt) = &token_resp.refresh_token {
            db.save_tokens(&account_id, &token_resp.access_token, rt, expires_at)
                .map_err(|e| e.to_string())?;
        }
    }

    // Kick off initial sync in background — fully async, no DB reference held across await
    let vault_path = state.vault_path.lock().map_err(|_| "vault_path lock poisoned".to_string())?.clone().unwrap_or_default();
    let client_mode = state.client_mode.lock().map_err(|_| "client_mode lock poisoned".to_string())?.clone();
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
            client_mode,
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

/// Get a valid access token for an account, refreshing only if the stored one is expired.
/// Serialized via `token_refresh_lock` to prevent thundering-herd double-refresh when
/// two concurrent IPC commands both see an expired token.
async fn get_valid_token(
    state: &AppState,
    account_id: &str,
) -> std::result::Result<String, String> {
    // Fast path: check without lock first.
    let (access_token, is_valid) = {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
        let at = db.get_access_token(account_id)
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        let valid = db.token_is_valid(account_id).unwrap_or(false);
        (at, valid)
    };
    if is_valid && !access_token.is_empty() {
        return Ok(access_token);
    }

    // Slow path: serialize refresh attempts so concurrent commands don't both refresh.
    let _guard = state.token_refresh_lock.lock().await;
    let (refresh_token, access_token, is_valid) = {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
        let rt = db.get_refresh_token(account_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "No refresh token stored".to_string())?;
        let at = db.get_access_token(account_id)
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        let valid = db.token_is_valid(account_id).unwrap_or(false);
        (rt, at, valid)
    };
    if is_valid && !access_token.is_empty() {
        return Ok(access_token);
    }

    let client_id = std::env::var("NEXUS_GMAIL_CLIENT_ID")
        .map_err(|_| "NEXUS_GMAIL_CLIENT_ID not set")?;
    let client_secret = std::env::var("NEXUS_GMAIL_CLIENT_SECRET")
        .map_err(|_| "NEXUS_GMAIL_CLIENT_SECRET not set")?;

    let oauth = GmailOAuth::new(client_id, client_secret);
    let (new_token, expires_in) = oauth
        .refresh_access_token(&refresh_token)
        .await
        .map_err(|e| e.to_string())?;

    let expires_at = chrono::Utc::now().timestamp() + expires_in;
    {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
        db.save_tokens(account_id, &new_token, &refresh_token, expires_at)
            .map_err(|e| e.to_string())?;
    }
    Ok(new_token)
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
        .map_err(|_| "vault_path lock poisoned".to_string())?
        .clone()
        .ok_or("No vault loaded")?;
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;

    let token = get_valid_token(&state, &account_id).await?;
    let client_mode = state.client_mode.lock().map_err(|_| "client_mode lock poisoned".to_string())?.clone();

    let db_path = std::path::Path::new(&vault_path)
        .join("nexus.db")
        .to_string_lossy()
        .into_owned();

    let syncer = GmailSyncer::new(
        account_id,
        vault_id,
        token,
        std::path::Path::new(&vault_path),
        client_mode,
        app.clone(),
    );

    let stats = syncer
        .incremental_sync_with_db(&db_path)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit("vault:hydrate-needed", ());
    Ok(stats)
}

/// Batch re-fetch HTML bodies for all messages missing from message_bodies.
/// Uses 10 concurrent requests (same as initial sync). Fire-and-forget safe.
#[tauri::command]
pub async fn repair_message_bodies(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> std::result::Result<usize, String> {
    let vault_path = state.vault_path.lock().map_err(|_| "vault_path lock poisoned".to_string())?.clone().ok_or("No vault loaded")?;
    let db_path = std::path::Path::new(&vault_path)
        .join("nexus.db")
        .to_string_lossy()
        .into_owned();

    let accounts = {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
        db.all_gmail_accounts().map_err(|e| e.to_string())?
    };

    let client_mode = state.client_mode.lock().map_err(|_| "client_mode lock poisoned".to_string())?.clone();
    let mut total = 0usize;
    for (account_id, vault_id) in accounts {
        let token = match get_valid_token(&state, &account_id).await {
            Ok(t) => t,
            Err(e) => { log::warn!("body repair: token error for {account_id}: {e}"); continue; }
        };
        let syncer = GmailSyncer::new(
            account_id.clone(),
            vault_id,
            token,
            std::path::Path::new(&vault_path),
            client_mode.clone(),
            app.clone(),
        );
        match syncer.repair_missing_bodies(&db_path).await {
            Ok(n) => { log::info!("body repair: fixed {n} bodies for {account_id}"); total += n; }
            Err(e) => log::warn!("body repair failed for {account_id}: {e}"),
        }
    }
    if total > 0 {
        let _ = app.emit("vault:hydrate-needed", ());
    }
    Ok(total)
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
    let (provider, settings_json) = {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
        let mut stmt = db
            .conn
            .prepare("SELECT provider, settings_json FROM accounts WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(rusqlite::params![account_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .map_err(|e| e.to_string())?
    };

    match provider.as_str() {
        "gmail" => {
            let client_id = std::env::var("NEXUS_GMAIL_CLIENT_ID")
                .map_err(|_| "NEXUS_GMAIL_CLIENT_ID not set")?;
            let client_secret = std::env::var("NEXUS_GMAIL_CLIENT_SECRET")
                .map_err(|_| "NEXUS_GMAIL_CLIENT_SECRET not set")?;

            let refresh_token = {
                let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
                db_guard
                    .as_ref()
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
                let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
                let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
                db.save_tokens(&account_id, &access_token, &refresh_token, expires_at)
                    .map_err(|e| e.to_string())?;
            }

            let client = reqwest::Client::new();
            let gmail_id = crate::gmail::mutations::send_raw(&client, &access_token, &raw_eml)
                .await
                .map_err(|e| e.to_string())?;
            Ok(gmail_id)
        }
        "imap" => {
            use crate::providers::imap::{Security, SmtpConfig};
            use base64::Engine;

            let settings = settings_json.ok_or("No IMAP settings found")?;
            let settings: serde_json::Value =
                serde_json::from_str(&settings).map_err(|e| e.to_string())?;

            let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
            let vault_path = state.vault_path.lock().map_err(|_| "vault_path lock poisoned".to_string())?.clone().ok_or("No vault")?;
            let db_path = std::path::Path::new(&vault_path)
                .join("nexus.db")
                .to_string_lossy()
                .into_owned();

            let encrypted_pw = {
                let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
                let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
                db.get_access_token(&account_id)
                    .map_err(|e| e.to_string())?
                    .unwrap_or_default()
            };
            let password = decrypt_credential_for_account(&db_path, &vault_id, &encrypted_pw)
                .map_err(|e| e.to_string())?;

            let smtp_cfg = &settings["smtp"];
            let security = match smtp_cfg["security"].as_str().unwrap_or("starttls") {
                "tls" => Security::Tls,
                "plain" => Security::Plain,
                _ => Security::StartTls,
            };
            let config = SmtpConfig {
                host: smtp_cfg["host"].as_str().unwrap_or("").to_string(),
                port: smtp_cfg["port"].as_u64().unwrap_or(587) as u16,
                security,
                username: smtp_cfg["username"].as_str().unwrap_or("").to_string(),
                password,
            };

            // Decode base64url raw_eml (sent from TS as base64url with no padding)
            let raw_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(raw_eml.trim_end_matches('='))
                .map_err(|e| format!("base64 decode: {e}"))?;

            crate::smtp::send_via_smtp(&config, &raw_bytes)
                .await
                .map_err(|e| e.to_string())?;
            Ok(format!("smtp-sent-{}", uuid::Uuid::new_v4()))
        }
        p => Err(format!("Unknown provider: {p}")),
    }
}

fn sanitize_filename(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("attachment");
    if base == ".." || base == "." { return "attachment".to_string(); }
    let s: String = base.chars().map(|c| match c {
        '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
        c if c.is_control() => '_',
        c => c,
    }).collect();
    let trimmed = s.trim_start_matches('.');
    let result: String = trimmed.chars().take(150).collect();
    if result.is_empty() { "attachment".to_string() } else { result }
}

fn unique_download_path(dir: &std::path::Path, filename: &str) -> std::path::PathBuf {
    let dest = dir.join(filename);
    if !dest.exists() { return dest; }
    let stem = std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| format!(".{s}"))
        .unwrap_or_default();
    let mut n = 1u32;
    loop {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() { return candidate; }
        n += 1;
    }
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

    let dest = unique_download_path(&downloads_dir, &filename);
    std::fs::write(&dest, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

// ─── Attachment download ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn download_attachment(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    message_id: String,    // Nexus message ID (e.g. "msg-...")
    attachment_id: String, // Gmail attachment part ID
    filename: String,
) -> std::result::Result<String, String> {
    let (provider_msg_id, account_id) = {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
        db.get_provider_id(&message_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Message not found".to_string())?
    };

    let access_token = get_valid_token(&state, &account_id).await?;

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
    let data_b64 = data_b64.trim_end_matches('=');
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(data_b64)
        .map_err(|e| e.to_string())?;

    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?;
    let safe_name = sanitize_filename(&filename);
    let dest = unique_download_path(&downloads_dir, &safe_name);
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

// ─── EP6 Multi-provider commands ─────────────────────────────────────────────

/// Discover IMAP/SMTP settings for an email address.
#[tauri::command]
pub async fn discover_imap_settings(
    email: String,
) -> std::result::Result<DiscoveryResult, String> {
    Ok(crate::providers::autodiscovery::discover(&email).await)
}

/// Test an IMAP connection without saving.
#[tauri::command]
pub async fn test_imap_connection(
    host: String,
    port: u16,
    security: String,
    username: String,
    password: String,
) -> std::result::Result<bool, String> {
    let sec = match security.as_str() {
        "tls" => Security::Tls,
        "starttls" => Security::StartTls,
        _ => Security::Plain,
    };
    let config = ImapConfig {
        host,
        port,
        security: sec,
        username,
        password,
    };
    match test_imap_config(&config).await {
        Ok(()) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

async fn test_imap_config(config: &ImapConfig) -> anyhow::Result<()> {
    match &config.security {
        Security::Tls => {
            use tokio_rustls::rustls;
            let tcp = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                tokio::net::TcpStream::connect(format!("{}:{}", config.host, config.port)),
            )
            .await
            .map_err(|_| anyhow!("Connection timeout"))?
            .map_err(|e| anyhow!("TCP: {e}"))?;
            tcp.set_nodelay(true).ok();

            let mut root_store = rustls::RootCertStore::empty();
            root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let tls_cfg = std::sync::Arc::new(
                rustls::ClientConfig::builder()
                    .with_root_certificates(root_store)
                    .with_no_client_auth(),
            );
            let connector = tokio_rustls::TlsConnector::from(tls_cfg);
            let server_name =
                rustls::pki_types::ServerName::try_from(config.host.as_str().to_owned())
                    .map_err(|e| anyhow!("bad hostname: {e}"))?;
            let tls = connector.connect(server_name, tcp).await?;
            let client = async_imap::Client::new(tls);
            let mut session = client
                .login(&config.username, &config.password)
                .await
                .map_err(|(e, _)| anyhow!("Login failed: {e}"))?;
            session.logout().await.ok();
        }
        _ => {
            let tcp = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                tokio::net::TcpStream::connect(format!("{}:{}", config.host, config.port)),
            )
            .await
            .map_err(|_| anyhow!("Connection timeout"))?
            .map_err(|e| anyhow!("TCP: {e}"))?;
            tcp.set_nodelay(true).ok();
            let client = async_imap::Client::new(tcp);
            let mut session = client
                .login(&config.username, &config.password)
                .await
                .map_err(|(e, _)| anyhow!("Login failed: {e}"))?;
            session.logout().await.ok();
        }
    }
    Ok(())
}

/// Add an IMAP account: save settings, encrypt credential, kick off initial sync.
#[tauri::command]
pub async fn add_imap_account(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    email: String,
    display_name: Option<String>,
    imap_host: String,
    imap_port: u16,
    imap_security: String,
    imap_username: String,
    imap_password: String,
    smtp_host: String,
    smtp_port: u16,
    smtp_security: String,
) -> std::result::Result<OAuthResult, String> {
    let imap_sec = match imap_security.as_str() {
        "tls" => Security::Tls,
        "starttls" => Security::StartTls,
        _ => Security::Plain,
    };

    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let vault_path = state
        .vault_path
        .lock()
        .map_err(|_| "vault_path lock poisoned".to_string())?
        .clone()
        .ok_or("No vault")?;
    let account_id = format!("acct-{}", uuid::Uuid::new_v4());

    let settings = serde_json::json!({
        "imap": {
            "host": imap_host,
            "port": imap_port,
            "security": imap_security,
            "username": imap_username,
        },
        "smtp": {
            "host": smtp_host,
            "port": smtp_port,
            "security": smtp_security,
            "username": imap_username,
        }
    });

    let db_path = std::path::Path::new(&vault_path)
        .join("nexus.db")
        .to_string_lossy()
        .into_owned();

    // Encrypt the password
    let encrypted_pw = encrypt_credential_for_account(&db_path, &vault_id, &imap_password)
        .map_err(|e| e.to_string())?;

    {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
        db.upsert_account(&account_id, &vault_id, "imap", &email, display_name.as_deref())
            .map_err(|e| e.to_string())?;
        db.save_settings_json(&account_id, &settings.to_string())
            .map_err(|e| e.to_string())?;
        db.save_credential(&account_id, &encrypted_pw)
            .map_err(|e| e.to_string())?;
    }

    // Kick off initial sync in background
    let account_id_clone = account_id.clone();
    let vault_id_clone = vault_id.clone();
    let app_clone = app.clone();
    let db_path_clone = db_path.clone();
    let config = ImapConfig {
        host: imap_host,
        port: imap_port,
        security: imap_sec,
        username: imap_username,
        password: imap_password,
    };

    tokio::spawn(async move {
        use crate::providers::MailProvider;
        let provider = ImapProvider::new(
            account_id_clone.clone(),
            vault_id_clone.clone(),
            config,
            app_clone.clone(),
        );

        match provider.fetch_initial().await {
            Ok((_label_infos, messages, cursor)) => {
                if let Ok(db) = crate::db::VaultDb::open(&db_path_clone, "nexus") {
                    let _ = db.conn.execute_batch("BEGIN IMMEDIATE");
                    for msg in &messages {
                        let _ = db.upsert_message_from_gmail(&vault_id_clone, msg);
                    }
                    let _ = db.conn.execute_batch("COMMIT");

                    if let Some(c) = cursor {
                        let _ = db.update_sync_cursor(&account_id_clone, &c);
                    }
                }
                use tauri::Emitter;
                let _ = app_clone.emit("vault:hydrate-needed", ());
                log::info!(
                    "IMAP initial sync complete for {account_id_clone}: {} messages",
                    messages.len()
                );
            }
            Err(e) => log::error!("IMAP initial sync failed for {account_id_clone}: {e}"),
        }
    });

    Ok(OAuthResult {
        account_id,
        email,
    })
}

/// Sync a specific account (dispatches to correct provider).
#[tauri::command]
pub async fn sync_account_now(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    account_id: String,
) -> std::result::Result<SyncStats, String> {
    let vault_path = state
        .vault_path
        .lock()
        .map_err(|_| "vault_path lock poisoned".to_string())?
        .clone()
        .ok_or("No vault loaded")?;
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;

    let (provider, settings_json) = {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
        let mut stmt = db
            .conn
            .prepare("SELECT provider, settings_json FROM accounts WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(rusqlite::params![account_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .map_err(|e| e.to_string())?
    };

    let db_path = std::path::Path::new(&vault_path)
        .join("nexus.db")
        .to_string_lossy()
        .into_owned();

    let client_mode = state.client_mode.lock().map_err(|_| "client_mode lock poisoned".to_string())?.clone();

    match provider.as_str() {
        "gmail" => {
            let token = get_valid_token(&state, &account_id).await?;
            let syncer = GmailSyncer::new(
                account_id,
                vault_id,
                token,
                std::path::Path::new(&vault_path),
                client_mode,
                app.clone(),
            );
            let stats = syncer
                .incremental_sync_with_db(&db_path)
                .await
                .map_err(|e| e.to_string())?;
            let _ = app.emit("vault:hydrate-needed", ());
            Ok(stats)
        }
        "imap" => {
            let settings = settings_json.ok_or("No IMAP settings found")?;
            let settings: serde_json::Value =
                serde_json::from_str(&settings).map_err(|e| e.to_string())?;

            let encrypted_pw = {
                let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
                let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
                db.get_access_token(&account_id)
                    .map_err(|e| e.to_string())?
                    .unwrap_or_default()
            };

            let password =
                decrypt_credential_for_account(&db_path, &vault_id, &encrypted_pw)
                    .map_err(|e| e.to_string())?;

            let imap_cfg = &settings["imap"];
            let security = match imap_cfg["security"].as_str().unwrap_or("tls") {
                "starttls" => Security::StartTls,
                "plain" => Security::Plain,
                _ => Security::Tls,
            };

            let config = ImapConfig {
                host: imap_cfg["host"].as_str().unwrap_or("").to_string(),
                port: imap_cfg["port"].as_u64().unwrap_or(993) as u16,
                security,
                username: imap_cfg["username"].as_str().unwrap_or("").to_string(),
                password,
            };

            let provider_obj =
                ImapProvider::new(account_id.clone(), vault_id.clone(), config, app.clone());

            use crate::providers::MailProvider;
            let (_, messages, cursor) =
                provider_obj.fetch_initial().await.map_err(|e| e.to_string())?;
            let count = messages.len() as u32;

            if let Ok(db) = crate::db::VaultDb::open(&db_path, "nexus") {
                let _ = db.conn.execute_batch("BEGIN IMMEDIATE");
                for msg in &messages {
                    let _ = db.upsert_message_from_gmail(&vault_id, msg);
                }
                let _ = db.conn.execute_batch("COMMIT");
                if let Some(c) = cursor {
                    let _ = db.update_sync_cursor(&account_id, &c);
                }
            }

            let _ = app.emit("vault:hydrate-needed", ());
            Ok(SyncStats {
                fetched: count,
                inserted: count,
                updated: 0,
            })
        }
        p => Err(format!("Unknown provider: {p}")),
    }
}

/// Start Outlook OAuth flow.
#[tauri::command]
pub async fn start_outlook_oauth(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> std::result::Result<OAuthResult, String> {
    let client_id = std::env::var("NEXUS_OUTLOOK_CLIENT_ID")
        .map_err(|_| "NEXUS_OUTLOOK_CLIENT_ID env var not set")?;
    let client_secret = std::env::var("NEXUS_OUTLOOK_CLIENT_SECRET")
        .map_err(|_| "NEXUS_OUTLOOK_CLIENT_SECRET env var not set")?;

    let oauth =
        crate::providers::outlook_oauth::OutlookOAuth::new(client_id, client_secret);
    let (auth_url, code_rx) = oauth.start_flow().await.map_err(|e| e.to_string())?;

    open_browser(&app, &auth_url).map_err(|e| e.to_string())?;

    // Extract port from redirect_uri embedded in auth_url
    let port = auth_url
        .split("localhost%3A")
        .nth(1)
        .or_else(|| auth_url.split("localhost:").nth(1))
        .and_then(|s| s.split(['/', '&', '%']).next())
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(8080);
    let redirect_uri = format!("http://localhost:{port}");

    let code = code_rx
        .await
        .map_err(|_| "OAuth receiver dropped")?
        .map_err(|e| e.to_string())?;

    let token_resp = oauth
        .exchange_code(&code, &redirect_uri)
        .await
        .map_err(|e| e.to_string())?;

    // In production you'd call Graph API for the user email
    let email = "user@outlook.com".to_string();
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let account_id = format!("acct-{}", uuid::Uuid::new_v4());
    let expires_at = chrono::Utc::now().timestamp() + token_resp.expires_in;

    {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
        db.upsert_account(&account_id, &vault_id, "imap", &email, Some(&email))
            .map_err(|e| e.to_string())?;

        let settings = serde_json::json!({
            "imap": { "host": "outlook.office365.com", "port": 993, "security": "tls", "username": email },
            "smtp": { "host": "smtp.office365.com", "port": 587, "security": "starttls", "username": email },
            "authMethod": "xoauth2"
        });
        db.save_settings_json(&account_id, &settings.to_string())
            .map_err(|e| e.to_string())?;

        if let Some(rt) = &token_resp.refresh_token {
            db.save_tokens(&account_id, &token_resp.access_token, rt, expires_at)
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(OAuthResult { account_id, email })
}

/// Encrypt a credential (e.g., IMAP password) using the vault key.
fn encrypt_credential_for_account(
    db_path: &str,
    vault_id: &str,
    plaintext: &str,
) -> anyhow::Result<String> {
    let db = crate::db::VaultDb::open(db_path, "nexus")?;
    let key = db.get_or_create_vault_key(vault_id)?;
    let encrypted = crate::crypto::encrypt_payload(&key, plaintext.as_bytes());
    Ok(base64::engine::general_purpose::STANDARD.encode(&encrypted))
}

/// Decrypt a credential stored in the DB.
fn decrypt_credential_for_account(
    db_path: &str,
    vault_id: &str,
    ciphertext: &str,
) -> anyhow::Result<String> {
    let db = crate::db::VaultDb::open(db_path, "nexus")?;
    let key = db.get_or_create_vault_key(vault_id)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(ciphertext)?;
    let decrypted = crate::crypto::decrypt_payload(&key, &bytes)?;
    String::from_utf8(decrypted).map_err(Into::into)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

fn get_vault_id(state: &AppState) -> Result<String> {
    let path = state
        .vault_path
        .lock()
        .map_err(|_| anyhow!("vault_path lock poisoned"))?
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

    *state.db.lock().map_err(|_| anyhow!("vault lock poisoned"))? = Some(db);
    *state.vault_path.lock().map_err(|_| anyhow!("vault_path lock poisoned"))? = Some(vault_path.to_string());
    // Load persisted client mode (defaults to "traditional" if first run or file absent).
    *state.client_mode.lock().map_err(|_| anyhow!("client_mode lock poisoned"))? = read_client_mode(vault_path);
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
        let mut backoff = crate::gmail::backoff::SyncBackoff::new();
        tokio::time::sleep(std::time::Duration::from_secs(60)).await; // initial sync already runs on connect

        loop {
            if backoff.is_open() {
                log::warn!(
                    "Sync circuit breaker open ({} consecutive failures) — pausing poller",
                    backoff.consecutive_failures()
                );
                tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                continue;
            }

            match poll_all_accounts(&vault_path, &app, &client_id, &client_secret).await {
                Ok(()) => {
                    backoff.record_success();
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                }
                Err(e) => {
                    backoff.record_failure();
                    let delay = backoff.delay();
                    log::warn!("Inbox poll error (failure #{}, retrying in {:.0}s): {e}", backoff.consecutive_failures(), delay.as_secs_f64());
                    tokio::time::sleep(delay).await;
                }
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

        let client_mode = read_client_mode(vault_path);
        let syncer = crate::gmail::GmailSyncer::new(
            account_id.clone(),
            vault_id,
            access_token,
            std::path::Path::new(vault_path),
            client_mode,
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
    *state.vault_path.lock().map_err(|_| "vault_path lock poisoned".to_string())? = None;
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

// ─── EP7 commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn search_messages(
    query: String,
    vault_id: String,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> std::result::Result<Vec<String>, String> {
    let limit = limit.unwrap_or(200);
    let results = {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "no vault open".to_string())?;
        db.search_fts5(&query, &vault_id, limit as usize).map_err(|e| e.to_string())?
    };
    Ok(results)
}

#[tauri::command]
pub async fn get_rules(
    vault_id: String,
    state: State<'_, AppState>,
) -> std::result::Result<Vec<JsonValue>, String> {
    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or_else(|| "no vault open".to_string())?;
    db.get_rules(&vault_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_rule(
    vault_id: String,
    rule: JsonValue,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or_else(|| "no vault open".to_string())?;
    db.upsert_rule(&vault_id, &rule).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_rule(
    id: String,
    vault_id: String,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or_else(|| "no vault open".to_string())?;
    db.delete_rule(&id, &vault_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_templates(
    vault_id: String,
    state: State<'_, AppState>,
) -> std::result::Result<Vec<JsonValue>, String> {
    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or_else(|| "no vault open".to_string())?;
    db.get_templates(&vault_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_template(
    vault_id: String,
    template: JsonValue,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or_else(|| "no vault open".to_string())?;
    db.upsert_template(&vault_id, &template).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_template(
    id: String,
    vault_id: String,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or_else(|| "no vault open".to_string())?;
    db.delete_template(&id, &vault_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_unsubscribe(
    message_id: String,
    state: State<'_, AppState>,
) -> std::result::Result<String, String> {
    // Returns the mailto/https URL so the frontend can handle it, or "posted" if we sent the POST.
    let list_unsubscribe_json: Option<String> = {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "no vault open".to_string())?;
        db.get_list_unsubscribe(&message_id).map_err(|e| e.to_string())?
    };

    let json_str = list_unsubscribe_json.ok_or_else(|| "no unsubscribe header".to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

    let post_url = parsed.get("post").and_then(|v| v.as_str()).map(String::from);
    let link = parsed.get("link").and_then(|v| v.as_str()).map(String::from);

    if let Some(url) = post_url {
        let safe = validate_unsubscribe_url(&url)?;
        // RFC 8058 one-click POST
        let client = reqwest::Client::new();
        let res = client
            .post(safe.as_str())
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body("List-Unsubscribe=One-Click")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if res.status().is_success() {
            return Ok("posted".to_string());
        }
        // Fall through to link if POST failed
        if let Some(fallback) = link {
            validate_unsubscribe_url(&fallback)?;
            return Ok(fallback);
        }
        return Err(format!("POST failed: {}", res.status()));
    }

    if let Some(ref l) = link {
        validate_unsubscribe_url(l)?;
    }
    link.ok_or_else(|| "no unsubscribe link found".to_string())
}

/// Validate that an unsubscribe URL is safe to request: must be https and must not target
/// private/loopback addresses (SSRF guard). Returns the parsed URL on success.
fn validate_unsubscribe_url(raw: &str) -> std::result::Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| "Invalid unsubscribe URL".to_string())?;
    if url.scheme() != "https" {
        return Err("Unsubscribe URL must use HTTPS".to_string());
    }
    if let Some(host) = url.host_str() {
        // Block loopback and well-known internal hostnames
        if matches!(host, "localhost" | "127.0.0.1" | "::1" | "0.0.0.0") {
            return Err("Unsubscribe URL targets a local address".to_string());
        }
        // Block RFC-1918 / link-local IPv4 and loopback IPv6
        if let Ok(addr) = host.parse::<std::net::IpAddr>() {
            let blocked = match addr {
                std::net::IpAddr::V4(v4) => {
                    v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_broadcast()
                }
                std::net::IpAddr::V6(v6) => v6.is_loopback(),
            };
            if blocked {
                return Err("Unsubscribe URL targets a private/internal address".to_string());
            }
        }
    } else {
        return Err("Unsubscribe URL has no host".to_string());
    }
    Ok(url)
}

fn fire_notification(app: &tauri::AppHandle, count: u32) {
    use tauri_plugin_notification::NotificationExt;
    let body = if count == 1 {
        "1 new message".to_string()
    } else {
        format!("{count} new messages")
    };
    let _ = app.notification().builder().title("Nexus").body(&body).show();
}
