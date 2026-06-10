//! EP-9/10/11/13 commands: Google contacts sync, Google calendar sync,
//! calendar event CRUD, calendar list, event search, and CalDAV.
//!
//! Extracted from the former monolithic commands.rs. Shared credential, token,
//! and vault helpers remain in the parent module and are reached via `super::`.

use tauri::{Emitter, State};

use crate::AppState;
use crate::gmail::types::OAuthResult;

use super::{
    decrypt_credential_for_account, encrypt_credential_for_account, get_valid_token, get_vault_id,
};

/// Sync full Google Contacts for the given account via the People API.
/// Uses delta sync tokens for efficiency on subsequent calls.
/// Returns the number of contacts upserted.
#[tauri::command]
pub async fn sync_google_contacts(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    account_id: String,
) -> std::result::Result<u32, String> {
    let (vault_path, vault_id) = {
        let vp = state.vault_path.lock().map_err(|_| "vault_path lock poisoned")?
            .clone().ok_or("No vault loaded")?;
        let guard = state.db.lock().map_err(|_| "db lock poisoned")?;
        let db = guard.as_ref().ok_or("Vault not open")?;
        let accounts = db.all_gmail_accounts().map_err(|e| e.to_string())?;
        let vid = accounts.into_iter()
            .find(|(aid, _)| aid == &account_id)
            .map(|(_, vid)| vid)
            .ok_or_else(|| format!("account {account_id} not found"))?;
        (vp, vid)
    };

    let access_token = get_valid_token(&state, &account_id).await?;

    // Load existing sync token (delta sync)
    let sync_token: Option<String> = {
        let guard = state.db.lock().map_err(|_| "db lock poisoned")?;
        let db = guard.as_ref().ok_or("Vault not open")?;
        db.get_contacts_sync(&account_id)
            .map_err(|e| e.to_string())?
            .and_then(|(token, _)| token)
    };

    let http = reqwest::Client::new();
    let (contacts, next_sync_token) = crate::gmail::contacts::fetch_google_contacts(
        &http,
        &access_token,
        &vault_id,
        sync_token.as_deref(),
    ).await.map_err(|e| e.to_string())?;

    let count = contacts.len() as u32;
    let now = chrono::Utc::now().timestamp_millis();

    {
        let db = crate::db::VaultDb::open(&vault_path, "nexus")
            .map_err(|e| e.to_string())?;
        for contact in &contacts {
            // Tag with the originating account so calendar/contacts sync can be
            // disconnected with the option to remove only this account's data.
            let mut contact = contact.clone();
            contact["sourceAccountId"] = serde_json::json!(account_id);
            db.upsert_contact(&vault_id, &contact).map_err(|e| e.to_string())?;
        }
        db.upsert_contacts_sync(&account_id, next_sync_token.as_deref(), now)
            .map_err(|e| e.to_string())?;
    }

    let _ = app.emit("vault:hydrate-needed", ());
    log::info!("sync_google_contacts: upserted {count} contacts for account {account_id}");
    Ok(count)
}

#[tauri::command]
pub async fn sync_google_calendar(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    account_id: String,
) -> std::result::Result<u32, String> {
    use std::collections::HashMap;

    let (vault_path, vault_id) = {
        let vp = state.vault_path.lock().map_err(|_| "vault_path lock poisoned")?
            .clone().ok_or("No vault loaded")?;
        let guard = state.db.lock().map_err(|_| "db lock poisoned")?;
        let db = guard.as_ref().ok_or("Vault not open")?;
        let accounts = db.all_gmail_accounts().map_err(|e| e.to_string())?;
        let vid = accounts.into_iter()
            .find(|(aid, _)| aid == &account_id)
            .map(|(_, vid)| vid)
            .ok_or_else(|| format!("account {account_id} not found"))?;
        (vp, vid)
    };

    let access_token = get_valid_token(&state, &account_id).await?;
    let http = reqwest::Client::new();

    // Step 1 — fetch the user's full calendar list. The same API returns 5
    // calendars for the reporting user (Wisdom from Her, Birthdays, Family,
    // Tasks, Holidays); previously only `/calendars/primary/events` was hit.
    let cal_list = crate::gmail::calendar::fetch_google_calendar_list(&http, &access_token)
        .await
        .map_err(|e| e.to_string())?;

    // Step 2 — upsert a Calendar row per discovered Google calendar. The local
    // id is deterministic (`${accountId}:${externalId}`) so re-discovery doesn't
    // create dup rows. On *first* discovery `enabled = selected || primary` —
    // respects Google's own visibility checkbox. On subsequent syncs we preserve
    // the user's stored choice and only refresh the display name and color.
    let now_ms = chrono::Utc::now().timestamp_millis();
    let existing: HashMap<String, serde_json::Value> = {
        let guard = state.db.lock().map_err(|_| "db lock poisoned")?;
        let db = guard.as_ref().ok_or("Vault not open")?;
        let rows = db.load_calendars(&vault_id).map_err(|e| e.to_string())?;
        rows.into_iter()
            .filter_map(|r| {
                let id = r["id"].as_str()?.to_owned();
                Some((id, r))
            })
            .collect()
    };

    let mut to_sync: Vec<(String, bool)> = Vec::new(); // (external_id, read_only)
    {
        let guard = state.db.lock().map_err(|_| "db lock poisoned")?;
        let db = guard.as_ref().ok_or("Vault not open")?;
        for cal in &cal_list {
            let external_id = cal["id"].as_str().unwrap_or_default();
            if external_id.is_empty() { continue; }
            let local_id = format!("{account_id}:{external_id}");
            let selected = cal["selected"].as_bool().unwrap_or(false);
            let primary = cal["primary"].as_bool().unwrap_or(false);
            let access_role = cal["accessRole"].as_str().unwrap_or("reader");
            let read_only = access_role == "reader" || access_role == "freeBusyReader";
            let name = cal["summaryOverride"].as_str()
                .or_else(|| cal["summary"].as_str())
                .unwrap_or("(unnamed calendar)");
            let color = cal["backgroundColor"].as_str().unwrap_or("#4285f4");

            let enabled = match existing.get(&local_id) {
                Some(prev) => prev["enabled"].as_bool().unwrap_or(true),
                None => selected || primary,
            };

            let row = serde_json::json!({
                "id": local_id,
                "accountId": account_id,
                "externalId": external_id,
                "name": name,
                "color": color,
                "enabled": enabled,
                "readOnly": read_only,
                "provider": "google",
                "createdAt": existing.get(&local_id)
                    .and_then(|p| p["createdAt"].as_i64())
                    .unwrap_or(now_ms),
                "updatedAt": now_ms,
            });
            db.upsert_calendar(&vault_id, &row).map_err(|e| e.to_string())?;
            if enabled {
                to_sync.push((external_id.to_owned(), read_only));
            }
        }
    }

    // Step 3 — sync events from each enabled calendar in turn. We keep a
    // per-calendar sync token so each one can do its own incremental delta.
    let now_ms = chrono::Utc::now().timestamp_millis();
    let day_ms: i64 = 86_400_000;
    let time_min = chrono::DateTime::from_timestamp_millis(now_ms - 14 * day_ms)
        .unwrap_or_default()
        .format("%Y-%m-%dT00:00:00Z")
        .to_string();
    let time_max = chrono::DateTime::from_timestamp_millis(now_ms + 90 * day_ms)
        .unwrap_or_default()
        .format("%Y-%m-%dT00:00:00Z")
        .to_string();
    let expand = crate::gmail::calendar::expand_recurrences_enabled();

    let mut total_count: u32 = 0;
    for (external_id, _read_only) in &to_sync {
        let sync_token: Option<String> = {
            let guard = state.db.lock().map_err(|_| "db lock poisoned")?;
            let db = guard.as_ref().ok_or("Vault not open")?;
            db.get_calendar_sync(&account_id, external_id).map_err(|e| e.to_string())?
        };

        let fetch_result = crate::gmail::calendar::fetch_google_calendar_events(
            &http, &access_token, &vault_id, &account_id, external_id,
            sync_token.as_deref(), &time_min, &time_max, expand,
        ).await;

        let (events, next_sync_token) = match fetch_result {
            Ok(r) => r,
            Err(e) if e.to_string().contains("syncToken expired") => {
                log::info!(
                    "sync_google_calendar: syncToken expired for {external_id}, falling back to full sync"
                );
                crate::gmail::calendar::fetch_google_calendar_events(
                    &http, &access_token, &vault_id, &account_id, external_id,
                    None, &time_min, &time_max, expand,
                ).await.map_err(|e| e.to_string())?
            }
            Err(e) => {
                // Don't let one bad calendar fail the whole sync — log and move on.
                log::warn!("sync_google_calendar: skipping {external_id}: {e}");
                continue;
            }
        };

        total_count += events.len() as u32;
        {
            let db = crate::db::VaultDb::open(&vault_path, "nexus")
                .map_err(|e| e.to_string())?;
            for event in &events {
                if event["status"].as_str() == Some("cancelled") {
                    let id = event["id"].as_str().unwrap_or_default();
                    db.delete_calendar_event(id).map_err(|e| e.to_string())?;
                } else {
                    db.upsert_calendar_event(&vault_id, event).map_err(|e| e.to_string())?;
                }
            }
            db.upsert_calendar_sync(&account_id, external_id, next_sync_token.as_deref(), now_ms)
                .map_err(|e| e.to_string())?;
        }
    }

    let _ = app.emit("vault:hydrate-needed", ());
    log::info!(
        "sync_google_calendar: processed {total_count} events across {} calendars for account {account_id}",
        to_sync.len(),
    );
    Ok(total_count)
}

/// Remove all Google-synced calendars + events for an account. Called when the
/// user disconnects calendar sync and chooses to remove the synced data.
#[tauri::command]
pub async fn remove_synced_calendars(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    account_id: String,
) -> std::result::Result<(), String> {
    {
        let guard = state.db.lock().map_err(|_| "db lock poisoned")?;
        let db = guard.as_ref().ok_or("Vault not open")?;
        db.remove_synced_calendars(&account_id).map_err(|e| e.to_string())?;
    }
    let _ = app.emit("vault:hydrate-needed", ());
    Ok(())
}

/// Remove all contacts synced from an account (and clear its sync token). Called
/// when the user disconnects contacts sync and chooses to remove the synced data.
#[tauri::command]
pub async fn remove_synced_contacts(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    account_id: String,
) -> std::result::Result<(), String> {
    {
        let guard = state.db.lock().map_err(|_| "db lock poisoned")?;
        let db = guard.as_ref().ok_or("Vault not open")?;
        db.remove_synced_contacts(&account_id).map_err(|e| e.to_string())?;
    }
    let _ = app.emit("vault:hydrate-needed", ());
    Ok(())
}

#[tauri::command]
pub async fn create_calendar_event(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    account_id: String,
    title: String,
    start_ts: i64,
    end_ts: i64,
    all_day: bool,
    location: Option<String>,
    description: Option<String>,
    attendee_emails: Vec<String>,
    time_zone: Option<String>,
) -> std::result::Result<String, String> {
    let (vault_path, vault_id) = {
        let vp = state.vault_path.lock().map_err(|_| "vault_path lock poisoned")?
            .clone().ok_or("No vault loaded")?;
        let guard = state.db.lock().map_err(|_| "db lock poisoned")?;
        let db = guard.as_ref().ok_or("Vault not open")?;
        let accounts = db.all_gmail_accounts().map_err(|e| e.to_string())?;
        let vid = accounts.into_iter()
            .find(|(aid, _)| aid == &account_id)
            .map(|(_, vid)| vid)
            .ok_or_else(|| format!("account {account_id} not found"))?;
        (vp, vid)
    };

    let access_token = get_valid_token(&state, &account_id).await?;
    let client = reqwest::Client::new();

    let event = crate::gmail::calendar::create_google_calendar_event(
        &client, &access_token, &vault_id, &account_id,
        &title, start_ts, end_ts, all_day,
        location.as_deref(), description.as_deref(), &attendee_emails,
        time_zone.as_deref(),
    ).await.map_err(|e| e.to_string())?;

    let event_id = event["id"].as_str().unwrap_or("").to_owned();

    let db = crate::db::VaultDb::open(&vault_path, "nexus").map_err(|e| e.to_string())?;
    db.upsert_calendar_event(&vault_id, &event).map_err(|e| e.to_string())?;

    let _ = app.emit("vault:hydrate-needed", ());
    Ok(event_id)
}

#[tauri::command]
pub async fn update_calendar_event(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    account_id: String,
    external_id: String,
    title: Option<String>,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    all_day: Option<bool>,
    location: Option<String>,
    description: Option<String>,
    attendee_emails: Option<Vec<String>>,
    time_zone: Option<String>,
) -> std::result::Result<(), String> {
    let (vault_path, vault_id) = {
        let vp = state.vault_path.lock().map_err(|_| "vault_path lock poisoned")?
            .clone().ok_or("No vault loaded")?;
        let guard = state.db.lock().map_err(|_| "db lock poisoned")?;
        let db = guard.as_ref().ok_or("Vault not open")?;
        let accounts = db.all_gmail_accounts().map_err(|e| e.to_string())?;
        let vid = accounts.into_iter()
            .find(|(aid, _)| aid == &account_id)
            .map(|(_, vid)| vid)
            .ok_or_else(|| format!("account {account_id} not found"))?;
        (vp, vid)
    };

    let access_token = get_valid_token(&state, &account_id).await?;
    let client = reqwest::Client::new();

    let event = crate::gmail::calendar::update_google_calendar_event(
        &client, &access_token, &vault_id, &account_id,
        &external_id,
        title.as_deref(), start_ts, end_ts, all_day,
        location.as_deref(), description.as_deref(),
        attendee_emails.as_deref(),
        time_zone.as_deref(),
    ).await.map_err(|e| e.to_string())?;

    let db = crate::db::VaultDb::open(&vault_path, "nexus").map_err(|e| e.to_string())?;
    db.upsert_calendar_event(&vault_id, &event).map_err(|e| e.to_string())?;

    let _ = app.emit("vault:hydrate-needed", ());
    Ok(())
}

#[tauri::command]
pub async fn get_calendar_list(
    state: State<'_, AppState>,
    account_id: String,
) -> std::result::Result<Vec<serde_json::Value>, String> {
    let access_token = get_valid_token(&state, &account_id).await?;
    let client = reqwest::Client::new();
    crate::gmail::calendar::fetch_google_calendar_list(&client, &access_token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_calendar_events(
    state: State<'_, AppState>,
    query: String,
    vault_id: String,
    limit: usize,
) -> std::result::Result<Vec<String>, String> {
    let guard = state.db.lock().map_err(|_| "db lock poisoned")?;
    let db = guard.as_ref().ok_or("Vault not open")?;
    db.search_calendar_fts5(&query, &vault_id, limit)
        .map_err(|e| e.to_string())
}

/// Discover and list a CalDAV server's calendars (EP-14 Phase 3).
/// Validates credentials and returns the available calendar collections. Full
/// account persistence + ongoing sync is the next step (see epic-14 checklist).
#[tauri::command]
pub async fn discover_caldav(
    server_url: String,
    username: String,
    password: String,
) -> std::result::Result<Vec<crate::providers::calendar::CalendarInfo>, String> {
    use crate::providers::calendar::{caldav, CalendarProvider};
    let client = reqwest::Client::new();
    let calendar_home = caldav::discover_calendar_home(&client, &server_url, &username, &password)
        .await
        .map_err(|e| e.to_string())?;
    let provider = caldav::CaldavCalendarProvider {
        client,
        base_url: server_url,
        username,
        password,
        calendar_home,
    };
    provider.list_calendars().await.map_err(|e| e.to_string())
}

/// Persist a CalDAV account and seed its calendar collections (EP-14 Phase 3).
///
/// Mirrors `add_imap_account`: stores an `accounts` row (provider `caldav`), the
/// encrypted password (in the shared credential column), and a settings JSON
/// blob holding the server URL / username / discovered calendar-home. Each
/// remote calendar becomes a local `Calendar` row (provider `caldav`) so events
/// can bind to it. Ongoing event sync is driven separately by
/// `sync_caldav_calendar`.
#[tauri::command]
pub async fn add_caldav_account(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    server_url: String,
    username: String,
    password: String,
    display_name: Option<String>,
) -> std::result::Result<OAuthResult, String> {
    use crate::providers::calendar::{caldav, CalendarProvider};

    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let vault_path = state
        .vault_path
        .lock()
        .map_err(|_| "vault_path lock poisoned".to_string())?
        .clone()
        .ok_or("No vault")?;
    let db_path = std::path::Path::new(&vault_path)
        .join("nexus.db")
        .to_string_lossy()
        .into_owned();

    // Validate credentials + discover the calendar collections up front.
    let client = reqwest::Client::new();
    let calendar_home = caldav::discover_calendar_home(&client, &server_url, &username, &password)
        .await
        .map_err(|e| e.to_string())?;
    let provider = caldav::CaldavCalendarProvider {
        client,
        base_url: server_url.clone(),
        username: username.clone(),
        password: password.clone(),
        calendar_home: calendar_home.clone(),
    };
    let calendars = provider.list_calendars().await.map_err(|e| e.to_string())?;

    let account_id = format!("acct-{}", uuid::Uuid::new_v4());
    let settings = serde_json::json!({
        "caldav": {
            "serverUrl": server_url,
            "username": username,
            "calendarHome": calendar_home,
        }
    });
    let encrypted_pw = encrypt_credential_for_account(&db_path, &vault_id, &password)
        .map_err(|e| e.to_string())?;

    {
        let db_guard = state.db.lock().map_err(|_| "vault lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or_else(|| "DB not open".to_string())?;
        db.upsert_account(&account_id, &vault_id, "caldav", &username, display_name.as_deref(), None)
            .map_err(|e| e.to_string())?;
        db.save_settings_json(&account_id, &settings.to_string())
            .map_err(|e| e.to_string())?;
        db.save_credential(&account_id, &encrypted_pw)
            .map_err(|e| e.to_string())?;

        // Seed a local Calendar row per discovered collection.
        let now = chrono::Utc::now().timestamp_millis();
        for cal in &calendars {
            let cal_json = serde_json::json!({
                "id": format!("{account_id}::{}", cal.external_id),
                "accountId": account_id,
                "externalId": cal.external_id,
                "name": cal.name,
                "color": cal.color,
                "enabled": true,
                "readOnly": cal.read_only,
                "provider": "caldav",
                "createdAt": now,
                "updatedAt": now,
            });
            db.upsert_calendar(&vault_id, &cal_json).map_err(|e| e.to_string())?;
        }
    }

    let _ = app.emit("vault:hydrate-needed", ());
    Ok(OAuthResult { account_id, email: username })
}

/// Sync events for one CalDAV calendar into the local store (EP-14 Phase 3).
///
/// Opens its own DB connection after all await points (VaultDb is not Send).
/// Parses each fetched VEVENT's iCalendar text and upserts it. Recurring
/// masters keep their RRULE and are expanded on read by the recurrence engine.
#[tauri::command]
pub async fn sync_caldav_calendar(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    account_id: String,
    calendar_external_id: String,
) -> std::result::Result<usize, String> {
    use crate::providers::calendar::{caldav, CalendarProvider};

    let vault_id = get_vault_id(&state).map_err(|e| e.to_string())?;
    let vault_path = state
        .vault_path
        .lock()
        .map_err(|_| "vault_path lock poisoned".to_string())?
        .clone()
        .ok_or("No vault")?;
    let db_path = std::path::Path::new(&vault_path)
        .join("nexus.db")
        .to_string_lossy()
        .into_owned();

    // Read settings + decrypt credential (synchronous, before any await).
    let (server_url, username, calendar_home, password) = {
        let db = crate::db::VaultDb::open(&db_path, "nexus").map_err(|e| e.to_string())?;
        let settings_str = db
            .get_settings_json(&account_id)
            .map_err(|e| e.to_string())?
            .ok_or("CalDAV account has no settings")?;
        let settings: serde_json::Value =
            serde_json::from_str(&settings_str).map_err(|e| e.to_string())?;
        let enc = db
            .get_access_token(&account_id)
            .map_err(|e| e.to_string())?
            .ok_or("CalDAV account has no stored credential")?;
        let pw = decrypt_credential_for_account(&db_path, &vault_id, &enc)
            .map_err(|e| e.to_string())?;
        (
            settings["caldav"]["serverUrl"].as_str().unwrap_or_default().to_owned(),
            settings["caldav"]["username"].as_str().unwrap_or_default().to_owned(),
            settings["caldav"]["calendarHome"].as_str().unwrap_or_default().to_owned(),
            pw,
        )
    };

    // Fetch a ±1 year window of events.
    let now = chrono::Utc::now().timestamp_millis();
    let year_ms: i64 = 365 * 86_400_000;
    let provider = caldav::CaldavCalendarProvider {
        client: reqwest::Client::new(),
        base_url: server_url,
        username,
        password,
        calendar_home,
    };
    let result = provider
        .fetch_events(&calendar_external_id, now - year_ms, now + year_ms, None)
        .await
        .map_err(|e| e.to_string())?;

    // Persist (fresh DB connection — no VaultDb held across the await above).
    let calendar_local_id = format!("{account_id}::{calendar_external_id}");
    let db = crate::db::VaultDb::open(&db_path, "nexus").map_err(|e| e.to_string())?;
    let mut count = 0usize;
    for raw in &result.events {
        match crate::providers::calendar::caldav::ics_to_event_json(
            &raw.ics,
            &vault_id,
            &account_id,
            &calendar_local_id,
            raw.href.as_deref(),
            raw.etag.as_deref(),
        ) {
            Some(ev) => {
                db.upsert_calendar_event(&vault_id, &ev).map_err(|e| e.to_string())?;
                count += 1;
            }
            None => log::warn!("CalDAV: could not parse VEVENT from {:?}", raw.href),
        }
    }

    let _ = app.emit("vault:hydrate-needed", ());
    Ok(count)
}
