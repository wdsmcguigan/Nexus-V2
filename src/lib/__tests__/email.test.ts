import { describe, it, expect } from "vitest";
import { isValidEmail } from "@/lib/email";

describe("isValidEmail (WHATWG HTML5 form-validation regex)", () => {
  it("accepts ordinary email shapes", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("alice@example.com")).toBe(true);
    expect(isValidEmail("a.b+tag@d.example")).toBe(true);
    expect(isValidEmail("user_name@sub.domain.org")).toBe(true);
  });

  it("trims surrounding whitespace before testing", () => {
    expect(isValidEmail("  alice@example.com  ")).toBe(true);
  });

  it("rejects empty / whitespace-only", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("   ")).toBe(false);
  });

  it("rejects strings with no @-domain (the user's actual bug)", () => {
    expect(isValidEmail("wdsmcguigan")).toBe(false);
    expect(isValidEmail("foo")).toBe(false);
  });

  it("rejects strings with @ but no host", () => {
    expect(isValidEmail("alice@")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
  });

  it("rejects malformed hosts", () => {
    // Note: `a@b` IS valid per WHATWG (no TLD required) — matches what
    // `<input type="email">` accepts in every browser. Internal corporate
    // intranet addresses like `user@server` are real-world cases.
    expect(isValidEmail("a@.b.com")).toBe(false);        // leading dot
    expect(isValidEmail("trailing@dot.")).toBe(false);   // trailing dot
    expect(isValidEmail("a@-bad.com")).toBe(false);      // leading hyphen
    expect(isValidEmail("a@b.com-")).toBe(false);        // trailing hyphen
  });

  it("rejects internal whitespace", () => {
    expect(isValidEmail("white space@x.com")).toBe(false);
    expect(isValidEmail("user@ex ample.com")).toBe(false);
  });

  it("rejects multiple @", () => {
    expect(isValidEmail("a@b@c.com")).toBe(false);
  });
});
