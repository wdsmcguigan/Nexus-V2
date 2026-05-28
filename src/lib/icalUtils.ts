import ICAL from "ical.js";

export interface ParsedCalendarInvite {
  uid: string;
  method: string;
  title: string;
  startTs: number;
  endTs: number;
  allDay: boolean;
  location?: string;
  description?: string;
  organizer: string;
  attendees: Array<{
    email: string;
    name?: string;
    partstat?: string;
    rsvp?: boolean;
  }>;
}

export function parseIcsInvite(icsText: string): ParsedCalendarInvite | null {
  try {
    const parsed = ICAL.parse(icsText);
    const comp = new ICAL.Component(parsed);
    const method = comp.getFirstPropertyValue("method") as string ?? "REQUEST";
    const vevent = comp.getFirstSubcomponent("vevent");
    if (!vevent) return null;

    const event = new ICAL.Event(vevent);
    const uid = event.uid ?? "";
    const title = event.summary ?? "(no title)";

    const startDt = event.startDate;
    const endDt = event.endDate;
    const allDay = startDt?.isDate ?? false;
    const startTs = startDt?.toJSDate().getTime() ?? Date.now();
    const endTs = endDt?.toJSDate().getTime() ?? startTs + 3600_000;

    const organizerProp = vevent.getFirstProperty("organizer");
    const organizer = organizerProp
      ? (organizerProp.getFirstValue() as string).replace(/^mailto:/i, "")
      : "";

    const attendees = vevent.getAllProperties("attendee").map((prop) => {
      const value = (prop.getFirstValue() as string ?? "").replace(/^mailto:/i, "");
      const cn = prop.getParameter("cn") as string | undefined;
      const partstat = prop.getParameter("partstat") as string | undefined;
      const rsvp = (prop.getParameter("rsvp") as string | undefined)?.toUpperCase() === "TRUE";
      return { email: value, name: cn, partstat, rsvp };
    });

    return {
      uid,
      method,
      title,
      startTs,
      endTs,
      allDay,
      location: event.location ?? undefined,
      description: event.description ?? undefined,
      organizer,
      attendees,
    };
  } catch {
    return null;
  }
}

export function buildIcalReply(
  original: ParsedCalendarInvite,
  userEmail: string,
  partstat: "ACCEPTED" | "DECLINED" | "TENTATIVE",
): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const startStr = new Date(original.startTs).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const endStr = new Date(original.endTs).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nexus//EN",
    "METHOD:REPLY",
    "BEGIN:VEVENT",
    `UID:${original.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${startStr}`,
    `DTEND:${endStr}`,
    `SUMMARY:${original.title}`,
    `ORGANIZER:mailto:${original.organizer}`,
    `ATTENDEE;PARTSTAT=${partstat}:mailto:${userEmail}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
