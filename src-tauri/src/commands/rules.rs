//! EP-7 commands: full-text search, rules, templates, event templates,
//! list-unsubscribe, account preferences, signatures, and vacation responder.
//!
//! Extracted from the former monolithic commands.rs. `validate_unsubscribe_url`
//! is internal to this group; other shared helpers live in the parent module.

use serde_json::Value as JsonValue;
use tauri::State;

use crate::AppState;

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
pub async fn get_event_templates(
    vault_id: String,
    state: State<'_, AppState>,
) -> std::result::Result<Vec<JsonValue>, String> {
    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or_else(|| "no vault open".to_string())?;
    db.get_event_templates(&vault_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_event_template(
    vault_id: String,
    template: JsonValue,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or_else(|| "no vault open".to_string())?;
    db.upsert_event_template(&vault_id, &template).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_event_template(
    id: String,
    vault_id: String,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or_else(|| "no vault open".to_string())?;
    db.delete_event_template(&id, &vault_id).map_err(|e| e.to_string())
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


// ─── EP7 Account preferences + signature ──────────────────────────────────────

#[tauri::command]
pub async fn get_account_preferences(
    state: State<'_, AppState>,
    account_id: String,
) -> std::result::Result<serde_json::Value, String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let db = guard.as_ref().ok_or("Vault not open")?;
    let raw = db.get_account_preferences(&account_id).map_err(|e| e.to_string())?;
    if let Some(json_str) = raw {
        serde_json::from_str(&json_str).map_err(|e| e.to_string())
    } else {
        Ok(serde_json::json!({ "defaultReplyAll": false, "externalImages": "ask" }))
    }
}

#[tauri::command]
pub async fn save_account_preferences(
    state: State<'_, AppState>,
    account_id: String,
    default_reply_all: bool,
    external_images: String,
) -> std::result::Result<(), String> {
    let prefs = serde_json::json!({
        "defaultReplyAll": default_reply_all,
        "externalImages": external_images,
    });
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let db = guard.as_ref().ok_or("Vault not open")?;
    db.save_account_preferences(&account_id, &prefs.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_signature_html(
    state: State<'_, AppState>,
    account_id: String,
) -> std::result::Result<Option<String>, String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let db = guard.as_ref().ok_or("Vault not open")?;
    db.get_signature_html(&account_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_signature_html(
    state: State<'_, AppState>,
    account_id: String,
    html: String,
) -> std::result::Result<(), String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let db = guard.as_ref().ok_or("Vault not open")?;
    db.save_signature_html(&account_id, &html)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_notification_pref(
    state: tauri::State<'_, crate::AppState>,
    enabled: bool,
) -> std::result::Result<(), String> {
    let mut guard = state.notifications_enabled.lock().map_err(|e| e.to_string())?;
    *guard = enabled;
    Ok(())
}

// ─── EP7 Stage 4: Vacation Responder ─────────────────────────────────────────

#[tauri::command]
pub async fn get_vacation_responder(
    state: State<'_, AppState>,
    account_id: String,
) -> std::result::Result<Option<serde_json::Value>, String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let db = guard.as_ref().ok_or("Vault not open")?;
    db.get_vacation_responder(&account_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_vacation_responder(
    state: State<'_, AppState>,
    responder: serde_json::Value,
) -> std::result::Result<(), String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let db = guard.as_ref().ok_or("Vault not open")?;
    db.save_vacation_responder(&responder).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_vacation_responder(
    state: State<'_, AppState>,
    account_id: String,
) -> std::result::Result<(), String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let db = guard.as_ref().ok_or("Vault not open")?;
    db.delete_vacation_responder(&account_id).map_err(|e| e.to_string())
}
