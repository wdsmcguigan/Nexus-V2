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
