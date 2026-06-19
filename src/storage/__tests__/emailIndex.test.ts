import { describe, it, expect } from "vitest";
import { LocalStore } from "@/storage/local";
import type { Contact } from "@/data/types";

function contact(id: string, email: string): Contact {
  return {
    id,
    vaultId: "v",
    name: "Test",
    emails: [email],
    phones: [],
    tags: [],
    socialProfiles: [],
    addresses: [],
    source: "manual",
    importance: "normal",
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("LocalStore emailIndex normalization", () => {
  it("looks up a contact regardless of stored-vs-query email case", () => {
    const store = new LocalStore();
    store.putContact(contact("c1", "Alice@Example.COM"));
    expect(store.lookupByEmail("alice@example.com")?.id).toBe("c1");
    expect(store.lookupByEmail("ALICE@EXAMPLE.COM")?.id).toBe("c1");
    expect(store.lookupByEmail("  alice@example.com  ")?.id).toBe("c1");
  });

  it("removes the normalized key when an email is dropped on update", () => {
    const store = new LocalStore();
    store.putContact(contact("c1", "Alice@Example.COM"));
    store.putContact({ ...contact("c1", "Bob@Y.org") });
    expect(store.lookupByEmail("alice@example.com")).toBeNull();
    expect(store.lookupByEmail("bob@y.org")?.id).toBe("c1");
  });

  it("keeps plus-addresses distinct", () => {
    const store = new LocalStore();
    store.putContact(contact("c1", "user+work@x.com"));
    expect(store.lookupByEmail("user@x.com")).toBeNull();
    expect(store.lookupByEmail("user+work@x.com")?.id).toBe("c1");
  });
});
