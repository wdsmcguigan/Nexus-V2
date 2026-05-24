import Foundation
import GRDB

/// Syncs Gmail messages using the Gmail API History endpoint.
/// Mirrors the logic in src-tauri/src/gmail/sync.rs.
final class GmailSync {
    private let db: VaultDB
    private let vaultId: String
    private let auth: GmailAuth

    init(db: VaultDB, vaultId: String, auth: GmailAuth) {
        self.db = db
        self.vaultId = vaultId
        self.auth = auth
    }

    // MARK: - Full sync (first run)

    func fullSync(account: NexusAccount) async throws -> SyncStats {
        let accessToken = try await resolvedAccessToken(account: account)
        var stats = SyncStats()

        // List messages (first 500)
        var nextPageToken: String? = nil
        repeat {
            let (messageRefs, pageToken) = try await listMessages(
                accessToken: accessToken,
                pageToken: nextPageToken
            )
            nextPageToken = pageToken

            // Batch fetch messages (100 at a time)
            let chunks = stride(from: 0, to: messageRefs.count, by: 100).map {
                Array(messageRefs[$0..<min($0 + 100, messageRefs.count)])
            }
            for chunk in chunks {
                let fetched = try await batchFetchMessages(accessToken: accessToken, ids: chunk.map { $0.id })
                for msg in fetched {
                    try await upsertParsedMessage(msg, accountId: account.id)
                    stats.fetched += 1
                }
            }
        } while nextPageToken != nil && stats.fetched < 1000

        // Store historyId for incremental sync
        if let historyId = try await fetchHistoryId(accessToken: accessToken) {
            try await db.dbQueue.write { db in
                try db.execute(
                    sql: "UPDATE accounts SET history_id = ? WHERE id = ?",
                    arguments: [historyId, account.id]
                )
            }
        }

        return stats
    }

    // MARK: - Incremental sync (History API)

    func incrementalSync(account: NexusAccount) async throws -> SyncStats {
        guard let historyId = account.historyId else {
            return try await fullSync(account: account)
        }

        let accessToken = try await resolvedAccessToken(account: account)
        var stats = SyncStats()

        let (historyItems, newHistoryId) = try await fetchHistory(
            accessToken: accessToken,
            startHistoryId: historyId
        )

        for item in historyItems {
            for added in item.messagesAdded ?? [] {
                if let msg = try? await fetchMessage(accessToken: accessToken, id: added.message.id) {
                    try await upsertParsedMessage(msg, accountId: account.id)
                    stats.fetched += 1
                }
            }
            for deleted in item.messagesDeleted ?? [] {
                // Look up by providerId and delete
                try await db.dbQueue.write { [weak self] db in
                    guard let self else { return }
                    try db.execute(
                        sql: "DELETE FROM messages WHERE provider_account_id = ? AND provider_id = ?",
                        arguments: [account.id, deleted.message.id]
                    )
                }
            }
            for labelsChanged in item.labelsAdded ?? [] {
                try await syncLabels(
                    accessToken: accessToken,
                    providerId: labelsChanged.message.id,
                    accountId: account.id,
                    labelIds: labelsChanged.labelIds
                )
            }
        }

        if !newHistoryId.isEmpty {
            try await db.dbQueue.write { db in
                try db.execute(
                    sql: "UPDATE accounts SET history_id = ? WHERE id = ?",
                    arguments: [newHistoryId, account.id]
                )
            }
        }

        return stats
    }

    // MARK: - Private helpers

    private func resolvedAccessToken(account: NexusAccount) async throws -> String {
        let now = Date()
        if let expiresAt = account.tokenExpiresAt,
           Date(timeIntervalSince1970: TimeInterval(expiresAt) / 1000) > now.addingTimeInterval(60),
           let token = account.accessToken {
            return token
        }
        guard let refreshToken = try KeychainStore.load(key: KeychainStore.refreshTokenKey(accountId: account.id))
        else {
            throw GmailSyncError.noRefreshToken
        }
        let (newToken, expiresAt) = try await auth.refreshAccessToken(refreshToken: refreshToken)
        try KeychainStore.save(key: KeychainStore.accessTokenKey(accountId: account.id), value: newToken)
        let expiresAtMs = Int64(expiresAt.timeIntervalSince1970 * 1000)
        try await db.dbQueue.write { db in
            try db.execute(
                sql: "UPDATE accounts SET token_expires_at = ? WHERE id = ?",
                arguments: [expiresAtMs, account.id]
            )
        }
        return newToken
    }

    private func listMessages(
        accessToken: String,
        pageToken: String?,
        maxResults: Int = 200
    ) async throws -> (messages: [MessageRef], nextPageToken: String?) {
        var urlStr = "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=\(maxResults)"
        if let pageToken { urlStr += "&pageToken=\(pageToken)" }

        var request = URLRequest(url: URL(string: urlStr)!)
        request.addValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        let messages = (json?["messages"] as? [[String: Any]])?.compactMap { dict -> MessageRef? in
            guard let id = dict["id"] as? String else { return nil }
            return MessageRef(id: id)
        } ?? []
        return (messages, json?["nextPageToken"] as? String)
    }

    private func batchFetchMessages(accessToken: String, ids: [String]) async throws -> [ParsedGmailMessage] {
        // Use batch endpoint or individual fetches for simplicity
        var results: [ParsedGmailMessage] = []
        try await withThrowingTaskGroup(of: ParsedGmailMessage?.self) { group in
            for id in ids {
                group.addTask {
                    try? await self.fetchMessage(accessToken: accessToken, id: id)
                }
            }
            for try await msg in group {
                if let msg { results.append(msg) }
            }
        }
        return results
    }

    private func fetchMessage(accessToken: String, id: String) async throws -> ParsedGmailMessage {
        let urlStr = "https://gmail.googleapis.com/gmail/v1/users/me/messages/\(id)?format=full"
        var request = URLRequest(url: URL(string: urlStr)!)
        request.addValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: request)
        return try parseGmailMessage(data: data)
    }

    private func fetchHistoryId(accessToken: String) async throws -> String? {
        var request = URLRequest(url: URL(string: "https://gmail.googleapis.com/gmail/v1/users/me/profile")!)
        request.addValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return json?["historyId"] as? String
    }

    private func fetchHistory(
        accessToken: String,
        startHistoryId: String
    ) async throws -> (items: [HistoryItem], newHistoryId: String) {
        let urlStr = "https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=\(startHistoryId)"
        var request = URLRequest(url: URL(string: urlStr)!)
        request.addValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        let items = (json?["history"] as? [[String: Any]])?.map { parseHistoryItem($0) } ?? []
        return (items, json?["historyId"] as? String ?? startHistoryId)
    }

    private func upsertParsedMessage(_ msg: ParsedGmailMessage, accountId: String) async throws {
        // Find or create inbox folder
        let inboxFolderId = try findOrCreateInboxFolder()

        let bodyRef = "gmail-\(msg.id)"
        let messageId = "msg-\(msg.id)"

        let fromJson = try JSONSerialization.data(withJSONObject: ["name": msg.fromName, "email": msg.fromEmail])
        let toJson = try JSONSerialization.data(withJSONObject: msg.toAddrs.map { ["name": $0.name, "email": $0.email] })

        let message = NexusMessage(
            id: messageId,
            vaultId: vaultId,
            folderId: inboxFolderId,
            threadId: "thread-\(msg.threadId)",
            subject: msg.subject,
            snippet: msg.snippet,
            bodyRef: bodyRef,
            receivedAt: msg.receivedAt,
            statusId: nil, priority: nil, star: nil,
            pinned: false, muted: false, notes: nil, flagJson: nil,
            fromAddrJson: String(data: fromJson, encoding: .utf8) ?? "{}",
            toAddrsJson: String(data: toJson, encoding: .utf8) ?? "[]",
            ccAddrsJson: "[]", bccAddrsJson: "[]",
            attachmentRefsJson: "[]", customFieldsJson: "{}",
            flagsRead: msg.isRead,
            flagsAnswered: false, flagsDraft: false, flagsFlagged: false,
            providerId: msg.id,
            providerAccountId: accountId,
            emlPath: nil,
            listUnsubscribeJson: msg.listUnsubscribe
        )

        try db.upsertMessage(message)

        if let html = msg.bodyHtml {
            try db.upsertBody(NexusMessageBody(bodyRef: bodyRef, html: html))
        }
    }

    private func findOrCreateInboxFolder() throws -> String {
        try db.dbQueue.write { db in
            if let row = try Row.fetchOne(db,
                sql: "SELECT id FROM folders WHERE vault_id = ? AND system_kind = 'inbox' LIMIT 1",
                arguments: [vaultId]) {
                return row["id"] as String
            }
            let folderId = "folder-inbox-\(vaultId.prefix(8))"
            try db.execute(
                sql: """
                    INSERT OR IGNORE INTO folders(id, vault_id, parent_id, name, disk_slug, system_kind, position)
                    VALUES (?, ?, NULL, 'Inbox', 'inbox', 'inbox', 0)
                    """,
                arguments: [folderId, vaultId]
            )
            return folderId
        }
    }

    private func syncLabels(accessToken: String, providerId: String, accountId: String, labelIds: [String]) async throws {
        // Simplified: just mark read if UNREAD removed
        if !labelIds.contains("UNREAD") {
            try await db.dbQueue.write { db in
                try db.execute(
                    sql: "UPDATE messages SET flags_read = 1 WHERE provider_account_id = ? AND provider_id = ?",
                    arguments: [accountId, providerId]
                )
            }
        }
    }

    // MARK: - Message parsing

    private func parseGmailMessage(data: Data) throws -> ParsedGmailMessage {
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let id = json?["id"] as? String else {
            throw GmailSyncError.parseError("Missing message id")
        }

        let headers = extractHeaders(json: json)
        let subject = headers["Subject"] ?? "(no subject)"
        let fromRaw = headers["From"] ?? ""
        let (fromName, fromEmail) = parseAddress(fromRaw)
        let toRaw = headers["To"] ?? ""
        let toAddrs = [toRaw].filter { !$0.isEmpty }.map { raw -> EmailAddress in
            let (name, email) = parseAddress(raw)
            return EmailAddress(name: name, email: email)
        }

        let labelIds = json?["labelIds"] as? [String] ?? []
        let isRead = !labelIds.contains("UNREAD")
        let internalDate = Int64(json?["internalDate"] as? String ?? "0") ?? 0
        let snippet = json?["snippet"] as? String ?? ""
        let threadId = json?["threadId"] as? String ?? id
        let listUnsubscribe = headers["List-Unsubscribe"]
        let bodyHtml = extractBody(json: json)

        return ParsedGmailMessage(
            id: id,
            threadId: threadId,
            subject: subject,
            snippet: snippet,
            fromName: fromName,
            fromEmail: fromEmail,
            toAddrs: toAddrs,
            isRead: isRead,
            receivedAt: internalDate,
            bodyHtml: bodyHtml,
            listUnsubscribe: listUnsubscribe.map { "{\"header\":\"\($0)\"}" }
        )
    }

    private func extractHeaders(json: [String: Any]?) -> [String: String] {
        let payload = json?["payload"] as? [String: Any]
        let headers = payload?["headers"] as? [[String: Any]] ?? []
        return Dictionary(
            headers.compactMap { h -> (String, String)? in
                guard let name = h["name"] as? String,
                      let value = h["value"] as? String else { return nil }
                return (name, value)
            },
            uniquingKeysWith: { first, _ in first }
        )
    }

    private func extractBody(json: [String: Any]?) -> String? {
        let payload = json?["payload"] as? [String: Any]
        return findHtmlPart(in: payload)
    }

    private func findHtmlPart(in payload: [String: Any]?) -> String? {
        guard let payload else { return nil }
        let mimeType = payload["mimeType"] as? String ?? ""

        if mimeType == "text/html" {
            if let b64 = (payload["body"] as? [String: Any])?["data"] as? String {
                return decodeBase64(b64)
            }
        }

        let parts = payload["parts"] as? [[String: Any]] ?? []
        for part in parts {
            if let found = findHtmlPart(in: part) { return found }
        }
        return nil
    }

    private func decodeBase64(_ b64: String) -> String? {
        let fixed = b64.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        guard let data = Data(base64Encoded: fixed, options: .ignoreUnknownCharacters) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func parseAddress(_ raw: String) -> (name: String, email: String) {
        if raw.contains("<") {
            let parts = raw.components(separatedBy: "<")
            let name = parts[0].trimmingCharacters(in: .init(charactersIn: " \""))
            let email = parts[1].replacingOccurrences(of: ">", with: "").trimmingCharacters(in: .whitespaces)
            return (name, email)
        }
        return ("", raw.trimmingCharacters(in: .whitespaces))
    }

    private func parseHistoryItem(_ dict: [String: Any]) -> HistoryItem {
        HistoryItem(
            messagesAdded: (dict["messagesAdded"] as? [[String: Any]])?.map {
                HistoryMessage(message: MessageRef(id: ($0["message"] as? [String: Any])?["id"] as? String ?? ""))
            },
            messagesDeleted: (dict["messagesDeleted"] as? [[String: Any]])?.map {
                HistoryMessage(message: MessageRef(id: ($0["message"] as? [String: Any])?["id"] as? String ?? ""))
            },
            labelsAdded: (dict["labelsAdded"] as? [[String: Any]])?.map {
                HistoryLabelChange(
                    message: MessageRef(id: ($0["message"] as? [String: Any])?["id"] as? String ?? ""),
                    labelIds: $0["labelIds"] as? [String] ?? []
                )
            }
        )
    }
}

// MARK: - Supporting types

struct SyncStats {
    var fetched: Int = 0
    var inserted: Int = 0
    var updated: Int = 0
}

struct MessageRef { var id: String }

struct ParsedGmailMessage {
    var id: String
    var threadId: String
    var subject: String
    var snippet: String
    var fromName: String
    var fromEmail: String
    var toAddrs: [EmailAddress]
    var isRead: Bool
    var receivedAt: Int64
    var bodyHtml: String?
    var listUnsubscribe: String?
}

struct HistoryItem {
    var messagesAdded: [HistoryMessage]?
    var messagesDeleted: [HistoryMessage]?
    var labelsAdded: [HistoryLabelChange]?
}

struct HistoryMessage { var message: MessageRef }
struct HistoryLabelChange { var message: MessageRef; var labelIds: [String] }

enum GmailSyncError: Error {
    case noRefreshToken
    case parseError(String)
}
