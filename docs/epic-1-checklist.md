# EP-1 — Filter & Saved Views (Web) — Execution Checklist

**Status:** Complete
**Branch:** `claude/nexus-ep1-execution-16c2941d`
**Reference docs:** `docs/architecture.md`, `docs/glossary.md`

---

## Phase 1a — SavedView schema + state foundations ✅

- [x] `SavedView` type added to `src/data/types.ts`
- [x] `SAVE_VIEW | DELETE_VIEW | RENAME_VIEW` added to `MutationKind`
- [x] `savedViews: Map<string, SavedView>` + CRUD methods added to `LocalStore`
  - [x] `putSavedView` / `deleteSavedView` / `renameSavedView` / `getSavedViewsSorted`
  - [x] `hydrate` + `toSnapshot` include `savedViews`
- [x] `saveView` / `deleteView` / `renameView` mutation helpers in `src/state/mutations.ts`
- [x] `workspace.ts` additions:
  - [x] `activeFilter: MetadataFilter` — user-added filter pills
  - [x] `setFilterAxis` / `removeFilterAxis` / `clearFilter`
  - [x] `saveCurrentFilter(name)` — creates a `SavedView` from current pills
  - [x] `deleteSavedView` / `renameSavedView`
  - [x] `loadSavedView(id)` — loads a view's filter + sets `selectedSavedViewId`
  - [x] `selectedSavedViewId: string | null`
  - [x] `viewMode: "list" | "kanban" | "table"` + `setViewMode`
- [x] `useStore.ts` additions:
  - [x] `useSavedViews()` — reactive sorted list
  - [x] `useVisibleMessages` updated: overlays `activeFilter` on nav selection; uses `activeFilter` directly when `selectedSavedViewId` is set
  - [x] `useSelectionTitle` shows saved view name when a view is active
- [x] Dead code removed: `useVisibleEmails()` from `workspace.ts`

**Gate 1a:** `pnpm typecheck` clean ✅

---

## Phase 1b — Filter bar UI (`FLT-BAR`) ✅

- [x] `src/components/filter/FilterBar.tsx` (new)
  - [x] Active filter pills (Status, Priority, Label, Read/Unread, Pinned, Starred, Flagged)
  - [x] `+ Add filter` dropdown (Radix DropdownMenu with submenus per axis)
  - [x] ✕ on each pill calls `removeFilterAxis`
  - [x] `Clear all` button when any filter active
  - [x] `Save view…` inline form: input + Save button → `saveCurrentFilter(name)`
- [x] Wired into `EmailListPanel.tsx` above the sort toolbar

**Gate 1b:** `pnpm typecheck` clean ✅

---

## Phase 1c — Saved views in nav ✅

- [x] `NavigationPanel.tsx` — new "Saved Views" section (between system labels and folders)
  - [x] Collapsible section header (ChevronDown/Right toggle)
  - [x] Each view row: `Bookmark` icon + name, highlighted when active
  - [x] Click row → `loadSavedView(id)`
  - [x] Context menu (right-click): Rename (inline `InlineRename`) / Delete
  - [x] Section only appears when `savedViews.length > 0`

**Gate 1c:** `pnpm typecheck` clean ✅

---

## Phase 1d — Kanban view (`VW-KANBAN-BY-STATUS`) ✅

- [x] `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` installed
- [x] `src/components/views/KanbanView.tsx` (new)
  - [x] Columns: "No Status" + one column per `STA` (in position order)
  - [x] Column headers: color dot + name + message count
  - [x] Cards: `KanbanCard` with sender avatar, subject, snippet, label/tag/priority chips
  - [x] Virtualized card list per column (`@tanstack/react-virtual`)
  - [x] Drag via `useDraggable` / `useDroppable` + `DndContext` with `PointerSensor` (8px threshold)
  - [x] Drop on column → `SET_STATUS` or `CLEAR_STATUS` mutation
  - [x] `DragOverlay` renders a ghost card while dragging
- [x] Wired into `EmailListPanel` when `viewMode === "kanban"`

**Gate 1d:** `pnpm typecheck` clean ✅

---

## Phase 1e — Table view (`VW-TABLE-CUSTOM-FIELDS`) ✅

- [x] `src/components/views/TableView.tsx` (new)
  - [x] Sticky column headers: Sender, Subject, Status, Priority, Labels, Tags, Date
  - [x] Custom field columns appended (one per `CFD` definition)
  - [x] Click column header → sort (asc/desc toggle; ChevronUp/Down indicator)
  - [x] Virtualized rows (`@tanstack/react-virtual`, `estimateSize: 36px`)
  - [x] Row click → `setSelectedEmail`
  - [x] Selected row highlighted with `bg-accent-soft`
  - [x] Status chip, Priority badge, Label chips, Tag chips in cells
- [x] Wired into `EmailListPanel` when `viewMode === "table"`

**Gate 1e:** `pnpm typecheck` clean ✅

---

## Phase 1f — View switcher + EP-0 cleanup ✅

- [x] ViewSwitcher added to `EmailListPanel` header (List / Kanban / Table toggle buttons)
  - [x] `List` / `Trello` / `Table2` icons from lucide-react
  - [x] Active mode highlighted with `bg-surface-3`
- [x] `EmailViewerPanel.tsx` migrated from legacy `Email` shape to `Message`
  - [x] Uses `useMessage(selectedEmailId)` from `useStore.ts`
  - [x] `msg.fromAddr`, `msg.toAddrs`, `msg.ccAddrs`, `msg.receivedAt`
  - [x] Body: `msg.snippet` as placeholder (full retrieval deferred to EP-3)

**Gate 1f:** `pnpm typecheck` clean ✅

---

## Phase 1g — Tests + docs ✅

- [x] `src/storage/__tests__/savedviews.test.ts` — 8 tests covering full CRUD + hydrate round-trip
- [x] `pnpm test` — 83/83 passing
- [x] `pnpm build` — clean (498 kB bundle)
- [x] This checklist written
- [x] Commit + push to `claude/nexus-ep1-execution-16c2941d`

**🚦 Gate 1g:** `pnpm typecheck && pnpm build && pnpm test` all green ✅

---

## Deferred items (for EP-2 / EP-3 planning)

**→ EP-2:**
- `INS-FLAG-PICKER` with due-date, `INS-NOTE-EDITOR`, `INS-CUSTOM-FIELDS` editors
- Color picker for label/folder (currently stub with `charCodeAt`)
- NAV-FOLDER-CTX "Recolor" and "Nest under"

**→ EP-3:**
- Full body retrieval via `bodyRef` in `EmailViewerPanel` (currently shows `msg.snippet`)
- FTS5 full-text search wired into `queryMessages`
- OPFS persistence for LocalStore

---

## Decisions log

**`activeFilter` overlays on nav selection (not replaces):**
Cleaner mental model for users — nav picks the mailbox, filter pills narrow within it.
Saved views use `activeFilter` directly (complete filter) and set `selectedSavedViewId`.

**Kanban cards use per-column `useVirtualizer`:**
Each column scrolls independently with its own virtualizer instance. This
is simpler than a global 2D virtualizer and handles variable card heights naturally.

**PointerSensor with 8px distance threshold:**
Prevents accidental drags when clicking a card to select a message.
Touch events work via `PointerEvent` on mobile browsers.

**Table view CFD columns read from `localStore.customFieldDefs` at render:**
Columns are stable for the session; no need to subscribe reactively to CFD changes.
If CFDs change mid-session, a re-mount (nav click) will pick up the new columns.

**`EmailViewerPanel` body deferred to EP-3:**
`Message.bodyRef` is a content hash pointing to disk/OPFS cache. Loading it
requires OPFS body retrieval (EP-3). The viewer shows `msg.snippet` as a
labeled placeholder in the meantime.
