import { describe, it, expect } from "vitest";
import {
  htmlToSnippet,
  classifyAttachment,
  deriveReplySubject,
  deriveReplyTo,
  deriveReplyCc,
  evaluateSendGate,
} from "@/lib/compose";

describe("htmlToSnippet", () => {
  it("strips tags and collapses whitespace", () => {
    expect(htmlToSnippet("<p>Hello   <b>world</b></p>")).toBe("Hello world");
  });

  it("drops <style> and <script> contents entirely", () => {
    expect(htmlToSnippet("<style>.x{color:red}</style><p>body</p>")).toBe("body");
    expect(htmlToSnippet("<script>alert(1)</script><p>body</p>")).toBe("body");
  });

  it("decodes &nbsp; to a space", () => {
    expect(htmlToSnippet("a&nbsp;b")).toBe("a b");
  });

  it("truncates with an ellipsis past max", () => {
    expect(htmlToSnippet("abcdef", 3)).toBe("abc…");
  });

  it("does not truncate at exactly max", () => {
    expect(htmlToSnippet("abc", 3)).toBe("abc");
  });
});

describe("classifyAttachment", () => {
  it("classifies by MIME type", () => {
    expect(classifyAttachment("photo", "image/png")).toBe("image");
    expect(classifyAttachment("doc", "application/pdf")).toBe("pdf");
    expect(classifyAttachment("invite", "text/calendar")).toBe("calendar");
    expect(classifyAttachment("sheet", "application/vnd.ms-excel")).toBe("doc");
    expect(classifyAttachment("bundle", "application/zip")).toBe("archive");
  });

  it("falls back to file extension when type is generic", () => {
    expect(classifyAttachment("report.pdf", "application/octet-stream")).toBe("pdf");
    expect(classifyAttachment("event.ics", "")).toBe("calendar");
    expect(classifyAttachment("notes.docx", "")).toBe("doc");
    expect(classifyAttachment("backup.tar.gz", "")).toBe("archive");
  });

  it("is case-insensitive on extension", () => {
    expect(classifyAttachment("REPORT.PDF", "")).toBe("pdf");
  });

  it("returns 'other' for unknown types", () => {
    expect(classifyAttachment("mystery.xyz", "application/x-unknown")).toBe("other");
    expect(classifyAttachment("noext", "")).toBe("other");
  });
});

describe("deriveReplySubject", () => {
  it("prefixes Fwd: for forwards", () => {
    expect(deriveReplySubject("forward", "Lunch")).toBe("Fwd: Lunch");
  });

  it("prefixes Re: for replies", () => {
    expect(deriveReplySubject("reply", "Lunch")).toBe("Re: Lunch");
    expect(deriveReplySubject("reply-all", "Lunch")).toBe("Re: Lunch");
  });

  it("is idempotent — does not double-prefix an existing Re:", () => {
    expect(deriveReplySubject("reply", "Re: Lunch")).toBe("Re: Lunch");
  });

  it("treats a null mode as a reply", () => {
    expect(deriveReplySubject(null, "Lunch")).toBe("Re: Lunch");
  });

  it("still adds Fwd: even when subject already has Re:", () => {
    expect(deriveReplySubject("forward", "Re: Lunch")).toBe("Fwd: Re: Lunch");
  });
});

const msg = {
  fromAddr: { email: "sender@test.com" },
  toAddrs: [{ email: "me@test.com" }, { email: "other@test.com" }],
  ccAddrs: [{ email: "cc1@test.com" }, { email: "cc2@test.com" }],
};

describe("deriveReplyTo", () => {
  it("forward → empty", () => {
    expect(deriveReplyTo("forward", msg, "me@test.com")).toEqual([]);
  });

  it("reply → just the original sender", () => {
    expect(deriveReplyTo("reply", msg, "me@test.com")).toEqual(["sender@test.com"]);
  });

  it("reply-all → sender plus original To, excluding self", () => {
    expect(deriveReplyTo("reply-all", msg, "me@test.com")).toEqual([
      "sender@test.com",
      "other@test.com",
    ]);
  });

  it("reply-all keeps all To recipients when self is not among them", () => {
    expect(deriveReplyTo("reply-all", msg, "nobody@test.com")).toEqual([
      "sender@test.com",
      "me@test.com",
      "other@test.com",
    ]);
  });

  it("null mode behaves like reply-all (matching the original initializer)", () => {
    expect(deriveReplyTo(null, msg, "me@test.com")).toEqual([
      "sender@test.com",
      "other@test.com",
    ]);
  });
});

describe("deriveReplyCc", () => {
  it("reply-all → original Cc list", () => {
    expect(deriveReplyCc("reply-all", msg)).toEqual(["cc1@test.com", "cc2@test.com"]);
  });

  it("reply / forward / null → empty", () => {
    expect(deriveReplyCc("reply", msg)).toEqual([]);
    expect(deriveReplyCc("forward", msg)).toEqual([]);
    expect(deriveReplyCc(null, msg)).toEqual([]);
  });
});

describe("evaluateSendGate", () => {
  it("blocks when there are no recipients at all", () => {
    expect(evaluateSendGate([], ["", "  ", ""])).toEqual({
      ok: false,
      reason: "Add at least one recipient",
    });
  });

  it("passes a single valid committed recipient", () => {
    expect(evaluateSendGate(["a@test.com"], ["", "", ""])).toEqual({ ok: true, reason: "" });
  });

  it("counts a pending (uncommitted) draft as a recipient", () => {
    expect(evaluateSendGate([], ["a@test.com", "", ""])).toEqual({ ok: true, reason: "" });
  });

  it("blocks on an invalid committed address", () => {
    expect(evaluateSendGate(["not-an-email"], [])).toEqual({
      ok: false,
      reason: "Fix invalid recipient(s) first",
    });
  });

  it("blocks on an invalid pending draft", () => {
    expect(evaluateSendGate(["a@test.com"], ["bad@@", "", ""])).toEqual({
      ok: false,
      reason: "Fix invalid recipient(s) first",
    });
  });

  it("trims pending drafts before validating", () => {
    expect(evaluateSendGate([], ["  a@test.com  ", "", ""])).toEqual({ ok: true, reason: "" });
  });
});
