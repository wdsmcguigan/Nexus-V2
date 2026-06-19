# Notes Module (`org.nexus.notes`) — Design Spec

> **Status:** Approved design (brainstorm complete). Phase 1, the second real module.
> **Builds on:** `docs/substrate-design.md` (the 4-pillar contract), `docs/module-authoring.md` (how-to), and the **`org.nexus.tasks` module (`src/modules/tasks/`) as the reference implementation** — copy its shape.
> **Next:** writing-plans → subagent-driven implementation.

## 0. Goal

Ship the second full-dogfood module on the substrate (design P2 — core modules use the same public API a third party would). It proves the contribution API generalizes beyond Tasks and adds the graph's second hub node. A master-detail Notes panel — a list of notes + a rich-text editor — with notes linkable to mail/tasks/etc. via the links graph (Pillar 3), namespaced mutations + reducer + inverse (Pillar 1), and a dock + command surface (Pillar 4).

## 1. Decisions (locked during brainstorming)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Body format | **Rich text via TipTap, stored as an HTML string** | Reuses the editor already wired in `EmailComposerPanel` (StarterKit + Underline + Link + Placeholder, `getHTML()`); HTML is a portable, sanitizable (DOMPurify, already a dep) plain string — clean to event-source + sync. |
| 2 | Title | **Explicit title field** | A dedicated stored field (like `Task.title`); the list shows it, create-from-email sets it to the subject cleanly, future search has a clear field to weight. |
| 3 | Body-edit mutation | **Debounced full-body snapshot** (`SET_NOTE_BODY`) | Body is high-frequency; a debounced snapshot (idle + flush-on-blur) keeps one undo unit per pause and avoids per-keystroke log flooding. |
| 4 | `updatedAt` | **Stamped at record-time, carried in the payload** | Keeps the reducer replay-deterministic *and* makes the list-sort timestamp correct — fixing the class of bug Tasks deferred (its `updatedAt`-on-edit TODO). |
| 5 | Create-from scope (v1) | **Email only** | Highest-value ("a note about this thread"); contact/event create-from are trivial follow-ons, excluded to keep the PR focused. |
| 6 | Panel | **Master-detail (list + editor), single view** | Simpler than Tasks' list/kanban toggle; fits the notes use case. |

## 2. Data model (`src/data/types.ts`)

```ts
export interface Note {
  id: string;
  vaultId: string;
  title: string;        // explicit, editable
  body: string;         // TipTap HTML (sanitized on render)
  createdAt: number;
  updatedAt: number;    // drives list sort; stamped at record-time (§4)
}
```

`vaultId` mirrors every other entity. All fields explicit (no optionals) for stable serialization. **Deferred:** pinning, tags, folders, archive.

## 3. Store & hydration

- **`src/storage/local.ts`:** add `notes = new Map<string, Note>()` with `putNote`/`deleteNote` helpers that call `this._notify()` (mirrors `putTask`/`deleteTask`). No `notesByX` index needed in v1 (the list sorts in a pure helper, §8).
- **Hydration:** notes are an event-sourced projection (P5), rebuilt by the existing `replayRegisteredModules(store)` in `main.tsx` (no change to that call site — it already iterates registered modules). Do **not** add notes to the vault snapshot.
- **Plan-time check:** confirm `Note` is registered the same way `Task` is so replay picks it up; no new hydrate payload.

## 4. Mutations + undo (Pillar 1)

### 4.1 Kinds (namespaced under `org.nexus.notes/`)

| Kind | Payload | Notes / inverse |
|------|---------|-------|
| `CREATE_NOTE` | full `Note` | inverse → `DELETE_NOTE` |
| `SET_NOTE_FIELDS` | `{ noteId, fields: Partial<Pick<Note,"title">>, updatedAt }` | inverse → `SET_NOTE_FIELDS` with prior values of exactly those keys (+ prior `updatedAt`) |
| `SET_NOTE_BODY` | `{ noteId, body, updatedAt }` | inverse → `SET_NOTE_BODY` with prior `body` (+ prior `updatedAt`) |
| `DELETE_NOTE` | `{ noteId }` | inverse → `CREATE_NOTE` with the full note captured before delete |

`SET_NOTE_FIELDS` is kept as a `fields` map (not a bare `title`) so later low-frequency fields (e.g. a future `pinned`) batch into it without a new kind — mirrors `SET_TASK_FIELDS`. Body is its own kind because its update cadence and inverse (whole-body snapshot) differ.

Links use the existing core `CREATE_LINK` / `DELETE_LINK` — no note-specific link kind.

### 4.2 Inverse + record-time stamping

- Register one `ModuleInverseBuilder` for the `org.nexus.notes` namespace via `host.registerInverse` covering the four kinds (mirrors `tasksInverse`). Inverse is captured **before** `applyMutation` from current store state (the existing pattern).
- **`updatedAt` discipline:** the mutation *helpers* (not the reducer) capture `updatedAt = Date.now()` and put it in the payload; the reducer applies the payload's `updatedAt` verbatim. This keeps replay deterministic (no `Date.now()` in the reducer) and makes edits actually bump the sort key. `CREATE_NOTE` sets `createdAt = updatedAt = now` in the helper.

### 4.3 Create-from (atomic, Pillar 3)

`createNoteFromEntity(srcType, srcId, title, store)` emits `CREATE_NOTE` (empty body) **plus** a `CREATE_LINK` (`link_type: "references"`, note → source entity) atomically via `recordMutations([...], store, "Create note from item")`, so one undo reverts both. Mirrors `createTaskFromEntity` (which uses `link_type: "tracks"`).

## 5. Body editing (TipTap)

- `NoteEditor` wires its own `useEditor` with the **same extension set as the composer** — `StarterKit`, `@tiptap/extension-underline`, `@tiptap/extension-link`, `@tiptap/extension-placeholder` — and reads `editor.getHTML()`. **`EmailComposerPanel` is not refactored** (kept surgical; a shared editor extraction is a future cleanup, not this PR).
- **Commit timing:** `onUpdate` schedules a debounced commit (~800ms idle); the editor flushes the pending body on blur, on switching to another note, and on unmount. Each flush is one `SET_NOTE_BODY` (one undo unit). The debounce/flush logic lives in a small hook so the timing is testable in isolation where practical; the editor component stays thin.
- **Render/safety:** note bodies are sanitized with DOMPurify before display anywhere outside the live editor.

## 6. Panel UI (`src/modules/notes/`)

`NotesPanel` is a master-detail layout (no view toggle):
- **List** (`NoteListView`): rows sorted by `updatedAt` desc; each `NoteRow` = title + text snippet (`noteSnippet(body)`) + relative time. A "New note" button in the list header creates an empty note and selects it. Empty state when there are no notes.
- **Editor** (`NoteEditor`): a title `<input>` (commits `SET_NOTE_FIELDS` on change/blur) + the TipTap body + a linked-items strip (`noteLinkedItems`, click to open the linked entity). A delete affordance emits `DELETE_NOTE`.

The panel is non-detachable (module panels, per the dock contribution point) and launches from an "Open Notes" command.

## 7. Links / create-from

- **Launchers:** an email-row context-menu action and a command-palette command, both "Create note from this email" → `createNoteFromEntity("nexus/email.message", msg.id, msg.subject || "(no subject)", store)` + open the Notes panel (mirrors the Tasks create-from-email wiring in `EmailRowContextMenu.tsx` / `CommandPalette.tsx`).
- **Display:** the editor lists the note's linked items via `linksFrom(note)` resolved to labels and opens them (email → select message, etc.).
- **Deferred:** `[[wikilinks]]` parsing, reverse backlinks (a "Notes" section inside the email/contact inspector — needs the inspector-section contribution point), contact/event create-from, FTS over note bodies.

## 8. Pure helpers (Node-tested, per testing policy)

- `src/modules/notes/noteSort.ts`: `sortNotesByUpdated(notes): Note[]` (updatedAt desc) and `noteSnippet(html: string): string` (strip tags → trimmed/truncated text preview for the list).
- `src/modules/notes/links.ts`: `noteLinkedItems(noteId, store)` resolver (mirrors `taskLinkedItems`).

Components consume these and stay thin wrappers covered by e2e.

## 9. Module registration (`src/modules/notes/index.ts` + `bootstrap.ts`)

Manifest (mirrors Tasks): `id`/`namespace` `org.nexus.notes`, `entities: ["org.nexus.notes/note"]`, `mutationKinds: [CREATE, FIELDS, BODY, DELETE]`, `capabilities: { "ui.contribute": ["dock"] }`, `trust: "core"`, `contributes.surfaces: [{ type: "dock", id: "notes.main", title: "Notes", icon: "notebook", detachable: false }]` (the plan confirms `"notebook"` resolves in the icon map; fall back to another lucide name if not), `contributes.commands: [{ id: "open", title: "Open Notes" }]`. `registerNotesModule()` wires reducer + inverse + surface + command via `host.contribute.*`. Register it in `src/modules/bootstrap.ts` alongside Tasks.

## 10. Reuse (research-and-reuse, verified in-repo)

The TipTap setup in `EmailComposerPanel` (extensions + `getHTML()`); DOMPurify (already a dep); the entire Tasks module shape — `recordMutation`/`recordMutations` → reducer → inverse → relay → undo → multi-window broadcast; `createTaskFromEntity` (the atomic create-from pattern); `linksGraph` (`createLink`/`linksFrom`/`noteLinkedItems` mirror); `replayRegisteredModules`; the `save*/delete*Mutation` helper shape; the `e2e/` Playwright pattern just landed.

## 11. File structure

```
src/data/types.ts            (+ Note)
src/storage/local.ts         (+ notes map, putNote/deleteNote)
src/state/mutations.ts       (no change — registerModuleInverse already exists from Tasks)
src/modules/notes/
  index.ts                   manifest + registerNotesModule (reducer + inverse + surface + command)
  model.ts                   Note helpers, makeNote factory, id gen
  mutations.ts               KIND constants, helpers (createNote/setNoteFields/setNoteBody/deleteNote), notesInverse, createNoteFromEntity
  reducer.ts                 ModuleReducer.apply → LocalStore.notes
  noteSort.ts                sortNotesByUpdated + noteSnippet (Node-tested)
  hooks.ts                   useNotes / useNote (useStoreVersion + useMemo)
  links.ts                   noteLinkedItems resolver (Node-tested)
  useNoteBodyAutosave.ts     debounced-commit + flush hook
  NotesPanel.tsx · NoteListView.tsx · NoteRow.tsx · NoteEditor.tsx
  __tests__/...
src/modules/bootstrap.ts     (+ registerNotesModule)
src/components/email/EmailRowContextMenu.tsx  (+ "Create note from this email")
src/components/palette/CommandPalette.tsx     (+ "Create note from this email" + "Open Notes" via module command)
e2e/notes.spec.ts            (critical-flow e2e)
```

## 12. Testing (per `docs/testing-policy.md`)

- **Reducer:** each kind applies correctly to `notes`; `updatedAt` from the payload is applied (not regenerated).
- **Undo/redo:** every inverse round-trips (create→delete→undo restores; title patch restores exactly the patched keys + prior updatedAt; body snapshot restores prior body + updatedAt; delete restores the full note). Inline-link create undoes both note and link.
- **Replay/hydration:** replaying a logged sequence rebuilds the identical projection; a module not registered still stores rows and materializes on replay.
- **Pure helpers:** `sortNotesByUpdated` ordering; `noteSnippet` strips tags + truncates; `noteLinkedItems` resolves edges.
- **Hooks:** return correct projections and update on mutation.
- **Create-from:** `createNoteFromEntity` produces note + link atomically (one undo reverts both).
- **e2e (`e2e/notes.spec.ts`):** open Notes → new note → type title + body → it appears in the list with the title; and create-note-from-email → a note titled with the subject exists. Runtime-derived assertions (capture the subject from the DOM), per the e2e isolation rules.

## 13. Out of scope (→ later steps)

Pinning/tags/folders/archive; `[[wikilinks]]` + reverse backlinks; inspector-section backlinks; contact/event create-from; FTS over note bodies; sharing/export; a shared rich-text-editor extraction from EmailComposer.
