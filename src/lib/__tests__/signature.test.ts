import { describe, it, expect } from "vitest";
import { escapeHtmlWithBreaks } from "@/lib/signature";

describe("escapeHtmlWithBreaks", () => {
  it("escapes the HTML-special characters", () => {
    expect(escapeHtmlWithBreaks("a < b > c & d")).toBe("a &lt; b &gt; c &amp; d");
  });

  it("turns newlines into <br/>", () => {
    expect(escapeHtmlWithBreaks("line1\nline2")).toBe("line1<br/>line2");
  });

  it("escapes ampersands before introducing entity ampersands (no double-escaping)", () => {
    // & must be replaced first, otherwise the &lt; etc. would be re-escaped.
    expect(escapeHtmlWithBreaks("<")).toBe("&lt;");
    expect(escapeHtmlWithBreaks("&lt;")).toBe("&amp;lt;");
  });

  it("handles a multi-line signature with markup-like text", () => {
    expect(escapeHtmlWithBreaks("Jane Doe\n<CEO> & Founder")).toBe(
      "Jane Doe<br/>&lt;CEO&gt; &amp; Founder",
    );
  });

  it("returns an empty string unchanged", () => {
    expect(escapeHtmlWithBreaks("")).toBe("");
  });
});
