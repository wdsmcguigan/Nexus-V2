/**
 * Pragmatic email-address validation.
 *
 * Uses the WHATWG HTML5 form-validation regex — the same one every browser
 * uses internally for `<input type="email">`. Documented in the HTML Living
 * Standard under "valid e-mail address":
 * https://html.spec.whatwg.org/multipage/input.html#valid-e-mail-address
 *
 * This is intentionally NOT a full RFC 5322 parser (quoted local-parts, IP-
 * literal domains, IDN, etc. are not handled). It accepts what users will
 * realistically type and what the browser would accept in an email input.
 */
const WHATWG_EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function isValidEmail(s: string): boolean {
  if (!s) return false;
  return WHATWG_EMAIL_RE.test(s.trim());
}
