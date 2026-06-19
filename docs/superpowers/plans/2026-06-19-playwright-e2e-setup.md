# Playwright e2e Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install and configure Playwright and ship the three policy-named critical-flow e2e specs (smoke, Tasks add/complete, create-task-from-email) running in web mode on Chromium + WebKit.

**Architecture:** Playwright drives the app in **web mode** (`vite preview` on :4173). `src/main.tsx` → `initWeb()` seeds fixtures and runs the full mutation pipeline + Tasks module entirely client-side — no Tauri/IPC. Each test gets a fresh browser context; a shared fixture additionally clears OPFS + localStorage so fixture seeding is deterministic. Specs assert on runtime-derived state, never hardcoded fixture content.

**Tech Stack:** `@playwright/test`, Vite preview server, existing React app in web mode.

## Global Constraints

- **Drive mode:** web mode only this PR (`pnpm preview`, port 4173). No `tauri-driver`.
- **Browsers:** `chromium` + `webkit` projects; both run on `pnpm e2e`.
- **No CI changes** to `.github/workflows/ci.yml` this PR (sketch documented in `e2e/README.md` only).
- **Isolation:** e2e lives in `e2e/` with `*.spec.ts` names — outside `src/`, so Vitest (`include: src/**/*.test.ts(x)`), `tsc -b` (app tsconfig `include: ["src"]`), and `eslint src` never touch it. Do not add e2e paths to those configs.
- **No new RTL/jsdom.** Playwright only.
- **Assertions are runtime-derived.** `generateMessages()` is not guaranteed deterministic — capture subject text from the DOM, never hardcode it.
- **Commit messages:** conventional commits, no `Co-Authored-By` trailer (repo attribution is off).
- The husky pre-commit hook runs `tsc -b --noEmit` + lint-staged (`eslint` on staged `src/**/*.{ts,tsx}`). Keep `src` edits lint-clean; e2e files are outside both globs.

---

### Task 1: Install Playwright + config + reset fixture + smoke spec

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/fixtures.ts`
- Create: `e2e/smoke.spec.ts`
- Modify: `package.json` (scripts)
- Modify: `.gitignore`

**Interfaces:**
- Produces: `e2e/fixtures.ts` exports `test` (extended with a clean-storage `page` fixture) and `expect`. Later tasks import `{ test, expect }` from `"./fixtures"`.
- Consumes: app chrome from `WorkspaceChrome.tsx` — a button with `aria-label="Command palette"` and a search button with text `Search emails, contacts, files…`.

- [ ] **Step 1: Install Playwright and browsers**

Run:
```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium webkit
```
Expected: `@playwright/test` added to `devDependencies`; Chromium + WebKit browser binaries downloaded.

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "pnpm build && pnpm preview",
    url: "http://localhost:4173",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] **Step 3: Create `e2e/fixtures.ts`**

```ts
import { test as base, expect, type Page } from "@playwright/test";

/**
 * Shared e2e fixture. Playwright already isolates storage per test via a fresh
 * browser context; we additionally wipe OPFS + localStorage before the app
 * boots so initWeb() fixture seeding starts clean even if context isolation
 * ever regresses. OPFS may be unavailable on some engines — the wipe is
 * defensive and the in-memory store path still works there.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.goto("/");
    await page.evaluate(async () => {
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
      try {
        const root = await navigator.storage.getDirectory();
        const names: string[] = [];
        // FileSystemDirectoryHandle is async-iterable in supporting engines.
        for await (const name of (root as unknown as AsyncIterable<string>)) {
          names.push(name);
        }
        await Promise.all(
          names.map((n) => root.removeEntry(n, { recursive: true }).catch(() => {})),
        );
      } catch {
        /* OPFS unavailable — in-memory store is fine */
      }
    });
    await page.reload();
    await use(page);
  },
});

export { expect };

/** Open the Tasks dock panel via the command palette. */
export async function openTasksPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Command palette" }).click();
  const input = page.getByPlaceholder("Search mail, contacts, or type a command…");
  await input.fill("Open Tasks");
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
}
```

> Note: `root.keys()` is intentionally avoided; iterating the handle directly and collecting names first prevents mutate-during-iteration races.

- [ ] **Step 4: Create `e2e/smoke.spec.ts`**

Smoke uses only role/text selectors that exist today (no `data-testid` yet — that lands in Task 3). Asserting these render after the reset fixture proves both the shell mounts and the reset path doesn't break boot.

```ts
import { test, expect } from "./fixtures";

test("app boots and renders the workspace shell after storage reset", async ({ page }) => {
  // Persistent chrome — present in every workspace, proves the shell mounted.
  await expect(page.getByRole("button", { name: "Command palette" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Search emails, contacts, files…" }),
  ).toBeVisible();
});
```

- [ ] **Step 5: Add scripts to `package.json`**

In the `"scripts"` block, add (after `"test:watch"`):
```json
    "e2e": "playwright test",
    "e2e:ui": "playwright test --ui",
```

- [ ] **Step 6: Update `.gitignore`**

Append:
```gitignore

# Playwright e2e
test-results/
playwright-report/
/blob-report/
playwright/.cache/
```

- [ ] **Step 7: Run the smoke spec on both projects**

Run:
```bash
pnpm e2e smoke.spec.ts
```
Expected: PASS for `[chromium]` and `[webkit]` (webServer builds + starts preview automatically). If WebKit cannot reach the server on first boot, re-run — the build step is one-time.

> Dev tip for faster iteration: run `pnpm build` once, then `pnpm preview` in a background terminal; subsequent `pnpm exec playwright test <spec> --project=chromium` reuse the running server.

- [ ] **Step 8: Verify unit layer is untouched**

Run:
```bash
pnpm test && pnpm typecheck && pnpm lint
```
Expected: all green — Vitest does not pick up `e2e/*.spec.ts`, `tsc -b` does not compile `e2e/`, `eslint src` does not lint it.

- [ ] **Step 9: Commit**

```bash
git add playwright.config.ts e2e/fixtures.ts e2e/smoke.spec.ts package.json pnpm-lock.yaml .gitignore
git commit -m "test(e2e): Playwright harness + smoke spec (web mode, chromium+webkit)"
```

---

### Task 2: Tasks open → add → complete spec

**Files:**
- Create: `e2e/tasks.spec.ts`

**Interfaces:**
- Consumes: `openTasksPanel(page)` and `{ test, expect }` from `e2e/fixtures.ts` (Task 1).
- Consumes (app, unchanged): `AddTaskRow` input `placeholder="Add task…"`; `TaskRow` checkbox `aria-label={`Toggle ${title}`}`.

- [ ] **Step 1: Write the spec**

The Tasks flow already works in the app, so this spec is a regression characterization of existing behavior — it should go green on first run. `TASK_STATUSES` order puts "needs-action" (To do) first, so `getByPlaceholder("Add task…").first()` is the To-do composer.

```ts
import { test, expect, openTasksPanel } from "./fixtures";

test("open Tasks, add a task, and complete it", async ({ page }) => {
  await openTasksPanel(page);

  const title = "Write the e2e harness";
  const addInput = page.getByPlaceholder("Add task…").first();
  await addInput.fill(title);
  await addInput.press("Enter");

  const checkbox = page.getByRole("checkbox", { name: `Toggle ${title}` });
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();

  await checkbox.check();
  await expect(page.getByRole("checkbox", { name: `Toggle ${title}` })).toBeChecked();
});
```

- [ ] **Step 2: Run the spec**

Run:
```bash
pnpm e2e tasks.spec.ts
```
Expected: PASS on `[chromium]` and `[webkit]`. The new task appears in the To-do group; checking it flips `status` to `completed` (the row moves to the Done group but the checkbox — re-queried by accessible name — is now checked).

- [ ] **Step 3: Commit**

```bash
git add e2e/tasks.spec.ts
git commit -m "test(e2e): Tasks open → add → complete flow"
```

---

### Task 3: Create-task-from-email spec + email-row testids + README

**Files:**
- Modify: `src/components/email/EmailRow.tsx` (add two `data-testid` attributes)
- Create: `e2e/tasks-from-email.spec.ts`
- Create: `e2e/README.md`

**Interfaces:**
- Consumes: `{ test, expect }` from `e2e/fixtures.ts`.
- Consumes (app): email-row right-click → Radix `ContextMenu` item `Create task from this email` (`EmailRowContextMenu.tsx:218`), which calls `createTaskFromEntity(...)` + `openModulePanel(...)`. The created task's title is `msg.subject || "(no subject)"`.
- Produces (app): `data-testid="email-row"` on the `EmailRow` root and `data-testid="email-subject"` on its subject span — the unambiguous targets the spec needs (a right-click target, and the subject text to assert the task title against).

- [ ] **Step 1: Write the spec first (red — testids don't exist yet)**

```ts
import { test, expect } from "./fixtures";

test("create a task from an email via the row context menu", async ({ page }) => {
  const row = page.getByTestId("email-row").first();
  await expect(row).toBeVisible();

  // Capture the real subject (fixtures may be non-deterministic) so we assert
  // the created task's title against it rather than a hardcoded string.
  const subject = (await row.getByTestId("email-subject").innerText()).trim();
  expect(subject.length).toBeGreaterThan(0);

  await row.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Create task from this email" })
    .click();

  // createTaskFromEntity also opens the Tasks panel.
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: `Toggle ${subject}` }),
  ).toBeVisible();
});
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
pnpm e2e tasks-from-email.spec.ts --project=chromium
```
Expected: FAIL — `getByTestId("email-row")` resolves to nothing (timeout waiting for visible) because the testids are not in the DOM yet.

- [ ] **Step 3: Add `data-testid="email-row"` to the EmailRow root**

In `src/components/email/EmailRow.tsx`, the root element currently begins:
```tsx
    <div
      role="row"
      aria-selected={inSelectionSet}
      data-list-row
```
Change to:
```tsx
    <div
      role="row"
      data-testid="email-row"
      aria-selected={inSelectionSet}
      data-list-row
```

- [ ] **Step 4: Add `data-testid="email-subject"` to the subject span**

In the same file, the subject span (around lines 242-249) currently reads:
```tsx
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-body",
              isRead ? "font-normal text-text-secondary" : "font-semibold text-text-primary",
            )}
          >
            {msg.subject}
          </span>
```
Change the opening tag to add the testid:
```tsx
          <span
            data-testid="email-subject"
            className={cn(
              "min-w-0 flex-1 truncate text-body",
              isRead ? "font-normal text-text-secondary" : "font-semibold text-text-primary",
            )}
          >
            {msg.subject}
          </span>
```

- [ ] **Step 5: Run to verify it passes**

Run:
```bash
pnpm e2e tasks-from-email.spec.ts
```
Expected: PASS on `[chromium]` and `[webkit]` — the right-click context menu opens, the task is created with title == captured subject, and the Tasks panel shows it.

- [ ] **Step 6: Create `e2e/README.md`**

````markdown
# End-to-end tests (Playwright)

These specs drive the app in **web mode** — `vite preview` on port 4173, where
`src/main.tsx` → `initWeb()` seeds fixtures and runs the full mutation pipeline
and the Tasks module entirely in the browser (no Tauri, no IPC).

## Run

```bash
pnpm e2e          # all specs, chromium + webkit (auto-starts the preview server)
pnpm e2e:ui       # interactive runner
pnpm e2e smoke.spec.ts            # one file
pnpm exec playwright test --project=chromium   # one engine
```

For fast iteration, run `pnpm build` once and start `pnpm preview` in a separate
terminal; the config's `reuseExistingServer` (local only) will reuse it.

## Isolation

Each test gets a fresh browser context. `e2e/fixtures.ts` additionally clears
OPFS + localStorage before the app boots, so fixture seeding is deterministic.
Because `generateMessages()` is not guaranteed deterministic, specs capture
subject text from the DOM and assert against it — never hardcoded fixture
content.

## Why web mode, and the Tauri-driver door

Web mode covers pure-frontend flows (Tasks, links, the mutation pipeline) and is
fast and CI-friendly. Flows that depend on the Rust backend (real SQLCipher
vault, sync, local-first filesystem side-effects) are **not** covered here. When
they need coverage, add a separate `tauri-driver` Playwright project against the
built `.app`; these web specs stay unchanged.

## CI (not yet wired)

Add this job to `.github/workflows/ci.yml` when ready to gate on e2e:

```yaml
  e2e:
    name: E2E (Playwright · web mode)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium webkit
      - run: pnpm build
      - run: pnpm e2e
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with: { name: playwright-report, path: playwright-report/, retention-days: 7 }
```
````

- [ ] **Step 7: Full verification**

Run:
```bash
pnpm e2e && pnpm test && pnpm typecheck && pnpm lint
```
Expected: all green — three e2e specs pass on both engines; the unit layer, typecheck, and lint are unaffected by the two `data-testid` additions.

- [ ] **Step 8: Commit**

```bash
git add src/components/email/EmailRow.tsx e2e/tasks-from-email.spec.ts e2e/README.md
git commit -m "test(e2e): create-task-from-email flow + email-row test ids + README"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-19-playwright-e2e-setup-design.md`):
- §2 web mode / preview :4173 / webServer → Task 1 Step 2. ✅
- §3 isolation (fresh context + OPFS/localStorage wipe) + runtime-derived assertions → Task 1 Step 3; Task 3 Steps 1/5. ✅
- §3 browsers chromium+webkit → Task 1 Step 2 projects + run steps. ✅
- §4 file layout (config, fixtures, 3 specs, README) → Tasks 1-3. ✅
- §5 selectors role/text-first + minimal testids (email-row, email-subject) → Task 3 Steps 3/4. ✅
- §6 scripts + gitignore + e2e isolated from Vitest/typecheck/lint → Task 1 Steps 5/6/8. ✅
- §7 CI sketch (deferred) → Task 3 README. ✅
- §8 Tauri-later door → Task 3 README. ✅
- §9 verification (`pnpm e2e`/`test`/`typecheck`/`lint` green) → Task 3 Step 7. ✅
- §10 out-of-scope (kanban drag, undo, CI wiring, tauri-driver) — correctly excluded. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". All steps carry exact code/commands. ✅

**Type consistency:** `openTasksPanel(page: Page)` defined in Task 1, imported in Task 2; `{ test, expect }` exported from `e2e/fixtures.ts` and consumed in Tasks 2/3; testids `email-row`/`email-subject` defined in Task 3 Steps 3/4 and used in Task 3 Step 1. Consistent. ✅
