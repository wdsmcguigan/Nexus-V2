import type { Contact } from "@/data/types";

// ─── Parser ───────────────────────────────────────────────────────────────────

export function parseVcf(text: string): Array<Partial<Contact>> {
  const results: Array<Partial<Contact>> = [];
  // Split into individual vCards
  const cards = text.split(/BEGIN:VCARD/i).slice(1);
  for (const card of cards) {
    const end = card.search(/END:VCARD/i);
    const body = end >= 0 ? card.slice(0, end) : card;
    results.push(parseCard(body));
  }
  return results;
}

function parseCard(body: string): Partial<Contact> {
  // Unfold continuation lines (RFC 2426 §2.6: lines starting with space/tab)
  const unfolded = body.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/).filter((l) => l.trim());

  const contact: Partial<Contact> & {
    emails: string[];
    phones: string[];
    socialProfiles: Array<{ platform: string; username: string }>;
    addresses: Array<{ label: string; street: string; city: string; state: string; country: string; zip: string }>;
    tags: string[];
  } = {
    emails: [],
    phones: [],
    socialProfiles: [],
    addresses: [],
    tags: [],
    source: "manual" as const,
    importance: "normal" as const,
  };

  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const rawProp = line.slice(0, colon).toUpperCase();
    const value = unescapeVcard(line.slice(colon + 1));

    // Extract base property name (ignore ;PARAM=VALUE suffixes)
    const prop = rawProp.split(";")[0];

    switch (prop) {
      case "FN":
        contact.name = value;
        break;
      case "EMAIL":
        if (value) contact.emails.push(value);
        break;
      case "TEL":
        if (value) contact.phones.push(value);
        break;
      case "ORG": {
        // ORG value may be "Company;Department" — take first component
        contact.company = value.split(";")[0]?.trim() || undefined;
        break;
      }
      case "TITLE":
        contact.title = value;
        break;
      case "URL": {
        if (!contact.website) {
          contact.website = value;
        } else {
          contact.socialProfiles.push({ platform: "url", username: value });
        }
        break;
      }
      case "BDAY": {
        // Normalize --MM-DD (no year) to YYYY-MM-DD with year 0000
        const normalized = value.startsWith("--")
          ? `0000-${value.slice(2, 4)}-${value.slice(4, 6)}`
          : value.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
        contact.birthday = normalized || undefined;
        break;
      }
      case "ADR": {
        // ADR: PO Box; Extended; Street; City; State; ZIP; Country
        const parts = value.split(";");
        contact.addresses.push({
          label: extractParam(rawProp, "TYPE") ?? "home",
          street: parts[2]?.trim() ?? "",
          city: parts[3]?.trim() ?? "",
          state: parts[4]?.trim() ?? "",
          zip: parts[5]?.trim() ?? "",
          country: parts[6]?.trim() ?? "",
        });
        break;
      }
      case "NOTE":
        contact.notes = value;
        break;
      case "CATEGORIES":
        contact.tags = value.split(",").map((t) => t.trim()).filter(Boolean);
        break;
      case "X-VIP":
      case "X-IMPORTANCE":
        if (value.toLowerCase() === "vip" || value === "1" || value.toLowerCase() === "true") {
          contact.importance = "vip";
        }
        break;
    }
  }

  return contact;
}

function extractParam(propWithParams: string, paramName: string): string | undefined {
  const regex = new RegExp(`${paramName}=([^;:]+)`, "i");
  return propWithParams.match(regex)?.[1]?.toLowerCase();
}

function unescapeVcard(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

// ─── Emitter ──────────────────────────────────────────────────────────────────

export function serializeVcf(contacts: Contact[]): string {
  return contacts.map(serializeContact).join("\r\n");
}

function serializeContact(c: Contact): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];

  lines.push(fold(`FN:${escapeVcard(c.name)}`));

  if (c.company || c.title) {
    lines.push(fold(`ORG:${escapeVcard(c.company ?? "")}`));
  }
  if (c.title) {
    lines.push(fold(`TITLE:${escapeVcard(c.title)}`));
  }

  for (const email of c.emails) {
    lines.push(fold(`EMAIL;TYPE=INTERNET:${email}`));
  }
  for (const phone of c.phones) {
    lines.push(fold(`TEL:${phone}`));
  }

  if (c.website) {
    lines.push(fold(`URL:${c.website}`));
  }
  for (const sp of c.socialProfiles ?? []) {
    lines.push(fold(`URL;TYPE=${sp.platform.toUpperCase()}:${escapeVcard(sp.username)}`));
  }

  if (c.birthday) {
    lines.push(`BDAY:${c.birthday.replace(/-/g, "")}`);
  }

  for (const addr of c.addresses ?? []) {
    const parts = [
      "",
      "",
      escapeVcard(addr.street),
      escapeVcard(addr.city),
      escapeVcard(addr.state),
      escapeVcard(addr.zip),
      escapeVcard(addr.country),
    ].join(";");
    lines.push(fold(`ADR;TYPE=${addr.label.toUpperCase()}:${parts}`));
  }

  if (c.notes) {
    lines.push(fold(`NOTE:${escapeVcard(c.notes)}`));
  }

  if (c.tags.length > 0) {
    lines.push(fold(`CATEGORIES:${c.tags.map(escapeVcard).join(",")}`));
  }

  if (c.importance === "vip") {
    lines.push("X-VIP:1");
  }

  lines.push("END:VCARD");
  return lines.join("\r\n");
}

function escapeVcard(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\n/g, "\\n");
}

// RFC 2426 §2.6: fold lines longer than 75 characters
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  parts.push(line.slice(0, 75));
  let offset = 75;
  while (offset < line.length) {
    parts.push(" " + line.slice(offset, offset + 74));
    offset += 74;
  }
  return parts.join("\r\n");
}
