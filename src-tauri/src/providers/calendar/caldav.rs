//! CalDAV provider (EP-14 Phase 3).
//!
//! A hand-rolled CalDAV client over `reqwest` + `quick-xml` (avoids a heavy
//! WebDAV dependency). Implements discovery (`.well-known/caldav` →
//! `current-user-principal` → `calendar-home-set` → collection list), a
//! `calendar-query` REPORT for time-ranged event fetch, and ETag-guarded
//! PUT/DELETE for writes. Structure adapted from velo (Apache-2.0; see
//! `docs/prior-art.md`).
//!
//! NOTE: this is a foundation built without a live CalDAV server to test
//! against. The request/response shapes follow RFC 4791, but the wire protocol
//! should be validated against a real server (Fastmail/iCloud/Radicale) before
//! relying on it — see `docs/epic-14-checklist.md` Phase 3.

use anyhow::{Context, Result};
use async_trait::async_trait;
use quick_xml::events::Event as XmlEvent;
use quick_xml::Reader;
use reqwest::Method;

use super::{CalendarInfo, CalendarProvider, FetchResult, RawEvent, RemoteRef};

pub struct CaldavCalendarProvider {
    pub client: reqwest::Client,
    /// Base server origin, e.g. `https://caldav.fastmail.com`.
    pub base_url: String,
    pub username: String,
    pub password: String,
    /// Discovered calendar collection href, e.g. `/dav/calendars/user/.../`.
    pub calendar_home: String,
}

impl CaldavCalendarProvider {
    fn abs_url(&self, href: &str) -> String {
        if href.starts_with("http") {
            href.to_owned()
        } else {
            format!("{}{}", self.base_url.trim_end_matches('/'), href)
        }
    }
}

#[async_trait]
impl CalendarProvider for CaldavCalendarProvider {
    fn name(&self) -> &str {
        "caldav"
    }

    async fn list_calendars(&self) -> Result<Vec<CalendarInfo>> {
        let body = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://apple.com/ns/ical/">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <cs:calendar-color/>
  </d:prop>
</d:propfind>"#;
        let url = self.abs_url(&self.calendar_home);
        let resp = self
            .client
            .request(Method::from_bytes(b"PROPFIND").unwrap(), &url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", "1")
            .header("Content-Type", "application/xml")
            .body(body)
            .send()
            .await
            .context("CalDAV PROPFIND calendar-home")?;
        let text = resp.error_for_status()?.text().await?;
        let responses = parse_multistatus(&text)?;
        Ok(responses
            .into_iter()
            // Only collections that are calendars (have a displayname) and aren't the home itself.
            .filter(|r| r.is_calendar && r.displayname.is_some())
            .map(|r| CalendarInfo {
                external_id: r.href,
                name: r.displayname.unwrap_or_default(),
                color: r.calendar_color,
                read_only: false,
            })
            .collect())
    }

    async fn fetch_events(
        &self,
        calendar_external_id: &str,
        time_min: i64,
        time_max: i64,
        _sync_token: Option<&str>,
    ) -> Result<FetchResult> {
        let fmt = |ms: i64| {
            use chrono::{TimeZone, Utc};
            Utc.timestamp_millis_opt(ms)
                .single()
                .map(|dt| dt.format("%Y%m%dT%H%M%SZ").to_string())
                .unwrap_or_default()
        };
        let body = format!(
            r#"<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="{}" end="{}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>"#,
            fmt(time_min),
            fmt(time_max)
        );
        let url = self.abs_url(calendar_external_id);
        let resp = self
            .client
            .request(Method::from_bytes(b"REPORT").unwrap(), &url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", "1")
            .header("Content-Type", "application/xml")
            .body(body)
            .send()
            .await
            .context("CalDAV calendar-query REPORT")?;
        let text = resp.error_for_status()?.text().await?;
        let responses = parse_multistatus(&text)?;
        let events = responses
            .into_iter()
            .filter_map(|r| {
                let ics = r.calendar_data?;
                Some(RawEvent {
                    external_id: r.href.clone(),
                    ics,
                    href: Some(r.href),
                    etag: r.getetag,
                })
            })
            .collect();
        Ok(FetchResult { events, sync_token: None })
    }

    async fn create_event(&self, calendar_external_id: &str, ics: &str) -> Result<RemoteRef> {
        // New resource href = collection + a fresh UID-based filename.
        let uid = uuid::Uuid::new_v4();
        let href = format!("{}/{}.ics", calendar_external_id.trim_end_matches('/'), uid);
        let url = self.abs_url(&href);
        let resp = self
            .client
            .put(&url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Content-Type", "text/calendar; charset=utf-8")
            .header("If-None-Match", "*")
            .body(ics.to_owned())
            .send()
            .await
            .context("CalDAV PUT (create)")?
            .error_for_status()?;
        let etag = resp.headers().get("ETag").and_then(|v| v.to_str().ok()).map(|s| s.to_owned());
        Ok(RemoteRef { external_id: href.clone(), href: Some(href), etag })
    }

    async fn update_event(&self, href: &str, etag: Option<&str>, ics: &str) -> Result<RemoteRef> {
        let url = self.abs_url(href);
        let mut req = self
            .client
            .put(&url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Content-Type", "text/calendar; charset=utf-8")
            .body(ics.to_owned());
        if let Some(tag) = etag {
            req = req.header("If-Match", tag);
        }
        let resp = req.send().await.context("CalDAV PUT (update)")?.error_for_status()?;
        let new_etag = resp.headers().get("ETag").and_then(|v| v.to_str().ok()).map(|s| s.to_owned());
        Ok(RemoteRef { external_id: href.to_owned(), href: Some(href.to_owned()), etag: new_etag })
    }

    async fn delete_event(&self, href: &str, etag: Option<&str>) -> Result<()> {
        let url = self.abs_url(href);
        let mut req = self.client.delete(&url).basic_auth(&self.username, Some(&self.password));
        if let Some(tag) = etag {
            req = req.header("If-Match", tag);
        }
        let resp = req.send().await.context("CalDAV DELETE")?;
        // 404 Not Found / 410 Gone both mean "already deleted" — treat as success.
        if resp.status().is_success()
            || matches!(resp.status().as_u16(), 404 | 410)
        {
            Ok(())
        } else {
            anyhow::bail!("CalDAV delete failed: {}", resp.status())
        }
    }
}

/// Discover a user's calendar-home collection href from a server origin.
/// Follows `.well-known/caldav` → `current-user-principal` → `calendar-home-set`.
pub async fn discover_calendar_home(
    client: &reqwest::Client,
    base_url: &str,
    username: &str,
    password: &str,
) -> Result<String> {
    let well_known = format!("{}/.well-known/caldav", base_url.trim_end_matches('/'));

    let principal_body = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>"#;
    let resp = client
        .request(Method::from_bytes(b"PROPFIND").unwrap(), &well_known)
        .basic_auth(username, Some(password))
        .header("Depth", "0")
        .header("Content-Type", "application/xml")
        .body(principal_body)
        .send()
        .await
        .context("CalDAV principal discovery")?;
    let text = resp.error_for_status()?.text().await?;
    let principal = first_href_for_prop(&text, "current-user-principal")
        .context("no current-user-principal in response")?;

    let home_body = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>"#;
    let principal_url = if principal.starts_with("http") {
        principal
    } else {
        format!("{}{}", base_url.trim_end_matches('/'), principal)
    };
    let resp = client
        .request(Method::from_bytes(b"PROPFIND").unwrap(), &principal_url)
        .basic_auth(username, Some(password))
        .header("Depth", "0")
        .header("Content-Type", "application/xml")
        .body(home_body)
        .send()
        .await
        .context("CalDAV calendar-home discovery")?;
    let text = resp.error_for_status()?.text().await?;
    first_href_for_prop(&text, "calendar-home-set").context("no calendar-home-set in response")
}

// ─── Minimal WebDAV multistatus parsing (quick-xml) ──────────────────────────

#[derive(Default, Debug)]
struct DavResponse {
    href: String,
    getetag: Option<String>,
    calendar_data: Option<String>,
    displayname: Option<String>,
    calendar_color: Option<String>,
    is_calendar: bool,
}

/// Parse a WebDAV `<multistatus>` body into per-resource responses. Element
/// namespaces are ignored — matching is by local name (the suffix after `:`).
fn parse_multistatus(xml: &str) -> Result<Vec<DavResponse>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut out: Vec<DavResponse> = Vec::new();
    let mut cur: Option<DavResponse> = None;
    let mut path: Vec<String> = Vec::new();

    loop {
        match reader.read_event() {
            Ok(XmlEvent::Start(e)) => {
                let local = local_name(e.name().as_ref());
                if local == "response" {
                    cur = Some(DavResponse::default());
                }
                if local == "calendar" {
                    if let Some(c) = cur.as_mut() {
                        c.is_calendar = true;
                    }
                }
                path.push(local);
            }
            Ok(XmlEvent::Empty(e)) => {
                let local = local_name(e.name().as_ref());
                if local == "calendar" {
                    if let Some(c) = cur.as_mut() {
                        c.is_calendar = true;
                    }
                }
            }
            Ok(XmlEvent::Text(t)) => {
                let text = t.unescape().unwrap_or_default().to_string();
                if text.is_empty() {
                    continue;
                }
                let parent = path.last().map(|s| s.as_str()).unwrap_or("");
                if let Some(c) = cur.as_mut() {
                    match parent {
                        "href" if c.href.is_empty() => c.href = text,
                        "getetag" => c.getetag = Some(text),
                        "calendar-data" => c.calendar_data = Some(text),
                        "displayname" => c.displayname = Some(text),
                        "calendar-color" => c.calendar_color = Some(text),
                        _ => {}
                    }
                }
            }
            Ok(XmlEvent::End(e)) => {
                let local = local_name(e.name().as_ref());
                path.pop();
                if local == "response" {
                    if let Some(c) = cur.take() {
                        out.push(c);
                    }
                }
            }
            Ok(XmlEvent::Eof) => break,
            Err(e) => return Err(anyhow::anyhow!("XML parse error: {e}")),
            _ => {}
        }
    }
    Ok(out)
}

/// Return the first `<href>` value nested under an element with the given local name.
fn first_href_for_prop(xml: &str, prop_local: &str) -> Option<String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut in_prop = false;
    let mut path: Vec<String> = Vec::new();
    loop {
        match reader.read_event() {
            Ok(XmlEvent::Start(e)) => {
                let local = local_name(e.name().as_ref());
                if local == prop_local {
                    in_prop = true;
                }
                path.push(local);
            }
            Ok(XmlEvent::Text(t)) => {
                if in_prop && path.last().map(|s| s.as_str()) == Some("href") {
                    let text = t.unescape().unwrap_or_default().to_string();
                    if !text.is_empty() {
                        return Some(text);
                    }
                }
            }
            Ok(XmlEvent::End(e)) => {
                let local = local_name(e.name().as_ref());
                if local == prop_local {
                    in_prop = false;
                }
                path.pop();
            }
            Ok(XmlEvent::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }
    None
}

/// Local name = the part after the last `:` in a possibly-namespaced QName.
fn local_name(raw: &[u8]) -> String {
    let s = String::from_utf8_lossy(raw);
    s.rsplit(':').next().unwrap_or(&s).to_string()
}

// ─── iCalendar VEVENT → event JSON ───────────────────────────────────────────

/// Parse a single VEVENT out of an iCalendar string into the JSON shape
/// `upsert_calendar_event` consumes. Returns `None` if no VEVENT is present or
/// it lacks the required start/UID. The event keeps its `RRULE` so the
/// recurrence engine expands it on read; all-day events are stored floating
/// (UTC-anchored), consistent with EP-14 Phase 1.
pub fn ics_to_event_json(
    ics: &str,
    vault_id: &str,
    account_id: &str,
    calendar_local_id: &str,
    href: Option<&str>,
    etag: Option<&str>,
) -> Option<serde_json::Value> {
    use icalendar::{Calendar, Component, EventLike};

    let parsed: Calendar = ics.parse().ok()?;
    let event = parsed.components.iter().find_map(|c| c.as_event())?;

    let uid = event.get_uid()?.to_owned();
    let (start_ts, all_day) = dpt_to_ms(event.get_start()?)?;
    // End is optional in iCalendar; default to a zero-length event.
    let end_ts = event
        .get_end()
        .and_then(dpt_to_ms)
        .map(|(ts, _)| ts)
        .unwrap_or(start_ts);

    let title = event.get_summary().unwrap_or("(no title)").to_owned();
    let description = event.get_description().map(|s| s.to_owned());
    let location = event.get_location().map(|s| s.to_owned());

    // RRULE (if present) — store the bare value, no "RRULE:" prefix.
    let rrule = event
        .properties()
        .get("RRULE")
        .map(|p| p.value().to_owned());

    let now = chrono::Utc::now().timestamp_millis();
    // The resource href is the stable external id for CalDAV writes.
    let external_id = href.unwrap_or(&uid);

    Some(serde_json::json!({
        "id": format!("{account_id}::{uid}"),
        "vaultId": vault_id,
        "accountId": account_id,
        "calendarId": calendar_local_id,
        "calendarLocalId": calendar_local_id,
        "externalId": external_id,
        "iCalUID": uid,
        "title": title,
        "description": description,
        "location": location,
        "startTs": start_ts,
        "endTs": end_ts,
        "allDay": all_day,
        "rrule": rrule,
        "status": "confirmed",
        "attendees": [],
        "icalHref": href,
        "icalEtag": etag,
        "icalRaw": ics,
        "createdAt": now,
        "updatedAt": now,
    }))
}

/// Serialize an event (the fields `calendar_event_for_push` exposes) into a
/// minimal VCALENDAR string suitable for a CalDAV PUT body. If `existing_ics` is
/// provided we reuse its UID so the resource keeps a stable identity across
/// edits; otherwise a fresh UID is generated.
#[allow(clippy::too_many_arguments)]
pub fn event_to_ics(
    uid: &str,
    title: &str,
    start_ts: i64,
    end_ts: i64,
    all_day: bool,
    location: Option<&str>,
    description: Option<&str>,
    rrule: Option<&str>,
) -> String {
    use icalendar::{Calendar, Component, Event, EventLike};
    use chrono::{TimeZone, Utc};

    let mut event = Event::new();
    event.uid(uid);
    event.summary(title);
    if let Some(loc) = location {
        event.location(loc);
    }
    if let Some(desc) = description {
        event.description(desc);
    }

    if all_day {
        // Floating DATE values, read from the UTC-anchored timestamps.
        let start = Utc.timestamp_millis_opt(start_ts).single().map(|d| d.date_naive());
        let end = Utc.timestamp_millis_opt(end_ts).single().map(|d| d.date_naive());
        if let (Some(s), Some(e)) = (start, end) {
            event.starts(s);
            event.ends(e);
        }
    } else {
        let start = Utc.timestamp_millis_opt(start_ts).single();
        let end = Utc.timestamp_millis_opt(end_ts).single();
        if let (Some(s), Some(e)) = (start, end) {
            event.starts(s);
            event.ends(e);
        }
    }

    if let Some(rule) = rrule {
        // `rrule` is stored without the "RRULE:" prefix; add the property raw.
        event.add_property("RRULE", rule);
    }

    let mut calendar = Calendar::new();
    calendar.push(event.done());
    calendar.to_string()
}

/// Convert an iCalendar date/time to `(epoch_ms, is_all_day)`. A bare DATE is
/// all-day (floating, anchored at UTC midnight); a DATE-TIME carries its offset.
fn dpt_to_ms(dpt: icalendar::DatePerhapsTime) -> Option<(i64, bool)> {
    use icalendar::{CalendarDateTime, DatePerhapsTime};
    match dpt {
        DatePerhapsTime::Date(d) => {
            let ts = d.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis();
            Some((ts, true))
        }
        DatePerhapsTime::DateTime(cdt) => match cdt {
            CalendarDateTime::Utc(dt) => Some((dt.timestamp_millis(), false)),
            CalendarDateTime::Floating(dt) => Some((dt.and_utc().timestamp_millis(), false)),
            CalendarDateTime::WithTimezone { date_time, tzid } => {
                // Resolve the IANA tzid to a real offset (DST-aware) via chrono-tz.
                let tz: chrono_tz::Tz = tzid.parse().ok()?;
                use chrono::TimeZone;
                let dt = tz.from_local_datetime(&date_time).single()?;
                Some((dt.timestamp_millis(), false))
            }
        },
    }
}

#[cfg(test)]
mod ics_tests {
    use super::*;

    const SAMPLE: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:abc-123\r\nSUMMARY:Team Sync\r\nDTSTART:20260601T090000Z\r\nDTEND:20260601T100000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    #[test]
    fn parses_vevent_with_rrule() {
        let ev = ics_to_event_json(SAMPLE, "v1", "acct-1", "acct-1::home", Some("/dav/e1.ics"), Some("\"etag1\""))
            .expect("should parse");
        assert_eq!(ev["title"], "Team Sync");
        assert_eq!(ev["iCalUID"], "abc-123");
        assert_eq!(ev["externalId"], "/dav/e1.ics");
        assert_eq!(ev["rrule"], "FREQ=WEEKLY;BYDAY=MO");
        assert_eq!(ev["allDay"], false);
        // 2026-06-01T09:00:00Z
        assert_eq!(ev["startTs"].as_i64().unwrap(), 1_780_304_400_000);
    }

    #[test]
    fn returns_none_without_vevent() {
        let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
        assert!(ics_to_event_json(ics, "v1", "a", "a::c", None, None).is_none());
    }

    #[test]
    fn event_to_ics_round_trips_through_parser() {
        // 2026-06-01T09:00:00Z .. 10:00:00Z, weekly.
        let start = 1_780_304_400_000;
        let end = start + 3_600_000;
        let ics = event_to_ics(
            "uid-xyz", "Standup", start, end, false,
            Some("Room 4"), Some("daily sync"), Some("FREQ=WEEKLY;BYDAY=MO"),
        );
        let ev = ics_to_event_json(&ics, "v1", "acct-1", "acct-1::home", None, None)
            .expect("serialized ICS should parse back");
        assert_eq!(ev["title"], "Standup");
        assert_eq!(ev["iCalUID"], "uid-xyz");
        assert_eq!(ev["location"], "Room 4");
        assert_eq!(ev["rrule"], "FREQ=WEEKLY;BYDAY=MO");
        assert_eq!(ev["startTs"].as_i64().unwrap(), start);
        assert_eq!(ev["allDay"], false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_calendar_query_report() {
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/dav/cal/event1.ics</d:href>
    <d:propstat><d:prop>
      <d:getetag>"abc123"</d:getetag>
      <c:calendar-data>BEGIN:VCALENDAR
END:VCALENDAR</c:calendar-data>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>"#;
        let responses = parse_multistatus(xml).unwrap();
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].href, "/dav/cal/event1.ics");
        assert_eq!(responses[0].getetag.as_deref(), Some("\"abc123\""));
        assert!(responses[0].calendar_data.as_deref().unwrap().contains("VCALENDAR"));
    }

    #[test]
    fn extracts_principal_href() {
        let xml = r#"<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/principal-path/</d:href>
    <d:propstat><d:prop>
      <d:current-user-principal><d:href>/principals/users/jane/</d:href></d:current-user-principal>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>"#;
        assert_eq!(
            first_href_for_prop(xml, "current-user-principal").as_deref(),
            Some("/principals/users/jane/")
        );
    }
}
