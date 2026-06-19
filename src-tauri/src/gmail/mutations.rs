use anyhow::{Context, Result};
use base64::Engine;
use serde_json::Value as JsonValue;

use super::label_map::nexus_to_gmail_label;
use crate::db::VaultDb;
use crate::gmail::GmailOAuth;

const GMAIL_API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";

/// Outbound mutations whose target message still has no provider id are deferred
/// and retried until this age cap, then dropped (with a warning) so a message
/// that never syncs cannot pin a mutation in the queue forever. 7 days.
const MAX_UNSYNCED_MUTATION_AGE_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// Whether an unsynced outbound mutation (its target message has no provider id
/// yet) should be dropped rather than deferred for retry, given its age in ms.
fn drop_unsynced_mutation(age_ms: i64) -> bool {
    age_ms >= MAX_UNSYNCED_MUTATION_AGE_MS
}

// ─── Outbound mutation application ───────────────────────────────────────────

/// Apply a single Nexus mutation to the Gmail API.
///
/// Returns `true` if the mutation was provider-relevant and an API call was
/// made, `false` if it is local-only (no API call needed).
pub async fn apply_to_gmail(
    client: &reqwest::Client,
    access_token: &str,
    kind: &str,
    payload: &JsonValue,
    gmail_msg_id: &str,
    vault_id: &str,
) -> Result<bool> {
    match kind {
        "ADD_LABEL" => {
            let nexus_label = payload["labelId"].as_str().unwrap_or_default();
            if let Some(gmail_label) = nexus_to_gmail_label(nexus_label, vault_id) {
                modify_labels(client, access_token, gmail_msg_id, &[&gmail_label], &[]).await?;
            }
            Ok(true)
        }
        "REMOVE_LABEL" => {
            let nexus_label = payload["labelId"].as_str().unwrap_or_default();
            if let Some(gmail_label) = nexus_to_gmail_label(nexus_label, vault_id) {
                modify_labels(client, access_token, gmail_msg_id, &[], &[&gmail_label]).await?;
            }
            Ok(true)
        }
        "ARCHIVE" => {
            modify_labels(client, access_token, gmail_msg_id, &[], &["INBOX"]).await?;
            Ok(true)
        }
        "DELETE_MESSAGE" => {
            // Move to Trash
            modify_labels(
                client,
                access_token,
                gmail_msg_id,
                &["TRASH"],
                &["INBOX"],
            )
            .await?;
            Ok(true)
        }
        "SET_READ" => {
            let read = payload["read"].as_bool().unwrap_or(true);
            if read {
                modify_labels(client, access_token, gmail_msg_id, &[], &["UNREAD"]).await?;
            } else {
                modify_labels(client, access_token, gmail_msg_id, &["UNREAD"], &[]).await?;
            }
            Ok(true)
        }
        "SET_STAR" => {
            let star = payload["star"].as_str();
            match star {
                Some(_) => modify_labels(client, access_token, gmail_msg_id, &["STARRED"], &[]).await?,
                None => modify_labels(client, access_token, gmail_msg_id, &[], &["STARRED"]).await?,
            }
            Ok(true)
        }
        "CLEAR_STAR" => {
            modify_labels(client, access_token, gmail_msg_id, &[], &["STARRED"]).await?;
            Ok(true)
        }
        // All other mutations are local-only
        _ => Ok(false),
    }
}

/// POST to Gmail messages.modify
async fn modify_labels(
    client: &reqwest::Client,
    access_token: &str,
    msg_id: &str,
    add_labels: &[&str],
    remove_labels: &[&str],
) -> Result<()> {
    let url = format!("{GMAIL_API}/messages/{msg_id}/modify");
    let body = serde_json::json!({
        "addLabelIds": add_labels,
        "removeLabelIds": remove_labels,
    });
    let resp = client
        .post(&url)
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .await
        .context("messages.modify")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("Gmail API error {status}: {text}");
    }
    Ok(())
}

/// POST a pre-built base64url-encoded RFC822 message to Gmail send endpoint.
pub async fn send_raw(
    client: &reqwest::Client,
    access_token: &str,
    raw_b64: &str,
) -> Result<String> {
    let url = format!("{GMAIL_API}/messages/send");
    let body = serde_json::json!({ "raw": raw_b64 });
    let resp = client
        .post(&url)
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .await
        .context("messages.send")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("Gmail send error {status}: {text}");
    }

    let json: JsonValue = resp.json().await.context("parsing send response")?;
    Ok(json["id"].as_str().unwrap_or_default().to_string())
}

// ─── Background queue drainer ─────────────────────────────────────────────────

/// Start a background Tokio task that drains the outbound mutation queue
/// every `interval_secs` seconds. Opens its own DB connection each cycle.
pub fn start_drainer(db_path: String, client_id: String, client_secret: String) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.tick().await; // skip first immediate tick

        loop {
            interval.tick().await;
            if let Err(e) = drain_once(&db_path, &client_id, &client_secret).await {
                log::warn!("Mutation drainer error: {e}");
            }
        }
    });
}

async fn drain_once(db_path: &str, client_id: &str, client_secret: &str) -> Result<()> {
    // Load all pending mutations synchronously, then drop the DB handle
    let pending = {
        let db = VaultDb::open(db_path, "nexus")?;
        db.pending_outbound_mutations()?
        // db dropped here — no reference held across await points
    };

    if pending.is_empty() {
        return Ok(());
    }

    log::debug!("Draining {} pending mutations", pending.len());
    let client = reqwest::Client::new();

    for (mut_id, kind, payload_json, vault_id) in &pending {
        let payload: JsonValue = match serde_json::from_str(payload_json) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("Bad mutation payload for {mut_id}: {e}");
                let db = VaultDb::open(db_path, "nexus")?;
                let _ = db.mark_mutation_synced(mut_id);
                continue;
            }
        };

        // Calendar event mutations push via the Calendar API, not messages.modify.
        if matches!(kind.as_str(), "UPSERT_CALENDAR_EVENT" | "UPDATE_CALENDAR_EVENT" | "DELETE_CALENDAR_EVENT") {
            match drain_calendar_event(db_path, client_id, client_secret, &client, kind, &payload).await {
                Ok(_) => {
                    let db = VaultDb::open(db_path, "nexus")?;
                    let _ = db.mark_mutation_synced(mut_id);
                }
                Err(e) => {
                    log::warn!("Calendar push error for {mut_id} ({kind}): {e}");
                    // Leave pending — retry next cycle.
                }
            }
            continue;
        }

        // Synchronous DB lookup — no await, safe to hold VaultDb briefly
        let nexus_msg_id = payload["messageId"].as_str().unwrap_or_default();
        let (gmail_msg_id, account_id) = {
            let db = VaultDb::open(db_path, "nexus")?;
            match db.get_provider_id(nexus_msg_id)? {
                Some(p) => p,
                None => {
                    let age = db.mutation_age_ms(mut_id)?.unwrap_or(i64::MAX);
                    if drop_unsynced_mutation(age) {
                        log::warn!(
                            "Dropping outbound mutation {mut_id}: message {nexus_msg_id} still has no provider_id after {age}ms"
                        );
                        let _ = db.mark_mutation_synced(mut_id);
                    } else {
                        // Message is pending initial sync — leave the mutation in
                        // the queue and retry next cycle once it gets a provider id.
                        log::debug!(
                            "No provider_id yet for {nexus_msg_id}; deferring {mut_id} for retry (age {age}ms)"
                        );
                    }
                    continue;
                }
            }
        }; // db dropped

        // Refresh token if needed (async — VaultDb not held across await)
        let access_token = match ensure_fresh_token(db_path, &account_id, client_id, client_secret).await {
            Ok(t) => t,
            Err(e) => {
                log::warn!("Could not get token for {account_id}: {e}");
                continue; // leave pending, retry next cycle
            }
        };

        // Apply mutation to Gmail (async — VaultDb not held across await)
        match apply_to_gmail(&client, &access_token, kind, &payload, &gmail_msg_id, vault_id).await {
            Ok(_) => {
                let db = VaultDb::open(db_path, "nexus")?;
                let _ = db.mark_mutation_synced(mut_id);
            }
            Err(e) => {
                log::warn!("Gmail API error for {mut_id} ({kind}): {e}");
                // Leave pending — retry next cycle
            }
        }
    }

    Ok(())
}

/// Push a calendar event mutation to Google Calendar.
///
/// Only events whose account is a Google account are pushed; purely local
/// events (account `'local'`/empty) are no-ops. On create, the Google event id
/// is written back to `external_id` so the row is no longer dirty. This is how
/// local-first events reach a provider once one is connected (EP-14 Phase 0).
async fn drain_calendar_event(
    db_path: &str,
    client_id: &str,
    client_secret: &str,
    client: &reqwest::Client,
    kind: &str,
    payload: &JsonValue,
) -> Result<()> {
    let event_id = match kind {
        "DELETE_CALENDAR_EVENT" => payload["eventId"].as_str().unwrap_or_default().to_string(),
        "UPSERT_CALENDAR_EVENT" => payload["event"]["id"].as_str().unwrap_or_default().to_string(),
        _ => payload["id"].as_str().unwrap_or_default().to_string(), // UPDATE_CALENDAR_EVENT
    };
    if event_id.is_empty() {
        return Ok(());
    }

    // Look up the event's push info + resolve the owning account's provider.
    let (info, vault_id, provider) = {
        let db = VaultDb::open(db_path, "nexus")?;
        let info = db.calendar_event_for_push(&event_id)?;
        let account_id = info.as_ref().map(|t| t.0.clone()).unwrap_or_default();
        let accounts = db.all_accounts()?;
        let matched = accounts.iter().find(|(aid, _, _)| aid == &account_id);
        let vault_id = matched.map(|(_, v, _)| v.clone()).unwrap_or_default();
        let provider = matched.map(|(_, _, p)| p.clone()).unwrap_or_default();
        (info, vault_id, provider)
    };

    let Some((account_id, external_id, title, start_ts, end_ts, all_day, location, description, attendees)) = info else {
        return Ok(()); // event no longer exists locally
    };

    // CalDAV events push over WebDAV (PUT/DELETE), not the Google JSON API.
    if provider == "caldav" {
        return drain_caldav_event(
            db_path, client, kind, &event_id, &vault_id, &account_id,
            &title, start_ts, end_ts, all_day, location.as_deref(), description.as_deref(),
        ).await;
    }
    if provider != "gmail" {
        return Ok(()); // local-only or unknown — nothing to sync
    }

    let access_token = ensure_fresh_token(db_path, &account_id, client_id, client_secret).await?;

    match kind {
        "UPSERT_CALENDAR_EVENT" | "UPDATE_CALENDAR_EVENT" if external_id.is_none() => {
            // Not yet on Google — create it and back-write the external id.
            let event = crate::gmail::calendar::create_google_calendar_event(
                client, &access_token, &vault_id, &account_id,
                &title, start_ts, end_ts, all_day,
                location.as_deref(), description.as_deref(), &attendees, None,
            ).await?;
            if let Some(ext) = event["externalId"].as_str() {
                let db = VaultDb::open(db_path, "nexus")?;
                db.set_calendar_event_external_id(&event_id, ext)?;
            }
        }
        "UPSERT_CALENDAR_EVENT" | "UPDATE_CALENDAR_EVENT" => {
            let ext = external_id.unwrap_or_default();
            crate::gmail::calendar::update_google_calendar_event(
                client, &access_token, &vault_id, &account_id, &ext,
                Some(&title), Some(start_ts), Some(end_ts), Some(all_day),
                location.as_deref(), description.as_deref(), Some(&attendees), None,
            ).await?;
        }
        "DELETE_CALENDAR_EVENT" => {
            if let Some(ext) = external_id {
                crate::gmail::calendar::delete_google_calendar_event(client, &access_token, &ext).await?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Push a calendar-event mutation to a CalDAV server (EP-14 Phase 3 outbound).
///
/// Reads the account's stored CalDAV config + decrypted password, builds the
/// provider, then PUTs (create/update) or DELETEs the resource. On a successful
/// PUT the resource href + new ETag are written back so subsequent edits use
/// `If-Match`. All DB access happens through fresh `VaultDb::open` calls outside
/// await points (VaultDb is not Send).
#[allow(clippy::too_many_arguments)]
async fn drain_caldav_event(
    db_path: &str,
    client: &reqwest::Client,
    kind: &str,
    event_id: &str,
    vault_id: &str,
    account_id: &str,
    title: &str,
    start_ts: i64,
    end_ts: i64,
    all_day: bool,
    location: Option<&str>,
    description: Option<&str>,
) -> Result<()> {
    use crate::providers::calendar::{caldav, CalendarProvider};

    // Gather account config + credential + the event's CalDAV identity (sync).
    let (server_url, username, calendar_home, password, href, etag, ical_raw, rrule) = {
        let db = VaultDb::open(db_path, "nexus")?;
        let settings_str = db
            .get_settings_json(account_id)?
            .context("CalDAV account has no settings")?;
        let settings: JsonValue = serde_json::from_str(&settings_str)?;
        let enc = db
            .get_access_token(account_id)?
            .context("CalDAV account has no stored credential")?;
        let password = db.decrypt_account_credential(vault_id, &enc)?;
        let (_acc, href, etag, ical_raw) = db
            .caldav_event_identity(event_id)?
            .unwrap_or((account_id.to_owned(), None, None, None));
        // Pull the stored RRULE (if any) so series keep recurring after a push.
        let rrule = db
            .get_calendar_event(event_id)?
            .and_then(|e| e["rrule"].as_str().map(|s| s.to_owned()));
        (
            settings["caldav"]["serverUrl"].as_str().unwrap_or_default().to_owned(),
            settings["caldav"]["username"].as_str().unwrap_or_default().to_owned(),
            settings["caldav"]["calendarHome"].as_str().unwrap_or_default().to_owned(),
            password,
            href,
            etag,
            ical_raw,
            rrule,
        )
    };

    let provider = caldav::CaldavCalendarProvider {
        client: client.clone(),
        base_url: server_url,
        username,
        password,
        calendar_home: calendar_home.clone(),
    };

    match kind {
        "DELETE_CALENDAR_EVENT" => {
            if let Some(h) = href {
                provider.delete_event(&h, etag.as_deref()).await?;
            }
        }
        _ => {
            // Create or update. Reuse the existing UID if we have raw ICS so the
            // resource keeps a stable identity; otherwise mint a new one.
            let uid = ical_raw
                .as_deref()
                .and_then(extract_uid)
                .unwrap_or_else(|| event_id.to_owned());
            let ics = caldav::event_to_ics(
                &uid, title, start_ts, end_ts, all_day, location, description, rrule.as_deref(),
            );
            let remote = match href.as_deref() {
                Some(h) => provider.update_event(h, etag.as_deref(), &ics).await?,
                None => provider.create_event(&calendar_home, &ics).await?,
            };
            let db = VaultDb::open(db_path, "nexus")?;
            db.set_caldav_event_ref(
                event_id,
                remote.href.as_deref().unwrap_or(&remote.external_id),
                remote.etag.as_deref(),
            )?;
        }
    }
    Ok(())
}

/// Extract the UID line from a raw VCALENDAR string (cheap, no full parse).
fn extract_uid(ics: &str) -> Option<String> {
    ics.lines()
        .find_map(|l| l.strip_prefix("UID:"))
        .map(|s| s.trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_unsynced_mutation_only_after_the_age_cap() {
        assert!(!drop_unsynced_mutation(0));
        assert!(!drop_unsynced_mutation(MAX_UNSYNCED_MUTATION_AGE_MS - 1));
        assert!(drop_unsynced_mutation(MAX_UNSYNCED_MUTATION_AGE_MS));
        assert!(drop_unsynced_mutation(MAX_UNSYNCED_MUTATION_AGE_MS + 1));
    }
}

/// Returns a valid (non-expired) access token, refreshing if needed.
/// Opens and closes its own DB connections so no VaultDb crosses an await point.
pub async fn ensure_fresh_token_pub(
    db_path: &str,
    account_id: &str,
    client_id: &str,
    client_secret: &str,
) -> Result<String> {
    ensure_fresh_token(db_path, account_id, client_id, client_secret).await
}

async fn ensure_fresh_token(
    db_path: &str,
    account_id: &str,
    client_id: &str,
    client_secret: &str,
) -> Result<String> {
    // Read token state synchronously, then close DB
    let (maybe_token, is_valid, refresh_token) = {
        let db = VaultDb::open(db_path, "nexus")?;
        let token = db.get_access_token(account_id)?;
        let valid = db.token_is_valid(account_id)?;
        let refresh = db.get_refresh_token(account_id)?;
        (token, valid, refresh)
    }; // db dropped

    if is_valid {
        if let Some(t) = maybe_token {
            return Ok(t);
        }
    }

    let refresh_token = refresh_token.context("no refresh token for account")?;

    // Async HTTP refresh — no DB reference held
    let oauth = GmailOAuth::new(client_id.to_string(), client_secret.to_string());
    let (new_token, expires_in) = oauth.refresh_access_token(&refresh_token).await?;

    // Save refreshed token (brief synchronous DB open)
    let expires_at = chrono::Utc::now().timestamp() + expires_in;
    {
        let db = VaultDb::open(db_path, "nexus")?;
        db.save_tokens(account_id, &new_token, &refresh_token, expires_at)?;
    }

    Ok(new_token)
}
