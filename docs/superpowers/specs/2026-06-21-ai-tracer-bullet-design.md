# AI Tracer-Bullet — "Summarize thread → AI Note" — Design Spec

> **Status:** Approved design (brainstorm complete). Phase 1, substrate §11 step 2 (the AI tracer-bullet, right after Tasks + Notes).
> **Builds on:** `docs/substrate-design.md` §4.4 (provenance envelope) and §8 (how the AI rides the substrate); the merged Notes module (`src/modules/notes/`, reused for the output) and Tasks module (the module/command pattern).
> **Next:** writing-plans → subagent-driven implementation.

## 0. Goal

Prove the substrate is **AI-shaped** with one small, real feature (substrate §8): an AI action is *just a `source:"ai"` mutation* — undoable, synced, labeled — that reads its context from the substrate and emits into the existing module ecosystem. The AI is "an optional subscriber/emitter on top of a system that already works without it." Build this one feature, then stop and return to panels (§11.2).

The feature: a **"Summarize this thread with AI"** command that reads a thread's message bodies, calls Claude, and emits an AI-authored **Note** (reusing the just-shipped Notes module) linked back to the thread — atomic, undoable, and visibly labeled as AI in the undo-history modal.

## 1. Decisions (locked during brainstorming)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | The feature / where AI output lands | **Summarize thread → AI Note** (`CREATE_NOTE` + `summarizes` link, `source:"ai"`) | Dogfoods Notes + the links graph + provenance; strongest proof of "AI is just another emitter into the module ecosystem." |
| 2 | LLM call location | **Rust backend IPC** (`ai_summarize`) for the real call; a deterministic **frontend stub** for web mode / e2e / no-key | Key never ships in the client (the secure, long-term-right shape); the stub keeps the substrate wiring fully e2e-testable. |
| 3 | Provenance home | **On the mutation** (§4.4 envelope), **not** on the Note entity | Provenance is a property of *any* mutation (generalizes beyond notes); keeps the Note model clean. |
| 4 | Provenance persistence | **In `payload_json` (wrapped envelope), no new DB column** | §4.4 mandate; works in web (OPFS) + Tauri/relay for free; reducers stay untouched via central unwrap. |
| 5 | Visible label | **Undo-history modal shows an "AI" tag** on `source:"ai"` entries | Honest, minimal proof that provenance is captured and surfaced; a note-row badge is out-of-scope (would put provenance on the entity). |
| 6 | AI as a module | A headless **`org.nexus.ai`** module contributing the command | Dogfoods the module system for AI too (§8: "the AI is itself a module"). |

## 2. The flow

1. User invokes **"Summarize this thread with AI"** from ⌘K (command palette) or the email-row context menu, on a selected message.
2. The AI command gathers the **thread context**: the selected message's body plus the bodies of the other messages in its thread (resolved from the store), concatenated into a single prompt-ready text (subject + from + body per message, capped at a sane length).
3. It calls `summarizer.summarize(threadText)` → a summary string.
4. It emits, atomically via `recordMutations([...], store, "Summarize thread", { source: "ai", generatedBy })`:
   - `org.nexus.notes/CREATE_NOTE` — a Note whose `title` = `"AI summary: <subject>"` and `body` = the summary (wrapped as minimal HTML, e.g. `<p>…</p>` paragraphs, sanitized like any note body).
   - `nexus/CREATE_LINK` — `link_type: "summarizes"`, note → the thread's anchor message (`nexus/email.message`).
5. The Notes panel opens (`openModulePanel(NOTES_MAIN_PANEL_KEY, "Notes")`) showing the new note; its linked-items strip shows the source email.
6. One ⌘Z removes both the note and the link (the atomic compound undo already provided by `recordMutations`). The undo-history modal lists the entry tagged "AI".

**Errors:** if `summarize` throws (no key, network error, Rust error), the command shows a toast (`toast.error("Couldn't summarize: …")`) and emits **nothing** — no partial state. The stub never throws.

## 3. The Summarizer interface (swappable)

```ts
// src/modules/ai/summarizer.ts
export interface ThreadMessage { subject: string; from: string; body: string; }
export interface Summarizer {
  summarize(messages: ThreadMessage[]): Promise<string>;
}
```

- **Real impl** (`ipcSummarizer`): calls a new Tauri IPC `ai_summarize(text: string): Promise<string>` (typed wrapper in `src/storage/tauri.ts`). The Rust command holds the key and calls Claude.
- **Stub impl** (`stubSummarizer`): deterministic — e.g. returns `"Summary of N messages: <first subject> … (stub)"` built purely from the inputs. No network. Used when **not** in Tauri (`!isTauri()`), or when a real call is unavailable.
- **Selection:** `getSummarizer()` returns `ipcSummarizer` in the Tauri app, `stubSummarizer` otherwise. (Web mode / e2e always get the stub — deterministic, offline.) If the IPC call fails because no key is configured, the error surfaces as a toast (§2 Errors); the stub is **not** silently substituted in the Tauri app (so a missing key is visible, not faked).

## 4. Rust: the `ai_summarize` command (bounded surface)

- **One command**, registered in `lib.rs:invoke_handler!` and implemented in `commands.rs` (or a small new `ai.rs` module): `ai_summarize(text: String) -> Result<String, String>`.
- Reads the API key from env (`NEXUS_ANTHROPIC_API_KEY`); if absent, returns `Err("NEXUS_ANTHROPIC_API_KEY not set")`.
- Uses `reqwest` (already a dep, `json` + `rustls-tls`) to POST the Claude Messages API with a cheap/fast model and a short summarization system prompt; returns the assistant text. **The exact endpoint, headers (`x-api-key`, `anthropic-version`), model id, and request/response shape MUST be taken from the `claude-api` skill at implementation time — do not hand-write from memory.**
- **No `VaultDb`** (takes text, returns text — avoids the non-Send-across-await gotcha). Must `cargo check` clean. **Do NOT run `cargo fmt` or gate on clippy** (repo isn't clean; CI runs `cargo check` only).
- `.env.example` gains `NEXUS_ANTHROPIC_API_KEY=` with a comment.
- A Rust unit test exercises request-body construction / response parsing against a canned JSON (no live network).

## 5. Provenance envelope (the one new substrate piece — §4.4)

### 5.1 Types & API

```ts
// src/data/types.ts
export type MutationSource = "user" | "ai" | "rule" | "module";
// Mutation gains:
//   source?: MutationSource;     // default "user"
//   generatedBy?: string;        // optional model/module id, e.g. "claude-..."
```

`recordMutation` / `recordMutations` gain a trailing optional arg:
```ts
recordMutation(kind, payload, store?, opts?: { source?: MutationSource; generatedBy?: string }): Mutation
recordMutations(steps, store?, description?, opts?: { source?: MutationSource; generatedBy?: string }): void
```
Default `source` is `"user"` (so all existing call sites are unchanged in behavior). The provenance applies to the whole compound for `recordMutations`.

### 5.2 Persistence without a schema change

Provenance rides **inside `payload_json`** as a reserved envelope, wrapped/unwrapped **centrally** so no reducer or Rust code changes:

- On persist (in the `_applyAndPersist` path), the stored payload becomes `{ __nexusMeta?: { source, generatedBy }, value: <originalPayload> }` **only when** `source`/`generatedBy` are non-default; otherwise the bare payload is stored unchanged (zero overhead + zero diff for existing mutations).
- On read/replay/dispatch, a central unwrap (`unwrapEnvelope(payload) -> { payload, meta }`) is applied **once** before the reducer/inverse see it, so reducers continue to receive the bare entity payload. `recordMutation`/`applyRemoteMutation`/`replayMutations` all route through the same unwrap.
- The in-memory `Mutation` object carries `source`/`generatedBy` as first-class fields (read from the envelope). Web mode (OPFS snapshot) and Tauri/relay (which store `payload_json` verbatim) both persist and sync it for free.

> **Invariant:** unwrapping is idempotent and a no-op for un-enveloped payloads, so a mixed log (old bare rows + new enveloped rows) replays identically. This is the part that's expensive to retrofit later, so it is built carefully now with focused tests.

### 5.3 Undo & the visible label

- The undo entry built for a provenance-bearing mutation carries its `source` (so the history UI can label it without re-reading the log).
- `UndoHistoryModal` renders an **"AI"** chip next to entries with `source === "ai"` (and uses the entry's existing `description`, e.g. "Summarize thread"). Minimal, non-invasive.

## 6. The AI module (`org.nexus.ai`, headless — §8)

- `src/modules/ai/index.ts`: manifest `{ id: "org.nexus.ai", namespace: "org.nexus.ai", entities: [], mutationKinds: [], capabilities: { "ui.contribute": ["command"] }, trust: "core", contributes: { commands: [{ id: "summarize-thread", title: "Summarize this thread with AI" }] } }`. Headless: it owns **no** entity/mutation kind of its own — it *emits core/Notes kinds with `source:"ai"`*, which is exactly the §8 thesis (the AI's action vocabulary is the registered kinds).
- `registerAiModule()` wires `host.contribute.command("summarize-thread", run)`. Registered in `src/modules/bootstrap.ts` alongside Tasks + Notes.
- The command `run` lives in `src/modules/ai/summarizeThread.ts`: resolves the current message + its thread → `ThreadMessage[]`, calls `getSummarizer().summarize(...)`, then `createSummaryNote(...)` (the atomic note + `summarizes` link with `source:"ai"`).
- The email-row context-menu launcher mirrors the Notes/Tasks "create from this email" wiring (it calls the same `summarizeThread` entry with the row's message id).

## 7. File structure

```
src/data/types.ts                 (+ MutationSource; Mutation.source/generatedBy)
src/state/mutations.ts            (+ opts on recordMutation/recordMutations; envelope wrap/unwrap; source on undo entries)
src/state/provenance.ts           (wrapEnvelope/unwrapEnvelope + the reserved-key constant) — pure, Node-tested
src/storage/tauri.ts              (+ aiSummarize IPC wrapper)
src/modules/ai/
  index.ts                        manifest + registerAiModule (command contribution)
  summarizer.ts                   Summarizer interface + stubSummarizer + ipcSummarizer + getSummarizer
  summarizeThread.ts              gather thread → summarize → createSummaryNote (entry for command + context menu)
  __tests__/...
src/modules/bootstrap.ts          (+ registerAiModule)
src/components/chrome/UndoHistoryModal.tsx  (+ "AI" chip for source:"ai")
src/components/palette/CommandPalette.tsx   (the "Summarize this thread with AI" command appears via the module command)
src/components/email/EmailRowContextMenu.tsx (+ "Summarize this thread with AI" action)
src-tauri/src/ai.rs (or commands.rs)  (+ ai_summarize)
src-tauri/src/lib.rs              (+ ai_summarize in invoke_handler!)
.env.example                     (+ NEXUS_ANTHROPIC_API_KEY)
e2e/ai-summarize.spec.ts         (stub summarizer flow)
```

## 8. Reuse (research-and-reuse, verified in-repo)

The Notes module's `createNoteFromEntity`/`recordMutations` atomic pattern (the summary note + link mirrors it); `linksGraph` `CREATE_LINK`/`linksFrom`; the module manifest + `host.contribute.command` pattern (Tasks/Notes); the email-row create-from-email launcher wiring; `UndoHistoryModal`; `reqwest` (already in src-tauri with the Gmail/calendar HTTP clients); the `claude-api` skill for the Claude request shape; the `e2e/` Playwright harness.

## 9. Testing (per `docs/testing-policy.md`)

- **Provenance (Node):** `wrapEnvelope`/`unwrapEnvelope` round-trip + idempotency + no-op on bare payloads; a `recordMutation(..., { source: "ai", generatedBy })` produces a `Mutation` with `source === "ai"` and replays to an identical projection; undo of an AI mutation removes it; a mixed (bare + enveloped) replay is identical to expected state.
- **Summarize command (Node):** with `stubSummarizer`, `summarizeThread` emits exactly `CREATE_NOTE` + `CREATE_LINK` (`summarizes`) tagged `source:"ai"`, one atomic undo reverts both; the gathered `ThreadMessage[]` includes the thread's messages.
- **Rust:** request-body/response-parse unit test for `ai_summarize` against canned JSON (no network); missing-key returns the expected `Err`.
- **e2e (web mode, stub):** invoke "Summarize this thread with AI" from ⌘K on an email → an "AI summary: …" note appears in Notes, linked to the email → it is undoable. Runtime-derived assertions.

## 10. Privacy posture (documented, not enforced here)

The command is **explicit/opt-in** — bodies leave the device only when the user invokes it. The real AI-layer epic later adds the §7.3.1 **body-access capability** gate + consent UI and moves the key fully behind the backend capability boundary. This slice records provenance and keeps the key server-side (Rust) but does **not** build capability enforcement (deferred per §10 of the substrate design).

## 11. Out of scope (→ later)

Streaming responses; multi-turn / chat; the **bus-trigger** ("auto-summarize VIP mail" — Pillar 2 reaction); a note-row "AI" badge; body-access capability **enforcement** + consent UI; model/temperature/settings UI; summarization-quality tuning; summarizing non-email entities; redo-label parity beyond the undo modal.
