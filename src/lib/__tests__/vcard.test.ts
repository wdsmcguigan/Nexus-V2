import { describe, it, expect } from "vitest";
import { parseVcf, serializeVcf } from "@/lib/vcard";
import type { Contact } from "@/data/types";

function base(over: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    vaultId: "v",
    name: "Jane Doe",
    emails: [],
    phones: [],
    tags: [],
    socialProfiles: [],
    addresses: [],
    source: "manual",
    importance: "normal",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("vcard escaping round-trip", () => {
  it("round-trips a name containing comma, semicolon, and backslash", () => {
    const c = base({ name: "Doe, John; CEO \\ Founder" });
    const parsed = parseVcf(serializeVcf([c]))[0]!;
    expect(parsed.name).toBe("Doe, John; CEO \\ Founder");
  });

  it("round-trips a note containing newlines", () => {
    const c = base({ notes: "line one\nline two" });
    const parsed = parseVcf(serializeVcf([c]))[0]!;
    expect(parsed.notes).toBe("line one\nline two");
  });

  it("unescapes an escaped backslash before 'n' as literal backslash-n, not a newline", () => {
    const vcf = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:a\\\\nb\r\nEND:VCARD";
    expect(parseVcf(vcf)[0]!.name).toBe("a\\nb");
  });
});

describe("vcard structured fields", () => {
  it("round-trips an address whose component contains a semicolon", () => {
    const c = base({
      addresses: [
        { label: "home", street: "1;2 Main St", city: "Town", state: "CA", zip: "90000", country: "US" },
      ],
    });
    const parsed = parseVcf(serializeVcf([c]))[0]!;
    const a = parsed.addresses?.[0];
    expect(a?.street).toBe("1;2 Main St");
    expect(a?.city).toBe("Town");
    expect(a?.country).toBe("US");
  });

  it("round-trips categories containing an embedded comma", () => {
    const c = base({ tags: ["A,B", "Other"] });
    const parsed = parseVcf(serializeVcf([c]))[0]!;
    expect(parsed.tags).toEqual(["A,B", "Other"]);
  });
});

describe("vcard folding and robustness", () => {
  it("round-trips a value longer than 75 chars via line folding", () => {
    const longName = "X".repeat(120);
    const out = serializeVcf([base({ name: longName })]);
    expect(out).toContain("\r\n "); // folded continuation
    expect(parseVcf(out)[0]!.name).toBe(longName);
  });

  it("parses a vCard missing END:VCARD without throwing", () => {
    const parsed = parseVcf("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Jane\r\n");
    expect(parsed[0]?.name).toBe("Jane");
  });

  it("returns an empty array when there is no vCard", () => {
    expect(parseVcf("not a vcard")).toEqual([]);
  });

  it("parses multiple vCards in one file", () => {
    const out = serializeVcf([
      base({ id: "c1", name: "Ada", emails: ["ada@x.com"] }),
      base({ id: "c2", name: "Bob" }),
    ]);
    expect(parseVcf(out).map((p) => p.name)).toEqual(["Ada", "Bob"]);
  });
});
