//! Calendar provider abstraction (EP-14 Phase 3).
//!
//! Mirrors the `MailProvider` pattern (EP-6) so calendars are provider-agnostic:
//! a local calendar, Google, and CalDAV all expose the same operations. The
//! structure (provider trait + factory + autodiscovery + a CalDAV client) is
//! adapted from velo (Apache-2.0; see `docs/prior-art.md`) — its license permits
//! adaptation with attribution.
//!
//! CalDAV servers return master VEVENTs with their `RRULE`/`EXDATE` (not
//! pre-expanded), so this layer depends on the EP-14 Phase 2 recurrence engine
//! to expand them for display.

pub mod caldav;
pub mod google;

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Metadata for one calendar collection on a provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarInfo {
    /// Provider calendar id (Google calendarId, or CalDAV collection href).
    pub external_id: String,
    pub name: String,
    pub color: Option<String>,
    pub read_only: bool,
}

/// A raw event as returned by a provider — iCalendar text plus its resource
/// identity (href/etag for CalDAV; for Google the event id doubles as both).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawEvent {
    pub external_id: String,
    pub ics: String,
    pub href: Option<String>,
    pub etag: Option<String>,
}

/// Reference to a remote resource after a write.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteRef {
    pub external_id: String,
    pub href: Option<String>,
    pub etag: Option<String>,
}

/// Result of a (possibly incremental) event fetch.
pub struct FetchResult {
    pub events: Vec<RawEvent>,
    pub sync_token: Option<String>,
}

#[async_trait]
pub trait CalendarProvider: Send + Sync {
    fn name(&self) -> &str;
    async fn list_calendars(&self) -> Result<Vec<CalendarInfo>>;
    /// Fetch events in `[time_min, time_max]` (epoch ms). `sync_token` enables
    /// incremental delta sync where the provider supports it.
    async fn fetch_events(
        &self,
        calendar_external_id: &str,
        time_min: i64,
        time_max: i64,
        sync_token: Option<&str>,
    ) -> Result<FetchResult>;
    async fn create_event(&self, calendar_external_id: &str, ics: &str) -> Result<RemoteRef>;
    async fn update_event(&self, href: &str, etag: Option<&str>, ics: &str) -> Result<RemoteRef>;
    async fn delete_event(&self, href: &str, etag: Option<&str>) -> Result<()>;
}
