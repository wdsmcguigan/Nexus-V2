# Nexus Suite — Foundational Substrate Design

> **Status:** Draft / RFC — design contract, not implementation.
> **Scope:** The shared foundation that the rich non-AI panels, the future AI layer, and the eventual third-party module ecosystem all sit on.
> **Audience:** Nexus core contributors. Read `docs/architecture.md` and `docs/glossary.md` first.

---

## 0. Why this document exists

We are evolving Nexus from an email client into an **email-first, local-first personal-information suite** — email, calendar, contacts, plus Notes, Tasks, Clock/Timer/Time-tracker, Gallery, Documents — and, much later, an **AI layer** and a **third-party module ecosystem** ("the Nexus Suite").

All three of those bets — *rich interconnected panels*, *an AI layer*, *a plugin platform* — turn out to want the **same four substrate pieces**. That is the central finding behind this doc, and a strong signal these are the right things to build first, before panel #2:

1. **Namespaced mutation conventions** — one write path for core, AI, and third parties.
2. **Event bus** — public pub/sub so modules react to each other without knowing each other.
3. **Links / relations graph** — cross-module entity references; the "knowledge graph" the AI will later traverse.
4. **Module / extension model** — manifest, contribution points, capability vocabulary, namespaced storage.

**Guiding principle for the whole doc:** *design for AI and for third parties now; build their enforcement/runtime later.* The expensive parts (sandbox enforcement, signing, marketplace, consent UI) are deferred. The cheap-but-irreversible parts (drawing the module boundary, namespacing the write path, defining the capability vocabulary) happen now, because retrofitting them later is a ground-up rewrite.

---

## 1. Design principles (the invariants)

These are the rules every pillar must honor. If a design choice violates one of these, it's wrong.

- **P1 — Everything is a mutation.** Every state change — core, AI-generated, or module-emitted — flows through `recordMutation()`. No side channels. This is what gives us undo, audit, relay sync, and multi-window consistency *for free*, and it is the single biggest architectural advantage we have over Odysseus (whose modules are glued by an agent making internal HTTP calls, with no unified provenance).
- **P2 — Everything is a module, including what we ship.** Core panels (Tasks, Notes, etc.) register through the *same* contribution API a third party would use. We dogfound the platform API in-tree before anyone outside touches it. (The VS Code discipline; the opposite of which is API rot.)
- **P3 — The vault is sacred.** Crypto, the E2EE relay, the raw mail/sync engine, and key material are **first-party-forever**. Modules build *on top of* the vault through capability-gated APIs; they never reach into it.
- **P4 — Capability before access.** Every cross-boundary read/write is named by a capability. Enforcement is deferred; the *vocabulary* is not. APIs are shaped capability-first from day one so permissions can be switched on later without rewriting them.
- **P5 — Module state is derived where possible.** Prefer module state as a *projection of the mutation log* (event-sourced) over opaque private storage. This makes module data undoable, syncable, and replayable across devices automatically. Bulk/private data that can't be event-sourced uses host-mediated namespaced storage.
- **P6 — Don't freeze the API until it's proven.** The contribution API stays *internal-public* (unfrozen, in-tree consumers only) until 2–3 first-party modules have proven its shape. No external module loading, no marketplace, until then.

---

## 2. How this builds on what already exists

This is **not** a greenfield system. It is a small set of generalizations of mechanisms Nexus already has. The point of grounding it is to show the lift is "extend + draw lines," not "rewrite."

| Substrate need | What already exists today | What we generalize it into |
|---|---|---|
| One write path | `recordMutation(kind, payload)` → `applyMutationIpc` → `apply_mutation` (`commands.rs`) → `INSERT INTO mutations` | Accept **namespaced** kinds; dispatch reducers by namespace |
| Multi-window broadcast | `apply_mutation` emits `vault:mutation-applied`; siblings apply via `applyRemoteMutation()` (pure reducer, echo-rejected by `originWindow`) | Promote into a **public in-process event bus** with typed subscriptions |
| Reducer | `applyMutationReducer()` switch in `storage/useStore.ts` | A **reducer registry** keyed by namespace; unknown kinds stored-but-unreduced |
| Undo / sync | `forwardSteps`/`reverseSteps`, `relay_seq`, `lamport`, `device_id` on the `mutations` table | Works unchanged for module + AI mutations — they're just rows |
| Cross-entity references | Ad hoc FKs (`message_labels`, `calendar_attendees`, `documents.source_email_*` in prior art) | A **generic `links` table** any module can write |
| Panel registration | dockview registry in `Workspace.tsx`; popout system (`popout.rs`) | A **contribution point**: modules register panels by manifest |
| Settings | `appPreferences.ts`, per-account `preferences_json`, `WorkspaceSnapshot` | Modules **contribute** settings into the same surfaces |

**Key consequence of P1 + the E2EE relay:** the relay stores only ciphertext blobs and is content-agnostic, so **module and AI mutations sync across devices for free** — the relay never needs to understand a kind to ship it. That is a large, free win.

---

## 3. Stable IDs (glossary additions)

Following `docs/glossary.md` conventions:

| ID | Concept |
|---|---|
| **MOD** | Module — a unit of *functionality* (core or third-party) declared by a manifest. May contribute **zero or more** surfaces; some modules are headless |
| **SRF** | Surface — a UI contribution of a given *type* (dock, rail, inspector-section, …). "Panel" is one surface type, not a synonym for module |
| **CAP** | Capability — a named permission a module requests in its manifest |
| **LNK** | Link — a typed edge in the relations graph between two entities |
| **ENT** | Entity type — a kind of object a module owns (e.g. `task`, `note`, `timer`) |
| **EVT** | Event subscription — a module's registration to receive mutations of given kinds |
| **CP** | Contribution point — a host extension slot (surface, command, settings, rule-action, …) |
| **NS** | Namespace — reverse-DNS prefix that scopes a module's kinds/entities/storage |

---

## 4. Pillar 1 — Namespaced mutation conventions

The mutation log is already the write path. We make it the write path for *everyone* by namespacing.

### 4.1 Naming

- **Core** kinds keep their current bare names but are conceptually reserved under `nexus/` (e.g. `SET_READ` ≡ `nexus/SET_READ`). No migration of existing rows required — the `mutations.kind` column is already a free-text string.
- **Module** kinds **must** use a reverse-DNS namespace: `vendor.module/KIND`, e.g. `org.nexus.tasks/CREATE_TASK`, `com.acme.timetracker/START_TIMER`.
- Namespace ownership is declared in the module manifest (§7). The host rejects an emit whose namespace the module doesn't own.

No schema change: `kind` stays a string; `payload_json` stays JSON. Namespacing is a *convention plus a registry*, not new columns.

### 4.2 Reducer registry

Today `applyMutationReducer()` is one switch. We split it:

```ts
// Host-side registry (illustrative)
type Reducer = (state: ModuleState, payload: unknown, ctx: MutationCtx) => ModuleState;
registerReducer(namespace: NS, kind: string, reducer: Reducer): void;
```

- The host dispatches each applied mutation to the reducer registered for its `(namespace, kind)`.
- Core reducers register `nexus/*`. Each module registers its own namespace on load.
- **Unknown-kind handling (critical for cross-device):** if a mutation's namespace has no registered reducer (module not installed on this device/window), the row is **still stored and still synced** — it just doesn't update any in-memory projection here. When the module later loads, it **replays** its kinds from the log to rebuild state (P5). This means a time-tracker entry created on your Mac arrives on a device without the time-tracker installed, sits harmlessly in the log, and materializes the moment you install it there.

### 4.3 Undo, sync, multi-window — unchanged

Module and AI mutations are ordinary rows, so they inherit:
- **Undo/redo** via `forwardSteps`/`reverseSteps` (a module declares the inverse of its own mutations).
- **Relay sync** via `relay_seq` draining.
- **Multi-window broadcast** via `vault:mutation-applied` → `applyRemoteMutation()`, echo-rejected by `originWindow`.

### 4.4 AI & provenance

Every mutation carries optional provenance metadata so AI actions are auditable and visually distinguishable:

```jsonc
// payload envelope convention (not a new column — lives in payload_json or a sibling meta field)
{ "source": "user" | "ai" | "module:<NS>" | "rule",
  "generatedBy": "<model id / module id>",   // optional
  "links": [ /* optional LNKs to create atomically, see §6 */ ] }
```

`source: "ai"` is what lets the UI label AI edits, lets undo target them, and lets the user trust the system. (Odysseus has no equivalent — its AI writes are untracked side effects.)

---

## 5. Pillar 2 — Event bus

The bus is how modules react to each other **without compile-time knowledge of each other**. "Calendar wakes up because a `CREATE_TASK` with a due date landed" — Calendar never imports Tasks.

### 5.1 Model

- It is a generalization of the existing `vault:mutation-applied` broadcast: **every applied mutation is an event** on the bus, keyed by `(namespace, kind)`.
- Modules subscribe by kind glob:

```ts
bus.subscribe("nexus/CREATE_CALENDAR_EVENT", handler);
bus.subscribe("com.acme.timetracker/*", handler);   // glob within a namespace it's allowed to hear
```

- Subscription requires the `bus.subscribe:<glob>` capability (§7.3).

### 5.2 Semantics (decide once, hold forever)

- **Order:** events are delivered in mutation-commit order (the `lamport`/commit order already established). No reordering guarantees beyond per-origin causal order — same as the relay.
- **Timing:** handlers run **after** the mutation is committed and the core reducer has applied (read-your-writes within a tick). Handlers are **observers**, not interceptors — they cannot veto or rewrite the triggering mutation (that keeps the write path deterministic). A handler reacts by **emitting its own mutation**, which is itself an event. Reactions compose; nothing is hidden.
- **Loop safety:** because reactions are themselves mutations, naive A→B→A chains are possible. The host tags reaction depth in the provenance envelope and cuts off runaway cascades past a bounded depth, logging it (no silent truncation — P-style honesty).
- **Where it runs:** the bus runs in the **main window only** (consistent with today's worker gating on `label === "main"`). Popout windows receive *projected* state via `applyRemoteMutation`, not raw bus subscriptions, so we don't fan reaction logic across N webviews.

### 5.3 Why this beats Odysseus's approach

Odysseus has a Python `fire_event()` bus too — but its events trigger an *LLM agent* to do cross-module work. Ours triggers **deterministic, undoable mutations**. The AI becomes an *optional* subscriber on top of a system that already works without it. That's the email-first inversion in one sentence.

---

## 6. Pillar 3 — Links / relations graph

This is the interop layer and the future AI substrate: the typed web that says *this email* ↔ *this task* ↔ *this time entry* ↔ *this contact* ↔ *this document*.

### 6.1 Schema

One generic table (encrypted in the vault like everything else):

```sql
CREATE TABLE links (
  id         TEXT PRIMARY KEY,
  src_type   TEXT NOT NULL,   -- ENT, e.g. 'nexus/email.message' or 'org.nexus.tasks/task'
  src_id     TEXT NOT NULL,
  link_type  TEXT NOT NULL,   -- e.g. 'derived-from', 'attached-to', 'tracks', 'mentions'
  dst_type   TEXT NOT NULL,
  dst_id     TEXT NOT NULL,
  meta_json  TEXT,            -- optional edge data (e.g. offset, role)
  created_at INTEGER NOT NULL
);
-- indexes both directions for traversal
CREATE INDEX idx_links_src ON links(src_type, src_id);
CREATE INDEX idx_links_dst ON links(dst_type, dst_id);
```

### 6.2 Links are mutations too (P1)

Edges are created/removed via core mutation kinds `nexus/CREATE_LINK` / `nexus/DELETE_LINK`, so they sync, undo, and broadcast like everything else. A mutation can also carry inline `links` in its provenance envelope (§4.4) so "create the event **and** link it to its source email" is **one atomic, undoable action** — undo removes both.

### 6.3 Entity types & traversal

- A module declares the `ENT` types it owns in its manifest (`org.nexus.tasks/task`). Core declares `nexus/email.message`, `nexus/calendar.event`, `nexus/contact`, etc.
- The host offers a capability-gated graph query API:

```ts
graph.linksFrom(entType, entId, linkType?): Link[];
graph.linksTo(entType, entId, linkType?): Link[];
graph.neighbors(entType, entId, { depth, linkTypes }): GraphResult;
```

- A module can link **its** objects to **core** objects it has never seen the schema of — it only needs the entity id and the `data.read:<entType>` capability. (Time-tracker links a timer to an email it cannot read the body of.)

### 6.4 This is the AI's map

When the AI layer arrives, it does not need bespoke integrations per module. It **traverses this graph**. "Summarize everything related to the Acme deal" becomes a graph walk from the Acme contact across emails, tasks, events, and docs. This is the capability Odysseus structurally cannot match, because it never built the graph — it asks the model to re-discover relationships every time.

---

## 7. Pillar 4 — Module / extension model

### 7.1 Manifest

Every module — core or third-party — ships a manifest:

```jsonc
{
  "id": "org.nexus.tasks",
  "name": "Tasks",
  "version": "1.0.0",
  "namespace": "org.nexus.tasks",
  "entities": ["task"],                       // ENT types it owns
  "mutationKinds": ["CREATE_TASK", "COMPLETE_TASK", "LINK_TASK"],
  "capabilities": {                            // CAP requests (vocabulary defined now, enforced later)
    "data.read":    ["nexus/email.message#envelope", "nexus/email.message#flags",
                     "nexus/contact", "nexus/calendar.event#envelope"],   // metadata only — no #body (§7.3.1)
    "data.write.own": true,
    "mutations.emit": ["org.nexus.tasks/*"],
    "bus.subscribe":  ["nexus/CREATE_CALENDAR_EVENT", "nexus/SET_FLAG"],
    "ui.contribute":  ["dock", "command", "inspector-section"],   // SRF types (§7.2)
    "net": "none"                              // privacy default
  },
  "contributes": {
    "surfaces": [
      { "type": "dock", "id": "tasks.main", "title": "Tasks", "icon": "check", "detachable": true },
      { "type": "inspector-section", "id": "tasks.related", "title": "Related Tasks" }
    ],
    "commands": [{ "id": "tasks.new", "title": "New Task", "default-key": "t" }]
  },
  "trust": "core"                              // core | first-party | third-party
}
```

### 7.2 Contribution points & the surface taxonomy (CP / SRF)

**Module vs. Surface vs. Panel** — three words, not two:

- A **Module (MOD)** is a *functional* unit. It may contribute **zero or more** surfaces. Some modules are **headless** (the rules engine, sync workers, the future AI agent) and contribute *no* surface at all — which is the clearest proof that Panel ≠ Module.
- A **Surface (SRF)** is a UI contribution *of a given type*.
- A **"Panel"** is just *one* surface type (the detachable dock tab). What we informally call "panel types" are really **surface types**.

The host exposes named contribution points; modules fill them **by manifest**, never by reaching into host internals. Nexus already implements every surface type below ad hoc today, so this is **naming + gating what exists**, not inventing new UI machinery.

#### Surface types

| Type | Today in Nexus | Placement / behavior | Third-party? |
|---|---|---|---|
| **dock** (the "Panel") | dockview center (EmailList, Calendar, Kanban, Table) + `popout.rs` | Tabbed, splittable, `detachable` → OS window | ✅ default surface |
| **rail** | NavigationPanel (left), InspectorPanel (right), StatusBar (bottom) | Edge-docked (left/right/top/bottom), `collapsible`, persistent | ❌ core/first-party only — a module must never own a rail |
| **inspector-section** | inspector's pickers/notes/tags blocks | A block *inside* the right rail (host aggregates contributions) | ✅ gated by `data.read` |
| **embedded-widget** | `CustomFieldStrip` inside email rows | A fragment injected into *another* surface, host-framed | ❌ core/first-party first (spoofing risk — §7.6) |
| **overlay** | CommandPalette, modals, popovers, HudStrip, toasts | Invoked, transient, not persistent | ✅ commands/toasts; modals gated |
| **headless** | sync workers, rules engine, (future) AI agent | No UI — pure backend module | n/a (no surface) |
| **full-window** | (new) focus reading/writing mode | Single surface fills the window, chrome hidden; host always draws a persistent exit affordance | ❌ core/first-party only (full-window = impersonation risk) |
| **ambient-indicator** | (new) running-timer pill | *Composition:* a **headless** module + a tiny host-framed status-bar/tray micro-surface showing live state | ✅ (host-framed, data-only) |
| **canvas** | (new) board / dashboard | *Composition:* a **dock** host that contains free-floating **embedded-widgets**; inherits embedded-widget trust gating | host = ✅; widgets on it follow embedded-widget rules |

Two of the new types are deliberately **compositions** of base types (ambient-indicator = headless + micro-surface; canvas = dock + embedded-widgets) rather than new primitives — this keeps the taxonomy from sprawling while still giving each a first-class name in the manifest.

#### Orthogonal attributes (flags, not types)

`detachable` (→ OS window), `collapsible`, `resizable`, `edge` (rail only), `singleton` vs multi-instance, and persistence scope (handled by `WorkspaceSnapshot`). Keeping these as flags rather than types stops the set from combinatorially exploding.

#### Trust-tier × surface-type gating (a substrate contract — decide now, §10)

| | dock | rail | inspector-section | embedded-widget | overlay | full-window | ambient-indicator | canvas |
|---|---|---|---|---|---|---|---|---|
| **core** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **first-party** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **third-party** | ✅ | ❌ | ✅ | ❌ (initially) | commands/toasts only | ❌ | ✅ | host ✅ / widgets ❌ |

A third-party module can never occupy a navigation rail, paint into another module's surface, take over the full window, or pop a modal — both a UX boundary and an anti-spoofing boundary.

Other (non-surface) contribution points: **command** (Cmd+K), **settings** (a `SettingsPanel` section, persisted via existing prefs surfaces), **context-menu action**, **rule-action** (an action the rules engine can invoke), **scheduled-task handler** (for the Tasks/scheduler module).

Core surfaces register through these exact points (P2).

### 7.3 Capability vocabulary (CAP)

Defined now; enforced later. The vocabulary *is* the API's shape.

| Capability | Meaning | Default |
|---|---|---|
| `data.read:<entType>[#<group>]` | Read a **projection group** of an entity type (§7.3.1). Bare grant = safe groups only; sensitive groups must be named | denied |
| `data.write.own` | Write to own namespaced storage | granted |
| `mutations.emit:<glob>` | Emit mutations (must be own NS) | own NS only |
| `bus.subscribe:<glob>` | Receive events for kinds | denied |
| `ui.contribute:<cp>` | Fill a contribution point | per manifest |
| `graph.read` / `graph.write` | Traverse / edit the links graph | read per `data.read`; write own edges |
| `net` | `none` \| allowlisted origins | **none** (privacy-first) |
| `email.send` | Submit outbound mail | **third-party: never**; core/first-party: human-confirm gated |
| `vault.*`, `crypto.*`, `relay.*` | Touch the sacred core | **third-party: never**; core/first-party: gated |

`email.send` and the sensitive read groups (`#body`/`#attachments`/`#raw`, §7.3.1) are the highest-risk surfaces and stay locked to first-party even as we open the platform.

#### 7.3.1 Read projection groups (the privacy lever)

`data.read` is **projection-group-granular**, not all-or-nothing per entity. Each entity type declares named field groups; a grant names the groups it needs. For `nexus/email.message`:

| Group | Contents | Sensitivity |
|---|---|---|
| `envelope` | subject, participants (from/to/cc), dates, folder | safe |
| `flags` | labels, status, flags, tags, custom fields | safe |
| `preview` | snippet | safe |
| `body` | full rendered body (text/html) | ⚠️ sensitive |
| `attachments` | attachment data | ⚠️ sensitive |
| `raw` | the `.eml` source | ⚠️ sensitive |

Rules (the frozen contract — membership can be refined, the syntax and the safe/sensitive split cannot):

- **Default-deny-sensitive.** A bare `data.read:nexus/email.message` yields the **safe groups only** (`envelope`, `flags`, `preview`). Sensitive groups must be **named explicitly** and are **never** granted to third-party modules.
- **Groups are owned by the entity's module.** Core declares groups for core entities; a module declares groups for its own entities.
- **Per-field syntax is reserved** (`#body.text` vs `#body.html`) for a later refinement. v1 stops at groups — granular enough for the privacy stance, stable enough to not break on schema drift.

**Why this is the differentiator:** `#body` becomes a **named, auditable, revocable** capability. A user (or the platform default) can let a module — or the AI agent — triage by metadata while *never* exposing a message body unless explicitly asked. Odysseus has no equivalent: once a module/agent is in, it sees everything. This is the email-first privacy posture encoded directly in the capability vocabulary.

### 7.4 Module storage (P5)

Two tiers:
1. **Event-sourced (preferred):** module state is a projection of its `mutations`. Undoable, syncable, replayable, free.
2. **Host-mediated namespaced store:** for bulk/private data that can't be event-sourced (e.g. a gallery's thumbnail cache). A capability-gated KV/document API scoped to the module's namespace inside the vault:

```ts
storage.get(key): unknown;            // scoped to MOD namespace, host-mediated
storage.set(key, value): void;        // never raw table/DDL access
```

Third-party modules **never** get arbitrary SQL/DDL against the encrypted vault. The host mediates all persistence.

### 7.5 Trust tiers & runtime

| Tier | Who | Runtime | Capabilities |
|---|---|---|---|
| **core** | In-tree, shipped by us | Direct (Rust/TS in-process) | Full, including gated `email.*` |
| **first-party** | Signed, by us, out-of-tree | Same as core, signed | Broad, `email.*` gated |
| **third-party** | Anyone, later | **Sandboxed web/JS in a constrained webview, capability-gated message bridge** | No `vault/crypto/relay`, no `email.body/send`, `net: none` by default |

**Hard rule (the trust decision):** third-party modules are **never arbitrary Rust** — native code can't be sandboxed and "trust me" is incompatible with a privacy product. They are sandboxed JS talking to the host only through the capability-gated bridge (closer to browser-extension / Figma-iframe isolation than to Obsidian's full-Node model, which we explicitly do not copy).

**Deferred (build much later):** the sandbox *enforcement*, signing/verification, the consent UI, and any external/marketplace loading. Until then: core panels are modules, the API is internal-public and unfrozen, and **no external module can load** (P6).

---

## 8. How the AI layer rides this substrate

The AI is "just another subscriber + emitter," not a new architecture:

- **Action vocabulary** = the registered, capability-permitted **mutation kinds**. The agent's tool catalog is generated from the kind registry; it can only do what a capability allows — so "draft only, never send" is a capability toggle, not bespoke code.
- **Context** = a **graph traversal** (Pillar 3) plus FTS, not a per-module integration.
- **Triggers** = **bus subscriptions** (Pillar 2): "when an email from a VIP arrives, summarize + extract tasks."
- **Provenance** = `source: "ai"` envelope (Pillar 1): every AI action is labeled, undoable, synced.
- **The AI is itself a module** with a manifest and capabilities — which means the prompt-injection firewall and the human-confirm gate are enforced by the *same capability system* protecting every other module. Email bodies enter the agent as untrusted data; its `email.send` capability is human-confirm gated, and its `data.read:nexus/email.message#body` capability is **separately consentable** — so metadata-only AI triage is possible without ever exposing bodies (§7.3.1).

This is why building the substrate first makes the AI layer *additive and small* instead of load-bearing and huge.

---

## 9. Security model summary

- **First-party-forever:** crypto, relay, key material, raw mail/sync engine, the sensitive read groups (`#body`/`#attachments`/`#raw`), and `email.send`. (P3)
- **Capability-gated:** all cross-boundary reads/writes, named now, enforced later. Reads are **projection-group-granular** so metadata access never implies body access. (P4, §7.3.1)
- **Third-party = sandboxed JS, `net: none` by default, no vault/crypto, no sensitive read groups, no `email.send`.** (§7.5)
- **Untrusted data:** email bodies, fetched pages, and any module-supplied text are *data, never instructions* to the AI — the highest-risk surface, gated at the capability layer.
- **No external loading until the API is proven** (P6). The platform is real in shape, dormant in runtime, until we choose to open it.

---

## 10. Build now vs. much later

| Build **now** (cheap, irreversible-if-skipped) | Defer to **much later** (expensive, not load-bearing) |
|---|---|
| Namespaced mutation kinds + reducer registry | Sandbox **enforcement** |
| Event bus (promote the existing broadcast) | Module signing / verification |
| `links` table + graph query API | Marketplace / discovery |
| Manifest + capability **vocabulary** | Permission-consent UI |
| Contribution points (panel/command/inspector/settings) | Loading **external** modules at all |
| Host-mediated namespaced storage API | The third-party sandbox **runtime** |
| Provenance envelope (`source`, `links`) | — |

We do the left column before panel #2. We do the right column when there is a real second developer who wants in.

---

## 11. Phased sequencing (ties to the agreed plan)

0. **Substrate (this doc):** mutation namespacing + reducer registry, event bus, `links` graph, manifest/contribution/capability vocabulary, namespaced storage. *Before panel #2.*
1. **Tasks + Notes** as the first two real modules — highest comms value, the graph's hub nodes. They **prove** the contribution API and the links graph in anger.
2. **Tracer-bullet AI slice:** one feature (Inspector "summarize this thread") built as an AI module emitting an allowlisted mutation. Proves the substrate is AI-shaped while it's cheap to change. Then stop and return to panels.
3. **Clock / Alarms / Timer / Time-tracker:** quick win; time entries `link_type: "tracks"` to Tasks.
4. **Email / Calendar / Contacts hardening** + **Gallery / attachment viewer.**
5. **Documents:** the big editor lift, with `derived-from` links to source emails.
6. **Sandboxed reader** (deferred browser): isolated link/article viewer; full browser only if it ever earns its keep.
7. **Full AI layer:** now standing on a rich graph — competitive with, and structurally beyond, Odysseus.
8. **Platformization (open the gates):** sandbox runtime, signing, consent UI, external loading — only once 2–3 first-party modules have frozen the API shape.

---

## 12. Open questions / decisions to make

These are deliberately unresolved; they need a decision before the substrate code lands, not before this doc merges.

1. **Reducer language for modules.** Core reducers are TS in the main window. Do module reducers run in TS (main window) only, or do we also allow Rust reducers for performance-critical core modules? (Leaning: TS reducers in-process for now; Rust stays core-only.)
2. **Replay cost.** For a module installed late on a device with a large `mutations` history, full-namespace replay could be slow. Do we snapshot module projections, and if so, where? (Leaning: optional projection snapshots in the namespaced store, rebuilt from the log.)
3. **Link garbage collection.** When an entity is deleted, what happens to its links? Cascade via mutation, or tombstone + lazy clean? (Leaning: `DELETE_LINK` mutations emitted alongside entity deletion, so it's undoable.)
4. **Capability granularity for `data.read`.** ✅ *Resolved (§7.3.1):* **projection-group** granularity in v1 (`#envelope`/`#flags`/`#preview`/`#body`/`#attachments`/`#raw`), default-deny-sensitive, per-field reserved for v1.1. Remaining sub-question: the exact group membership for *non-email* core entities (contact, calendar.event) — needs a pass before those entities ship.
5. **Bus reaction depth limit.** What's the cutoff for reaction cascades before we log-and-stop?
6. **Manifest format & location** for core (in-tree) modules — colocated with the panel, or a central registry?
7. **Popout windows and module UI.** Can a third-party `dock` surface be popped out into its own OS window, or is that a core-only privilege initially? (Leaning: core-only at first.)
8. **Embedded-widget trust model.** When a widget is host-framed (host draws chrome, module supplies data only), is that enough to allow third-party embedded widgets, or do they stay core/first-party indefinitely? This gates whether AI "related items" chips can ever come from third-party modules. (Leaning: host-framed + data-only, but core/first-party until the sandbox runtime exists.)
9. **Surface-type taxonomy freeze.** Is the §7.2 set (dock, rail, inspector-section, embedded-widget, overlay, headless, full-window, ambient-indicator, canvas) the frozen vocabulary for v1, or do we reserve room for one more primitive? The trust-gating matrix is the part that's expensive to widen later; the type list itself can grow more cheaply.

---

## Appendix A — Substrate at a glance

```mermaid
flowchart TB
    subgraph UI["UI (panels = modules, P2)"]
      core_panels["Core panels<br/>Email · Calendar · Contacts"]
      mod_panels["Module panels<br/>Tasks · Notes · Timer · Gallery · Docs"]
      ai_panel["AI surfaces<br/>(Inspector sections, Cmd+K)"]
    end

    subgraph SUB["Substrate"]
      bus["Event Bus<br/>(public pub/sub over mutations)"]
      reg["Reducer Registry<br/>(dispatch by namespace)"]
      graph["Links / Relations Graph<br/>(the knowledge graph)"]
      caps["Capability Layer<br/>(vocabulary now, enforce later)"]
    end

    subgraph CORE["First-party-forever core (P3)"]
      mut["Mutation log<br/>recordMutation → apply_mutation"]
      vault["SQLCipher Vault"]
      relay["E2EE Relay sync"]
      mail["Mail / sync engine · email.body · email.send"]
    end

    core_panels & mod_panels & ai_panel -->|emit mutations| caps
    caps --> mut
    mut --> reg
    mut --> bus
    mut --> graph
    bus -->|events| mod_panels & ai_panel
    graph -->|traversal| ai_panel
    mut --> vault
    vault --> relay
    caps -.gates.-> mail
```

## Appendix B — Illustrative module API surface (host → module)

```ts
interface NexusModuleHost {
  // write path (P1) — capability: mutations.emit
  emit(kind: string, payload: unknown, opts?: { links?: LinkSpec[]; source?: Source }): void;

  // event bus (Pillar 2) — capability: bus.subscribe
  subscribe(kindGlob: string, handler: (evt: MutationEvent) => void): Unsubscribe;

  // links graph (Pillar 3) — capability: data.read / graph.read
  graph: {
    linksFrom(entType: string, id: string, linkType?: string): Link[];
    linksTo(entType: string, id: string, linkType?: string): Link[];
    neighbors(entType: string, id: string, opts: TraversalOpts): GraphResult;
  };

  // host-mediated namespaced storage (P5) — capability: data.write.own
  storage: { get(key: string): unknown; set(key: string, value: unknown): void };

  // contribution points (Pillar 4) — declared in manifest, wired by host
  contribute: {
    surface(spec: SurfaceSpec): void;       // spec.type ∈ dock | rail | inspector-section | … (§7.2)
    command(spec: CommandSpec): void;
    settingsSection(spec: SettingsSpec): void;
    ruleAction(spec: RuleActionSpec): void;
  };
}
```

*All methods are capability-gated. A third-party module receives a host proxy that only exposes what its manifest was granted; first-party/core modules receive a broader proxy. Same interface shape, different grants — that's P4 in practice.*
