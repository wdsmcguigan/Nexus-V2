# Testing Policy

> Repo-wide testing standard for Nexus-V2. One uniform standard — no "new modules tested one way, old panels another."

## The standard

1. **Pure logic → Node unit tests (Vitest).** Business logic, reducers, mutation inverses, data transforms, derivation, and any UI-adjacent logic that can be extracted into a pure function are tested in the default Vitest **`node`** environment. This is the backbone and applies to *every* module and panel.

2. **Critical UI flows → Playwright e2e (real browser).** User-visible flows (open a panel, create/complete a task, create-task-from-email, etc.) are covered by Playwright e2e against the running app. This is the automated form of the manual "run the app and verify" check.

3. **No React Testing Library / jsdom.** Deliberately not used. Reasons: (a) consistency — adding RTL only to *new* code creates a two-tier codebase; (b) jsdom can't test this app's layout, drag-and-drop (dnd-kit kanban), or dockview panel rendering — the parts most likely to break; (c) a real-browser check (Playwright) fits the app far better and matches how the UI is actually verified.

## How to apply it

- **Extract UI logic into pure functions and Node-test those.** Worked examples in the Tasks module: `src/modules/tasks/sort.ts` (`sortTasks`, `groupTasksByStatus`), `src/modules/tasks/links.ts` (`taskLinkedItems`), and `resolveStatusDrag` in `TaskKanbanView.tsx`. The component then becomes a thin wrapper that's covered by e2e.
- **Mutations/undo are Node-tested** by applying a mutation through `recordMutation`/`recordMutations` against a `LocalStore` and asserting the projection + that `undoLastMutation` reverts it. See `src/modules/tasks/__tests__/dataLayer.test.ts`, `createFromEntity.test.ts`, `src/state/__tests__/recordMutations.test.ts`.
- **A new module/panel’s critical flow gets one e2e** once Playwright is set up.

## Status: Playwright not yet installed

Playwright is **not yet in the repo** (no `@playwright/test`, no config, no `e2e/`). First task when resuming UI-test work:
1. `pnpm add -D @playwright/test` + `npx playwright install`
2. A `playwright.config.ts` pointing at the dev server (web mode: `pnpm dev` on :1420).
3. A first critical-flow spec — e.g. Tasks: open the panel → add a task → complete it; and create-task-from-email.

**Until Playwright lands, verify UI changes live** by running the app and observing behavior (the project's existing practice — start the dev server, drive it, confirm the change and a clean console).

## Do NOT

- Do **not** add `@testing-library/react` or `jsdom`.
- Do **not** rely on a manual live check as a *regression gate* for shipped flows — that's what the Playwright layer is for once it exists.
- Do **not** assert on rendered markup details that aren't user-meaningful; test behavior and observable state.

## Known test quirks

- `src/storage/__tests__/benchmark.test.ts` is timing-sensitive and can flake under load. If it's the *only* failure, re-run `pnpm test -- benchmark` in isolation to confirm it passes.
