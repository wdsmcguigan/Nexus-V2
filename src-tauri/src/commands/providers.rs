//! EP-6 multi-provider commands: IMAP autodiscovery/test/add, JMAP add,
//! per-account sync, and Outlook OAuth. `test_imap_config` is internal to this
//! group; credential encrypt/decrypt helpers remain in the parent module.

use anyhow::anyhow;
use tauri::{Emitter, State};

use crate::AppState;
use crate::gmail::GmailSyncer;
use crate::gmail::types::{OAuthResult, SyncStats};
use crate::providers::autodiscovery::DiscoveryResult;
use crate::providers::imap::{ImapConfig, ImapProvider, Security};

use super::{
    decrypt_credential_for_account, encrypt_credential_for_account, get_valid_token, get_vault_id,
    open_browser,
};

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
        db.upsert_account(&account_id, &vault_id, "imap", &email, display_name.as_deref(), None)
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
    let watcher_config = config.clone();
    let watcher_app = app.clone();
    let watcher_account = account_id.clone();

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
                crate::providers::imap_idle::start_idle_watcher(
                    watcher_account,
                    watcher_config,
                    watcher_app,
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
        "jmap" => {
            use crate::providers::jmap::{JmapConfig, JmapProvider};
            use crate::providers::MailProvider;
            let settings = settings_json.ok_or("No JMAP settings found")?;
            let settings: serde_json::Value =
                serde_json::from_str(&settings).map_err(|e| e.to_string())?;

            let encrypted_token = {
                let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
                let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
                db.get_access_token(&account_id)
                    .map_err(|e| e.to_string())?
                    .unwrap_or_default()
            };
            let token = decrypt_credential_for_account(&db_path, &vault_id, &encrypted_token)
                .map_err(|e| e.to_string())?;

            let jmap_cfg = &settings["jmap"];
            let config = JmapConfig {
                session_url: jmap_cfg["sessionUrl"].as_str().unwrap_or("").to_string(),
                token,
                account_id: jmap_cfg["primaryAccountId"].as_str().unwrap_or("").to_string(),
                api_url: jmap_cfg["apiUrl"].as_str().unwrap_or("").to_string(),
            };
            let provider_obj =
                JmapProvider::new(account_id.clone(), vault_id.clone(), config);

            let cursor_str: Option<String> = {
                let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
                let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
                db.get_sync_cursor(&account_id).ok().flatten()
            };

            let (count_fetched, count_updated) = if let Some(cursor) = cursor_str {
                match provider_obj.fetch_incremental(&cursor).await.map_err(|e| e.to_string())? {
                    Some(result) => {
                        let new_count = result.new_messages.len() as u32;
                        let upd_count = result.label_additions.len() as u32;
                        if let Ok(db) = crate::db::VaultDb::open(&db_path, "nexus") {
                            let _ = db.conn.execute_batch("BEGIN IMMEDIATE");
                            for msg in &result.new_messages {
                                let _ = db.upsert_message_from_gmail(&vault_id, msg);
                            }
                            let _ = db.conn.execute_batch("COMMIT");
                            let _ = db.update_sync_cursor(&account_id, &result.new_cursor);
                        }
                        (new_count, upd_count)
                    }
                    None => (0, 0),
                }
            } else {
                let (_, messages, cursor) =
                    provider_obj.fetch_initial().await.map_err(|e| e.to_string())?;
                let n = messages.len() as u32;
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
                (n, 0)
            };

            let _ = app.emit("vault:hydrate-needed", ());
            Ok(SyncStats {
                fetched: count_fetched,
                inserted: count_fetched,
                updated: count_updated,
            })
        }
        p => Err(format!("Unknown provider: {p}")),
    }
}

/// Add a JMAP account using a bearer token (e.g. a Fastmail API token).
/// Discovers the session resource, captures the api url and account id,
/// then kicks off an initial sync in the background.
#[tauri::command]
pub async fn add_jmap_account(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    email: String,
    display_name: Option<String>,
    session_url: String,
    token: String,
) -> std::result::Result<OAuthResult, String> {
    use crate::providers::jmap::{JmapConfig, JmapProvider};
    use crate::providers::MailProvider;

    let (api_url, primary_account_id) = JmapProvider::discover(&session_url, &token)
        .await
        .map_err(|e| e.to_string())?;

    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let vault_path = state
        .vault_path
        .lock()
        .map_err(|_| "vault_path lock poisoned".to_string())?
        .clone()
        .ok_or("No vault")?;
    let account_id = format!("acct-{}", uuid::Uuid::new_v4());

    let settings = serde_json::json!({
        "jmap": {
            "sessionUrl": session_url,
            "apiUrl": api_url,
            "primaryAccountId": primary_account_id,
        }
    });

    let db_path = std::path::Path::new(&vault_path)
        .join("nexus.db")
        .to_string_lossy()
        .into_owned();

    let encrypted_token = encrypt_credential_for_account(&db_path, &vault_id, &token)
        .map_err(|e| e.to_string())?;

    {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
        db.upsert_account(&account_id, &vault_id, "jmap", &email, display_name.as_deref(), None)
            .map_err(|e| e.to_string())?;
        db.save_settings_json(&account_id, &settings.to_string())
            .map_err(|e| e.to_string())?;
        db.save_credential(&account_id, &encrypted_token)
            .map_err(|e| e.to_string())?;
    }

    let config = JmapConfig {
        session_url,
        token,
        account_id: primary_account_id,
        api_url,
    };
    let account_id_clone = account_id.clone();
    let vault_id_clone = vault_id.clone();
    let app_clone = app.clone();
    let db_path_clone = db_path.clone();
    tokio::spawn(async move {
        let provider = JmapProvider::new(account_id_clone.clone(), vault_id_clone.clone(), config);
        match provider.fetch_initial().await {
            Ok((_labels, messages, cursor)) => {
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
                    "JMAP initial sync complete for {account_id_clone}: {} messages",
                    messages.len()
                );
            }
            Err(e) => log::error!("JMAP initial sync failed for {account_id_clone}: {e}"),
        }
    });

    Ok(OAuthResult { account_id, email })
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
        db.upsert_account(&account_id, &vault_id, "imap", &email, Some(&email), None)
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
