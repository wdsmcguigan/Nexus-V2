import Foundation
import SwiftUI

/// Central app state. Owns VaultDB, MutationEngine, SyncEngine.
/// iOS 15 compatible: uses ObservableObject + @Published.
@MainActor
final class AppState: ObservableObject {

    @Published var isOnboarded: Bool = false
    @Published var messages: [NexusMessage] = []
    @Published var folders: [NexusFolder] = []
    @Published var labels: [NexusLabel] = []
    @Published var accounts: [NexusAccount] = []
    @Published var statuses: [NexusStatus] = []
    @Published var contacts: [NexusContact] = []
    @Published var rules: [NexusRule] = []
    @Published var templates: [NexusTemplate] = []
    @Published var searchResults: [NexusMessage] = []
    @Published var messageLabelIds: [String: [String]] = [:]  // messageId -> [labelId]
    @Published var selectedFolderId: String? = nil
    @Published var selectedTab: Int = 0
    @Published var clientMode: ClientMode = .traditional
    @Published var showCompose: Bool = false
    @Published var composeReplyTo: NexusMessage? = nil
    @Published var oauthCallbackURL: URL? = nil

    private(set) var db: VaultDB?
    private(set) var mutationEngine: MutationEngine?
    private(set) var syncEngine: SyncEngine?
    private(set) var vaultId: String = ""

    enum ClientMode: String {
        case traditional = "traditional"
        case localFirst = "local-first"
    }

    // MARK: - Vault init

    func initializeVault(path: String) throws {
        let expandedPath = (path as NSString).expandingTildeInPath
        // Ensure directory exists
        try FileManager.default.createDirectory(atPath: expandedPath, withIntermediateDirectories: true)
        let dbPath = "\(expandedPath)/vault.db"

        let newDb = try VaultDB(path: dbPath)
        // Protect the database file so it is inaccessible while the device is locked.
        try? FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.complete],
            ofItemAtPath: dbPath
        )
        self.db = newDb

        // Load or create vault record
        let vaultId = "vault-\(UUID().uuidString.prefix(8))"
        let vault = NexusVault(id: vaultId, path: expandedPath,
                               createdAt: Int64(Date().timeIntervalSince1970 * 1000))
        try newDb.upsertVault(vault)
        self.vaultId = vaultId

        self.mutationEngine = try MutationEngine(db: newDb, vaultId: vaultId)

        let auth = GmailAuth(
            clientId: Config.gmailClientId,
            clientSecret: Config.gmailClientSecret
        )
        let engine = SyncEngine(db: newDb, vaultId: vaultId, gmailAuth: auth)
        self.syncEngine = engine

        try loadData()
        isOnboarded = true
    }

    func loadData() throws {
        guard let db else { return }
        accounts = try db.fetchAccounts(vaultId: vaultId)
        folders = try db.fetchFolders(vaultId: vaultId)
        labels = try db.fetchLabels(vaultId: vaultId)
        statuses = try db.fetchStatuses(vaultId: vaultId)
        contacts = try db.fetchContacts(vaultId: vaultId)
        rules = try db.fetchRules(vaultId: vaultId)
        templates = try db.fetchTemplates(vaultId: vaultId)

        let folderId = selectedFolderId ?? folders.first(where: { $0.systemKind == "inbox" })?.id
        if let folderId {
            selectedFolderId = folderId
            messages = try db.fetchMessages(vaultId: vaultId, folderId: folderId)
        } else {
            messages = try db.fetchMessages(vaultId: vaultId)
        }

        // Build message-labels cache for fast row display
        var cache: [String: [String]] = [:]
        for msg in messages {
            let labelIds = try db.fetchLabels(messageId: msg.id)
            if !labelIds.isEmpty { cache[msg.id] = labelIds }
        }
        messageLabelIds = cache
    }

    func search(query: String) {
        guard let db, !query.trimmingCharacters(in: .whitespaces).isEmpty else {
            searchResults = []
            return
        }
        do {
            let ids = try db.searchMessages(query: query + "*", vaultId: vaultId)
            searchResults = try ids.compactMap { try db.fetchMessage(id: $0) }
        } catch {
            searchResults = []
        }
    }

    func loadMessagesForFolder(_ folderId: String) {
        guard let db else { return }
        selectedFolderId = folderId
        messages = (try? db.fetchMessages(vaultId: vaultId, folderId: folderId)) ?? []
        var cache: [String: [String]] = [:]
        for msg in messages {
            let labelIds = (try? db.fetchLabels(messageId: msg.id)) ?? []
            if !labelIds.isEmpty { cache[msg.id] = labelIds }
        }
        messageLabelIds = cache
    }

    // MARK: - OAuth callback

    func handleOAuthCallback(url: URL) {
        oauthCallbackURL = url
    }

    // MARK: - Account management

    func connectGmailAccount() async throws {
        guard let syncEngine else { throw AppError.notInitialized }

        let auth = GmailAuth(
            clientId: Config.gmailClientId,
            clientSecret: Config.gmailClientSecret
        )
        let tokens = try await auth.authenticate()

        // Store tokens in Keychain
        try KeychainStore.save(
            key: KeychainStore.accessTokenKey(accountId: tokens.accountId),
            value: tokens.accessToken
        )
        try KeychainStore.save(
            key: KeychainStore.refreshTokenKey(accountId: tokens.accountId),
            value: tokens.refreshToken
        )

        let account = NexusAccount(
            id: tokens.accountId,
            vaultId: vaultId,
            provider: "gmail",
            email: tokens.email,
            displayName: nil,
            accessToken: nil,  // stored in Keychain, not DB
            refreshToken: nil,
            tokenExpiresAt: Int64(tokens.expiresAt.timeIntervalSince1970 * 1000),
            historyId: nil,
            createdAt: Int64(Date().timeIntervalSince1970 * 1000),
            syncCursor: nil,
            settingsJson: nil
        )
        try db?.upsertAccount(account)
        accounts = try db?.fetchAccounts(vaultId: vaultId) ?? []

        // Start sync
        await syncEngine.syncAll()
        try loadData()
    }

    // MARK: - Mutations

    func apply(kind: MutationKind, payload: [String: Any]) {
        do {
            try mutationEngine?.apply(kind: kind, payload: payload)
            try loadData()
        } catch {
            print("Mutation error: \(error)")
        }
    }
}

enum AppError: Error {
    case notInitialized
}

// MARK: - Config

enum Config {
    static var gmailClientId: String {
        Bundle.main.object(forInfoDictionaryKey: "NEXUS_GMAIL_CLIENT_ID") as? String ?? ""
    }
    static var gmailClientSecret: String {
        Bundle.main.object(forInfoDictionaryKey: "NEXUS_GMAIL_CLIENT_SECRET") as? String ?? ""
    }
}
