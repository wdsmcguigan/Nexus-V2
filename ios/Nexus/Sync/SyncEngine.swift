import Foundation
import BackgroundTasks

/// Orchestrates foreground and background sync for all accounts.
/// Foreground: 30-second Timer. Background: BGAppRefreshTask.
@MainActor
final class SyncEngine: ObservableObject {

    static let bgTaskIdentifier = "com.nexus.app.sync"

    private let db: VaultDB
    private let vaultId: String
    private let gmailAuth: GmailAuth
    private var relayClient: RelayClient?
    private var foregroundTimer: Timer?

    @Published var isSyncing = false
    @Published var lastSyncAt: Date?
    @Published var lastError: String?

    init(db: VaultDB, vaultId: String, gmailAuth: GmailAuth) {
        self.db = db
        self.vaultId = vaultId
        self.gmailAuth = gmailAuth
    }

    func configure(relayURL: URL?, vaultKeyHex: String) {
        if let relayURL {
            relayClient = try? RelayClient(baseURL: relayURL, vaultKeyHex: vaultKeyHex, vaultId: vaultId)
        }
    }

    // MARK: - Foreground sync

    func startForegroundSync() {
        foregroundTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                await self.syncAll()
            }
        }
        // Sync immediately on start
        Task { await syncAll() }
    }

    func stopForegroundSync() {
        foregroundTimer?.invalidate()
        foregroundTimer = nil
    }

    // MARK: - Background task registration

    static func registerBackgroundTask() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: bgTaskIdentifier,
            using: nil
        ) { task in
            guard let refreshTask = task as? BGAppRefreshTask else { return }
            Task {
                // Background sync needs its own DB instance (isolated)
                // AppState should be passed or recreated here
                refreshTask.setTaskCompleted(success: true)
            }
        }
    }

    func scheduleBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: Self.bgTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)  // 15 min minimum
        try? BGTaskScheduler.shared.submit(request)
    }

    // MARK: - Sync all accounts

    func syncAll() async {
        guard !isSyncing else { return }
        isSyncing = true
        lastError = nil
        defer {
            isSyncing = false
            lastSyncAt = Date()
            scheduleBackgroundRefresh()
        }

        do {
            let accounts = try db.fetchAccounts(vaultId: vaultId)
            for account in accounts where account.provider == "gmail" {
                let syncer = GmailSync(db: db, vaultId: vaultId, auth: gmailAuth)
                _ = try await account.historyId != nil
                    ? syncer.incrementalSync(account: account)
                    : syncer.fullSync(account: account)
            }

            // Push pending mutations to relay
            if let relay = relayClient {
                let pending = try db.fetchPendingMutations(vaultId: vaultId)
                for mutation in pending {
                    try await relay.pushMutation(mutation)
                    try db.markMutationSynced(id: mutation.id, relaySeq: Int64(Date().timeIntervalSince1970))
                }

                // Pull remote mutations
                let (lastSeq, _) = try db.fetchRelayState(relayUrl: relay.baseURL.absoluteString)
                let remote = try await relay.pullMutations(since: lastSeq)
                if !remote.isEmpty {
                    let engine = try MutationEngine(db: db, vaultId: vaultId)
                    for remoteMut in remote {
                        guard let kind = MutationKind(rawValue: remoteMut.kind) else { continue }
                        let payloadData = remoteMut.payloadJson.data(using: String.Encoding.utf8) ?? Data()
                        let payload = (try? JSONSerialization.jsonObject(with: payloadData)) as? [String: Any] ?? [:]
                        try engine.apply(kind: kind, payload: payload)
                    }
                    let maxSeq = remote.map { $0.seq }.max() ?? lastSeq
                    try db.updateRelayState(relayUrl: relay.baseURL.absoluteString, lastSeq: maxSeq)
                }
            }
        } catch {
            lastError = error.localizedDescription
        }
    }
}
