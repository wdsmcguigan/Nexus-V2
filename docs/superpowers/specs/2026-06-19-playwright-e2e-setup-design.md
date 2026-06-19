# Playwright e2e Harness (web mode) — Design Spec

> **Status:** Approved design (brainstorm complete). Makes the repo testing policy's Playwright layer real.
> **Builds on:** `docs/testing-policy.md` (mandates Playwright e2e for critical UI flows; declares Playwright not-yet-installed) and the completed Tasks module (`src/modules/tasks/`), which supplies the first flows to cover.
> **Next:** writing-plans → subagent-driven implementation.

## 0. Goal

Install and configure Playwright and ship the first critical-flow e2e specs, turning the just-committed testing policy from aspirational into an actual regression layer. Scope is deliberately small: prove the harness end-to-end on the three policy-named flows before investing further. CI wiring is intentionally deferred to a fast follow-up.

## 1. Decisions (locked during brainstorming)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | What Playwright drives | **Web mode now; Tauri-driver door documented for later** | `initWeb()` runs fixtures + the full mutation pipeline + Tasks module in a plain browser with no IPC. Fast, CI-friendly, policy-blessed. A `tauri-driver` layer is documented as a future addition for IPC-dependent flows. |
| 2 | Browser engine(s) | **Chromium + WebKit** | WebKit mirrors the shipped app's macOS WKWebView runtime; Chromium is the stable default. Both run locally. |
| 3 | First-PR scope | **3 flows** — app-boots smoke, Tasks open→add→complete, create-task-from-email | Exactly what `docs/testing-policy.md` names. Proves the harness without over-investing before the pattern is established. |
| 4 | CI wiring | **Config + local only this PR** | Validate the harness locally first; CI `e2e` job is a documented fast-follow. |

## 2. How it drives the app

- Target: **web mode** against a production-like server — `pnpm build && pnpm preview` (port 4173). Web mode (`src/main.tsx` → `initWeb()`) seeds fixtures, runs `replayRegisteredModules`, and exercises `recordMutation`/`recordMutations`, the links graph, and the Tasks module entirely client-side. No Tauri, no SQLCipher, no IPC.
- `playwright.config.ts` declares a `webServer` block (`command: pnpm preview`, `url: http://localhost:4173`, `reuseExistingServer: !process.env.CI`) so `pnpm e2e` boots the server automatically. Using `preview` (built output) over `dev` is faster and closer to shipped behavior.
- `baseURL: http://localhost:4173`; specs navigate with `await page.goto("/")`.

## 3. Test isolation (the flake-killer)

- Playwright assigns each test a fresh `BrowserContext`, so storage (including OPFS, which `LocalStore.initOpfs()` uses via `navigator.storage.getDirectory()` → `nexus-store.json`) is **isolated per test**. A fresh context starts with empty OPFS, so `initWeb()` re-seeds fixtures deterministically each test.
- **Belt-and-suspenders:** a shared test fixture (`e2e/fixtures.ts`) clears OPFS + `localStorage` before the app navigates, guaranteeing a clean slate even if context isolation ever regresses. The smoke spec asserts the reset path works.
- **Non-determinism guard:** `generateMessages()` in `src/data/fixtures.ts` is not guaranteed deterministic across runs. Specs therefore assert on **state derived at runtime**, never on hardcoded fixture content. Concretely, the create-from-email spec reads the target email row's subject from the DOM, triggers task creation, then asserts a task exists whose title equals that captured subject.

## 4. File layout

```
playwright.config.ts          # webServer→preview; chromium + webkit projects; trace on first-retry
e2e/
  fixtures.ts                 # extended `test` with a clean-storage fixture + helpers (e.g. openTasksPanel)
  smoke.spec.ts               # app boots, workspace shell renders, storage reset verified
  tasks.spec.ts               # open Tasks panel → add a task → complete it (row moves to Done group)
  tasks-from-email.spec.ts    # right-click an email row → "Create task from this email" → task title == subject
  README.md                   # how to run; the "web now / tauri-driver later" note; CI job sketch
```

## 5. Selectors

Role/text/label-first (Playwright user-facing locators), which the Tasks UI already supports without new attributes:

- Panel: `getByRole("heading", { name: "Tasks" })` (`TasksPanel.tsx` `<h2>Tasks</h2>`).
- Add task: `getByPlaceholder("Add task…")` + `Enter` (`AddTaskRow.tsx`).
- Complete: `getByRole("checkbox", { name: "Toggle <title>" })` (`TaskRow.tsx` `aria-label`).
- View toggle: `getByRole("button", { name: "List" | "Kanban" })`.
- Status groups: section headings "To do" / "Doing" / "Done" (`TASK_STATUS_LABEL`).

Minimal `data-testid` additions only where the DOM is genuinely ambiguous, each justified and enumerated in the plan:

- An email row needs a stable right-click target → `data-testid="email-row"` on the row element (likely in the email list row component).
- If the dockview Tasks tab/panel is not unambiguously reachable by role after launch, one `data-testid` on the Tasks panel container.

No speculative testids. The plan lists exactly which attributes get added and why.

## 6. Scripts & ignores

- `package.json`: `"e2e": "playwright test"`, `"e2e:ui": "playwright test --ui"`.
- `.gitignore`: `test-results/`, `playwright-report/`, `/blob-report/`, `playwright/.cache/`.
- Keep the e2e layer separate from the Vitest unit layer: ensure Vitest's `include`/`exclude` does not pick up `e2e/**` (Playwright specs are not Vitest tests), and ensure `e2e/**` typechecks without colliding with the app `tsconfig` (Playwright provides its own types via `@playwright/test`). The plan verifies `pnpm test`, `pnpm typecheck`, and `pnpm lint` remain green alongside the new dir.

## 7. CI (deferred — sketch only)

Not wired this PR. The `e2e/README.md` includes a ready-to-paste job sketch for `.github/workflows/ci.yml`:

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

## 8. Tauri-later door

Documented in `e2e/README.md`: web-mode specs cover pure-frontend flows. When IPC-dependent flows (real vault, sync, local-first FS side-effects) need coverage, add a separate `tauri-driver` Playwright project against the built `.app`; the web specs stay unchanged. No `tauri-driver` work in this PR.

## 9. Testing / verification

- `pnpm e2e` green on **both** `chromium` and `webkit` projects locally.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (Vitest) all still green — the e2e dir does not leak into the unit-test or app-typecheck surfaces.
- Manual sanity: `pnpm e2e:ui` opens the runner and the three specs pass interactively.

## 10. Out of scope (→ later)

Kanban drag→status and reorder e2e; undo/redo round-trip e2e; visual-regression screenshots; CI wiring (sketch only); `tauri-driver` implementation; coverage of email/calendar/contacts flows. These come once the harness is proven.
