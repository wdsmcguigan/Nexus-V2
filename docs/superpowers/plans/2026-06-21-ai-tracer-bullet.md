# AI Tracer-Bullet ("Summarize thread → AI Note") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the substrate is AI-shaped: a "Summarize this thread with AI" command that emits a `source:"ai"` mutation creating a Note linked to the thread — undoable, synced, labeled.

**Architecture:** A headless `org.nexus.ai` module contributes the command; it gathers thread context, calls a swappable `Summarizer` (real = Rust `ai_summarize` IPC → Claude; stub = deterministic, for web/e2e), and emits `CREATE_NOTE` + `CREATE_LINK` (`summarizes`) tagged `source:"ai"` atomically. The one new substrate piece is a provenance envelope (`source`/`generatedBy`) carried inside `payload_json` (no DB column), wrapped/unwrapped centrally so reducers are untouched.

**Tech Stack:** TypeScript/React, Zustand store, the existing mutation pipeline, Rust (Tauri command + reqwest), Vitest (node), Playwright e2e.

## Global Constraints

- **Provenance lives in `payload_json`, NOT a new DB column** (substrate §4.4). Wrapped/unwrapped centrally; every existing reducer + Rust path stays unchanged.
- **`source` default is `"user"`** — all existing `recordMutation`/`recordMutations` call sites must be behaviorally unchanged.
- **Build through the public substrate API** (`registerModule`, `host.contribute.command`, `recordMutations`); never write the store/DB directly.
- **LLM call is swappable**: real impl = Rust IPC `ai_summarize` (key from env `NEXUS_ANTHROPIC_API_KEY`, server-side); stub = deterministic, used when `!isTauri()`. The stub never throws.
- **Rust:** `cargo check` must pass (CI runs it). **Do NOT run `cargo fmt` or gate on clippy** (repo isn't clean). The Claude request shape (endpoint, `anthropic-version` header, model id, body/response JSON) MUST be confirmed via the **`claude-api` skill** at implementation time — the values below are a starting point.
- **Link type for the summary** = `"summarizes"`; **note title** = `"AI summary: <subject>"`.
- **e2e** stays isolated under `e2e/` (outside Vitest/tsconfig/eslint globs); **no RTL/jsdom**.
- Commit messages: conventional commits, **no `Co-Authored-By` trailer**. Mirror existing module/command patterns (`src/modules/notes/`).

---

### Task 1: Provenance envelope (substrate, headless)

**Files:**
- Create: `src/state/provenance.ts`
- Create: `src/state/__tests__/provenance.test.ts`
- Modify: `src/data/types.ts` (+ `MutationSource`; `Mutation.source`/`generatedBy`)
- Modify: `src/state/mutations.ts` (opts on `recordMutation`/`recordMutations`; central wrap/unwrap; `source` on `UndoEntry`/`HistoryEntry`)
- Test: `src/state/__tests__/provenance.test.ts`, `src/state/__tests__/mutations.provenance.test.ts`

**Interfaces:**
- Produces: `wrapEnvelope(payload, meta?)`, `unwrapEnvelope(stored) -> { payload, meta }`, `MUTATION_ENVELOPE_KEY`; `MutationSource` type; `recordMutation(kind, payload, store?, opts?: { source?: MutationSource; generatedBy?: string })`; `recordMutations(steps, store?, description?, opts?: { source?: MutationSource; generatedBy?: string })`; `Mutation.source?`/`generatedBy?`; `HistoryEntry.source?`.
- Consumes (existing): the mutation pipeline internals (`_applyAndPersist`, `applyMutation`, `getUndoHistory`/`getRedoHistory`).

- [ ] **Step 1: Write the provenance unit test (RED)**

Create `src/state/__tests__/provenance.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { wrapEnvelope, unwrapEnvelope } from "@/state/provenance";

describe("provenance envelope", () => {
  it("returns the bare payload unchanged when meta is absent or default", () => {
    const p = { a: 1 };
    expect(wrapEnvelope(p)).toBe(p);
    expect(wrapEnvelope(p, { source: "user" })).toBe(p);
    expect(wrapEnvelope(p, {})).toBe(p);
  });

  it("wraps when source is non-default or generatedBy is set", () => {
    const p = { a: 1 };
    const w = wrapEnvelope(p, { source: "ai", generatedBy: "claude-x" }) as Record<string, unknown>;
    expect(w).not.toBe(p);
    expect((w.value as typeof p)).toEqual(p);
  });

  it("unwraps an enveloped payload to { payload, meta }", () => {
    const p = { a: 1 };
    const w = wrapEnvelope(p, { source: "ai" });
    const { payload, meta } = unwrapEnvelope(w);
    expect(payload).toEqual(p);
    expect(meta?.source).toBe("ai");
  });

  it("is a no-op for a bare payload (meta null)", () => {
    const p = { a: 1 };
    const { payload, meta } = unwrapEnvelope(p);
    expect(payload).toBe(p);
    expect(meta).toBeNull();
  });

  it("is idempotent — unwrapping a bare payload twice is stable", () => {
    const p = { a: 1 };
    const once = unwrapEnvelope(p).payload;
    expect(unwrapEnvelope(once).payload).toBe(p);
  });
});
```

- [ ] **Step 2: Run it to confirm fail**

Run: `pnpm test -- state/__tests__/provenance`
Expected: FAIL (`@/state/provenance` not found).

- [ ] **Step 3: Add `MutationSource` + Mutation fields to `types.ts`**

In `src/data/types.ts`, add near `interface Mutation` (line ~605):
```ts
export type MutationSource = "user" | "ai" | "rule" | "module";
```
and add two optional fields to `interface Mutation` (after `payload`):
```ts
  /** Provenance (substrate §4.4). Absent ⇒ "user". Carried in payload_json, not a column. */
  source?: MutationSource;
  /** Optional generator id (e.g. model id "claude-…" or module id). */
  generatedBy?: string;
```

- [ ] **Step 4: Implement `provenance.ts`**

```ts
import type { MutationSource } from "@/data/types";

export interface MutationMeta {
  source?: MutationSource;
  generatedBy?: string;
}

/** Reserved key under which provenance rides inside payload_json (substrate §4.4). */
export const MUTATION_ENVELOPE_KEY = "__nexusMeta";

/** True when meta carries something worth persisting (non-default source or a generator). */
function hasMeta(meta?: MutationMeta): meta is MutationMeta {
  return !!meta && ((!!meta.source && meta.source !== "user") || !!meta.generatedBy);
}

/**
 * Wrap a payload with provenance meta — ONLY when meta is meaningful. A bare
 * "user" mutation is stored unchanged (zero overhead, zero diff for existing rows).
 */
export function wrapEnvelope(payload: unknown, meta?: MutationMeta): unknown {
  if (!hasMeta(meta)) return payload;
  return { [MUTATION_ENVELOPE_KEY]: { source: meta.source, generatedBy: meta.generatedBy }, value: payload };
}

/** Unwrap an envelope. Idempotent + a no-op for bare payloads (meta = null). */
export function unwrapEnvelope(stored: unknown): { payload: unknown; meta: MutationMeta | null } {
  if (stored && typeof stored === "object" && MUTATION_ENVELOPE_KEY in (stored as object)) {
    const env = stored as Record<string, unknown>;
    return { payload: (env as { value: unknown }).value, meta: (env[MUTATION_ENVELOPE_KEY] as MutationMeta) ?? null };
  }
  return { payload: stored, meta: null };
}
```

- [ ] **Step 5: Run the provenance test (GREEN)**

Run: `pnpm test -- state/__tests__/provenance` → PASS.

- [ ] **Step 6: Thread `opts` + central wrap/unwrap through `mutations.ts`**

In `src/state/mutations.ts`:

(a) Import the envelope + the type:
```ts
import { wrapEnvelope, unwrapEnvelope, type MutationMeta } from "@/state/provenance";
import { /* …existing… */ type MutationSource } from "@/data/types";
```

(b) Add `source` to the internal `UndoEntry` (after `canUndo`):
```ts
  source?: MutationSource;
```
and to the exported `HistoryEntry` (after `blocked`):
```ts
  /** Provenance of the action (e.g. "ai"). Absent ⇒ user action. */
  source?: MutationSource;
```

(c) `recordMutation` — accept opts, tag the undo entry, pass opts down:
```ts
export function recordMutation(
  kind: MutationKind,
  payload: unknown,
  store: LocalStore = _defaultStore,
  opts?: MutationMeta,
): Mutation {
  const undoEntry = _skipStack
    ? null
    : (_buildReverseEntry(kind, payload, store) ?? _buildNonUndoableEntry(kind, payload));
  if (undoEntry && opts?.source) undoEntry.source = opts.source;

  const mutation = _applyAndPersist(kind, payload, store, opts);

  if (!_skipStack) {
    if (undoEntry) {
      _undoStack.push(undoEntry);
      if (_undoStack.length > UNDO_MAX) _undoStack.shift();
    }
    _redoStack.length = 0;
  }
  return mutation;
}
```

(d) `recordMutations` — accept opts, tag the compound entry, pass opts to each step's persist:
```ts
export function recordMutations(
  steps: Array<{ kind: MutationKind; payload: unknown }>,
  store: LocalStore = _defaultStore,
  description = "Multiple changes",
  opts?: MutationMeta,
): void {
  if (steps.length === 0) return;
  const reverse: Array<{ kind: MutationKind; payload: unknown }> = [];
  let undoable = true;
  for (const step of steps) {
    const entry = _skipStack ? null : _buildReverseEntry(step.kind, step.payload, store);
    if (entry && entry.canUndo) reverse.unshift(...entry.reverseSteps);
    else undoable = false;
    _applyAndPersist(step.kind, step.payload, store, opts);
  }
  if (!_skipStack) {
    if (undoable && reverse.length) {
      _undoStack.push({ forwardSteps: [...steps], reverseSteps: reverse, description, canUndo: true, source: opts?.source });
      if (_undoStack.length > UNDO_MAX) _undoStack.shift();
    }
    _redoStack.length = 0;
  }
}
```

(e) `_applyAndPersist` — wrap the persisted payload, set `source`/`generatedBy` on the Mutation, persist the wrapped form:
```ts
function _applyAndPersist(
  kind: MutationKind,
  payload: unknown,
  store: LocalStore,
  opts?: MutationMeta,
): Mutation {
  _lamport += 1;
  const persistedPayload = wrapEnvelope(payload, opts);
  const mutation: Mutation = {
    id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    vaultId: store.vault?.id ?? "local",
    deviceId: _deviceId,
    ts: Date.now(),
    lamport: _lamport,
    kind,
    payload: persistedPayload,
    source: opts?.source ?? "user",
    ...(opts?.generatedBy ? { generatedBy: opts.generatedBy } : {}),
  };

  store.appendMutation(mutation);
  applyMutation(mutation, store);

  if (isTauri()) {
    applyMutationIpc(kind, persistedPayload, mutation.deviceId, mutation.lamport).catch((e) =>
      console.warn("IPC mutation persist failed:", e),
    );
  }

  emitBusEvent(mutation);
  return mutation;
}
```

(f) `applyMutation` — central unwrap. Rename the param to `mIn`, derive a bare-payload working copy `m`, and set source/generatedBy on `mIn` from meta (for remote/replay). The ~74-case body keeps using `m` unchanged:
```ts
export function applyMutation(mIn: Mutation, store: LocalStore): void {
  const { payload, meta } = unwrapEnvelope(mIn.payload);
  if (meta) {
    if (meta.source) mIn.source = meta.source;
    if (meta.generatedBy) mIn.generatedBy = meta.generatedBy;
  }
  const m = meta ? { ...mIn, payload } : mIn;
  const ns = kindNamespace(m.kind);
  if (ns !== null) {
    getModuleReducer(ns)?.apply(m.kind, m.payload, store);
    return;
  }
  switch (m.kind) {
    // …entire existing switch body unchanged (it references `m`)…
```
> Only the function signature + the first 8 lines change; do NOT touch any `case`.

(g) `getUndoHistory` / `getRedoHistory` — pass `source` through. In `getUndoHistory`, the mapped entry becomes:
```ts
    const entry: HistoryEntry = { description: e.description, canUndo: e.canUndo, blocked: barrier, source: e.source };
```
and `getRedoHistory`:
```ts
  return [..._redoStack].reverse().map((e) => ({ description: e.description, canUndo: e.canUndo, blocked: false, source: e.source }));
```

- [ ] **Step 7: Write the pipeline provenance test (RED→GREEN)**

Create `src/state/__tests__/mutations.provenance.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import {
  recordMutation,
  applyMutation,
  undoLastMutation,
  getUndoHistory,
  _resetUndoStacks,
} from "@/state/mutations";
import type { Mutation } from "@/data/types";

function freshStore(): LocalStore {
  const s = new LocalStore();
  (s as unknown as { vault: { id: string } }).vault = { id: "v1" };
  return s;
}
beforeEach(() => _resetUndoStacks());

describe("mutation provenance", () => {
  it("a source:'ai' mutation carries source on the Mutation and in history", () => {
    const s = freshStore();
    const m = recordMutation("CREATE_FOLDER", { id: "f1", name: "F", parentId: null } as never, s, {
      source: "ai",
      generatedBy: "claude-x",
    });
    expect(m.source).toBe("ai");
    expect(m.generatedBy).toBe("claude-x");
    const hist = getUndoHistory();
    expect(hist[0]?.source).toBe("ai");
  });

  it("default source is 'user' and the payload is stored bare", () => {
    const s = freshStore();
    const m = recordMutation("CREATE_FOLDER", { id: "f2", name: "G", parentId: null } as never, s);
    expect(m.source).toBe("user");
    // bare payload (no envelope wrapper key)
    expect(Object.keys(m.payload as object)).not.toContain("__nexusMeta");
  });

  it("a persisted enveloped mutation replays to the bare projection (reducer sees bare payload)", () => {
    const s1 = freshStore();
    recordMutation("CREATE_FOLDER", { id: "f3", name: "H", parentId: null } as never, s1, { source: "ai" });
    const persisted = Array.from(s1.mutations) as Mutation[]; // enveloped payload on disk-shape
    const s2 = freshStore();
    for (const m of persisted) applyMutation({ ...m }, s2);
    expect(s2.folders.get("f3")?.name).toBe("H");
  });

  it("undo of an AI mutation reverses it", () => {
    const s = freshStore();
    recordMutation("CREATE_FOLDER", { id: "f4", name: "I", parentId: null } as never, s, { source: "ai" });
    expect(s.folders.has("f4")).toBe(true);
    undoLastMutation(s);
    expect(s.folders.has("f4")).toBe(false);
  });
});
```
> Plan-time check: confirm `CREATE_FOLDER`'s payload shape + that `LocalStore` exposes the appended mutations (used by the replay assertion). If the accessor differs (e.g. `s.mutations` is a Map or a method), adapt the test to the real accessor — read `appendMutation` in `src/storage/local.ts`. The asserted behaviors (source captured; bare default; enveloped replay → bare projection; AI undo) are the requirement.

Run: `pnpm test -- state/__tests__/mutations.provenance` → RED first (opts not yet wired if run before Step 6; GREEN after).

- [ ] **Step 8: Full verification**

Run: `pnpm test && pnpm typecheck && pnpm lint` → all green (existing 442 + new provenance tests; existing call sites unchanged because `source` defaults to `"user"`).

- [ ] **Step 9: Commit**

```bash
git add src/state/provenance.ts src/data/types.ts src/state/mutations.ts src/state/__tests__/provenance.test.ts src/state/__tests__/mutations.provenance.test.ts
git commit -m "feat(substrate): mutation provenance envelope (source/generatedBy in payload_json)"
```

---

### Task 2: Summarizer interface + IPC wrapper (frontend)

**Files:**
- Modify: `src/storage/tauri.ts` (+ `aiSummarize` wrapper)
- Create: `src/modules/ai/summarizer.ts`
- Test: `src/modules/ai/__tests__/summarizer.test.ts`

**Interfaces:**
- Produces: `ThreadMessage` (`{ subject: string; from: string; body: string }`), `Summarizer` (`{ summarize(messages: ThreadMessage[]): Promise<string> }`), `stubSummarizer`, `getSummarizer(): Summarizer`; `aiSummarize(text: string): Promise<string>`.
- Consumes: `isTauri` (`@/storage/tauri`).

- [ ] **Step 1: Add the IPC wrapper**

In `src/storage/tauri.ts`, near the other `invoke` wrappers, add:
```ts
export async function aiSummarize(text: string): Promise<string> {
  return invoke<string>("ai_summarize", { text });
}
```

- [ ] **Step 2: Write the summarizer test (RED)**

Create `src/modules/ai/__tests__/summarizer.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { stubSummarizer, type ThreadMessage } from "@/modules/ai/summarizer";

const msgs: ThreadMessage[] = [
  { subject: "Q2 plan", from: "a@x.com", body: "Let's ship." },
  { subject: "Re: Q2 plan", from: "b@x.com", body: "Agreed." },
];

describe("stubSummarizer", () => {
  it("is deterministic and never throws", async () => {
    const a = await stubSummarizer.summarize(msgs);
    const b = await stubSummarizer.summarize(msgs);
    expect(a).toBe(b);
    expect(a).toContain("Q2 plan");
    expect(a.length).toBeGreaterThan(0);
  });
  it("handles an empty thread", async () => {
    await expect(stubSummarizer.summarize([])).resolves.toBeTypeOf("string");
  });
});
```

- [ ] **Step 3: Run it (RED)**

Run: `pnpm test -- ai/__tests__/summarizer`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `summarizer.ts`**

```ts
import { isTauri, aiSummarize } from "@/storage/tauri";

export interface ThreadMessage {
  subject: string;
  from: string;
  body: string;
}

export interface Summarizer {
  summarize(messages: ThreadMessage[]): Promise<string>;
}

/** Flatten a thread into prompt-ready text (capped so a huge thread can't blow the request). */
export function threadToText(messages: ThreadMessage[], maxChars = 12000): string {
  const text = messages
    .map((m) => `Subject: ${m.subject}\nFrom: ${m.from}\n\n${m.body}`)
    .join("\n\n---\n\n");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/** Deterministic offline summary — used in web mode / e2e. Never throws. */
export const stubSummarizer: Summarizer = {
  async summarize(messages) {
    const first = messages[0]?.subject ?? "(no subject)";
    return `Summary of ${messages.length} message(s) about "${first}". (stub summarizer)`;
  },
};

/** Real summary via the Rust IPC (key server-side). Only valid in the Tauri app. */
export const ipcSummarizer: Summarizer = {
  async summarize(messages) {
    return aiSummarize(threadToText(messages));
  },
};

/** Pick the real summarizer in the Tauri app, the deterministic stub otherwise. */
export function getSummarizer(): Summarizer {
  return isTauri() ? ipcSummarizer : stubSummarizer;
}
```

- [ ] **Step 5: Run tests (GREEN) + checks**

Run: `pnpm test -- ai/__tests__/summarizer` → PASS. Then `pnpm typecheck && pnpm lint` → green.

- [ ] **Step 6: Commit**

```bash
git add src/storage/tauri.ts src/modules/ai/summarizer.ts src/modules/ai/__tests__/summarizer.test.ts
git commit -m "feat(ai): swappable Summarizer (stub + IPC) and ai_summarize IPC wrapper"
```

---

### Task 3: AI module + summarize-thread flow

**Files:**
- Create: `src/modules/ai/summarizeThread.ts`
- Create: `src/modules/ai/index.ts`
- Modify: `src/modules/bootstrap.ts` (+ `registerAiModule`)
- Test: `src/modules/ai/__tests__/summarizeThread.test.ts`

**Interfaces:**
- Produces: `summarizeThread(messageId: string, store: LocalStore): Promise<void>`; `createSummaryNote(subject, summary, threadAnchorId, store): Note`; `registerAiModule(): () => void`; `AI_MODULE_ID`.
- Consumes: `getSummarizer`/`ThreadMessage` (Task 2); `recordMutations` + `MutationMeta` opts (Task 1); Notes `makeNote` (`@/modules/notes/model`), `KIND` + `NOTE_ENTITY` (`@/modules/notes/mutations`), `NOTES_MAIN_PANEL_KEY` (`@/modules/notes`); `Link`/`Message` types; `localStore`; `registerModule` + `dockComponentKey`/`host` (`@/modules/registry`); `useWorkspace`.

- [ ] **Step 1: Write the flow test (RED)**

Create `src/modules/ai/__tests__/summarizeThread.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { registerModuleInverse, _resetModuleInverses, _resetUndoStacks, undoLastMutation } from "@/state/mutations";
import { linksFrom } from "@/state/linksGraph";
import { notesReducer } from "@/modules/notes/reducer";
import { notesInverse } from "@/modules/notes/mutations";
import { NOTE_ENTITY } from "@/modules/notes/mutations";
import { summarizeThread } from "@/modules/ai/summarizeThread";

function freshStore(): LocalStore {
  const s = new LocalStore();
  (s as unknown as { vault: { id: string } }).vault = { id: "v1" };
  return s;
}
beforeEach(() => {
  _resetModuleReducers();
  _resetModuleInverses();
  _resetUndoStacks();
  registerModuleReducer("org.nexus.notes", notesReducer);
  registerModuleInverse("org.nexus.notes", notesInverse);
});

describe("summarizeThread (stub summarizer in node)", () => {
  it("creates an AI note + a 'summarizes' link, atomically undoable, tagged source:'ai'", async () => {
    const s = freshStore();
    s.messages.set("m1", { id: "m1", threadId: "t1", subject: "Q2", fromAddr: { name: "A", email: "a@x" }, snippet: "hi" } as never);

    await summarizeThread("m1", s);

    const notes = Array.from(s.notes.values());
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe("AI summary: Q2");
    const links = linksFrom(s, NOTE_ENTITY, notes[0]!.id);
    expect(links).toHaveLength(1);
    expect(links[0]!.linkType).toBe("summarizes");
    expect(links[0]!.dstId).toBe("m1");

    undoLastMutation(s);
    expect(s.notes.size).toBe(0);
    expect(linksFrom(s, NOTE_ENTITY, notes[0]!.id)).toHaveLength(0);
  });
});
```
> The node test runs the **stub** summarizer because `isTauri()` is false in node. Plan-time check: confirm the `Message` fixture fields actually used by `summarizeThread`'s gather step (subject/fromAddr/body-or-snippet) against `src/data/types.ts` `Message`; the gather reads the message body via the body source the app uses (see Step 3 note).

- [ ] **Step 2: Run it (RED)**

Run: `pnpm test -- ai/__tests__/summarizeThread`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `summarizeThread.ts`**

```ts
import type { Link, Message, Note } from "@/data/types";
import type { LocalStore } from "@/storage/local";
import { recordMutations } from "@/state/mutations";
import { makeNote } from "@/modules/notes/model";
import { KIND as NOTES_KIND, NOTE_ENTITY } from "@/modules/notes/mutations";
import { getSummarizer, type ThreadMessage } from "@/modules/ai/summarizer";

const GENERATED_BY = "claude (ai-tracer)";

/** Gather a message's thread into ThreadMessage[] (the AI's context). */
export function gatherThread(messageId: string, store: LocalStore): { anchor: Message | undefined; messages: ThreadMessage[] } {
  const anchor = store.messages.get(messageId);
  if (!anchor) return { anchor: undefined, messages: [] };
  const threadMsgs = Array.from(store.messages.values()).filter((m) => m.threadId === anchor.threadId);
  const ordered = threadMsgs.length ? threadMsgs : [anchor];
  const messages: ThreadMessage[] = ordered.map((m) => ({
    subject: m.subject || "(no subject)",
    from: m.fromAddr?.email ?? "",
    body: m.snippet ?? "",
  }));
  return { anchor, messages };
}

/** Build the AI summary note + a 'summarizes' link, emitted as one atomic source:"ai" action. */
export function createSummaryNote(subject: string, summary: string, threadAnchorId: string, store: LocalStore): Note {
  const note = makeNote(
    { title: `AI summary: ${subject}`, body: `<p>${escapeHtml(summary)}</p>` },
    store.vault?.id ?? "local",
    Date.now(),
  );
  const link: Link = {
    id: `lnk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    vaultId: store.vault?.id ?? "local",
    srcType: NOTE_ENTITY,
    srcId: note.id,
    linkType: "summarizes",
    dstType: "nexus/email.message",
    dstId: threadAnchorId,
    createdAt: Date.now(),
  };
  recordMutations(
    [
      { kind: NOTES_KIND.CREATE, payload: note },
      { kind: "CREATE_LINK", payload: link },
    ],
    store,
    "Summarize thread",
    { source: "ai", generatedBy: GENERATED_BY },
  );
  return note;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The command entry: gather → summarize → emit the AI note. Throws are surfaced by the caller. */
export async function summarizeThread(messageId: string, store: LocalStore): Promise<void> {
  const { anchor, messages } = gatherThread(messageId, store);
  if (!anchor) return;
  const summary = await getSummarizer().summarize(messages);
  createSummaryNote(anchor.subject || "(no subject)", summary, anchor.id, store);
}
```
> Note: v1 uses `m.snippet` as the body source (always present, no async body fetch) — keeps the flow synchronous to gather and deterministic in tests. Using full bodies is a later refinement (the real Rust summarizer can be given more once body-fetch is wired). Confirm `Message.fromAddr`/`snippet`/`subject` field names against `src/data/types.ts`.

- [ ] **Step 4: Run the flow test (GREEN)**

Run: `pnpm test -- ai/__tests__/summarizeThread` → PASS.

- [ ] **Step 5: Implement the module `index.ts`**

```ts
import { registerModule, type ModuleManifest } from "@/modules/registry";
import { localStore } from "@/storage/local";
import { useWorkspace } from "@/state/workspace";
import { NOTES_MAIN_PANEL_KEY } from "@/modules/notes";
import { summarizeThread } from "@/modules/ai/summarizeThread";

export const AI_MODULE_ID = "org.nexus.ai";

const manifest: ModuleManifest = {
  id: AI_MODULE_ID,
  name: "AI",
  version: "0.1.0",
  namespace: AI_MODULE_ID,
  entities: [],
  mutationKinds: [],
  capabilities: { "ui.contribute": ["command"] },
  trust: "core",
  contributes: {
    surfaces: [],
    commands: [{ id: "summarize-thread", title: "Summarize this thread with AI", icon: "sparkles" }],
  },
};

/** Run the summarize flow against the currently-selected email; surface errors as a toast + open Notes on success. */
export async function runSummarizeSelectedThread(): Promise<void> {
  const { toast } = await import("sonner");
  const messageId = useWorkspace.getState().selectedEmailId;
  if (!messageId) {
    toast.error("Select an email first");
    return;
  }
  try {
    await summarizeThread(messageId, localStore);
    useWorkspace.getState().openModulePanel(NOTES_MAIN_PANEL_KEY, "Notes");
    toast.success("AI summary created");
  } catch (e) {
    toast.error(`Couldn't summarize: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function registerAiModule(): () => void {
  return registerModule(manifest, (host) => {
    host.contribute.command("summarize-thread", () => {
      void runSummarizeSelectedThread();
    });
  });
}
```
> Plan-time check: confirm the workspace selector for the current email id (the Notes/Tasks context menu uses `setSelectedEmail`; find the matching getter — likely `selectedEmailId` or similar on `useWorkspace`). If the manifest type rejects `surfaces: []` for a headless module, omit the `surfaces` key. Confirm `"sparkles"` is a valid lucide name or drop the icon (it is cosmetic/unused, like the Notes `"notebook"`).

- [ ] **Step 6: Register in bootstrap + verify**

In `src/modules/bootstrap.ts`: add `import { registerAiModule } from "@/modules/ai";` and `registerAiModule();` after `registerNotesModule();`.

Run: `pnpm test && pnpm typecheck && pnpm lint` → all green.

- [ ] **Step 7: Commit**

```bash
git add src/modules/ai/summarizeThread.ts src/modules/ai/index.ts src/modules/bootstrap.ts src/modules/ai/__tests__/summarizeThread.test.ts
git commit -m "feat(ai): org.nexus.ai module + summarize-thread flow (source:ai note + summarizes link)"
```

---

### Task 4: Rust `ai_summarize` command

**Files:**
- Create: `src-tauri/src/commands/ai.rs`
- Modify: `src-tauri/src/commands/mod.rs` (+ `mod ai; pub use ai::*;`)
- Modify: `src-tauri/src/lib.rs` (+ `commands::ai_summarize` in `invoke_handler!`)
- Modify: `.env.example` (+ `NEXUS_ANTHROPIC_API_KEY`)

**Interfaces:**
- Produces: Tauri command `ai_summarize(text: String) -> Result<String, String>` (invoked by the `aiSummarize` IPC wrapper from Task 2).

> **Before writing the request:** invoke the `claude-api` skill to confirm the current Messages-API endpoint, `anthropic-version` header value, the model id, and the request/response JSON shape. The code below is a correct-as-of-writing starting point (`anthropic-version: 2023-06-01`, model `claude-haiku-4-5-20251001`); reconcile with the skill.

- [ ] **Step 1: Create `commands/ai.rs`**

```rust
use serde_json::json;

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MODEL: &str = "claude-haiku-4-5-20251001";

/// Summarize arbitrary thread text via the Claude Messages API. Key from env
/// (NEXUS_ANTHROPIC_API_KEY); returns the assistant text or a human-readable error.
#[tauri::command]
pub async fn ai_summarize(text: String) -> Result<String, String> {
    let api_key = std::env::var("NEXUS_ANTHROPIC_API_KEY")
        .map_err(|_| "NEXUS_ANTHROPIC_API_KEY not set".to_string())?;

    let body = json!({
        "model": MODEL,
        "max_tokens": 512,
        "system": "Summarize the following email thread in 3-5 concise sentences. Plain prose, no preamble.",
        "messages": [ { "role": "user", "content": text } ]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(ANTHROPIC_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        return Err(format!("Claude API error {status}: {detail}"));
    }

    let v: serde_json::Value = resp.json().await.map_err(|e| format!("bad response: {e}"))?;
    extract_text(&v).ok_or_else(|| "no text in response".to_string())
}

/// Pull the first text block out of a Claude Messages response.
fn extract_text(v: &serde_json::Value) -> Option<String> {
    v.get("content")?
        .as_array()?
        .iter()
        .find_map(|block| block.get("text").and_then(|t| t.as_str()))
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_text_from_response() {
        let v = json!({ "content": [ { "type": "text", "text": "hello summary" } ] });
        assert_eq!(extract_text(&v).as_deref(), Some("hello summary"));
    }

    #[test]
    fn returns_none_when_no_text() {
        let v = json!({ "content": [] });
        assert!(extract_text(&v).is_none());
    }
}
```

- [ ] **Step 2: Wire the module**

In `src-tauri/src/commands/mod.rs`, add with the other `mod`/`pub use` lines:
```rust
mod ai;
pub use ai::*;
```
In `src-tauri/src/lib.rs`, add to the `tauri::generate_handler![ … ]` list (near the other commands):
```rust
            commands::ai_summarize,
```
In `.env.example`, append:
```bash
# Anthropic API key for the AI summarize feature (NEXUS_ANTHROPIC_API_KEY).
NEXUS_ANTHROPIC_API_KEY=
```

- [ ] **Step 3: Verify Rust compiles + the unit test passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml ai_summarize 2>&1 | tail -20` (or `cargo test --manifest-path src-tauri/Cargo.toml commands::ai`)
Expected: the two `extract_text` tests PASS.
Run: `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`
Expected: success. **Do NOT run `cargo fmt` or clippy.**

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/ai.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs .env.example
git commit -m "feat(ai): ai_summarize Tauri command (Claude Messages API, key from env)"
```

---

### Task 5: UI wiring — history "AI" chip + email context menu

**Files:**
- Modify: `src/components/chrome/UndoHistoryModal.tsx` (+ "AI" chip)
- Modify: `src/components/email/EmailRowContextMenu.tsx` (+ "Summarize this thread with AI" action)

**Interfaces:**
- Consumes: `HistoryEntry.source` (Task 1); `runSummarizeSelectedThread` is module-internal — the context-menu action calls `summarizeThread(msg.id, localStore)` directly (mirroring the Notes/Tasks create-from launchers) then opens Notes.

- [ ] **Step 1: Add the "AI" chip to the undo modal**

In `src/components/chrome/UndoHistoryModal.tsx`, in `UndoItem` (the enabled branch) and `RedoItem`, render a small chip when `item.source === "ai"`, next to the description. Add to each item's content (after the `<span>{item.description}</span>`):
```tsx
{item.source === "ai" && (
  <span className="ml-auto rounded-xs border border-accent/40 bg-accent/10 px-1 text-caption text-accent">AI</span>
)}
```
(Place it inside the row `<button>`/`<div>` so it sits at the right via `ml-auto`.)

- [ ] **Step 2: Add the email context-menu action**

In `src/components/email/EmailRowContextMenu.tsx`:
1. Add `Sparkles` to the existing `lucide-react` import.
2. Add `import { summarizeThread } from "@/modules/ai/summarizeThread";` and `import { NOTES_MAIN_PANEL_KEY } from "@/modules/notes";` (if not already imported from Task wiring).
3. After the existing "Create note from this email" `<ContextMenu.Item>`, add:
```tsx
<ContextMenu.Item
  className={itemCls}
  onSelect={() => {
    void summarizeThread(msg.id, localStore)
      .then(() => {
        useWorkspace.getState().openModulePanel(NOTES_MAIN_PANEL_KEY, "Notes");
        toast.success("AI summary created");
      })
      .catch((e) => toast.error(`Couldn't summarize: ${e instanceof Error ? e.message : String(e)}`));
  }}
>
  <Sparkles size={12} className="absolute left-2 text-text-tertiary" />
  Summarize this thread with AI
</ContextMenu.Item>
```
(`itemCls`, `localStore`, `useWorkspace`, `toast`, `msg` are already in scope.)

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test` → green. (The ⌘K "Summarize this thread with AI" command also appears automatically via the module command from Task 3 — confirm it's listed.)

- [ ] **Step 4: Commit**

```bash
git add src/components/chrome/UndoHistoryModal.tsx src/components/email/EmailRowContextMenu.tsx
git commit -m "feat(ai): history 'AI' chip for source:ai + summarize-thread email action"
```

---

### Task 6: e2e (web mode, stub summarizer)

**Files:**
- Create: `e2e/ai-summarize.spec.ts`

**Interfaces:**
- Consumes: `{ test, expect }` from `e2e/fixtures.ts`; email-row `data-testid="email-row"`/`email-subject`; the Notes panel selectors (heading "Notes"; a note row is a `<button>` whose name includes the title).

- [ ] **Step 1: Write the spec**

Create `e2e/ai-summarize.spec.ts`:
```ts
import { test, expect } from "./fixtures";

test("summarize a thread from an email creates an AI note linked to it", async ({ page }) => {
  const row = page.getByTestId("email-row").first();
  await expect(row).toBeVisible();
  const subject = (await row.getByTestId("email-subject").innerText()).trim();
  expect(subject.length).toBeGreaterThan(0);

  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Summarize this thread with AI" }).click();

  // Notes opens with an "AI summary: <subject>" note (stub summarizer, deterministic).
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: new RegExp("AI summary: " + escapeRegExp(subject)) }),
  ).toBeVisible();
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 2: Run on both engines**

Run: `pnpm e2e ai-summarize.spec.ts`
Expected: PASS on `[chromium]` and `[webkit]` (web mode uses the stub summarizer — deterministic, offline). If the menu item or note title isn't found, investigate selectors/timing; do not weaken assertions.

- [ ] **Step 3: Full verification**

Run: `pnpm e2e && pnpm test && pnpm typecheck && pnpm lint` → all green (5 e2e specs now; unit/typecheck/lint unaffected). Rust already verified in Task 4.

- [ ] **Step 4: Commit**

```bash
git add e2e/ai-summarize.spec.ts
git commit -m "test(e2e): summarize-thread → AI note flow (stub summarizer)"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-21-ai-tracer-bullet-design.md`):
- §2 flow (command → gather → summarize → atomic CREATE_NOTE + summarizes link → open Notes; errors as toast) → Tasks 3/5. ✅
- §3 Summarizer interface (stub + ipc + getSummarizer) → Task 2. ✅
- §4 Rust ai_summarize (env key, reqwest, no VaultDb, cargo-check, unit test, .env.example) → Task 4. ✅
- §5 provenance envelope (types, opts on record*, payload_json wrap/unwrap central, undo+history source) → Task 1. ✅
- §5.3 history "AI" label → Task 5. ✅
- §6 headless org.nexus.ai module (command contribution, bootstrap) → Task 3. ✅
- §7 file structure → Tasks 1-6 match. ✅
- §9 testing (provenance round-trip/idempotency/mixed-replay/AI-undo; stub flow emits the right atomic mutation; Rust parse/missing-key; e2e) → Tasks 1/2/3/4/6. ✅
- §10 privacy (explicit/opt-in; key server-side; no enforcement) → satisfied by design (command is user-invoked; key in Rust). ✅
- §11 out-of-scope (streaming, bus-trigger, note badge, capability enforcement, settings UI) → excluded. ✅

**Placeholder scan:** No TBD/"handle errors" — error handling is concrete (toast on throw; missing-key Err). The "confirm via claude-api skill" + "confirm field names against types.ts" notes point at authoritative sources, not blanks. Each code step carries complete code.

**Type consistency:** `MutationMeta`/`MutationSource`/`wrapEnvelope`/`unwrapEnvelope` defined in Task 1, consumed by Tasks 1(mutations)/3; `recordMutations(..., opts)` 4-arg form defined Task 1, used Task 3; `ThreadMessage`/`Summarizer`/`getSummarizer`/`stubSummarizer` defined Task 2, used Task 3; `summarizeThread(messageId, store)` defined Task 3, used Task 5/6; `aiSummarize`/`ai_summarize` names match across Task 2 (wrapper) ↔ Task 4 (command); `HistoryEntry.source` defined Task 1, used Task 5; `NOTE_ENTITY`/`KIND`/`makeNote` consumed from the merged Notes module. Consistent.

**One cross-task note:** Task 3's flow test runs the **stub** summarizer (node has `isTauri() === false`), so it's deterministic and offline — the real Claude path is only exercised manually in the Tauri app + the Rust unit test. This is the intended tracer-bullet shape.
