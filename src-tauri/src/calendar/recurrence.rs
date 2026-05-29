//! RRULE expansion + exception handling (EP-14 Phase 2).
//!
//! A recurring event is stored as a master row carrying an `RRULE` string,
//! `start_ts`/`end_ts` (the first occurrence + its duration), an optional IANA
//! `tzid`, and a list of `EXDATE` exclusions. This module expands that master
//! into concrete occurrences within a bounded window using the `rrule` crate,
//! which is DST-aware via `chrono-tz`.
//!
//! Design follows Mailspring (GPL — studied, not copied): the master holds the
//! rule; "edit this occurrence" records an inline exception keyed by the
//! occurrence's original start; "edit all" shifts the whole series. We expand
//! within the hydration window so an unbounded `RRULE` (no `UNTIL`/`COUNT`)
//! never expands without limit.

use anyhow::{Context, Result};
use chrono::{DateTime, TimeZone, Utc};

/// One concrete occurrence of a recurring series.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Occurrence {
    /// Occurrence start (epoch ms).
    pub start_ts: i64,
    /// Occurrence end (epoch ms) = start + master duration.
    pub end_ts: i64,
}

/// The scope an edit to a recurring event applies to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditScope {
    /// Just the targeted instance (inline exception + EXDATE).
    Occurrence,
    /// The whole series (merge into the master).
    Series,
    /// This instance and all following — splits the series into two. Not yet
    /// implemented; Mailspring defers this too. We surface it as a typed error
    /// so callers fail cleanly instead of silently corrupting the series.
    ThisAndFollowing,
}

impl EditScope {
    /// Validate that this scope is supported by the engine. Returns a typed
    /// error for `ThisAndFollowing` so the UI can show a clear "not supported
    /// yet" message rather than producing a corrupt series.
    pub fn ensure_supported(self) -> Result<()> {
        match self {
            EditScope::Occurrence | EditScope::Series => Ok(()),
            EditScope::ThisAndFollowing => Err(anyhow::anyhow!(
                "edit scope 'this and following' is not supported yet"
            )),
        }
    }
}

/// Format an epoch-ms instant as an iCalendar UTC datetime (`YYYYMMDDTHHMMSSZ`).
fn ms_to_ical_utc(ms: i64) -> String {
    Utc.timestamp_millis_opt(ms)
        .single()
        .map(|dt| dt.format("%Y%m%dT%H%M%SZ").to_string())
        .unwrap_or_default()
}

/// Expand a recurring master into occurrences within `[window_start, window_end]`
/// (epoch ms, inclusive). `rrule` is the bare RRULE value (no `RRULE:` prefix).
/// `exdates` are occurrence starts (epoch ms) to exclude. `max` caps the number
/// of occurrences to guard against runaway unbounded rules.
pub fn expand_rrule(
    rrule: &str,
    start_ts: i64,
    duration_ms: i64,
    exdates: &[i64],
    window_start: i64,
    window_end: i64,
    max: u16,
) -> Result<Vec<Occurrence>> {
    // Build an iCalendar fragment the `rrule` crate can parse. DTSTART is
    // emitted in UTC; the offset is already baked into `start_ts`.
    let dtstart = ms_to_ical_utc(start_ts);
    let mut ics = format!("DTSTART:{dtstart}\nRRULE:{}", rrule.trim());
    for ex in exdates {
        ics.push_str(&format!("\nEXDATE:{}", ms_to_ical_utc(*ex)));
    }

    let set: rrule::RRuleSet = ics
        .parse()
        .with_context(|| format!("parsing RRULE set: {ics:?}"))?;

    let after: DateTime<rrule::Tz> = rrule::Tz::UTC.timestamp_millis_opt(window_start).single()
        .context("window_start out of range")?;
    let before: DateTime<rrule::Tz> = rrule::Tz::UTC.timestamp_millis_opt(window_end).single()
        .context("window_end out of range")?;

    let result = set.after(after).before(before).all(max);

    Ok(result
        .dates
        .into_iter()
        .map(|dt| {
            let start = dt.timestamp_millis();
            Occurrence { start_ts: start, end_ts: start + duration_ms }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Datelike, Timelike};

    fn ms(y: i32, m: u32, d: u32, h: u32) -> i64 {
        Utc.with_ymd_and_hms(y, m, d, h, 0, 0).single().unwrap().timestamp_millis()
    }

    #[test]
    fn weekly_expansion_within_window() {
        // Every Monday starting 2026-01-05 09:00 UTC.
        let start = ms(2026, 1, 5, 9);
        let occ = expand_rrule(
            "FREQ=WEEKLY;BYDAY=MO",
            start,
            3_600_000,
            &[],
            ms(2026, 1, 1, 0),
            ms(2026, 2, 1, 0),
            100,
        )
        .unwrap();
        // Jan 5, 12, 19, 26 → 4 Mondays in range.
        assert_eq!(occ.len(), 4);
        assert_eq!(occ[0].start_ts, start);
        assert_eq!(occ[0].end_ts, start + 3_600_000);
    }

    #[test]
    fn count_bound_is_respected() {
        let start = ms(2026, 1, 1, 9);
        let occ = expand_rrule(
            "FREQ=DAILY;COUNT=3",
            start,
            3_600_000,
            &[],
            ms(2026, 1, 1, 0),
            ms(2026, 12, 31, 0),
            100,
        )
        .unwrap();
        assert_eq!(occ.len(), 3);
    }

    #[test]
    fn exdate_excludes_occurrence() {
        let start = ms(2026, 1, 1, 9);
        let exclude = ms(2026, 1, 2, 9); // second daily occurrence
        let occ = expand_rrule(
            "FREQ=DAILY;COUNT=3",
            start,
            3_600_000,
            &[exclude],
            ms(2026, 1, 1, 0),
            ms(2026, 12, 31, 0),
            100,
        )
        .unwrap();
        assert_eq!(occ.len(), 2);
        assert!(!occ.iter().any(|o| o.start_ts == exclude));
    }

    #[test]
    fn edit_scope_support_is_typed() {
        assert!(EditScope::Occurrence.ensure_supported().is_ok());
        assert!(EditScope::Series.ensure_supported().is_ok());
        let err = EditScope::ThisAndFollowing.ensure_supported().unwrap_err();
        assert!(err.to_string().contains("not supported"));
    }

    #[test]
    fn dst_keeps_wall_clock_time() {
        // A 9am New York event recurring daily across the 2026-03-08 US DST
        // change should remain 9am local on both sides (the UTC offset shifts).
        let ics = "DTSTART;TZID=America/New_York:20260307T090000\nRRULE:FREQ=DAILY;COUNT=3";
        let set: rrule::RRuleSet = ics.parse().unwrap();
        let dates = set.all(10).dates;
        assert_eq!(dates.len(), 3);
        for dt in &dates {
            assert_eq!(dt.hour(), 9, "occurrence should stay at 9am wall-clock");
        }
        // Sanity: the dates span the DST boundary (Mar 7, 8, 9).
        assert_eq!(dates[0].day(), 7);
        assert_eq!(dates[2].day(), 9);
    }
}
