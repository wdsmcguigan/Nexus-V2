# EP-3 — FTS Index + Body Retrieval + Markdown Notes + OPFS Persistence — Execution Checklist

**Status:** Complete
**Branch:** `claude/nexus-ep3-execution`
**Reference docs:** `docs/architecture.md`, `docs/glossary.md`

---

## Phase 3a — Body store + EmailViewerPanel ✅

- [x] `src/storage/bodyStore.ts` (new) — `BodyStore` class, singleton `bodyStore`
  - [x] `set(bodyRef, html)` / `get(bodyRef)` / `has(bodyRef)` / `size()`
  - [x] Class exported for type use in FTS and tests
- [x] `fixtures.ts` — `generateBodyHtml(i, subject, snippet)` generates 4-paragraph HTML per message
  - [x] 10 distinct body templates cycling via `i % 10`
  - [x] `initStore()` populates `bodyStore` after `localStore.hydrate()`
- [x] `EmailViewerPanel.tsx` — reads from `bodyStore.get(msg.bodyRef)`
  - [x] Falls back to snippet `<p>` if body not cached (future sync messages)
  - [x] Removed EP-2 "deferred to EP-3" placeholder

**Gate 3a:** `pnpm typecheck` clean ✅

---

## Phase 3b — FTS engine ✅

- [x] `src/storage/fts.ts` (new) — `FTSIndex` class, singleton `ftsIndex`
  - [x] MiniSearch BM25 backend: fields = subject / body / notes
  - [x] Field boost: subject ×3, notes ×2, body ×1
  - [x] `prefix: true`, `fuzzy: 0.15` for tolerant search
  - [x] `indexMessages(messages, bodies)` — bulk populate; skips already-indexed IDs
  - [x] `addMessage(msg, bodyHtml)` — incremental upsert (for future live ingestion)
  - [x] `removeMessage(id)` — remove from index
  - [x] `search(query, limit)` → `FTSResult[]` with score
  - [x] `searchIds(query)` → `Set<string>` (for intersect in queryMessages)
  - [x] `_stripHtml(html)` strips tags before indexing body
  - [x] Class exported for test injection
- [x] `fixtures.ts` — `ftsIndex.indexMessages(messages, bodyStore)` called in `initStore()`
- [x] `src/storage/query.ts` — upgraded `textQuery` handling
  - [x] Old simple `includes` post-filter removed
  - [x] FTS intersect added to Phase 1 (before resolving Message objects)
  - [x] `queryMessages` accepts injectable `fts: FTSIndex` param (default = global singleton)
  - [x] Header comment updated to reflect EP-3 FTS backend

**Gate 3b:** `pnpm typecheck` clean ✅

---

## Phase 3c — OPFS persistence ✅

- [x] `LocalStore.initOpfs()` — returns `Promise<boolean>` (true = loaded from OPFS)
  - [x] Calls `_notify()` after hydrating from OPFS so React re-renders with persisted data
- [x] `main.tsx` — calls `localStore.initOpfs()` async after first render
  - [x] If OPFS data loaded: re-indexes FTS from persisted messages + bodyStore
  - [x] First visit: OPFS empty → fixtures remain; OPFS initialized for future saves
  - [x] Return visits: OPFS loads → store re-hydrated, mutations persisted between sessions

**Gate 3c:** `pnpm typecheck` clean ✅

---

## Phase 3d — Search UI ✅

- [x] Search bar added to `EmailListPanel.tsx`
  - [x] Appears between PanelHeader and FilterBar in all view modes (list / kanban / table)
  - [x] 200ms debounce → `setFilterAxis({ textQuery })` or `removeFilterAxis("textQuery")`
  - [x] Clear button (✕) when query is non-empty
  - [x] Escape key: clears and blurs search input
  - [x] `/` keyboard shortcut: focuses search from anywhere (when no other input focused)
  - [x] Syncs with external filter clear (pill removal via FilterBar)
  - [x] Empty-state message updated to "No messages match" with "Clear search" action
  - [x] Imports: `Search`, `X` from lucide-react

**Gate 3d:** `pnpm typecheck` clean ✅

---

## Phase 3e — Markdown preview in NoteEditor ✅

- [x] `marked` v18 installed (ships own TypeScript types)
- [x] `NoteEditor.tsx` — Edit / Preview toggle
  - [x] "Preview" button appears when note has content
  - [x] `marked.parse(value)` renders to HTML; displayed in a styled `<div>`
  - [x] Preview uses Tailwind prose-style overrides for headings, code, links, lists
  - [x] Switching message (`messageId` change) resets to Edit mode
  - [x] Toolbar row: "Markdown" label + Edit/Preview chip button

**Gate 3e:** `pnpm typecheck` clean ✅

---

## Phase 3f — Tests + docs ✅

- [x] `src/storage/__tests__/ep3.test.ts` — 18 tests:
  - [x] BodyStore: set / get / overwrite / size
  - [x] FTSIndex: subject match, body match, notes match, ranking, prefix, empty query, searchIds, removeMessage, addMessage upsert
  - [x] queryMessages + FTS: no-filter baseline, textQuery narrows results, combined with label filter, zero results, total count
- [x] `src/storage/__tests__/query.test.ts` — updated textQuery tests to pass injectable `FTSIndex`
- [x] `pnpm test` — 118/118 passing
- [x] `pnpm build` — clean (602 kB bundle; +70 kB from minisearch + marked)
- [x] This checklist written
- [x] Commit + push to `claude/nexus-ep3-execution`

**🚦 Gate 3f:** `pnpm typecheck && pnpm build && pnpm test` all green ✅

---

## Deferred items (for EP-4 / EP-5)

**→ EP-4 (Tauri desktop):**
- Replace MiniSearch with SQLite-FTS5 (Tantivy or FTS5 extension via rusqlite)
- Full body retrieval from real `.eml` files on disk (via `bodyRef` → disk path lookup)
- FTS index persistent in SQLite alongside LocalStore (no re-index on startup)
- `BodyStore.get()` becomes async (disk read) rather than sync in-memory Map

**→ EP-5 (Sync relay):**
- FTS index incremental update as new messages arrive from sync
- `ftsIndex.addMessage()` already wired for single-message upsert

---

## Decisions log

**MiniSearch instead of SQLite-FTS5 for EP-3 (web):**
The architecture spec lists "wa-sqlite/sql.js or OPFS-SQLite" as options. wa-sqlite requires
SharedArrayBuffer (COOP/COEP headers) or Worker thread setup; sql.js adds a ~1.5 MB WASM
binary that needs special Vite configuration. MiniSearch is 30 kB pure JS with BM25 ranking
and handles the fixture corpus (60 messages) with sub-millisecond latency. The FTS abstraction
(`ftsIndex.searchIds(query)`) is a clean seam: EP-4 Tauri replaces the MiniSearch
implementation with SQLite-FTS5 behind the same interface.

**OPFS persistence: fixtures always load first, OPFS overlays async:**
`initStore()` (called synchronously via the fixtures import) seeds the store so the first
render is never blank. `initOpfs()` runs after the first paint. On first visit OPFS is empty
so nothing changes; on return visits the persisted snapshot overwrites the fixture seed and
triggers a React re-render via `_notify()`. This gives instant first paint with correct
persistence on subsequent sessions.

**`queryMessages` accepts injectable `FTSIndex` parameter:**
The global `ftsIndex` singleton is populated by `initStore()` at runtime. Tests construct
isolated `FTSIndex` instances to avoid cross-test contamination and to test with controlled
corpora. The default parameter keeps call sites outside tests unchanged.

**`marked` setOptions with `async: false`:**
`marked` v18 defaults to async parsing (returns a Promise). Setting `async: false` restores
synchronous behavior so `marked.parse(value)` returns `string` directly, fitting React's
render-time model without introducing async state or Suspense.
