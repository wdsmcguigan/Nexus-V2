# Contributing to Nexus-V2

Short, link-heavy. This file is the index; specific recipes live in `docs/developer-guide.md`.

---

## Before opening a PR

Required local checks (all must pass):

```bash
pnpm typecheck         # TypeScript strict, zero errors
pnpm lint              # ESLint zero-warnings
pnpm test              # Vitest unit tests
cargo check -p nexus   # Rust backend compiles
cargo test -p nexus    # Rust unit tests
```

If you touched the relay binary:

```bash
cargo check -p nexus-relay
cargo test -p nexus-relay
```

---

## The mutation pipeline rule (read this first)

Every user-initiated state change must flow through `recordMutation()` in `src/state/mutations.ts`. Never write to the Zustand store or the database directly.

```
UI event → recordMutation(kind, payload) → optimistic store update →
  applyMutationIpc → Rust apply_mutation → db.apply_mutation → mutations table
```

See the sequence diagram in `CLAUDE.md` and the deeper "How to add a new mutation kind" recipe in `docs/developer-guide.md`.

This rule exists because the relay drainer reads from the `mutations` table; any write that bypasses it is invisible to other devices and gets lost on next sync.

Exceptions:
- Provider sync workers (Gmail, IMAP, Outlook) write directly to the DB inside a transaction. Their writes do not need to round-trip through the mutation log because they're already remote-sourced and would otherwise echo back.

---

## Adding things

| Adding | Required steps | Detailed recipe |
|---|---|---|
| **A new mutation kind** | 1. Add variant to `MutationKind` in `src/data/types.ts`. 2. Add case to `applyMutation()` switch in `src/state/mutations.ts` (optimistic local update). 3. Add helper function in `mutations.ts` (e.g., `myMutation(payload, store)`). 4. Handle in `src-tauri/src/db/queries.rs:apply_mutation`. 5. Update `docs/glossary.md` §8 and `docs/database-reference.md` cross-reference. | `docs/developer-guide.md` §How to Add a New Mutation Kind |
| **A new IPC command** | 1. Implement `#[tauri::command] pub async fn` in `src-tauri/src/commands.rs`. 2. Register in `src-tauri/src/lib.rs:invoke_handler!`. 3. Typed wrapper in `src/storage/tauri.ts`. 4. Add row to `docs/ipc-api-reference.md`. | `docs/developer-guide.md` §How to Add a New IPC Command |
| **A new database column** | 1. Add `ALTER TABLE ... ADD COLUMN` to a new `EP<N>_ALTER_SQL` constant in `src-tauri/src/db/schema.rs`. 2. Append the constant to the migration runner in `db/mod.rs`. 3. Update query helpers in `queries.rs`. 4. Add row to `docs/database-reference.md`. | `docs/database-reference.md` §Migration model |
| **A new database table** | 1. Add `CREATE TABLE IF NOT EXISTS` to a new `EP<N>_IDEMPOTENT_SQL` constant. 2. Migration runner already runs it. 3. Update `docs/database-reference.md` ERD + table inventory. | Same |
| **A new docs page** | 1. Write it. 2. Link from `docs/roadmap.md` "Documentation Map". 3. Link from `CLAUDE.md` "Where to Find Things" if it's a primary reference. | — |
| **Shipping an epic** | 1. Create `docs/epic-<N>-checklist.md` with what shipped. 2. Update `docs/architecture.md` Phasing table. 3. Update `docs/roadmap.md`. 4. Update `CLAUDE.md` "Epics shipped so far". | — |
| **Discovering a gap** | Add a row to `docs/known-gaps.md` with severity, location, and definition of done. | `docs/known-gaps.md` §Maintenance rule |

---

## Branch convention

Feature branches follow `claude/nexus-ep<N>-<description>-<id>` (or `claude/<description>-<id>` for cross-epic work). Each session has a designated branch — check the session instructions.

---

## Commit hygiene

- One logical change per commit. Bisect-friendly.
- Reference docs paths in commit bodies when you change behavior so the docs PR can find them.
- **Never** commit `.env`, secrets, OAuth credentials, or vault key material.
- **Never** bypass git hooks (`--no-verify`, `--no-gpg-sign`).

---

## Code style

- TypeScript: follow ESLint config; React 18 functional components; no `any` without `// eslint-disable-next-line` justification.
- Rust: standard rustfmt; clippy clean (`cargo clippy -p nexus -- -D warnings` when possible).
- No comments explaining "what" — the code says that. Only comment "why" when it's non-obvious.
- Don't add backwards-compat shims when the codebase has a single client (this app).

See `CLAUDE.md` §General Rules for the full code-style philosophy.

---

## Documentation expectations

Documentation is treated as code. A PR that changes behavior without updating the relevant doc is incomplete.

When in doubt: docs ordering by priority:
1. `CLAUDE.md` — orientation, must always be accurate
2. `docs/known-gaps.md` — must be updated when fixing or discovering gaps
3. `docs/ipc-api-reference.md` / `docs/database-reference.md` — must match `commands.rs` / `schema.rs`
4. `docs/glossary.md` — must list every `MutationKind` variant
5. Everything else
