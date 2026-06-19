# Hardening 3 — Calendar date correctness (confirmed, low-risk fixes)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Two confirmed, low-risk correctness fixes in the calendar. (Larger timezone-model questions are deliberately deferred — see "Surfaced, not fixed".)

**Scope is deliberately narrow.** A full audit found the calendar's all-day UTC-anchoring model is sound and well-documented; most audit findings were mischaracterized. These two are genuine and safe.

**Tech Stack:** TypeScript, Vitest. Pure frontend. `@/` → `src/`.

---

## Surfaced, NOT fixed (needs a design decision — do not touch in this plan)

- **`generateWeekDays`/`generateMonthCells` (`src/lib/calendarUtils.ts`) derive grid cells from `new Date(iso + "T00:00:00")` (LOCAL midnight → UTC), while event grouping in `WeekView`/`MonthView` uses `new Date(startTs).toISOString()` (pure UTC).** For non-UTC viewers these can disagree by a day. Fixing it requires deciding whether the calendar grid is local-day or UTC-day oriented, and updating every helper + its tests in lockstep. High regression risk; out of scope.

---

### Task 1: Symmetric UTC handling for RRULE date inputs

**Problem:** In `src/components/calendar/event-form/RecurrenceEditor.tsx`, `tsToDateInput` (line 31) reads LOCAL date components but `dateInputToTs` (line 36) writes UTC via `Date.UTC`. The `UNTIL` date round-trips with a one-day shift for non-UTC users. Fix by reading UTC in `tsToDateInput`; extract both to `calendarUtils.ts` so they're testable.

**Files:**
- Modify: `src/lib/calendarUtils.ts` (add exported `tsToDateInput`, `dateInputToTs`)
- Modify: `src/components/calendar/event-form/RecurrenceEditor.tsx` (remove the two local fns, import them)
- Test: `src/lib/__tests__/calendarUtils.test.ts` (append)

- [ ] **Step 1: Append the test**

Add to `src/lib/__tests__/calendarUtils.test.ts` (add `tsToDateInput, dateInputToTs` to the existing import from `@/lib/calendarUtils`):

```ts
describe("date <input> helpers (UTC-symmetric)", () => {
  it("dateInputToTs parses to a UTC-anchored midnight timestamp", () => {
    expect(dateInputToTs("2026-06-01")).toBe(Date.UTC(2026, 5, 1));
  });

  it("tsToDateInput reads UTC components (matches dateInputToTs)", () => {
    // A UTC-anchored ts late in the UTC day must read back as the same date,
    // regardless of the runtime timezone.
    expect(tsToDateInput(Date.UTC(2026, 5, 1, 23, 30))).toBe("2026-06-01");
  });

  it("round-trips a date through input→ts→input", () => {
    const ts = dateInputToTs("2026-12-31")!;
    expect(tsToDateInput(ts)).toBe("2026-12-31");
  });

  it("dateInputToTs returns undefined for empty or malformed input", () => {
    expect(dateInputToTs("")).toBeUndefined();
    expect(dateInputToTs("not-a-date")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/__tests__/calendarUtils.test.ts`
Expected: FAIL — `tsToDateInput`/`dateInputToTs` not exported from `@/lib/calendarUtils`.

- [ ] **Step 3: Add the helpers to `src/lib/calendarUtils.ts`**

Append (near the other date helpers):

```ts
/**
 * YYYY-MM-DD (UTC) for a date `<input>`. UTC-symmetric with `dateInputToTs` so a
 * date round-trips identically in any runtime timezone.
 */
export function tsToDateInput(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Parse a YYYY-MM-DD date `<input>` to a UTC-anchored timestamp, or undefined. */
export function dateInputToTs(s: string): number | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return Date.UTC(y, m - 1, d);
}
```

- [ ] **Step 4: Use them in `RecurrenceEditor.tsx`**

In `src/components/calendar/event-form/RecurrenceEditor.tsx`:
(a) Delete the two local function declarations `tsToDateInput` (the `getFullYear/getMonth/getDate` version) and `dateInputToTs`.
(b) Add them to the imports from `@/lib/calendarUtils` (or add an import line if none exists):
```ts
import { tsToDateInput, dateInputToTs } from "@/lib/calendarUtils";
```
Leave the call sites (`dateInputToTs(s)`, `tsToDateInput(parts.until)`) unchanged.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test -- src/lib/__tests__/calendarUtils.test.ts`
Expected: PASS.

- [ ] **Step 6: Full check + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint` (all green — RecurrenceEditor still compiles, no other usages of the removed local fns). Then:
```bash
git add src/lib/calendarUtils.ts src/components/calendar/event-form/RecurrenceEditor.tsx src/lib/__tests__/calendarUtils.test.ts
git commit -m "fix(calendar): UTC-symmetric RRULE until-date input handling"
```

---

### Task 2: `eventColor("")` falls back to the accent token

**Problem:** `src/lib/calendarColors.ts:16` — `(colorId && GOOGLE_COLOR_MAP[colorId]) ?? "var(--color-accent)"`. For an empty-string `colorId`, `(colorId && ...)` short-circuits to `""`, and `?? ` does not catch `""`, so an empty colorId renders an invisible (empty) color. A user-created event with an empty colorId should get the accent fallback.

**Files:**
- Modify: `src/lib/calendarColors.ts`
- Test: `src/lib/__tests__/calendarColors.test.ts` (update the existing latent-edge test)

- [ ] **Step 1: Update the test to assert the desired behavior**

In `src/lib/__tests__/calendarColors.test.ts`, find the existing test that reads roughly:
```ts
  it("returns '' for an empty-string colorId (latent edge case)", () => {
    // ...comment about Google never sending empty colorId...
    expect(eventColor("")).toBe("");
  });
```
Replace that whole `it(...)` block with:
```ts
  it("falls back to the accent token for an empty-string colorId", () => {
    expect(eventColor("")).toBe("var(--color-accent)");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/__tests__/calendarColors.test.ts`
Expected: FAIL — current code returns `""`, not the accent token.

- [ ] **Step 3: Fix the fallback operator**

In `src/lib/calendarColors.ts`, change:
```ts
  return (colorId && GOOGLE_COLOR_MAP[colorId]) ?? "var(--color-accent)";
```
to:
```ts
  return (colorId && GOOGLE_COLOR_MAP[colorId]) || "var(--color-accent)";
```

(Reason: `||` catches both `undefined` (unmapped/missing colorId) and `""` (empty), while preserving the valid-hex path. A mapped colorId returns a non-empty hex string, which is truthy.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/lib/__tests__/calendarColors.test.ts`
Expected: PASS (all cases: known id → hex, undefined → accent, unknown → accent, empty → accent).

- [ ] **Step 5: Full check + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint` (all green). Then:
```bash
git add src/lib/calendarColors.ts src/lib/__tests__/calendarColors.test.ts
git commit -m "fix(calendar): empty colorId falls back to the accent token"
```

---

## Self-Review (completed by author)

**Spec coverage:** RRULE until-date UTC asymmetry → Task 1 (extract + fix + test, symmetric by construction); empty-colorId invisible event → Task 2 (red→green, existing latent-edge test updated to the correct expectation). The grid-vs-grouping timezone inconsistency is explicitly surfaced and out of scope.

**Note on Task 1 testability:** the underlying bug is timezone-latent (invisible in a UTC test runner), so Task 1's tests characterize the now-correct UTC behavior and lock it; the fix's correctness is by construction (both helpers use UTC). Task 2 is a genuine red→green.

**Type consistency:** `tsToDateInput(ts: number): string` and `dateInputToTs(s: string): number | undefined` keep their existing signatures; only their home (calendarUtils) and `tsToDateInput`'s internals change. RecurrenceEditor call sites are unchanged.

---

## Execution Handoff
Two tasks, pure frontend, each green + committed.
