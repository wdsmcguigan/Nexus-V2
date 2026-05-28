/** Returns [startMs, endMs] for the Monday-anchored week containing `iso`. */
export function getWeekBounds(iso: string): [number, number] {
  const d = new Date(iso + "T00:00:00");
  const dow = d.getDay(); // 0=Sun
  const mon = new Date(d);
  mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return [mon.getTime(), sun.getTime()];
}

/** Returns ISO date for the Monday of the week containing `iso`. */
export function weekMonday(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const dow = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return mon.toISOString().slice(0, 10);
}

/** Returns [startMs, endMs] for the calendar month containing `iso`. */
export function getMonthBounds(iso: string): [number, number] {
  const [y, m] = iso.split("-").map(Number);
  const start = new Date(y!, m! - 1, 1, 0, 0, 0, 0);
  const end = new Date(y!, m!, 0, 23, 59, 59, 999);
  return [start.getTime(), end.getTime()];
}

/** Returns ISO date for the 1st of the month containing `iso`. */
export function monthStart(iso: string): string {
  return iso.slice(0, 7) + "-01";
}

/** Advance `iso` by `weeks` weeks (positive or negative). */
export function addWeeks(iso: string, weeks: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/** Advance `iso` by `months` months (positive or negative). */
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Generate the 42 ISO dates for a month grid starting from the Monday of the week containing the 1st. */
export function generateMonthCells(monthStartIso: string): string[] {
  const firstDay = new Date(monthStartIso + "T00:00:00");
  const dow = firstDay.getDay();
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - (dow === 0 ? 6 : dow - 1));
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d.toISOString().slice(0, 10));
  }
  return cells;
}

/** Generate the 7 ISO dates for the week starting from `mondayIso`. */
export function generateWeekDays(mondayIso: string): string[] {
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayIso + "T00:00:00");
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** Returns the number of minutes from midnight for a given timestamp. */
export function minutesFromMidnight(ts: number, iso: string): number {
  const midnight = new Date(iso + "T00:00:00").getTime();
  return Math.round((ts - midnight) / 60_000);
}
