# Notes Module (`org.nexus.notes`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Notes module — a master-detail rich-text notes panel (list + TipTap editor) with email→note linking — as the second real module on the substrate, mirroring `src/modules/tasks/`.

**Architecture:** A manifest + `setup` registered through the public module API (`registerModule`, `host.contribute.*`). Notes are an event-sourced projection of the mutation log (`LocalStore.notes`, rebuilt by `replayRegisteredModules`). Namespaced mutations (`org.nexus.notes/*`) with a reducer + inverse (undo). Body is TipTap HTML, committed via a debounced `SET_NOTE_BODY`. Links use the core `CREATE_LINK`/`linksFrom`.

**Tech Stack:** TypeScript, React 18, Zustand store, TipTap (already a dep), Vitest (node), Playwright e2e.

## Global Constraints

- **Build through the public substrate API** — `registerModule`, `host.contribute.*`, `recordMutation`/`recordMutations`, `linksGraph`. Never write the store/DB directly.
- **Body = TipTap HTML string** (reuse the composer's extension set: StarterKit + Underline + Link + Placeholder, `editor.getHTML()`). **Do NOT refactor `EmailComposerPanel`** (kept surgical).
- **Title = explicit stored field**, edited via `SET_NOTE_FIELDS`.
- **`updatedAt` stamped at record-time in the mutation HELPER** (captured into the payload), applied verbatim by the reducer — never `Date.now()` in the reducer (replay must be pure). The inverse restores the prior `updatedAt`.
- **Create-from scope v1 = email only.** Link type `"references"`. One atomic undo unit via `recordMutations`.
- **Testing policy:** pure logic → Vitest **node** tests (`src/**/*.test.ts`); critical UI flow → one Playwright e2e under `e2e/`. **No RTL/jsdom.** e2e stays isolated (lives in `e2e/`, `*.spec.ts`, outside Vitest/tsconfig/eslint globs — do not wire it into them).
- **Commit messages:** conventional commits, **no `Co-Authored-By` trailer**.
- Mirror `src/modules/tasks/` shapes exactly unless this plan says otherwise.

---

### Task 1: Data layer + module registration (headless)

**Files:**
- Modify: `src/data/types.ts` (+ `Note`)
- Modify: `src/storage/local.ts` (+ `notes` map, `putNote`/`deleteNote`, clear)
- Create: `src/modules/notes/model.ts`
- Create: `src/modules/notes/mutations.ts`
- Create: `src/modules/notes/reducer.ts`
- Create: `src/modules/notes/index.ts`
- Modify: `src/modules/bootstrap.ts` (+ `registerNotesModule`)
- Test: `src/modules/notes/__tests__/dataLayer.test.ts`, `src/modules/notes/__tests__/createFromEntity.test.ts`, `src/modules/notes/__tests__/registration.test.ts`

**Interfaces:**
- Produces: `Note` type; `LocalStore.notes: Map<string,Note>` + `putNote(n)`/`deleteNote(id)`; `KIND` (`CREATE`/`FIELDS`/`BODY`/`DELETE`), `NOTES_NS`, `NOTE_ENTITY`, `createNoteMutation`/`setNoteFieldsMutation`/`setNoteBodyMutation`/`deleteNoteMutation`/`createNoteFromEntity`, `notesInverse`, `notesReducer`, `makeNote`, `NoteFields`; `registerNotesModule()`, `NOTES_MODULE_ID`, `NOTES_MAIN_SURFACE_ID`, `NOTES_MAIN_PANEL_KEY`.
- Consumes (existing): `recordMutation`/`recordMutations`/`ModuleInverseBuilder` (`src/state/mutations.ts`); `ModuleReducer` (`src/state/moduleReducers.ts`); `registerModule`/`ModuleManifest` (`src/modules/registry.ts`); `dockComponentKey` (`src/modules/surfaceRegistry.ts`); `Link` type (`src/data/types.ts`); `useWorkspace` (`src/state/workspace.ts`).

- [ ] **Step 1: Add the `Note` type**

In `src/data/types.ts`, add near the other entity interfaces:
```ts
export interface Note {
  id: string;
  vaultId: string;
  title: string;
  body: string;        // TipTap HTML
  createdAt: number;
  updatedAt: number;   // drives list sort; stamped at record-time
}
```

- [ ] **Step 2: Add the store projection**

In `src/storage/local.ts`: import `Note` (extend the existing `@/data/types` import). Next to `tasks = new Map<string, Task>();` add:
```ts
  notes = new Map<string, Note>();
```
Add these methods next to `putTask`/`deleteTask`:
```ts
  putNote(n: Note): void {
    this.notes.set(n.id, n);
    this._notify();
  }
  deleteNote(id: string): void {
    this.notes.delete(id);
    this._notify();
  }
```
Wherever `this.tasks` / `this.tasksByStatus` are cleared (the reset path, around line 173), add `this.notes.clear();` immediately after.

- [ ] **Step 3: Write the data-layer test (RED)**

Create `src/modules/notes/__tests__/dataLayer.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { recordMutation, undoLastMutation } from "@/state/mutations";
import {
  KIND,
  createNoteMutation,
  setNoteFieldsMutation,
  setNoteBodyMutation,
  deleteNoteMutation,
  notesInverse,
} from "@/modules/notes/mutations";
import { notesReducer } from "@/modules/notes/reducer";
import { registerReducer, resetModuleReducers } from "@/state/moduleReducers";
import { registerModuleInverse } from "@/state/mutations";

function freshStore(): LocalStore {
  const s = new LocalStore();
  // minimal vault so vault?.id resolves
  (s as unknown as { vault: { id: string } }).vault = { id: "v1" };
  return s;
}

beforeEach(() => {
  resetModuleReducers();
  registerReducer("org.nexus.notes", notesReducer);
  registerModuleInverse("org.nexus.notes", notesInverse);
});

describe("notes data layer", () => {
  it("CREATE_NOTE puts a note", () => {
    const s = freshStore();
    const n = createNoteMutation({ title: "Hi" }, s);
    expect(s.notes.get(n.id)?.title).toBe("Hi");
  });

  it("SET_NOTE_FIELDS updates title and bumps updatedAt", () => {
    const s = freshStore();
    const n = createNoteMutation({ title: "A" }, s);
    const before = s.notes.get(n.id)!.updatedAt;
    setNoteFieldsMutation(n.id, { title: "B" }, s);
    const after = s.notes.get(n.id)!;
    expect(after.title).toBe("B");
    expect(after.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("SET_NOTE_BODY updates body", () => {
    const s = freshStore();
    const n = createNoteMutation({ title: "A" }, s);
    setNoteBodyMutation(n.id, "<p>hello</p>", s);
    expect(s.notes.get(n.id)?.body).toBe("<p>hello</p>");
  });

  it("DELETE_NOTE removes it", () => {
    const s = freshStore();
    const n = createNoteMutation({ title: "A" }, s);
    deleteNoteMutation(n.id, s);
    expect(s.notes.has(n.id)).toBe(false);
  });

  it("undo round-trips each kind", () => {
    const s = freshStore();
    const n = createNoteMutation({ title: "A", body: "<p>x</p>" }, s);
    const origUpdated = s.notes.get(n.id)!.updatedAt;

    setNoteFieldsMutation(n.id, { title: "B" }, s);
    undoLastMutation(s);
    expect(s.notes.get(n.id)!.title).toBe("A");
    expect(s.notes.get(n.id)!.updatedAt).toBe(origUpdated);

    setNoteBodyMutation(n.id, "<p>y</p>", s);
    undoLastMutation(s);
    expect(s.notes.get(n.id)!.body).toBe("<p>x</p>");

    deleteNoteMutation(n.id, s);
    undoLastMutation(s);
    expect(s.notes.get(n.id)!.title).toBe("A");
    expect(s.notes.get(n.id)!.body).toBe("<p>x</p>");

    undoLastMutation(s); // undo the create
    expect(s.notes.has(n.id)).toBe(false);
  });

  it("replaying logged mutations rebuilds the projection", () => {
    const s = freshStore();
    const n = createNoteMutation({ title: "A" }, s);
    setNoteBodyMutation(n.id, "<p>body</p>", s);

    // simulate a fresh store replaying the same kinds
    const s2 = freshStore();
    recordMutation(KIND.CREATE, s.notes.get(n.id) ? { ...s.notes.get(n.id)!, body: "" } : null, s2);
    recordMutation(KIND.BODY, { noteId: n.id, body: "<p>body</p>", updatedAt: Date.now() }, s2);
    expect(s2.notes.get(n.id)?.body).toBe("<p>body</p>");
  });
});
```

> If `resetModuleReducers`/`registerReducer` are named differently in `src/state/moduleReducers.ts`, use the actual exports (read the file) and the Tasks test `src/modules/tasks/__tests__/dataLayer.test.ts` as the authoritative setup pattern — mirror its imports exactly. The behaviors asserted above are the requirement.

- [ ] **Step 4: Run the test to confirm it fails**

Run: `pnpm test -- notes/__tests__/dataLayer`
Expected: FAIL (modules `model`/`mutations`/`reducer` not yet created).

- [ ] **Step 5: Implement `model.ts`**

Create `src/modules/notes/model.ts`:
```ts
import type { Note } from "@/data/types";

/** The note fields editable via SET_NOTE_FIELDS. */
export type NoteFields = Partial<Pick<Note, "title">>;

// Monotonic within this module instance; combined with Date.now() for unique ids.
let _seq = 0;
function noteId(): string {
  _seq += 1;
  return `note-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

/** Build a full Note from partial input, filling defaults. */
export function makeNote(input: Partial<Note>, vaultId: string, now: number): Note {
  return {
    id: input.id ?? noteId(),
    vaultId,
    title: input.title ?? "",
    body: input.body ?? "",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}
```

- [ ] **Step 6: Implement `mutations.ts`**

Create `src/modules/notes/mutations.ts`:
```ts
import type { Note, Link } from "@/data/types";
import type { LocalStore } from "@/storage/local";
import { recordMutation, recordMutations, type ModuleInverseBuilder } from "@/state/mutations";
import { makeNote, type NoteFields } from "@/modules/notes/model";

export const NOTES_NS = "org.nexus.notes";
export const KIND = {
  CREATE: `${NOTES_NS}/CREATE_NOTE`,
  FIELDS: `${NOTES_NS}/SET_NOTE_FIELDS`,
  BODY: `${NOTES_NS}/SET_NOTE_BODY`,
  DELETE: `${NOTES_NS}/DELETE_NOTE`,
} as const;

/** The entity type identifier for a note (used as srcType in links). */
export const NOTE_ENTITY = "org.nexus.notes/note";

export function createNoteMutation(input: Partial<Note>, store: LocalStore): Note {
  const n = makeNote(input, store.vault?.id ?? "local", Date.now());
  recordMutation(KIND.CREATE, n, store);
  return n;
}
export function setNoteFieldsMutation(noteId: string, fields: NoteFields, store: LocalStore): void {
  recordMutation(KIND.FIELDS, { noteId, fields, updatedAt: Date.now() }, store);
}
export function setNoteBodyMutation(noteId: string, body: string, store: LocalStore): void {
  recordMutation(KIND.BODY, { noteId, body, updatedAt: Date.now() }, store);
}
export function deleteNoteMutation(noteId: string, store: LocalStore): void {
  recordMutation(KIND.DELETE, { noteId }, store);
}

/**
 * Create a note linked to a source entity (e.g. an email) as ONE atomic undo
 * unit. The link is note --references--> entity.
 */
export function createNoteFromEntity(
  entityType: string,
  entityId: string,
  title: string,
  store: LocalStore,
): Note {
  const note = makeNote({ title }, store.vault?.id ?? "local", Date.now());
  const link: Link = {
    id: `lnk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    vaultId: store.vault?.id ?? "local",
    srcType: NOTE_ENTITY,
    srcId: note.id,
    linkType: "references",
    dstType: entityType,
    dstId: entityId,
    createdAt: Date.now(),
  };
  recordMutations(
    [
      { kind: KIND.CREATE, payload: note },
      { kind: "CREATE_LINK", payload: link },
    ],
    store,
    "Create note from item",
  );
  return note;
}

/** Inverse builder — captures prior state BEFORE the mutation applies (substrate §4.3). */
export const notesInverse: ModuleInverseBuilder = (kind, payload, store) => {
  const s = store as LocalStore;
  switch (kind) {
    case KIND.CREATE: {
      const n = payload as Note;
      return { reverseSteps: [{ kind: KIND.DELETE, payload: { noteId: n.id } }], description: "Create note" };
    }
    case KIND.FIELDS: {
      const p = payload as { noteId: string; fields: NoteFields; updatedAt: number };
      const prev = s.notes.get(p.noteId);
      if (!prev) return null;
      const priorFields: NoteFields = {};
      for (const k of Object.keys(p.fields) as Array<keyof NoteFields>) {
        (priorFields as Record<string, unknown>)[k] = prev[k];
      }
      return {
        reverseSteps: [{ kind: KIND.FIELDS, payload: { noteId: p.noteId, fields: priorFields, updatedAt: prev.updatedAt } }],
        description: "Edit note",
      };
    }
    case KIND.BODY: {
      const p = payload as { noteId: string; body: string; updatedAt: number };
      const prev = s.notes.get(p.noteId);
      if (!prev) return null;
      return {
        reverseSteps: [{ kind: KIND.BODY, payload: { noteId: p.noteId, body: prev.body, updatedAt: prev.updatedAt } }],
        description: "Edit note body",
      };
    }
    case KIND.DELETE: {
      const p = payload as { noteId: string };
      const prev = s.notes.get(p.noteId);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.CREATE, payload: prev }], description: "Delete note" };
    }
  }
  return null;
};
```

- [ ] **Step 7: Implement `reducer.ts`**

Create `src/modules/notes/reducer.ts`:
```ts
import type { ModuleReducer } from "@/state/moduleReducers";
import type { LocalStore } from "@/storage/local";
import type { Note } from "@/data/types";
import type { NoteFields } from "@/modules/notes/model";

// updatedAt is always carried in the payload (stamped at record-time in the
// helpers) and applied verbatim here — never Date.now() in the reducer, which
// would break replay determinism.
function patch(store: LocalStore, noteId: string, change: Partial<Note>): void {
  const prev = store.notes.get(noteId);
  if (!prev) return;
  store.putNote({ ...prev, ...change, updatedAt: change.updatedAt ?? prev.updatedAt });
}

export const notesReducer: ModuleReducer = {
  apply(kind, payload, store) {
    const local = store as LocalStore;
    switch (kind) {
      case "org.nexus.notes/CREATE_NOTE":
        local.putNote(payload as Note);
        break;
      case "org.nexus.notes/SET_NOTE_FIELDS": {
        const p = payload as { noteId: string; fields: NoteFields; updatedAt: number };
        patch(local, p.noteId, { ...p.fields, updatedAt: p.updatedAt });
        break;
      }
      case "org.nexus.notes/SET_NOTE_BODY": {
        const p = payload as { noteId: string; body: string; updatedAt: number };
        patch(local, p.noteId, { body: p.body, updatedAt: p.updatedAt });
        break;
      }
      case "org.nexus.notes/DELETE_NOTE": {
        const p = payload as { noteId: string };
        local.deleteNote(p.noteId);
        break;
      }
    }
  },
};
```

- [ ] **Step 8: Implement `index.ts` (manifest + register)**

Create `src/modules/notes/index.ts`:
```ts
import { registerModule, type ModuleManifest } from "@/modules/registry";
import { dockComponentKey } from "@/modules/surfaceRegistry";
import { NotesPanel } from "@/modules/notes/NotesPanel";
import { notesReducer } from "@/modules/notes/reducer";
import { notesInverse, KIND } from "@/modules/notes/mutations";
import { useWorkspace } from "@/state/workspace";

export const NOTES_MODULE_ID = "org.nexus.notes";
export const NOTES_MAIN_SURFACE_ID = "notes.main";

/** The dockview component key / panel id for the Notes main dock surface. */
export const NOTES_MAIN_PANEL_KEY = dockComponentKey(NOTES_MODULE_ID, NOTES_MAIN_SURFACE_ID);

const manifest: ModuleManifest = {
  id: NOTES_MODULE_ID,
  name: "Notes",
  version: "0.1.0",
  namespace: NOTES_MODULE_ID,
  entities: ["org.nexus.notes/note"],
  mutationKinds: [KIND.CREATE, KIND.FIELDS, KIND.BODY, KIND.DELETE],
  capabilities: { "ui.contribute": ["dock"] },
  trust: "core",
  contributes: {
    surfaces: [
      { type: "dock", id: NOTES_MAIN_SURFACE_ID, title: "Notes", icon: "notebook", detachable: false },
    ],
    commands: [{ id: "open", title: "Open Notes", icon: "notebook" }],
  },
};

/** Register the Notes module. Wires reducer, inverse, dock surface, and open command. */
export function registerNotesModule(): () => void {
  return registerModule(manifest, (host) => {
    host.registerReducer(notesReducer);
    host.registerInverse(notesInverse);
    host.contribute.surface(NOTES_MAIN_SURFACE_ID, NotesPanel);
    host.contribute.command("open", () => {
      useWorkspace.getState().openModulePanel(NOTES_MAIN_PANEL_KEY, "Notes");
    });
  });
}
```

> `index.ts` imports `NotesPanel` (created in Task 3). Until Task 3, this import is unresolved — so create a **temporary placeholder** `src/modules/notes/NotesPanel.tsx` now to keep Task 1 compiling:
> ```tsx
> import type { IDockviewPanelProps } from "dockview";
> export function NotesPanel(_: IDockviewPanelProps) {
>   return <div className="p-4 text-text-muted">Notes</div>;
> }
> ```
> Task 3 replaces it with the real panel.

- [ ] **Step 9: Register in bootstrap**

In `src/modules/bootstrap.ts`: add `import { registerNotesModule } from "@/modules/notes";` next to the Tasks import, and add `registerNotesModule();` after `registerTasksModule();` in `bootstrapModules()`.

- [ ] **Step 10: Write the create-from-entity + registration tests**

Create `src/modules/notes/__tests__/createFromEntity.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { undoLastMutation, registerModuleInverse } from "@/state/mutations";
import { registerReducer, resetModuleReducers } from "@/state/moduleReducers";
import { linksFrom } from "@/state/linksGraph";
import { createNoteFromEntity, notesInverse, NOTE_ENTITY } from "@/modules/notes/mutations";
import { notesReducer } from "@/modules/notes/reducer";

function freshStore(): LocalStore {
  const s = new LocalStore();
  (s as unknown as { vault: { id: string } }).vault = { id: "v1" };
  return s;
}

beforeEach(() => {
  resetModuleReducers();
  registerReducer("org.nexus.notes", notesReducer);
  registerModuleInverse("org.nexus.notes", notesInverse);
});

describe("createNoteFromEntity", () => {
  it("creates a note + a references link atomically, one undo reverts both", () => {
    const s = freshStore();
    const note = createNoteFromEntity("nexus/email.message", "msg-1", "Re: hello", s);
    expect(s.notes.get(note.id)?.title).toBe("Re: hello");
    const links = linksFrom(s, NOTE_ENTITY, note.id);
    expect(links).toHaveLength(1);
    expect(links[0]!.linkType).toBe("references");
    expect(links[0]!.dstId).toBe("msg-1");

    undoLastMutation(s);
    expect(s.notes.has(note.id)).toBe(false);
    expect(linksFrom(s, NOTE_ENTITY, note.id)).toHaveLength(0);
  });
});
```

Create `src/modules/notes/__tests__/registration.test.ts` — mirror `src/modules/tasks/__tests__/registration.test.ts` exactly, substituting `registerNotesModule`, `NOTES_MODULE_ID`, and the four note kinds. (Read the Tasks file and copy its structure; it asserts the module registers its reducer/inverse/surface/command without throwing and that its manifest declares the expected kinds.)

- [ ] **Step 11: Run all Task-1 tests (GREEN)**

Run: `pnpm test -- notes/__tests__`
Expected: PASS. Then `pnpm typecheck && pnpm lint` — green.

- [ ] **Step 12: Commit**

```bash
git add src/data/types.ts src/storage/local.ts src/modules/notes src/modules/bootstrap.ts
git commit -m "feat(notes): data layer — Note entity, mutations, reducer, inverse, registration"
```

---

### Task 2: Pure helpers + hooks

**Files:**
- Create: `src/modules/notes/noteSort.ts`
- Create: `src/modules/notes/links.ts`
- Create: `src/modules/notes/hooks.ts`
- Test: `src/modules/notes/__tests__/noteSort.test.ts`, `src/modules/notes/__tests__/links.test.ts`

**Interfaces:**
- Produces: `sortNotesByUpdated(notes): Note[]`, `noteSnippet(html, max?): string`; `noteLinkedItems(store, noteId): LinkedItem[]` + `LinkedItem`; `useNotes(): Note[]`, `useNote(id): Note | undefined`.
- Consumes: `linksFrom` (`@/state/linksGraph`), `NOTE_ENTITY` (Task 1), `useStoreVersion` (`@/storage/useStore`), `localStore`.

- [ ] **Step 1: Write the pure-helper tests (RED)**

Create `src/modules/notes/__tests__/noteSort.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sortNotesByUpdated, noteSnippet } from "@/modules/notes/noteSort";
import type { Note } from "@/data/types";

function note(p: Partial<Note>): Note {
  return { id: p.id ?? "n", vaultId: "v", title: p.title ?? "", body: p.body ?? "", createdAt: p.createdAt ?? 0, updatedAt: p.updatedAt ?? 0 };
}

describe("sortNotesByUpdated", () => {
  it("orders by updatedAt desc, then createdAt desc", () => {
    const a = note({ id: "a", updatedAt: 100, createdAt: 1 });
    const b = note({ id: "b", updatedAt: 200, createdAt: 2 });
    const c = note({ id: "c", updatedAt: 100, createdAt: 5 });
    expect(sortNotesByUpdated([a, b, c]).map((n) => n.id)).toEqual(["b", "c", "a"]);
  });
  it("does not mutate the input", () => {
    const arr = [note({ id: "a", updatedAt: 1 }), note({ id: "b", updatedAt: 2 })];
    sortNotesByUpdated(arr);
    expect(arr.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("noteSnippet", () => {
  it("strips tags and collapses whitespace", () => {
    expect(noteSnippet("<p>Hello   <b>world</b></p>")).toBe("Hello world");
  });
  it("decodes common entities", () => {
    expect(noteSnippet("<p>a &amp; b &lt;c&gt;</p>")).toBe("a & b <c>");
  });
  it("truncates with an ellipsis", () => {
    expect(noteSnippet("<p>" + "x".repeat(200) + "</p>", 10)).toBe("xxxxxxxxxx…");
  });
  it("returns empty string for empty body", () => {
    expect(noteSnippet("")).toBe("");
    expect(noteSnippet("<p></p>")).toBe("");
  });
});
```

Create `src/modules/notes/__tests__/links.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { registerReducer, resetModuleReducers } from "@/state/moduleReducers";
import { registerModuleInverse } from "@/state/mutations";
import { createNoteFromEntity, notesInverse } from "@/modules/notes/mutations";
import { notesReducer } from "@/modules/notes/reducer";
import { noteLinkedItems } from "@/modules/notes/links";

function freshStore(): LocalStore {
  const s = new LocalStore();
  (s as unknown as { vault: { id: string } }).vault = { id: "v1" };
  return s;
}
beforeEach(() => {
  resetModuleReducers();
  registerReducer("org.nexus.notes", notesReducer);
  registerModuleInverse("org.nexus.notes", notesInverse);
});

describe("noteLinkedItems", () => {
  it("resolves an email link to the message subject", () => {
    const s = freshStore();
    s.messages.set("msg-1", { id: "msg-1", subject: "Quarterly review" } as never);
    const note = createNoteFromEntity("nexus/email.message", "msg-1", "n", s);
    const items = noteLinkedItems(s, note.id);
    expect(items).toHaveLength(1);
    expect(items[0]!.entityType).toBe("nexus/email.message");
    expect(items[0]!.label).toBe("Quarterly review");
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm test -- notes/__tests__/noteSort notes/__tests__/links`
Expected: FAIL (`noteSort`/`links` not created).

- [ ] **Step 3: Implement `noteSort.ts`**

```ts
import type { Note } from "@/data/types";

/** Sort notes by last-updated desc, then creation time desc. Pure. */
export function sortNotesByUpdated(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

/** Strip HTML to a trimmed text preview for the list. Pure (no DOM). */
export function noteSnippet(html: string, max = 140): string {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}
```

- [ ] **Step 4: Implement `links.ts`**

```ts
import type { LocalStore } from "@/storage/local";
import { linksFrom } from "@/state/linksGraph";
import { NOTE_ENTITY } from "@/modules/notes/mutations";

export interface LinkedItem {
  linkId: string;
  entityType: string;
  entityId: string;
  label: string;
}

/** Resolve a note's outgoing "references" links into displayable items. */
export function noteLinkedItems(store: LocalStore, noteId: string): LinkedItem[] {
  return linksFrom(store, NOTE_ENTITY, noteId).map((l) => ({
    linkId: l.id,
    entityType: l.dstType,
    entityId: l.dstId,
    label: labelFor(store, l.dstType, l.dstId),
  }));
}

function labelFor(store: LocalStore, type: string, id: string): string {
  if (type === "nexus/email.message") return store.messages.get(id)?.subject || "(email)";
  if (type === "nexus/contact") return store.contacts.get(id)?.name || "(contact)";
  if (type === "nexus/calendar.event") return store.calendarEvents.get(id)?.title || "(event)";
  return id;
}
```

- [ ] **Step 5: Implement `hooks.ts`**

```ts
import { useMemo } from "react";
import { localStore } from "@/storage/local";
import { useStoreVersion } from "@/storage/useStore";
import { sortNotesByUpdated } from "@/modules/notes/noteSort";
import type { Note } from "@/data/types";

/** All notes, sorted by last-updated desc. */
export function useNotes(): Note[] {
  const v = useStoreVersion();
  return useMemo(() => sortNotesByUpdated(Array.from(localStore.notes.values())), [v]);
}

/** A single note by id (reactive), or undefined. */
export function useNote(id: string): Note | undefined {
  const v = useStoreVersion();
  return useMemo(() => localStore.notes.get(id), [v, id]);
}
```

- [ ] **Step 6: Run tests (GREEN)**

Run: `pnpm test -- notes/__tests__` → PASS. Then `pnpm typecheck && pnpm lint` → green.

- [ ] **Step 7: Commit**

```bash
git add src/modules/notes/noteSort.ts src/modules/notes/links.ts src/modules/notes/hooks.ts src/modules/notes/__tests__/noteSort.test.ts src/modules/notes/__tests__/links.test.ts
git commit -m "feat(notes): pure helpers (sort/snippet, linked-items) + hooks"
```

---

### Task 3: Panel UI (list + TipTap editor)

**Files:**
- Replace: `src/modules/notes/NotesPanel.tsx` (the Task-1 placeholder)
- Create: `src/modules/notes/NoteListView.tsx`, `src/modules/notes/NoteRow.tsx`, `src/modules/notes/NoteEditor.tsx`

**Interfaces:**
- Consumes: `useNotes`/`useNote` (Task 2), `noteSnippet` (Task 2), `noteLinkedItems`/`LinkedItem` (Task 2), `createNoteMutation`/`setNoteFieldsMutation`/`setNoteBodyMutation`/`deleteNoteMutation` (Task 1), `localStore`, `useWorkspace`, `Button` (`@/components/ui/Button`), `cn`/`formatRelativeTime` (`@/lib/utils`), TipTap (`@tiptap/react` + the four composer extensions).

This task is characterization + live-verify (the e2e lands in Task 5). The body-autosave + draft-resync is the delicate part — verify it live.

- [ ] **Step 1: Implement `NoteRow.tsx`**

```tsx
import { cn, formatRelativeTime } from "@/lib/utils";
import { noteSnippet } from "@/modules/notes/noteSort";
import type { Note } from "@/data/types";

interface NoteRowProps {
  note: Note;
  isSelected?: boolean;
  onSelect: (id: string) => void;
}

export function NoteRow({ note, isSelected, onSelect }: NoteRowProps) {
  const snippet = noteSnippet(note.body);
  return (
    <button
      type="button"
      onClick={() => onSelect(note.id)}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors duration-fast",
        isSelected ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-surface-2",
      )}
    >
      <span className="truncate text-body font-medium text-text-primary">{note.title || "Untitled"}</span>
      <span className="truncate text-small text-text-muted">{snippet || "No content"}</span>
      <span className="font-mono text-mono-xs text-text-muted">{formatRelativeTime(new Date(note.updatedAt))}</span>
    </button>
  );
}
```

- [ ] **Step 2: Implement `NoteListView.tsx`**

```tsx
import { Plus } from "lucide-react";
import { localStore } from "@/storage/local";
import { useNotes } from "@/modules/notes/hooks";
import { createNoteMutation } from "@/modules/notes/mutations";
import { NoteRow } from "@/modules/notes/NoteRow";

interface NoteListViewProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function NoteListView({ selectedId, onSelect }: NoteListViewProps) {
  const notes = useNotes();
  function handleNew() {
    const n = createNoteMutation({}, localStore);
    onSelect(n.id);
  }
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <h2 className="text-h3 font-semibold text-text-primary">Notes</h2>
        <button
          type="button"
          aria-label="New note"
          onClick={handleNew}
          className="flex size-7 items-center justify-center rounded-md bg-surface-2 text-text-secondary hover:text-text-primary"
        >
          <Plus size={16} />
        </button>
      </header>
      <div className="nx-scroll flex-1 overflow-y-auto p-1">
        {notes.length === 0 ? (
          <p className="px-2 py-4 text-center text-small text-text-muted">No notes yet</p>
        ) : (
          notes.map((n) => (
            <NoteRow key={n.id} note={n} isSelected={n.id === selectedId} onSelect={onSelect} />
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `NoteEditor.tsx`** (title input + TipTap body + debounced autosave + linked items)

```tsx
import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExt from "@tiptap/extension-underline";
import LinkExt from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { X, Trash2 } from "lucide-react";
import { localStore } from "@/storage/local";
import { useWorkspace } from "@/state/workspace";
import { Button } from "@/components/ui/Button";
import { useNote } from "@/modules/notes/hooks";
import { setNoteFieldsMutation, setNoteBodyMutation, deleteNoteMutation } from "@/modules/notes/mutations";
import { noteLinkedItems, type LinkedItem } from "@/modules/notes/links";

const BODY_DEBOUNCE_MS = 800;

function openLinkedItem(item: LinkedItem): void {
  const ws = useWorkspace.getState();
  if (item.entityType === "nexus/email.message") ws.setSelectedEmail(item.entityId);
  else if (item.entityType === "nexus/contact") ws.openContactsPanel(item.entityId);
  else if (item.entityType === "nexus/calendar.event") ws.openCalendarPanel();
}

interface NoteEditorProps {
  noteId: string;
  onClose: () => void;
}

export function NoteEditor({ noteId, onClose }: NoteEditorProps) {
  const note = useNote(noteId);
  const [title, setTitle] = useState(note?.title ?? "");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBodyRef = useRef<string | null>(null);
  const noteIdRef = useRef(noteId);

  // Hoisted function declaration so the editor callbacks below can reference it.
  function flushBody(): void {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const body = pendingBodyRef.current;
    pendingBodyRef.current = null;
    if (body == null) return;
    const id = noteIdRef.current;
    const cur = localStore.notes.get(id);
    if (cur && cur.body !== body) setNoteBodyMutation(id, body, localStore);
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: { HTMLAttributes: { class: "nx-code-block" } } }),
      UnderlineExt,
      LinkExt.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Write…" }),
    ],
    content: note?.body ?? "",
    onUpdate: ({ editor }) => {
      pendingBodyRef.current = editor.getHTML();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flushBody, BODY_DEBOUNCE_MS);
    },
    onBlur: () => flushBody(),
  });

  // On note switch: flush the OUTGOING note's pending body, then load the new note's
  // content. setContent(..., false) does not emit an update, so it won't autosave.
  const prevNoteRef = useRef(note);
  useEffect(() => {
    const prev = prevNoteRef.current;
    prevNoteRef.current = note;
    if (prev && prev.id !== noteId) flushBody();
    noteIdRef.current = noteId;
    if (!note || !editor) return;
    if (prev?.id !== note.id) {
      setTitle(note.title);
      editor.commands.setContent(note.body, false);
    }
  }, [note, noteId, editor]);

  // Flush any pending body on unmount.
  useEffect(() => () => flushBody(), []);

  if (!note) return null;

  const linked = noteLinkedItems(localStore, noteId);

  function commitTitle() {
    const trimmed = title.trim();
    if (trimmed !== note!.title) setNoteFieldsMutation(noteId, { title: trimmed }, localStore);
  }
  function handleDelete() {
    deleteNoteMutation(noteId, localStore);
    onClose();
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-mono-sm uppercase tracking-[0.04em] text-text-muted">Note</span>
        <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      <input
        type="text"
        value={title}
        placeholder="Title"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-full bg-transparent text-h3 font-semibold text-text-primary placeholder:text-text-muted focus:outline-none"
      />

      <EditorContent
        editor={editor}
        className="nx-scroll min-h-0 flex-1 overflow-y-auto rounded-sm border border-border-default bg-surface-2 px-3 py-2 text-body text-text-primary"
      />

      {linked.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-small text-text-secondary">Linked</span>
          {linked.map((item) => (
            <button
              key={item.linkId}
              type="button"
              onClick={() => openLinkedItem(item)}
              className="truncate rounded-sm border border-border-default bg-surface-2 px-2 py-1 text-left text-body text-text-primary hover:border-accent focus:border-accent focus:outline-none"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <Button variant="destructive" size="sm" onClick={handleDelete}>
        <Trash2 />
        Delete
      </Button>
    </div>
  );
}
```

> If `useWorkspace` has no `setSelectedEmail`/`openContactsPanel`/`openCalendarPanel`, mirror the exact names used in `src/modules/tasks/TaskDetail.tsx` `openLinkedItem` (that file is the authority — it compiles today).

- [ ] **Step 4: Implement `NotesPanel.tsx`** (replace the placeholder)

```tsx
import { useState } from "react";
import type { IDockviewPanelProps } from "dockview";
import { useNote } from "@/modules/notes/hooks";
import { NoteListView } from "@/modules/notes/NoteListView";
import { NoteEditor } from "@/modules/notes/NoteEditor";

/** Notes dock panel: master-detail (list + rich-text editor). Contributed by org.nexus.notes. */
export function NotesPanel(_: IDockviewPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useNote(selectedId ?? "");
  const showEditor = selectedId != null && selected != null;

  return (
    <div className="flex h-full">
      <div className="w-72 shrink-0 border-r border-border-subtle">
        <NoteListView selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <div className="min-w-0 flex-1">
        {showEditor ? (
          <NoteEditor noteId={selectedId} onClose={() => setSelectedId(null)} />
        ) : (
          <div className="flex h-full items-center justify-center text-body text-text-muted">
            Select or create a note
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck, lint, and live-verify**

Run: `pnpm typecheck && pnpm lint` → green.
Then live-verify in the running app (`pnpm dev`, open via Cmd+K → "Open Notes"): create a note, type a title (blurs → list updates), type body (pauses → persists; reload preserves it via OPFS), switch between notes (no body loss), delete. Confirm a clean console. (This flow is automated in Task 5.)

- [ ] **Step 6: Commit**

```bash
git add src/modules/notes/NotesPanel.tsx src/modules/notes/NoteListView.tsx src/modules/notes/NoteRow.tsx src/modules/notes/NoteEditor.tsx
git commit -m "feat(notes): master-detail panel — list + TipTap editor with debounced autosave"
```

---

### Task 4: Create-note-from-email launchers

**Files:**
- Modify: `src/components/email/EmailRowContextMenu.tsx`
- Modify: `src/components/palette/CommandPalette.tsx`

**Interfaces:**
- Consumes: `createNoteFromEntity` (Task 1), `NOTES_MAIN_PANEL_KEY` (Task 1).

- [ ] **Step 1: Add the context-menu action**

In `src/components/email/EmailRowContextMenu.tsx`:
1. Add `NotebookPen` to the existing `lucide-react` import.
2. Add imports:
```tsx
import { createNoteFromEntity } from "@/modules/notes/mutations";
import { NOTES_MAIN_PANEL_KEY } from "@/modules/notes";
```
3. Immediately after the existing "Create task from this email" `<ContextMenu.Item>` (ends ~line 219), add:
```tsx
<ContextMenu.Item
  className={itemCls}
  onSelect={() => {
    createNoteFromEntity("nexus/email.message", msg.id, msg.subject || "(no subject)", localStore);
    useWorkspace.getState().openModulePanel(NOTES_MAIN_PANEL_KEY, "Notes");
    toast.success("Note created");
  }}
>
  <NotebookPen size={12} className="absolute left-2 text-text-tertiary" />
  Create note from this email
</ContextMenu.Item>
```
(`itemCls`, `localStore`, `useWorkspace`, `toast`, `msg` are already in scope from the Tasks item right above.)

- [ ] **Step 2: Add the command-palette command**

In `src/components/palette/CommandPalette.tsx`:
1. Add `NotebookPen` to the existing `lucide-react` import.
2. Add imports:
```tsx
import { createNoteFromEntity } from "@/modules/notes/mutations";
import { NOTES_MAIN_PANEL_KEY } from "@/modules/notes";
```
3. Immediately after the existing `all.push({ id: "create-task-from-email", … })` block (ends ~line 277), add:
```tsx
all.push({
  id: "create-note-from-email",
  label: "Create note from this email",
  group: "Message",
  icon: NotebookPen,
  perform: () => {
    const m = localStore.messages.get(mid);
    if (m) {
      createNoteFromEntity("nexus/email.message", m.id, m.subject || "(no subject)", localStore);
      openModulePanel(NOTES_MAIN_PANEL_KEY, "Notes");
    }
  },
});
```
(`localStore`, `mid`, `openModulePanel` are already in scope from the Tasks command right above.)

- [ ] **Step 3: Typecheck, lint, live-verify**

Run: `pnpm typecheck && pnpm lint` → green. Live-verify: right-click an email row → "Create note from this email" opens Notes with a note titled the subject; Cmd+K → "Create note from this email" does the same. (Automated in Task 5.) "Open Notes" already appears in Cmd+K via the module command from Task 1 — confirm it opens the panel.

- [ ] **Step 4: Commit**

```bash
git add src/components/email/EmailRowContextMenu.tsx src/components/palette/CommandPalette.tsx
git commit -m "feat(notes): create-note-from-email launchers (context menu + command palette)"
```

---

### Task 5: Notes e2e

**Files:**
- Create: `e2e/notes.spec.ts`

**Interfaces:**
- Consumes: `{ test, expect }` from `e2e/fixtures.ts`; the email-row `data-testid="email-row"`/`data-testid="email-subject"` (already added in the Playwright PR).

- [ ] **Step 1: Write the spec**

Create `e2e/notes.spec.ts`:
```ts
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function openNotesPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Command palette" }).click();
  const input = page.getByPlaceholder("Search mail, contacts, or type a command…");
  await input.fill("Open Notes");
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
}

test("create a note and see it in the list", async ({ page }) => {
  await openNotesPanel(page);
  await page.getByRole("button", { name: "New note" }).click();

  const titleInput = page.getByPlaceholder("Title");
  await expect(titleInput).toBeVisible();
  await titleInput.fill("My first note");
  await titleInput.press("Enter"); // blur → commit title

  // Type into the TipTap body.
  const body = page.locator(".ProseMirror");
  await body.click();
  await body.type("Some body text");

  // The note appears in the list with its title.
  await expect(page.getByRole("button", { name: /My first note/ })).toBeVisible();
});

test("create a note from an email via the row context menu", async ({ page }) => {
  const row = page.getByTestId("email-row").first();
  await expect(row).toBeVisible();
  const subject = (await row.getByTestId("email-subject").innerText()).trim();
  expect(subject.length).toBeGreaterThan(0);

  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Create note from this email" }).click();

  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(escapeRegExp(subject)) })).toBeVisible();
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

> Selector notes: `NoteRow` is a `<button>` whose accessible name includes the title, so `getByRole("button", { name: /title/ })` matches a list row. The TipTap editable has class `ProseMirror`. If `.type()` is flaky on the editor, use `body.pressSequentially("Some body text")`.

- [ ] **Step 2: Run the spec on both engines**

Run: `pnpm e2e notes.spec.ts`
Expected: PASS on `[chromium]` and `[webkit]`. (webServer builds + serves the app, which now includes the Notes module.) If a flow fails, investigate selectors/timing — do not weaken assertions.

- [ ] **Step 3: Full verification**

Run: `pnpm e2e && pnpm test && pnpm typecheck && pnpm lint`
Expected: all green (4 e2e specs now: smoke, tasks, tasks-from-email, notes; unit/typecheck/lint unaffected).

- [ ] **Step 4: Commit**

```bash
git add e2e/notes.spec.ts
git commit -m "test(e2e): Notes — create note + create-note-from-email flows"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-19-notes-module-design.md`):
- §2 `Note` entity → Task 1 Step 1. ✅
- §3 store projection + replay (no snapshot) → Task 1 Step 2 (+ existing `replayRegisteredModules`). ✅
- §4 kinds + inverse + record-time `updatedAt` + `createNoteFromEntity` (`references`) → Task 1 Steps 6/10. ✅
- §5 TipTap body, composer extension set, no EmailComposer refactor, debounced commit + flush → Task 3 Step 3. ✅
- §6 master-detail panel (list + editor, new-note, empty state) → Task 3. ✅
- §7 create-from-email launchers + linked-items display + open command → Task 4 + Task 3 Step 3 (linked strip) + Task 1 Step 8 (open command). ✅
- §8 pure helpers (`noteSort`/`noteSnippet`/`noteLinkedItems`) Node-tested → Task 2. ✅
- §9 manifest/register + bootstrap → Task 1 Steps 8/9. ✅
- §11 file structure → Tasks 1-5 match it. ✅
- §12 tests (reducer/inverse/replay/helpers/create-from/e2e) → Tasks 1/2/5. ✅
- §13 out-of-scope (pinning/tags/wikilinks/backlinks/contact-event create-from/FTS/shared-editor) → correctly excluded. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases". Every code step carries complete code; the two "if names differ, mirror the Tasks file" notes point at a concrete authoritative file, not a blank. ✅

**Type consistency:** `KIND`/`NOTE_ENTITY`/`makeNote`/`NoteFields`/`notesInverse`/`notesReducer` defined in Task 1 and consumed by Tasks 2/3/4 with matching names; `NOTES_MAIN_PANEL_KEY` defined in Task 1 §8, used in Task 4; `noteSnippet`/`noteLinkedItems`/`useNotes`/`useNote` defined in Task 2, used in Task 3; `updatedAt`-in-payload shape consistent across mutations (§6), reducer (§7), and inverse. ✅

**One known cross-task ordering note:** Task 1's `index.ts` imports `NotesPanel`, so Task 1 creates a placeholder `NotesPanel.tsx` (Step 8 note) that Task 3 replaces — this keeps every task independently compiling/green.
