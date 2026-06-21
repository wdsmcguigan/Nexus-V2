use anyhow::{anyhow, Context, Result};
use base64::Engine;
use serde::Serialize;
use serde_json::Value as JsonValue;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

use crate::db::{queries::HydratePayload, VaultDb};
use crate::gmail::{GmailOAuth, GmailSyncer};
use crate::gmail::types::{OAuthResult, SyncStats};
use crate::providers::imap::{ImapConfig, Security};
use crate::AppState;

// Command groups extracted into focused submodules. Re-exported so existing
// `commands::<name>` paths (and lib.rs's invoke_handler!) stay unchanged.
mod ai;
mod calendar;
mod providers;
mod relay;
mod rules;
pub use ai::*;
pub use calendar::*;
pub use providers::*;
pub use relay::*;
pub use rules::*;

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

#[tauri::command]
pub async fn get_messages_for_label(
    state: State<'_, AppState>,
    label_id: String,
) -> std::result::Result<Vec<serde_json::Value>, String> {
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    db_guard
        .as_ref()
        .ok_or_else(|| "DB not open".to_string())?
        .load_messages_for_label(&vault_id, &label_id)
        .map_err(|e| e.to_string())
}

/// Read the raw RFC 822 source of a message from its on-disk `.eml` file.
/// Returns None when no `.eml` exists (e.g. traditional mode, where the
/// frontend falls back to reconstructed headers).
#[tauri::command]
pub async fn get_message_source(
    state: State<'_, AppState>,
    message_id: String,
) -> std::result::Result<Option<String>, String> {
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let eml_path = {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        db_guard
            .as_ref()
            .ok_or_else(|| "DB not open".to_string())?
            .get_message_eml_path(&vault_id, &message_id)
            .map_err(|e| e.to_string())?
    };
    match eml_path {
        Some(path) => std::fs::read_to_string(&path).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
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

/// Broadcast envelope for a committed mutation, consumed by sibling windows to
/// patch their in-memory store without a full re-hydrate. `origin_window` lets
/// the originating window ignore its own echo (it already applied optimistically).
#[derive(Serialize, Clone)]
struct MutationEvent {
    kind: String,
    payload: JsonValue,
    lamport: i64,
    #[serde(rename = "originWindow")]
    origin_window: String,
}

#[tauri::command]
pub async fn apply_mutation(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
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

    // Broadcast to all windows so siblings patch their store. The originating
    // window ignores its own echo (matched on origin_window in the frontend).
    let _ = app.emit(
        "vault:mutation-applied",
        MutationEvent {
            kind,
            payload,
            lamport,
            origin_window: window.label().to_string(),
        },
    );

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
    // Prefer in-memory state (set after init_vault runs).
    // Fall back to the on-disk file so calls that race the startup init hook
    // still return the saved path instead of None → prevents spurious Welcome screen.
    let in_memory = state.vault_path.lock().map_err(|_| "vault_path lock poisoned".to_string())?.clone();
    if in_memory.is_some() {
        return Ok(in_memory);
    }
    Ok(dirs::data_local_dir()
        .map(|d| d.join("Nexus").join("vault_path.txt"))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| expand_tilde(s.trim())))
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
        db.upsert_account(&account_id, &vault_id, "gmail", &token_resp.email, Some(&token_resp.email), token_resp.photo_url.as_deref())
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

        let http = reqwest::Client::new();

        // Fetch Google Contacts photos in parallel with initial mail sync
        let photos_future = crate::gmail::contacts::fetch_contact_photos(&http, &access_token);

        let syncer = GmailSyncer::new(
            account_id_clone.clone(),
            vault_id_clone.clone(),
            access_token.clone(),
            std::path::Path::new(&vault_path),
            client_mode,
            app_handle.clone(),
        );

        let (sync_result, photos_result) = tokio::join!(
            syncer.initial_sync_with_db(&db_path),
            photos_future,
        );

        match sync_result {
            Ok(stats) => log::info!("Initial sync complete: {stats:?}"),
            Err(e) => log::error!("Initial sync failed: {e}"),
        }

        // Save contact photos (own profile photo already stored via userinfo in upsert_account)
        match photos_result {
            Ok(photos) => {
                let db = match crate::db::VaultDb::open(&vault_path, "nexus") {
                    Ok(d) => d,
                    Err(e) => { log::warn!("Could not open DB for contact photos: {e}"); return; }
                };
                if let Err(e) = db.update_contact_photos(&vault_id_clone, &photos) {
                    log::warn!("update_contact_photos error: {e}");
                }
                log::info!("Synced {} Google Contact photos", photos.len());
            }
            Err(e) => log::warn!("Google Contacts fetch failed: {e}"),
        }

        // Sync "other" contacts — people the user has emailed but hasn't saved. Only
        // entries with a Google profile photo are imported; their `source` is
        // "google_other" so they can be distinguished from explicitly-saved contacts.
        match crate::gmail::contacts::fetch_other_contacts(&http, &access_token, &vault_id_clone).await {
            Ok(others) => {
                match crate::db::VaultDb::open(&vault_path, "nexus") {
                    Ok(db) => {
                        let mut count = 0usize;
                        for contact in &others {
                            if let Err(e) = db.upsert_contact(&vault_id_clone, contact) {
                                log::warn!("upsert other-contact error: {e}");
                            } else {
                                count += 1;
                            }
                        }
                        log::info!("Synced {count} other-contact photos");
                    }
                    Err(e) => log::warn!("Could not open DB for other-contacts: {e}"),
                }
            }
            Err(e) => log::warn!("fetch_other_contacts failed: {e}"),
        }

        let _ = app_handle.emit("vault:hydrate-needed", ());
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

/// Diagnostic result returned from `refresh_account_photos` so the UI can show
/// the user exactly what happened to their profile photo refresh attempt.
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PhotoRefreshResult {
    /// True iff the account row's photo_url was updated this call.
    pub photo_updated: bool,
    /// The URL that was stored (if photo_updated).
    pub photo_url: Option<String>,
    /// Which API actually returned the photo: "userinfo" | "people_api" | null.
    pub source: Option<String>,
    /// Human-readable explanation (always populated).
    pub diagnostic: String,
}

/// Backfill the profile photo for a Gmail account and refresh all contact photos.
/// Safe to call for existing accounts that predate the photo_url column.
///
/// The own-account photo lookup runs INLINE (with a People API fallback) so the
/// returned diagnostic accurately reflects what happened. Contact photo and
/// otherContacts sync continue to run as background spawns since they're slow.
#[tauri::command]
pub async fn refresh_account_photos(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    account_id: String,
) -> std::result::Result<PhotoRefreshResult, String> {
    let vault_path = state
        .vault_path
        .lock()
        .map_err(|_| "vault_path lock poisoned".to_string())?
        .clone()
        .ok_or("No vault loaded")?;
    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;

    // Only Gmail accounts have People API / userinfo
    let provider = {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or("DB not open")?;
        db.conn
            .query_row(
                "SELECT provider FROM accounts WHERE id = ?1",
                rusqlite::params![&account_id],
                |r| r.get::<_, String>(0),
            )
            .map_err(|e| e.to_string())?
    };
    if provider != "gmail" {
        return Ok(PhotoRefreshResult {
            photo_updated: false,
            photo_url: None,
            source: None,
            diagnostic: format!("Skipped: provider is '{provider}', not 'gmail'."),
        });
    }

    let access_token = get_valid_token(&state, &account_id).await?;
    let vault_id_clone = vault_id.clone();
    let account_id_clone = account_id.clone();
    let app_handle = app.clone();
    let http = reqwest::Client::new();

    // ── Step 1: try userinfo (fast, the canonical OIDC `picture` field) ──
    let (mut photo_url, mut source) = match crate::gmail::oauth::fetch_userinfo(&http, &access_token).await {
        Ok((_, Some(url))) => (Some(url), Some("userinfo".to_string())),
        Ok((_, None)) => {
            log::info!("refresh_account_photos: userinfo returned no picture; trying People API fallback");
            (None, None)
        }
        Err(e) => {
            log::warn!("refresh_account_photos: fetch_userinfo error: {e}; trying People API fallback");
            (None, None)
        }
    };

    // ── Step 2: People API fallback when userinfo had nothing ──
    if photo_url.is_none() {
        match crate::gmail::contacts::fetch_self_photo(&http, &access_token).await {
            Ok(Some(url)) => {
                photo_url = Some(url);
                source = Some("people_api".to_string());
            }
            Ok(None) => log::info!("refresh_account_photos: People API also returned no photo"),
            Err(e) => log::warn!("refresh_account_photos: fetch_self_photo error: {e}"),
        }
    }

    // Treat empty-string picture URLs as "no photo" — some Google accounts
    // return "" instead of omitting the field, and React would treat an empty
    // string as falsy and silently skip it on render.
    if photo_url.as_deref().is_some_and(|u| u.trim().is_empty()) {
        photo_url = None;
        source = None;
    }

    // Step 3: write via state.db (same connection build_hydrate_payload uses,
    // so the next loadVaultData reads the updated row without a cross-
    // connection race).
    let photo_updated = if let Some(ref url) = photo_url {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        match db_guard.as_ref() {
            Some(db) => match db.update_account_photo(&account_id, url) {
                Ok(()) => true,
                Err(e) => {
                    log::warn!("update_account_photo error: {e}");
                    false
                }
            },
            None => {
                log::warn!("refresh_account_photos: state.db not open");
                false
            }
        }
    } else {
        false
    };

    let diagnostic = match (&photo_url, &source) {
        (Some(_), Some(s)) if s == "userinfo" => "Photo updated from Google userinfo.".to_string(),
        (Some(_), Some(s)) if s == "people_api" => {
            "Photo updated from Google People API (userinfo returned none).".to_string()
        }
        (Some(_), _) => "Photo refreshed.".to_string(),
        (None, _) => {
            "Google returned no profile photo for this account from either the userinfo or the People API. \
             If you've set a photo in Google recently, disconnect and reconnect the account to refresh OAuth permissions."
                .to_string()
        }
    };
    log::info!("refresh_account_photos: {diagnostic}");

    // Emit hydrate event so the frontend re-reads the account row immediately.
    if photo_updated {
        let _ = app.emit("vault:hydrate-needed", ());
    }

    // ── Step 4: kick off contact photo refresh in the background ──
    tokio::spawn(async move {
        let http = reqwest::Client::new();

        // Refresh contact photos via People API
        match crate::gmail::contacts::fetch_contact_photos(&http, &access_token).await {
            Ok(photos) => {
                match crate::db::VaultDb::open(&vault_path, "nexus") {
                    Ok(db) => {
                        if let Err(e) = db.update_contact_photos(&vault_id_clone, &photos) {
                            log::warn!("update_contact_photos error: {e}");
                        } else {
                            log::info!("Refreshed {} contact photos", photos.len());
                        }
                    }
                    Err(e) => log::warn!("refresh_account_photos: DB open error: {e}"),
                }
            }
            Err(e) => log::warn!("fetch_contact_photos error: {e}"),
        }

        // Refresh "other" contacts (people user has emailed but not saved) via People API.
        // Only entries with a Google profile photo are imported; their `source` is
        // "google_other" so they can be distinguished from explicitly-saved contacts.
        match crate::gmail::contacts::fetch_other_contacts(&http, &access_token, &vault_id_clone).await {
            Ok(others) => {
                match crate::db::VaultDb::open(&vault_path, "nexus") {
                    Ok(db) => {
                        let mut count = 0usize;
                        for contact in &others {
                            if let Err(e) = db.upsert_contact(&vault_id_clone, contact) {
                                log::warn!("upsert other-contact error: {e}");
                            } else {
                                count += 1;
                            }
                        }
                        log::info!("Refreshed {count} other-contact photos");
                    }
                    Err(e) => log::warn!("refresh_account_photos: DB open error: {e}"),
                }
            }
            Err(e) => log::warn!("fetch_other_contacts error: {e}"),
        }

        let _ = app_handle.emit("vault:hydrate-needed", ());
    });

    Ok(PhotoRefreshResult {
        photo_updated,
        photo_url,
        source,
        diagnostic,
    })
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

    // Spawn an IMAP IDLE watcher for every existing IMAP account.
    start_imap_watchers_for_existing_accounts(vault_path, &vault_id, app.clone());

    Ok(vault_id)
}

fn start_imap_watchers_for_existing_accounts(
    vault_path: &str,
    vault_id: &str,
    app: tauri::AppHandle,
) {
    let db_path = std::path::Path::new(vault_path)
        .join("nexus.db")
        .to_string_lossy()
        .into_owned();

    let accounts: Vec<(String, String, String)> = match crate::db::VaultDb::open(&db_path, "nexus")
    {
        Ok(db) => {
            let mut stmt = match db.conn.prepare(
                "SELECT id, settings_json, COALESCE(access_token, '')
                 FROM accounts
                 WHERE provider = 'imap'",
            ) {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("IMAP watcher startup: prepare failed: {e}");
                    return;
                }
            };
            let rows = stmt
                .query_map(rusqlite::params![], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        r.get::<_, String>(2)?,
                    ))
                })
                .and_then(|iter| iter.collect::<rusqlite::Result<Vec<_>>>());
            match rows {
                Ok(rs) => rs,
                Err(e) => {
                    log::warn!("IMAP watcher startup: query failed: {e}");
                    return;
                }
            }
        }
        Err(e) => {
            log::warn!("IMAP watcher startup: db open failed: {e}");
            return;
        }
    };

    for (account_id, settings_json, encrypted_pw) in accounts {
        let settings: serde_json::Value = match serde_json::from_str(&settings_json) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("IMAP watcher: bad settings_json for {account_id}: {e}");
                continue;
            }
        };
        let imap = &settings["imap"];
        let security = match imap["security"].as_str().unwrap_or("tls") {
            "starttls" => Security::StartTls,
            "plain" => Security::Plain,
            _ => Security::Tls,
        };
        let password = match decrypt_credential_for_account(&db_path, vault_id, &encrypted_pw) {
            Ok(p) => p,
            Err(e) => {
                log::warn!("IMAP watcher: decrypt failed for {account_id}: {e}");
                continue;
            }
        };
        let config = ImapConfig {
            host: imap["host"].as_str().unwrap_or("").to_string(),
            port: imap["port"].as_u64().unwrap_or(993) as u16,
            security,
            username: imap["username"].as_str().unwrap_or("").to_string(),
            password,
        };
        crate::providers::imap_idle::start_idle_watcher(account_id, config, app.clone());
    }
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

fn fire_notification(app: &tauri::AppHandle, count: u32) {
    use tauri_plugin_notification::NotificationExt;
    let state = app.state::<crate::AppState>();
    let enabled = state.notifications_enabled.lock().map(|g| *g).unwrap_or(true);
    if !enabled {
        return;
    }
    let body = if count == 1 {
        "1 new message".to_string()
    } else {
        format!("{count} new messages")
    };
    let _ = app.notification().builder().title("Nexus").body(&body).show();
}

