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

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

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
        "createdAt": now,
        "updatedAt": now,
    }))
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
