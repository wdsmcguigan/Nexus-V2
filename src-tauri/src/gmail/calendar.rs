use anyhow::Result;

/// Fetch Google Calendar events using the Events List API v3.
///
/// When `sync_token` is `Some`, fetches only changed events since the last sync
/// (delta sync). When `None`, fetches all events in the given time window.
/// Returns `(events_as_json_values, next_sync_token)`.
pub async fn fetch_google_calendar_events(
    client: &reqwest::Client,
    access_token: &str,
    vault_id: &str,
    account_id: &str,
    sync_token: Option<&str>,
    time_min: &str,
    time_max: &str,
) -> Result<(Vec<serde_json::Value>, Option<String>)> {
    let mut events = Vec::new();
    let mut page_token: Option<String> = None;
    let mut next_sync_token: Option<String> = None;

    loop {
        let mut url = String::from(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events\
            ?maxResults=250&singleEvents=true",
        );

        if let Some(ref st) = sync_token {
            // Delta sync: syncToken implies showDeleted=true
            url.push_str(&format!("&syncToken={st}&showDeleted=true"));
        } else {
            // Full sync: time-bounded window
            url.push_str(&format!(
                "&orderBy=startTime&timeMin={time_min}&timeMax={time_max}&showDeleted=false"
            ));
        }

        if let Some(ref pt) = page_token {
            url.push_str(&format!("&pageToken={pt}"));
        }

        let resp = client
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await?;

        // Google returns 410 Gone when the sync token has expired; caller should
        // retry with a full sync (sync_token = None).
        if resp.status() == reqwest::StatusCode::GONE {
            return Err(anyhow::anyhow!("syncToken expired"));
        }

        let body: serde_json::Value = resp.json().await?;

        if let Some(items) = body["items"].as_array() {
            for item in items {
                if let Some(ev) = map_event(item, vault_id, account_id) {
                    events.push(ev);
                }
            }
        }

        if let Some(nst) = body["nextSyncToken"].as_str() {
            next_sync_token = Some(nst.to_owned());
        }

        page_token = body["nextPageToken"].as_str().map(|s| s.to_owned());
        if page_token.is_none() {
            break;
        }
    }

    Ok((events, next_sync_token))
}

fn map_event(item: &serde_json::Value, vault_id: &str, account_id: &str) -> Option<serde_json::Value> {
    let external_id = item["id"].as_str()?;
    let id = format!("{account_id}-{external_id}");
    let title = item["summary"].as_str().unwrap_or("(no title)");
    let status = item["status"].as_str().unwrap_or("confirmed");

    let (start_ts, all_day) = parse_google_datetime(&item["start"])?;
    let (end_ts, _) = parse_google_datetime(&item["end"])?;

    let rrule = item["recurrence"]
        .as_array()
        .and_then(|arr| arr.iter().find(|v| v.as_str().map_or(false, |s| s.starts_with("RRULE:"))))
        .and_then(|v| v.as_str())
        .map(|s| s.trim_start_matches("RRULE:").to_owned());

    let organizer_email = item["organizer"]["email"].as_str().map(|s| s.to_owned());

    let attendees: Vec<serde_json::Value> = item["attendees"]
        .as_array()
        .map(|arr| {
            arr.iter().map(|a| {
                serde_json::json!({
                    "email": a["email"].as_str().unwrap_or(""),
                    "name": a["displayName"].as_str(),
                    "responseStatus": a["responseStatus"].as_str().unwrap_or("needsAction"),
                    "self": a["self"].as_bool().unwrap_or(false),
                    "organizer": a["organizer"].as_bool().unwrap_or(false),
                })
            }).collect()
        })
        .unwrap_or_default();

    let html_link = item["htmlLink"].as_str().map(|s| s.to_owned());
    let description = item["description"].as_str().map(|s| s.to_owned());
    let location = item["location"].as_str().map(|s| s.to_owned());

    // Google Meet / conference link — first video entryPoint URI
    let conference_url = item["conferenceData"]["entryPoints"]
        .as_array()
        .and_then(|eps| eps.iter().find(|e| e["entryPointType"].as_str() == Some("video")))
        .and_then(|ep| ep["uri"].as_str())
        .map(|s| s.to_owned());

    let color_id = item["colorId"].as_str().map(|s| s.to_owned());
    let ical_uid = item["iCalUID"].as_str().map(|s| s.to_owned());
    let recurring_event_id = item["recurringEventId"].as_str().map(|s| s.to_owned());
    let creator_email = item["creator"]["email"].as_str().map(|s| s.to_owned());
    let visibility = item["visibility"].as_str().map(|s| s.to_owned());
    let transparency = item["transparency"].as_str().map(|s| s.to_owned());

    // Reminder overrides (array of {method, minutes})
    let reminders = item["reminders"]["overrides"].clone();

    // Drive file attachments (array of {fileUrl, title, mimeType, ...})
    let attachments = item["attachments"].clone();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    // Use Google's server-side timestamps; fall back to now only if absent
    let created_at = item["created"].as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(now);
    let updated_at = item["updated"].as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(now);

    Some(serde_json::json!({
        "id": id,
        "vaultId": vault_id,
        "accountId": account_id,
        "calendarId": "primary",
        "externalId": external_id,
        "title": title,
        "description": description,
        "location": location,
        "startTs": start_ts,
        "endTs": end_ts,
        "allDay": all_day,
        "rrule": rrule,
        "status": status,
        "organizerEmail": organizer_email,
        "attendees": attendees,
        "htmlLink": html_link,
        "conferenceUrl": conference_url,
        "colorId": color_id,
        "iCalUID": ical_uid,
        "recurringEventId": recurring_event_id,
        "creatorEmail": creator_email,
        "visibility": visibility,
        "transparency": transparency,
        "reminders": reminders,
        "attachments": attachments,
        "createdAt": created_at,
        "updatedAt": updated_at,
    }))
}

/// Create a new event on the user's primary Google Calendar.
/// Returns the created event mapped to our schema (same shape as `map_event` output).
pub async fn create_google_calendar_event(
    client: &reqwest::Client,
    access_token: &str,
    vault_id: &str,
    account_id: &str,
    title: &str,
    start_ts: i64,
    end_ts: i64,
    all_day: bool,
    location: Option<&str>,
    description: Option<&str>,
    attendee_emails: &[String],
) -> Result<serde_json::Value> {
    let (start_val, end_val) = if all_day {
        let start_date = ms_to_date_str(start_ts);
        let end_date = ms_to_date_str(end_ts);
        (serde_json::json!({ "date": start_date }), serde_json::json!({ "date": end_date }))
    } else {
        let start_dt = ms_to_rfc3339(start_ts);
        let end_dt = ms_to_rfc3339(end_ts);
        (serde_json::json!({ "dateTime": start_dt, "timeZone": "UTC" }), serde_json::json!({ "dateTime": end_dt, "timeZone": "UTC" }))
    };

    let attendees: Vec<serde_json::Value> = attendee_emails
        .iter()
        .map(|e| serde_json::json!({ "email": e }))
        .collect();

    let mut body = serde_json::json!({
        "summary": title,
        "start": start_val,
        "end": end_val,
        "attendees": attendees,
    });
    if let Some(loc) = location { body["location"] = serde_json::Value::String(loc.to_owned()); }
    if let Some(desc) = description { body["description"] = serde_json::Value::String(desc.to_owned()); }

    let resp = client
        .post("https://www.googleapis.com/calendar/v3/calendars/primary/events")
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .await?;

    let item: serde_json::Value = resp.error_for_status()?.json().await?;
    map_event(&item, vault_id, account_id)
        .ok_or_else(|| anyhow::anyhow!("failed to parse created event"))
}

/// Update an existing event on the user's primary Google Calendar via PATCH.
/// Returns the updated event mapped to our schema.
pub async fn update_google_calendar_event(
    client: &reqwest::Client,
    access_token: &str,
    vault_id: &str,
    account_id: &str,
    external_id: &str,
    title: Option<&str>,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    all_day: Option<bool>,
    location: Option<&str>,
    description: Option<&str>,
    attendee_emails: Option<&[String]>,
) -> Result<serde_json::Value> {
    let mut body = serde_json::json!({});

    if let Some(t) = title { body["summary"] = serde_json::Value::String(t.to_owned()); }
    if let Some(loc) = location { body["location"] = serde_json::Value::String(loc.to_owned()); }
    if let Some(desc) = description { body["description"] = serde_json::Value::String(desc.to_owned()); }
    if let Some(emails) = attendee_emails {
        let attendees: Vec<serde_json::Value> = emails.iter().map(|e| serde_json::json!({ "email": e })).collect();
        body["attendees"] = serde_json::Value::Array(attendees);
    }

    if let (Some(s), Some(e)) = (start_ts, end_ts) {
        let is_all_day = all_day.unwrap_or(false);
        if is_all_day {
            body["start"] = serde_json::json!({ "date": ms_to_date_str(s) });
            body["end"] = serde_json::json!({ "date": ms_to_date_str(e) });
        } else {
            body["start"] = serde_json::json!({ "dateTime": ms_to_rfc3339(s), "timeZone": "UTC" });
            body["end"] = serde_json::json!({ "dateTime": ms_to_rfc3339(e), "timeZone": "UTC" });
        }
    }

    let encoded_id: String = url::form_urlencoded::byte_serialize(external_id.as_bytes()).collect();
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events/{encoded_id}"
    );

    let resp = client
        .patch(&url)
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .await?;

    let item: serde_json::Value = resp.error_for_status()?.json().await?;
    map_event(&item, vault_id, account_id)
        .ok_or_else(|| anyhow::anyhow!("failed to parse updated event"))
}

/// Fetch the list of calendars the user has access to.
pub async fn fetch_google_calendar_list(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<Vec<serde_json::Value>> {
    let resp = client
        .get("https://www.googleapis.com/calendar/v3/users/me/calendarList")
        .bearer_auth(access_token)
        .send()
        .await?;

    let body: serde_json::Value = resp.error_for_status()?.json().await?;
    let items = body["items"]
        .as_array()
        .map(|arr| {
            arr.iter().map(|c| serde_json::json!({
                "id": c["id"].as_str().unwrap_or(""),
                "summary": c["summary"].as_str().unwrap_or(""),
                "backgroundColor": c["backgroundColor"].as_str().unwrap_or("#4285f4"),
                "selected": c["selected"].as_bool().unwrap_or(false),
            })).collect()
        })
        .unwrap_or_default();
    Ok(items)
}

fn ms_to_rfc3339(ms: i64) -> String {
    use chrono::{TimeZone, Utc};
    Utc.timestamp_millis_opt(ms)
        .single()
        .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_default()
}

fn ms_to_date_str(ms: i64) -> String {
    use chrono::{TimeZone, Utc};
    Utc.timestamp_millis_opt(ms)
        .single()
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

/// Parse a Google Calendar datetime object (`{ dateTime: "...", date: "..." }`).
/// Returns `(unix_ms, is_all_day)`.
fn parse_google_datetime(dt: &serde_json::Value) -> Option<(i64, bool)> {
    if let Some(s) = dt["dateTime"].as_str() {
        // RFC 3339 datetime
        let ts = chrono::DateTime::parse_from_rfc3339(s).ok()?.timestamp_millis();
        return Some((ts, false));
    }
    if let Some(s) = dt["date"].as_str() {
        // All-day date "YYYY-MM-DD" — treat as midnight UTC
        use chrono::NaiveDate;
        let d = NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()?;
        let ts = d.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis();
        return Some((ts, true));
    }
    None
}
