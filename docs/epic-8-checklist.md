# Epic 8 — iOS Native App

**Status: 🟡 In progress** — first-party Swift client lives at `/ios/`. Feature parity with the desktop Tauri client has **not** been verified. This checklist captures current state as of 2026-05-28.

The iOS app has its own `ios/README.md` with developer setup; this checklist is the cross-repo view (what's wired up at the Nexus-V2 level and what's pending).

---

## Goal

Native iOS client that shares the vault format with the desktop app via the relay sync. iOS 15+, pure Swift, SwiftUI.

---

## What's in place

### Project structure (29 Swift files, 7 directories)

| Area | Files | Notes |
|---|---|---|
| **App** (3) | `NexusApp.swift`, `AppState.swift`, `Info.plist` | SwiftUI app entry. |
| **Data** (4) | `VaultDB.swift`, `Models.swift`, `MutationEngine.swift`, `Schema.sql` | GRDBSQLCipher-backed local DB. **Schema mirrors the desktop `schema.rs`** (see `ios/README.md` for the compatibility note). |
| **Crypto** (1) | `CryptoManager.swift` | XChaCha20-Poly1305, matches Rust desktop. Plus `CryptoManagerTests.swift`. |
| **Keychain** (1) | `KeychainStore.swift` | OAuth token storage via `Security.framework` (vs desktop which stores tokens in SQLCipher-encrypted DB). |
| **Sync** (4) | `GmailAuth.swift`, `GmailSync.swift`, `RelayClient.swift`, `SyncEngine.swift` | Gmail OAuth (custom URL scheme `nexus://oauth`), full + incremental sync, relay drain. |
| **UI** (15 screens) | `SplashView`, `VaultSetupView`, `MainTabView`, `InboxView`, `MailView`, `MessageDetailView`, `ComposeView`, `FolderSidebarView`, `LabelsView`, `KanbanView`, `SearchView`, `RulesView`, `TemplatesView`, `ContactsView`, `SettingsView` | All SwiftUI. |
| **Tests** (2) | `CryptoManagerTests.swift`, `MutationEngineTests.swift` | Unit tests for the two most security-critical layers. |

### Cross-repo compatibility

- **Vault format**: same SQLCipher-encrypted SQLite as desktop. Schema mirror is in `ios/Nexus/Data/Schema.sql`. **Risk**: if the desktop schema (`src-tauri/src/db/schema.rs`) ships a new ALTER block, the iOS schema must mirror it manually — there is no shared codegen.
- **Crypto**: `CryptoManager.swift` implements the same `nonce(24) || ciphertext` framing as `src-tauri/src/crypto.rs:encrypt_payload`. Verified by `CryptoManagerTests.swift`.
- **Relay client**: `Sync/RelayClient.swift` speaks the same 4 endpoints (`POST/GET /api/v1/mutations`, `POST/GET /api/v1/enroll/:code_hash`).

### Build setup

- `Package.swift` + `Local.xcconfig` (gitignored) for client IDs/secrets.
- Xcode project at `ios/Nexus.xcodeproj`, scheme `NexusTests`.
- Required Swift Package deps: `groue/GRDB.swift` (GRDBSQLCipher product), `apple/swift-crypto` (Crypto + _CryptoExtras).

### iOS-specific differences from desktop

| Concern | Desktop (macOS) | iOS |
|---|---|---|
| OAuth tokens | SQLite `accounts` table (SQLCipher-encrypted) | iOS Keychain |
| OAuth redirect URI | `http://localhost:<ephemeral>` | `nexus://oauth` custom scheme |
| Background sync | Rust tokio 30s timer | `BGTaskScheduler` |
| HTML rendering | Tauri webview | `WKWebView` in `UIViewRepresentable` |

---

## What's not verified / still pending

### 🟡 Feature parity audit

The desktop app has:
- 57 IPC commands (`docs/ipc-api-reference.md`)
- 72 MutationKinds (`src/data/types.ts`)
- 15 UI feature areas (`src/components/`)

The iOS app has 15 UI screens but **no audit exists** mapping each desktop feature to its iOS counterpart (or its absence). For example:
- Does `MutationEngine.swift` handle all 74 mutation kinds? Unknown.
- Are custom fields editable on iOS? Unknown.
- Is the Kanban view fully featured or read-only? Unknown.
- Are calendar templates supported (EP-13)? Unknown.

**Definition of done for this item:** produce a parity matrix in this checklist.

### 🟡 Schema drift risk

There's no automated check that `ios/Nexus/Data/Schema.sql` matches the most recent desktop ALTER blocks. **Definition of done:** a CI step (or a `pnpm` script) that fails when the two schemas diverge.

### 🟠 Android shell

Tracked separately — `docs/known-gaps.md` item 10. Will follow iOS parity.

### 🟠 App Store presence

Out of scope for this checklist.

---

## Verification

```bash
# Desktop side
cargo check -p nexus
pnpm typecheck && pnpm lint && pnpm test

# iOS side (must be on macOS with Xcode)
cd ios
xcodebuild -scheme NexusTests -destination 'platform=iOS Simulator,name=iPhone 15' test
```

Manual cross-device test:
1. Set up a relay (see `docs/relay.md`)
2. Enroll desktop on the relay
3. Enroll iOS via 6-digit pairing code
4. Make a mutation on iOS (label add, status change, …)
5. Verify it lands on desktop within 30 seconds
6. Make a mutation on desktop → verify it lands on iOS
7. Verify both directions for every `MutationKind` family

---

## Related docs

- `ios/README.md` — iOS dev setup, build & run
- `docs/architecture.md` §Sync engine
- `docs/security-model.md` §Device enrollment
- `docs/known-gaps.md` items 9, 10
