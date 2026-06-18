# Hardening 1 — Email-address normalization (contact↔message linking)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Fix the confirmed case-sensitivity bug where `emailIndex` keys and lookups aren't normalized, so a contact whose stored email differs in case from a message header (or a vCard import vs a Gmail-synced contact) silently fails to link — breaking sender→contact hover cards, contact message history, and VIP resolution.

**Architecture:** Normalize at the index boundary only. Add a pure `normalizeEmail()` (trim + lowercase) and apply it at every `emailIndex` write and read in `LocalStore`. Stored `Contact.emails` keep their original display case; only the index key is canonical. Plus-addressing (`user+tag@x`) is deliberately NOT folded — those are distinct addresses. (Verified sites in `src/storage/local.ts`: writes at `_insertContactIndexes:599`, `putContact:561`, `deleteContact:572`; reads at auto-seed `:193`, messagesByContact `:217`, `lookupByEmail:580`.)

**Tech Stack:** TypeScript, Vitest (`pnpm test`). Pure frontend. `@/` → `src/`.

---

## Out of scope

- Plus-address folding and dot-stripping (provider-specific; over-matches — keep distinct).
- Changing stored `Contact.emails` case (display values stay as-authored).
- vCard parsing (Hardening #2).

---

### Task 1: `normalizeEmail` helper

**Files:**
- Modify: `src/lib/email.ts` (add `normalizeEmail`)
- Test: `src/lib/__tests__/email.test.ts` (append)

- [ ] **Step 1: Append the failing test**

Add to `src/lib/__tests__/email.test.ts`. First add `normalizeEmail` to the existing import line `import { isValidEmail } from "@/lib/email";` → `import { isValidEmail, normalizeEmail } from "@/lib/email";`. Then add:

```ts
describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Alice@Example.COM ")).toBe("alice@example.com");
  });

  it("keeps plus-addressing distinct (does not fold tags)", () => {
    expect(normalizeEmail("user+tag@x.com")).toBe("user+tag@x.com");
    expect(normalizeEmail("user+tag@x.com")).not.toBe(normalizeEmail("user@x.com"));
  });

  it("is idempotent", () => {
    const once = normalizeEmail("Bob@Y.org");
    expect(normalizeEmail(once)).toBe(once);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/__tests__/email.test.ts`
Expected: FAIL — `normalizeEmail` is not exported.

- [ ] **Step 3: Add the helper to `src/lib/email.ts`**

```ts
/**
 * Canonical form of an email address for index keys and equality: trimmed and
 * lowercased. Does NOT fold plus-addressing (`user+tag@x` and `user@x` are
 * distinct addresses) or strip dots — those are provider-specific and over-match.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/lib/__tests__/email.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email.ts src/lib/__tests__/email.test.ts
git commit -m "feat(contacts): add normalizeEmail helper"
```

---

### Task 2: Normalize every `emailIndex` read/write in `LocalStore`

**Files:**
- Modify: `src/storage/local.ts`
- Test: `src/storage/__tests__/emailIndex.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/storage/__tests__/emailIndex.test.ts
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
    // update c1 to a different email — the old key must be gone
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/storage/__tests__/emailIndex.test.ts`
Expected: FAIL — first test fails (`lookupByEmail("alice@example.com")` returns null because the key was stored as `"Alice@Example.COM"`).

- [ ] **Step 3: Import the helper**

At the top of `src/storage/local.ts`, add to the imports:
```ts
import { normalizeEmail } from "@/lib/email";
```

- [ ] **Step 4: Normalize the three WRITE sites**

(a) `_insertContactIndexes` — change:
```ts
    for (const e of contact.emails) {
      this.emailIndex.set(e, contact.id);
    }
```
to:
```ts
    for (const e of contact.emails) {
      this.emailIndex.set(normalizeEmail(e), contact.id);
    }
```

(b) `putContact` old-email cleanup — change:
```ts
      for (const e of existing.emails) {
        if (!contact.emails.includes(e)) this.emailIndex.delete(e);
      }
```
to:
```ts
      const next = new Set(contact.emails.map(normalizeEmail));
      for (const e of existing.emails) {
        if (!next.has(normalizeEmail(e))) this.emailIndex.delete(normalizeEmail(e));
      }
```

(c) `deleteContact` — change:
```ts
    for (const e of c.emails) this.emailIndex.delete(e);
```
to:
```ts
    for (const e of c.emails) this.emailIndex.delete(normalizeEmail(e));
```

- [ ] **Step 5: Normalize the three READ sites**

(d) `lookupByEmail` — change:
```ts
  lookupByEmail(email: string): Contact | null {
    const id = this.emailIndex.get(email);
```
to:
```ts
  lookupByEmail(email: string): Contact | null {
    const id = this.emailIndex.get(normalizeEmail(email));
```

(e) auto-seed guard (in `hydrate`) — change:
```ts
      if (email && !this.emailIndex.has(email)) {
```
to:
```ts
      if (email && !this.emailIndex.has(normalizeEmail(email))) {
```

(f) messagesByContact build (in `hydrate`) — change:
```ts
        const cid = this.emailIndex.get(addr.email);
```
to:
```ts
        const cid = this.emailIndex.get(normalizeEmail(addr.email));
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm test -- src/storage/__tests__/emailIndex.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Full check + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint` (all green — no regression in existing contact/store tests). Then:
```bash
git add src/storage/local.ts src/storage/__tests__/emailIndex.test.ts
git commit -m "fix(contacts): normalize email case across the contact index"
```

---

## Self-Review (completed by author)

**Spec coverage:** all six verified `emailIndex` sites (3 writes: `_insertContactIndexes`, `putContact`, `deleteContact`; 3 reads: `lookupByEmail`, auto-seed `has`, messagesByContact `get`) are normalized in Task 2 Steps 4–5. The helper (Task 1) is trim+lowercase, plus-addressing preserved.

**Placeholder scan:** none — full before/after code in every edit step.

**Type consistency:** `normalizeEmail(email: string): string` used identically at all sites; `emailIndex` stays `Map<string, string>` (normalized key → contactId). The `putContact` cleanup builds a `Set<string>` of normalized next-emails so an unchanged email (case-only edit) is not spuriously deleted.

**Note:** Gmail sync already lowercases `Contact.emails` (`src-tauri/src/gmail/contacts.rs:79`), so for synced contacts `normalizeEmail` is a no-op — consistent. The message-path read sites (auto-seed, messagesByContact) are normalized in code; the unit test directly covers `lookupByEmail` + the write/delete paths, and the reviewer confirms the read-site edits by diff.

---

## Execution Handoff

Two tasks, pure frontend, each green + committed.
