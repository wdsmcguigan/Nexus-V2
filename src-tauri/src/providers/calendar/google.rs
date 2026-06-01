//! Google Calendar provider adapter (EP-14 Phase 3).
//!
//! Wraps the existing `gmail::calendar` functions behind `CalendarProvider` so
//! Google sits alongside CalDAV under one abstraction. Reads (list/fetch) are
//! mapped here; Google writes continue to flow through the JSON command path
//! (`create_calendar_event` / the drainer), which is richer than round-tripping
//! ICS through Google's JSON API.

use anyhow::{bail, Result};
use async_trait::async_trait;

use super::{CalendarInfo, CalendarProvider, FetchResult, RawEvent, RemoteRef};

pub struct GoogleCalendarProvider {
    pub client: reqwest::Client,
    pub access_token: String,
    pub vault_id: String,
    pub account_id: String,
}

#[async_trait]
impl CalendarProvider for GoogleCalendarProvider {
    fn name(&self) -> &str {
        "google"
    }

    async fn list_calendars(&self) -> Result<Vec<CalendarInfo>> {
        let raw = crate::gmail::calendar::fetch_google_calendar_list(&self.client, &self.access_token).await?;
        Ok(raw
            .into_iter()
            .map(|c| CalendarInfo {
                external_id: c["id"].as_str().unwrap_or_default().to_owned(),
                name: c["summary"].as_str().unwrap_or_default().to_owned(),
                color: c["backgroundColor"].as_str().map(|s| s.to_owned()),
                read_only: false,
            })
            .collect())
    }

    async fn fetch_events(
        &self,
        calendar_external_id: &str,
        time_min: i64,
        time_max: i64,
        sync_token: Option<&str>,
    ) -> Result<FetchResult> {
        let to_rfc3339 = |ms: i64| {
            use chrono::{TimeZone, Utc};
            Utc.timestamp_millis_opt(ms)
                .single()
                .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
                .unwrap_or_default()
        };
        // EP14 multi-cal: the trait passes the target Google calendar id (e.g.
        // "primary" or a holiday calendar). Default to "primary" when the
        // caller didn't supply one, matching pre-multi-cal behavior.
        let cal_id = if calendar_external_id.is_empty() { "primary" } else { calendar_external_id };
        let (events, new_token) = crate::gmail::calendar::fetch_google_calendar_events(
            &self.client,
            &self.access_token,
            &self.vault_id,
            &self.account_id,
            cal_id,
            sync_token,
            &to_rfc3339(time_min),
            &to_rfc3339(time_max),
            crate::gmail::calendar::expand_recurrences_enabled(),
        )
        .await?;
        // The Google path is JSON-native; expose the provider event id. ICS is
        // left empty because downstream storage uses the already-mapped JSON.
        let events = events
            .into_iter()
            .map(|e| RawEvent {
                external_id: e["externalId"].as_str().unwrap_or_default().to_owned(),
                ics: String::new(),
                href: None,
                etag: None,
            })
            .collect();
        Ok(FetchResult { events, sync_token: new_token })
    }

    async fn create_event(&self, _calendar_external_id: &str, _ics: &str) -> Result<RemoteRef> {
        bail!("Google event creation flows through the JSON command path, not ICS")
    }

    async fn update_event(&self, _href: &str, _etag: Option<&str>, _ics: &str) -> Result<RemoteRef> {
        bail!("Google event updates flow through the JSON command path, not ICS")
    }

    async fn delete_event(&self, href: &str, _etag: Option<&str>) -> Result<()> {
        crate::gmail::calendar::delete_google_calendar_event(&self.client, &self.access_token, href).await
    }
}
