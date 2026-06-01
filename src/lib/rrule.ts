/**
 * RRULE (RFC 5545) build / parse / format helpers (EP-14).
 *
 * Scoped to what the RecurrenceEditor UI exposes — daily / weekly / monthly /
 * yearly, an interval, optional BYDAY for weekly, optional BYMONTHDAY for
 * monthly, and an end condition (never / count / until). Anything outside that
 * shape round-trips as-is.
 *
 * Expansion is the Rust side's job (`src-tauri/src/calendar/recurrence.rs`); we
 * just emit a string the `rrule` crate can parse.
 */

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export interface RrulePartsBase {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval?: number;
  byday?: Weekday[];
  bymonthday?: number[];
  count?: number;
  /**
   * End-date as an epoch ms (the UI carries it as a Date input value). The
   * UNTIL serialisation depends on `allDay`: date-only for all-day events,
   * UTC datetime otherwise.
   */
  until?: number;
}

export interface RruleParts extends RrulePartsBase {
  allDay?: boolean;
}

const WEEKDAYS_ORDER: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatUntilDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

function formatUntilDateTime(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

function parseUntil(raw: string): number | undefined {
  // Accept either YYYYMMDD or YYYYMMDDTHHMMSSZ.
  const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (dateMatch) {
    const [, y, m, d] = dateMatch;
    return Date.UTC(Number(y), Number(m) - 1, Number(d));
  }
  const dtMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw);
  if (dtMatch) {
    const [, y, m, d, hh, mm, ss] = dtMatch;
    return Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  }
  return undefined;
}

export function buildRrule(parts: RruleParts): string {
  const segs: string[] = [`FREQ=${parts.freq}`];
  if (parts.interval && parts.interval > 1) segs.push(`INTERVAL=${parts.interval}`);
  if (parts.byday && parts.byday.length > 0) {
    // Sort so output is stable regardless of click order.
    const ordered = [...parts.byday].sort(
      (a, b) => WEEKDAYS_ORDER.indexOf(a) - WEEKDAYS_ORDER.indexOf(b),
    );
    segs.push(`BYDAY=${ordered.join(",")}`);
  }
  if (parts.bymonthday && parts.bymonthday.length > 0) {
    segs.push(`BYMONTHDAY=${parts.bymonthday.join(",")}`);
  }
  if (parts.count != null) {
    segs.push(`COUNT=${parts.count}`);
  } else if (parts.until != null) {
    segs.push(
      `UNTIL=${parts.allDay ? formatUntilDate(parts.until) : formatUntilDateTime(parts.until)}`,
    );
  }
  return segs.join(";");
}

export function parseRrule(rrule: string | undefined): RruleParts | undefined {
  if (!rrule) return undefined;
  // Some serialisers prefix with "RRULE:" — strip it.
  const body = rrule.startsWith("RRULE:") ? rrule.slice(6) : rrule;
  const map: Record<string, string> = {};
  for (const seg of body.split(";")) {
    const [k, v] = seg.split("=");
    if (k && v !== undefined) map[k.toUpperCase()] = v;
  }
  const freqRaw = map["FREQ"];
  if (freqRaw !== "DAILY" && freqRaw !== "WEEKLY" && freqRaw !== "MONTHLY" && freqRaw !== "YEARLY") {
    return undefined;
  }
  const out: RruleParts = { freq: freqRaw };
  if (map["INTERVAL"]) {
    const n = Number.parseInt(map["INTERVAL"], 10);
    if (Number.isFinite(n) && n > 0) out.interval = n;
  }
  if (map["BYDAY"]) {
    const days = map["BYDAY"]
      .split(",")
      .filter((d): d is Weekday => WEEKDAYS_ORDER.includes(d as Weekday));
    if (days.length) out.byday = days;
  }
  if (map["BYMONTHDAY"]) {
    const days = map["BYMONTHDAY"]
      .split(",")
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isFinite(n));
    if (days.length) out.bymonthday = days;
  }
  if (map["COUNT"]) {
    const n = Number.parseInt(map["COUNT"], 10);
    if (Number.isFinite(n) && n > 0) out.count = n;
  } else if (map["UNTIL"]) {
    const until = parseUntil(map["UNTIL"]);
    if (until != null) {
      out.until = until;
      // A date-only UNTIL strongly implies all-day.
      out.allDay = /^\d{8}$/.test(map["UNTIL"]);
    }
  }
  return out;
}

const FREQ_ADVERB: Record<RruleParts["freq"], string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
};

const DAY_LABEL: Record<Weekday, string> = {
  MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun",
};

/**
 * Human-readable summary like "Weekly on Mon, Wed (10 times)" or
 * "Every 2 weeks until Jun 1, 2026". Returns `""` for an empty / unparseable
 * rule so call sites can just truthy-check the return.
 */
export function formatRrule(rrule: string | undefined): string {
  if (!rrule) return "";
  const p = parseRrule(rrule);
  if (!p) return "";
  const interval = p.interval && p.interval > 1 ? p.interval : 1;
  let base: string;
  if (interval === 1) {
    base = FREQ_ADVERB[p.freq];
  } else {
    const unit =
      p.freq === "DAILY"   ? "days" :
      p.freq === "WEEKLY"  ? "weeks" :
      p.freq === "MONTHLY" ? "months" :
      "years";
    base = `Every ${interval} ${unit}`;
  }
  if (p.freq === "WEEKLY" && p.byday && p.byday.length > 0) {
    base += ` on ${p.byday.map((d) => DAY_LABEL[d]).join(", ")}`;
  }
  if (p.freq === "MONTHLY" && p.bymonthday && p.bymonthday.length > 0) {
    base += ` on day ${p.bymonthday.join(", ")}`;
  }
  if (p.count != null) {
    base += ` (${p.count} time${p.count === 1 ? "" : "s"})`;
  } else if (p.until != null) {
    const d = new Date(p.until);
    base += ` until ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return base;
}
