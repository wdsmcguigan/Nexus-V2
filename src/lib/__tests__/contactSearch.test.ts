import { describe, it, expect } from "vitest";
import { filterContacts, contactLabel } from "@/lib/contactSearch";
import type { Contact } from "@/data/types";

function c(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    vaultId: "v1",
    name: "Default",
    emails: ["default@example.com"],
    phones: [],
    addresses: [],
    socialProfiles: [],
    starred: false,
    source: "manual",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Contact;
}

describe("filterContacts", () => {
  it("returns nothing for empty query", () => {
    expect(filterContacts([c()], "")).toEqual([]);
    expect(filterContacts([c()], "   ")).toEqual([]);
  });

  it("matches by name", () => {
    const alice = c({ id: "a", name: "Alice", emails: ["alice@example.com"] });
    const bob = c({ id: "b", name: "Bob", emails: ["bob@example.com"] });
    expect(filterContacts([alice, bob], "ali").map((x) => x.id)).toEqual(["a"]);
  });

  it("matches by email", () => {
    const alice = c({ id: "a", name: "Alice", emails: ["alice@example.com"] });
    const bob = c({ id: "b", name: "Bob", emails: ["bob@example.com"] });
    expect(filterContacts([alice, bob], "bob@").map((x) => x.id)).toEqual(["b"]);
  });

  it("is case-insensitive", () => {
    const alice = c({ id: "a", name: "Alice", emails: ["AlIcE@Example.COM"] });
    expect(filterContacts([alice], "ALICE")).toHaveLength(1);
    expect(filterContacts([alice], "example.com")).toHaveLength(1);
  });

  it("does NOT throw when a contact has name === null at runtime (regression for the third null-name crash)", () => {
    const nullNamed = { ...c({ id: "n", emails: ["only-email@example.com"] }), name: null as unknown as string };
    expect(() => filterContacts([nullNamed], "only-email")).not.toThrow();
    expect(filterContacts([nullNamed], "only-email").map((x) => x.id)).toEqual(["n"]);
  });

  it("survives a contact with name null AND no emails (worst case)", () => {
    const broken = { ...c({ id: "x", emails: [] }), name: null as unknown as string };
    expect(() => filterContacts([broken], "anything")).not.toThrow();
    expect(filterContacts([broken], "anything")).toEqual([]);
  });

  it("respects the result-count limit", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      c({ id: `c${i}`, name: `Alice ${i}`, emails: [`alice${i}@example.com`] }),
    );
    expect(filterContacts(many, "alice", 6)).toHaveLength(6);
  });
});

describe("contactLabel", () => {
  it("uses the name when present", () => {
    expect(contactLabel(c({ name: "Alice" }))).toBe("Alice");
  });

  it("falls back to the first email when name is null", () => {
    expect(
      contactLabel({ ...c({ emails: ["a@b.com"] }), name: null as unknown as string }),
    ).toBe("a@b.com");
  });

  it("falls back to the first email when name is empty string", () => {
    expect(contactLabel(c({ name: "", emails: ["a@b.com"] }))).toBe("a@b.com");
  });

  it("returns 'Unknown' when both name and emails are missing", () => {
    expect(
      contactLabel({ ...c({ emails: [] }), name: null as unknown as string }),
    ).toBe("Unknown");
  });
});
