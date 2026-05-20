# Nexus iOS

iOS client for Nexus email. Pure Swift, iOS 15+.

## Setup

1. Open Xcode, choose **File → New → Project**, select **App**, set:
   - Product Name: `Nexus`
   - Bundle ID: `com.nexus.app`
   - Minimum Deployments: iOS 15.0
   - Interface: SwiftUI, Language: Swift

2. Add Swift Package dependencies via **File → Add Package Dependencies**:
   - `https://github.com/groue/GRDB.swift` — use **GRDBSQLCipher** product
   - `https://github.com/apple/swift-crypto` — use **Crypto** + **_CryptoExtras** products

3. Delete the generated `ContentView.swift` and `Assets.xcassets` stubs; add all files from `Nexus/` and `NexusTests/`.

4. Add `Nexus/Data/Schema.sql` to the target as a **resource** (copy if needed).

5. In **Build Settings**, add User-Defined entries:
   - `NEXUS_GMAIL_CLIENT_ID` = your Google OAuth client ID
   - `NEXUS_GMAIL_CLIENT_SECRET` = your Google OAuth client secret

6. Replace `Info.plist` contents with `Nexus/App/Info.plist` from this repo.

7. In Google Cloud Console, add `nexus://oauth` as an authorized redirect URI for your OAuth client.

## Architecture

| Layer | Files |
|-------|-------|
| Data | `Data/VaultDB.swift`, `Data/Models.swift`, `Data/MutationEngine.swift` |
| Crypto | `Crypto/CryptoManager.swift` — XChaCha20-Poly1305 matching Rust desktop |
| Keychain | `Keychain/KeychainStore.swift` — OAuth token storage |
| Sync | `Sync/GmailAuth.swift`, `Sync/GmailSync.swift`, `Sync/RelayClient.swift`, `Sync/SyncEngine.swift` |
| UI | `UI/VaultSetupView.swift`, `UI/InboxView.swift`, `UI/MessageDetailView.swift`, `UI/ComposeView.swift`, `UI/SettingsView.swift` |
| App | `App/NexusApp.swift`, `App/AppState.swift` |

## Vault Compatibility

The iOS app uses the same SQLCipher-encrypted SQLite database format as the macOS desktop app:
- Key: `"nexus"` (hardcoded, same as Rust `VaultDb`)
- Schema: mirrors `src-tauri/src/db/schema.rs` exactly
- Encryption: XChaCha20-Poly1305 with 24-byte random nonces (matches `crypto.rs`)

To share a vault between macOS and iOS, copy the `vault.db` file to the iOS Documents/Mail directory.

## iOS-Specific Differences from Desktop

| Concern | Desktop (macOS) | iOS |
|---------|----------------|-----|
| OAuth tokens | SQLite `accounts` table | Keychain (`Security.framework`) |
| OAuth redirect | `http://localhost:9004` | `nexus://oauth` custom scheme |
| Background sync | Rust tokio timer | `BGTaskScheduler` |
| HTML rendering | webview | `WKWebView` in `UIViewRepresentable` |

## Running Tests

```
xcodebuild -scheme NexusTests -destination 'platform=iOS Simulator,name=iPhone 15' test
```
