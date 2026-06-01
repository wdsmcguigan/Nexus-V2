import type { Contact } from "@/data/types";

/**
 * Filter contacts by a free-text query, matching against name and any email.
 *
 * `Contact.name` is typed as `string` but is `null` at runtime for some
 * Google-imported contacts that only have an email — three crashes in the past
 * have been traced to this. Use this helper for any contact-autocomplete /
 * suggestion / palette filter rather than inlining `c.name.toLowerCase()`.
 *
 * Matching is case-insensitive. Returns at most `limit` results.
 */
export function filterContacts(
  contacts: Iterable<Contact>,
  query: string,
  limit: number = 6,
): Contact[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: Contact[] = [];
  for (const c of contacts) {
    const nameMatch = c.name?.toLowerCase().includes(q) ?? false;
    const emailMatch = c.emails?.some((e) => e?.toLowerCase().includes(q)) ?? false;
    if (nameMatch || emailMatch) {
      out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Human-readable label for a contact. Falls back through:
 * `name → first email → "Unknown"`. Used for chip / row / autocomplete display.
 */
export function contactLabel(c: Contact): string {
  return c.name || c.emails?.[0] || "Unknown";
}
