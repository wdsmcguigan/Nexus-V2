# Hardening 2 — vCard robustness + test suite

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** `src/lib/vcard.ts` (parse/serialize for contact import/export) has **zero tests** and three confirmed correctness bugs that silently corrupt data on round-trip. Add a real test suite and fix the bugs, verified by round-trip fidelity.

**Architecture:** Three focused TDD tasks, each red→green→commit, all in `src/lib/vcard.ts` + one growing test file `src/lib/__tests__/vcard.test.ts`. (1) escaping symmetry: rewrite `unescapeVcard` as a single left-to-right pass and make `escapeVcard` handle `\r`. (2) structured fields: split on *unescaped* separators before unescaping (new `splitUnescaped` helper) for ADR/ORG/CATEGORIES. (3) folding + malformed-input characterization coverage.

**Tech Stack:** TypeScript, Vitest. Pure frontend. `@/` → `src/`.

## Out of scope
- Quoted-printable decoding (a vCard 2.1 concern; modern exporters use UTF-8 vCard 3.0) — note, don't build.
- Escaping EMAIL/TEL/URL values (they don't carry `,;\` in practice).

---

### Task 1: Escaping symmetry (round-trip `,;\` and newlines)

**Files:**
- Modify: `src/lib/vcard.ts` (`unescapeVcard`, `escapeVcard`)
- Test: `src/lib/__tests__/vcard.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/vcard.test.ts
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
    const parsed = parseVcf(serializeVcf([c]))[0];
    expect(parsed.name).toBe("Doe, John; CEO \\ Founder");
  });

  it("round-trips a note containing newlines", () => {
    const c = base({ notes: "line one\nline two" });
    const parsed = parseVcf(serializeVcf([c]))[0];
    expect(parsed.notes).toBe("line one\nline two");
  });

  it("unescapes an escaped backslash before 'n' as literal backslash-n, not a newline", () => {
    const vcf = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:a\\\\nb\r\nEND:VCARD";
    expect(parseVcf(vcf)[0].name).toBe("a\\nb");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/__tests__/vcard.test.ts`
Expected: the third test FAILS (current `unescapeVcard` turns `\\nb` into backslash+newline+b instead of backslash+n+b). The first two may already pass.

- [ ] **Step 3: Replace `unescapeVcard` with a single-pass scanner**

In `src/lib/vcard.ts`, replace the entire `unescapeVcard` function (currently the chained `.replace(...)` version) with:

```ts
function unescapeVcard(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      i++;
      out += next === "n" || next === "N" ? "\n" : next;
    } else {
      out += ch;
    }
  }
  return out;
}
```

- [ ] **Step 4: Make `escapeVcard` handle `\r`**

Replace `escapeVcard` with:

```ts
function escapeVcard(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test -- src/lib/__tests__/vcard.test.ts`
Expected: 3 pass.

- [ ] **Step 6: Full check + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint` (all green). Then:
```bash
git add src/lib/vcard.ts src/lib/__tests__/vcard.test.ts
git commit -m "fix(contacts): correct vCard escape/unescape symmetry"
```

---

### Task 2: Structured fields (split on unescaped separators)

**Files:**
- Modify: `src/lib/vcard.ts` (add `splitUnescaped`; restructure ADR/ORG/CATEGORIES parsing)
- Test: `src/lib/__tests__/vcard.test.ts` (append)

- [ ] **Step 1: Append the failing test**

Add to `src/lib/__tests__/vcard.test.ts` (reuse the existing `base` helper):

```ts
describe("vcard structured fields", () => {
  it("round-trips an address whose component contains a semicolon", () => {
    const c = base({
      addresses: [
        { label: "home", street: "1;2 Main St", city: "Town", state: "CA", zip: "90000", country: "US" },
      ],
    });
    const parsed = parseVcf(serializeVcf([c]))[0];
    const a = parsed.addresses?.[0];
    expect(a?.street).toBe("1;2 Main St");
    expect(a?.city).toBe("Town");
    expect(a?.country).toBe("US");
  });

  it("round-trips categories containing an embedded comma", () => {
    const c = base({ tags: ["A,B", "Other"] });
    const parsed = parseVcf(serializeVcf([c]))[0];
    expect(parsed.tags).toEqual(["A,B", "Other"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/__tests__/vcard.test.ts`
Expected: both new tests FAIL (the ADR `street` comes back as `"1"` and `city` as `"2 Main St"` because the value is unescaped before the `;` split; categories split mid-tag).

- [ ] **Step 3: Add the `splitUnescaped` helper**

In `src/lib/vcard.ts`, add near `unescapeVcard`:

```ts
/** Split on unescaped `sep`, leaving escape sequences intact in each part. */
function splitUnescaped(value: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      cur += ch + value[i + 1];
      i++;
    } else if (ch === sep) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}
```

- [ ] **Step 4: Keep the raw value in `parseCard`**

In `parseCard`, the loop currently computes `const value = unescapeVcard(line.slice(colon + 1));`. Change it to keep both:

```ts
    const rawValue = line.slice(colon + 1);
    const value = unescapeVcard(rawValue);
```

- [ ] **Step 5: Restructure ADR, ORG, CATEGORIES to split-before-unescape**

(a) The `ADR` case currently does `const parts = value.split(";");`. Change to:
```ts
        const parts = splitUnescaped(rawValue, ";").map(unescapeVcard);
```
(leave the subsequent `parts[2]?.trim()` etc. unchanged).

(b) The `ORG` case currently does `contact.company = value.split(";")[0]?.trim() || undefined;`. Change to:
```ts
        const comps = splitUnescaped(rawValue, ";").map(unescapeVcard);
        contact.company = comps[0]?.trim() || undefined;
```

(c) The `CATEGORIES` case currently does `contact.tags = value.split(",").map((t) => t.trim()).filter(Boolean);`. Change to:
```ts
        contact.tags = splitUnescaped(rawValue, ",").map(unescapeVcard).map((t) => t.trim()).filter(Boolean);
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm test -- src/lib/__tests__/vcard.test.ts`
Expected: all pass (5 total).

- [ ] **Step 7: Full check + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint` (all green). Then:
```bash
git add src/lib/vcard.ts src/lib/__tests__/vcard.test.ts
git commit -m "fix(contacts): split vCard structured fields on unescaped separators"
```

---

### Task 3: Folding + malformed-input coverage

**Files:**
- Test only: `src/lib/__tests__/vcard.test.ts` (append)

- [ ] **Step 1: Append the tests**

Add to `src/lib/__tests__/vcard.test.ts`:

```ts
describe("vcard folding and robustness", () => {
  it("round-trips a value longer than 75 chars via line folding", () => {
    const longName = "X".repeat(120);
    const out = serializeVcf([base({ name: longName })]);
    expect(out).toContain("\r\n "); // folded continuation
    expect(parseVcf(out)[0].name).toBe(longName);
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
```

- [ ] **Step 2: Run the tests**

These characterize already-correct behavior (folding/unfolding, missing-END tolerance, multi-card). Run: `pnpm test -- src/lib/__tests__/vcard.test.ts`
Expected: all pass (9 total). If the folding round-trip test FAILS, the fold/unfold pair is asymmetric — STOP and report BLOCKED with the actual vs expected (do not weaken the assertion; the fix would be in `fold`/the unfold regex in `parseCard`).

- [ ] **Step 3: Full check + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint` (all green). Then:
```bash
git add src/lib/__tests__/vcard.test.ts
git commit -m "test(contacts): cover vCard folding, multi-card, and malformed input"
```

---

## Self-Review (completed by author)

**Spec coverage:** escaping symmetry incl. the `\\n` ordering bug → Task 1; structured-field split-before-unescape for ADR/ORG/CATEGORIES → Task 2; folding + malformed/multi-card → Task 3. Quoted-printable explicitly out of scope.

**Placeholder scan:** none — full before/after code and exact commands in every step.

**Type consistency:** `unescapeVcard(value: string): string`, `escapeVcard(value: string): string`, `splitUnescaped(value, sep): string[]` are pure string helpers. `parseCard` keeps `rawValue` (escaped) for structured splits and `value` (unescaped) for simple fields. The `base()` Contact fixture matches `src/data/types.ts` `Contact` (same shape used in the emailIndex hardening test).

---

## Execution Handoff
Three tasks, pure frontend, each green + committed.
