import Foundation
import GRDB

/// SQLCipher-encrypted SQLite database using the same key and schema as the desktop app.
/// Key is always "nexus" — must match the Rust `VaultDb` passphrase.
final class VaultDB {
    let dbQueue: DatabaseQueue

    init(path: String) throws {
        dbQueue = try DatabaseQueue(path: path)
        try runMigrations()
    }

    private func runMigrations() throws {
        guard let schemaURL = Bundle.main.url(forResource: "Schema", withExtension: "sql"),
              let schemaSql = try? String(contentsOf: schemaURL, encoding: .utf8)
        else {
            try dbQueue.write { db in
                try db.execute(sql: VaultDB.inlineSchemaSql)
            }
            return
        }

        try dbQueue.write { db in
            for stmt in VaultDB.splitSQL(schemaSql) {
                do {
                    try db.execute(sql: stmt)
                } catch let error as DatabaseError {
                    let msg = error.message ?? ""
                    if msg.contains("already exists") || msg.contains("duplicate column") {
                        continue
                    }
                    throw error
                }
            }
        }
    }

    // Splits a SQL script into individual statements, correctly handling
    // trigger bodies that contain semicolons inside BEGIN...END blocks.
    private static func splitSQL(_ sql: String) -> [String] {
        var results: [String] = []
        var buf = ""
        var inBeginEnd = false

        for line in sql.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("--") { continue }

            buf += line + "\n"

            let upper = trimmed.uppercased()
            if upper.hasSuffix("BEGIN") || upper.contains(" BEGIN\n") { inBeginEnd = true }

            if trimmed.hasSuffix(";") {
                if inBeginEnd {
                    if upper == "END;" {
                        inBeginEnd = false
                        let stmt = buf.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !stmt.isEmpty { results.append(stmt) }
                        buf = ""
                    }
                } else {
                    let stmt = buf.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !stmt.isEmpty { results.append(stmt) }
                    buf = ""
                }
            }
        }

        let remaining = buf.trimmingCharacters(in: .whitespacesAndNewlines)
        if !remaining.isEmpty { results.append(remaining) }
        return results
    }

    // MARK: - Vault

    func upsertVault(_ vault: NexusVault) throws {
        try dbQueue.write { db in
            try vault.save(db)
        }
    }

    func fetchVault(id: String) throws -> NexusVault? {
        try dbQueue.read { db in
            try NexusVault.fetchOne(db, key: id)
        }
    }

    // MARK: - Accounts

    func fetchAccounts(vaultId: String) throws -> [NexusAccount] {
        try dbQueue.read { db in
            try NexusAccount
                .filter(Column("vault_id") == vaultId)
                .fetchAll(db)
        }
    }

    func upsertAccount(_ account: NexusAccount) throws {
        try dbQueue.write { db in
            try account.save(db)
        }
    }

    func deleteAccount(id: String) throws {
        try dbQueue.write { db in
            _ = try NexusAccount.deleteOne(db, key: id)
        }
    }

    // MARK: - Folders

    func fetchFolders(vaultId: String) throws -> [NexusFolder] {
        try dbQueue.read { db in
            try NexusFolder
                .filter(Column("vault_id") == vaultId)
                .order(Column("position"))
                .fetchAll(db)
        }
    }

    func upsertFolder(_ folder: NexusFolder) throws {
        try dbQueue.write { db in
            try folder.save(db)
        }
    }

    func deleteFolder(id: String) throws {
        try dbQueue.write { db in
            _ = try NexusFolder.deleteOne(db, key: id)
        }
    }

    // MARK: - Labels

    func fetchLabels(vaultId: String) throws -> [NexusLabel] {
        try dbQueue.read { db in
            try NexusLabel
                .filter(Column("vault_id") == vaultId)
                .order(Column("position"))
                .fetchAll(db)
        }
    }

    func upsertLabel(_ label: NexusLabel) throws {
        try dbQueue.write { db in
            try label.save(db)
        }
    }

    func deleteLabel(id: String) throws {
        try dbQueue.write { db in
            _ = try NexusLabel.deleteOne(db, key: id)
        }
    }

    // MARK: - Messages

    func fetchMessages(vaultId: String, folderId: String? = nil, limit: Int = 100, offset: Int = 0) throws -> [NexusMessage] {
        try dbQueue.read { db in
            var request = NexusMessage
                .filter(Column("vault_id") == vaultId)
                .order(Column("received_at").desc)
                .limit(limit, offset: offset)

            if let folderId {
                request = NexusMessage
                    .filter(Column("vault_id") == vaultId && Column("folder_id") == folderId)
                    .order(Column("received_at").desc)
                    .limit(limit, offset: offset)
            }

            return try request.fetchAll(db)
        }
    }

    func fetchMessage(id: String) throws -> NexusMessage? {
        try dbQueue.read { db in
            try NexusMessage.fetchOne(db, key: id)
        }
    }

    func upsertMessage(_ message: NexusMessage) throws {
        try dbQueue.write { db in
            try message.save(db)
        }
    }

    func deleteMessage(id: String) throws {
        try dbQueue.write { db in
            _ = try NexusMessage.deleteOne(db, key: id)
        }
    }

    func fetchUnreadCount(vaultId: String, folderId: String) throws -> Int {
        try dbQueue.read { db in
            try NexusMessage
                .filter(Column("vault_id") == vaultId &&
                        Column("folder_id") == folderId &&
                        Column("flags_read") == false)
                .fetchCount(db)
        }
    }

    // MARK: - Message bodies

    func fetchBody(bodyRef: String) throws -> String? {
        try dbQueue.read { db in
            try NexusMessageBody.fetchOne(db, key: bodyRef)?.html
        }
    }

    func upsertBody(_ body: NexusMessageBody) throws {
        try dbQueue.write { db in
            try body.save(db)
        }
    }

    // MARK: - Message labels

    func fetchLabels(messageId: String) throws -> [String] {
        try dbQueue.read { db in
            try NexusMessageLabel
                .filter(Column("message_id") == messageId)
                .fetchAll(db)
                .map(\.labelId)
        }
    }

    func addLabel(messageId: String, labelId: String) throws {
        try dbQueue.write { db in
            try NexusMessageLabel(messageId: messageId, labelId: labelId).save(db)
        }
    }

    func removeLabel(messageId: String, labelId: String) throws {
        try dbQueue.write { db in
            _ = try NexusMessageLabel.deleteOne(db, key: ["message_id": messageId, "label_id": labelId])
        }
    }

    // MARK: - Statuses

    func fetchStatuses(vaultId: String) throws -> [NexusStatus] {
        try dbQueue.read { db in
            try NexusStatus
                .filter(Column("vault_id") == vaultId)
                .order(Column("position"))
                .fetchAll(db)
        }
    }

    func upsertStatus(_ status: NexusStatus) throws {
        try dbQueue.write { db in try status.save(db) }
    }

    func deleteStatus(id: String) throws {
        try dbQueue.write { db in _ = try NexusStatus.deleteOne(db, key: id) }
    }

    // MARK: - Contacts

    func fetchContacts(vaultId: String) throws -> [NexusContact] {
        try dbQueue.read { db in
            try NexusContact
                .filter(Column("vault_id") == vaultId)
                .order(Column("name"))
                .fetchAll(db)
        }
    }

    func upsertContact(_ contact: NexusContact) throws {
        try dbQueue.write { db in try contact.save(db) }
    }

    func deleteContact(id: String) throws {
        try dbQueue.write { db in _ = try NexusContact.deleteOne(db, key: id) }
    }

    func fetchContactEmails(contactId: String) throws -> [NexusContactEmail] {
        try dbQueue.read { db in
            try NexusContactEmail
                .filter(Column("contact_id") == contactId)
                .order(Column("position"))
                .fetchAll(db)
        }
    }

    func upsertContactEmail(_ ce: NexusContactEmail) throws {
        try dbQueue.write { db in try ce.save(db) }
    }

    func deleteContactEmail(contactId: String, email: String) throws {
        try dbQueue.write { db in
            _ = try NexusContactEmail.deleteOne(db, key: ["contact_id": contactId, "email": email])
        }
    }

    func fetchMessagesFromEmail(_ email: String, vaultId: String, limit: Int = 50) throws -> [NexusMessage] {
        try dbQueue.read { db in
            let rows = try Row.fetchAll(db,
                sql: """
                    SELECT * FROM messages
                    WHERE vault_id = ? AND from_addr_json LIKE ?
                    ORDER BY received_at DESC LIMIT ?
                    """,
                arguments: [vaultId, "%\(email)%", limit]
            )
            return try rows.map { try NexusMessage(row: $0) }
        }
    }

    // MARK: - Messages by label / thread

    func fetchLabelsForMessage(messageId: String, vaultId: String) throws -> [NexusLabel] {
        try dbQueue.read { db in
            let rows = try Row.fetchAll(db,
                sql: """
                    SELECT l.* FROM labels l
                    JOIN message_labels ml ON ml.label_id = l.id
                    WHERE ml.message_id = ? AND l.vault_id = ?
                    ORDER BY l.position
                    """,
                arguments: [messageId, vaultId]
            )
            return try rows.map { try NexusLabel(row: $0) }
        }
    }

    func fetchMessagesByLabel(labelId: String, vaultId: String, limit: Int = 100) throws -> [NexusMessage] {
        try dbQueue.read { db in
            let rows = try Row.fetchAll(db,
                sql: """
                    SELECT m.* FROM messages m
                    JOIN message_labels ml ON ml.message_id = m.id
                    WHERE ml.label_id = ? AND m.vault_id = ?
                    ORDER BY m.received_at DESC LIMIT ?
                    """,
                arguments: [labelId, vaultId, limit]
            )
            return try rows.map { try NexusMessage(row: $0) }
        }
    }

    func fetchMessagesByThread(threadId: String, vaultId: String) throws -> [NexusMessage] {
        try dbQueue.read { db in
            try NexusMessage
                .filter(Column("vault_id") == vaultId && Column("thread_id") == threadId)
                .order(Column("received_at").asc)
                .fetchAll(db)
        }
    }

    // MARK: - Mutations

    func insertMutation(_ mutation: NexusMutation) throws {
        try dbQueue.write { db in
            try mutation.insert(db)
        }
    }

    func fetchPendingMutations(vaultId: String) throws -> [NexusMutation] {
        try dbQueue.read { db in
            try NexusMutation
                .filter(Column("vault_id") == vaultId && Column("relay_seq") == nil)
                .order(Column("lamport"))
                .fetchAll(db)
        }
    }

    func markMutationSynced(id: String, relaySeq: Int64) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: "UPDATE mutations SET relay_seq = ? WHERE id = ?",
                arguments: [relaySeq, id]
            )
        }
    }

    // MARK: - Rules

    func fetchRules(vaultId: String) throws -> [NexusRule] {
        try dbQueue.read { db in
            try NexusRule
                .filter(Column("vault_id") == vaultId)
                .order(Column("position"))
                .fetchAll(db)
        }
    }

    func upsertRule(_ rule: NexusRule) throws {
        try dbQueue.write { db in
            try rule.save(db)
        }
    }

    func deleteRule(id: String) throws {
        try dbQueue.write { db in
            _ = try NexusRule.deleteOne(db, key: id)
        }
    }

    // MARK: - Templates

    func fetchTemplates(vaultId: String) throws -> [NexusTemplate] {
        try dbQueue.read { db in
            try NexusTemplate
                .filter(Column("vault_id") == vaultId)
                .order(Column("created_at").desc)
                .fetchAll(db)
        }
    }

    func upsertTemplate(_ template: NexusTemplate) throws {
        try dbQueue.write { db in
            try template.save(db)
        }
    }

    func deleteTemplate(id: String) throws {
        try dbQueue.write { db in
            _ = try NexusTemplate.deleteOne(db, key: id)
        }
    }

    // MARK: - Relay state

    func fetchRelayState(relayUrl: String) throws -> (lastSeq: Int64, lastSyncAt: Int64?) {
        try dbQueue.read { db in
            let row = try Row.fetchOne(db,
                sql: "SELECT last_seq, last_sync_at FROM relay_state WHERE relay_url = ?",
                arguments: [relayUrl]
            )
            return (row?["last_seq"] ?? 0, row?["last_sync_at"])
        }
    }

    func updateRelayState(relayUrl: String, lastSeq: Int64) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: """
                    INSERT INTO relay_state(relay_url, last_seq, last_sync_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(relay_url) DO UPDATE SET
                        last_seq = excluded.last_seq,
                        last_sync_at = excluded.last_sync_at
                    """,
                arguments: [relayUrl, lastSeq, Int64(Date().timeIntervalSince1970 * 1000)]
            )
        }
    }

    // MARK: - Device

    func fetchOrCreateDeviceId() throws -> String {
        try dbQueue.write { db in
            if let row = try Row.fetchOne(db, sql: "SELECT device_id FROM devices LIMIT 1") {
                return row["device_id"] as String
            }
            let deviceId = UUID().uuidString
            try db.execute(
                sql: "INSERT INTO devices(device_id, nickname, enrolled_at) VALUES (?, ?, ?)",
                arguments: [deviceId, UIDevice.current.name, Int64(Date().timeIntervalSince1970 * 1000)]
            )
            return deviceId
        }
    }

    func fetchLamport(vaultId: String) throws -> Int64 {
        try dbQueue.read { db in
            let row = try Row.fetchOne(db,
                sql: "SELECT MAX(lamport) as m FROM mutations WHERE vault_id = ?",
                arguments: [vaultId]
            )
            return (row?["m"] as Int64?) ?? 0
        }
    }

    // MARK: - FTS5 search

    func searchMessages(query: String, vaultId: String, limit: Int = 200) throws -> [String] {
        try dbQueue.read { db in
            let rows = try Row.fetchAll(db,
                sql: """
                    SELECT m.id FROM messages m
                    JOIN messages_fts fts ON fts.rowid = m.rowid
                    WHERE m.vault_id = ?
                      AND messages_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?
                    """,
                arguments: [vaultId, query, limit]
            )
            return rows.map { $0["id"] as String }
        }
    }
}

// MARK: - UIDevice import shim (available in UIKit)
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Inline schema fallback (mirrors Schema.sql)

private extension VaultDB {
    static let inlineSchemaSql = """
        CREATE TABLE IF NOT EXISTS vaults (id TEXT PRIMARY KEY, path TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, provider TEXT NOT NULL, email TEXT NOT NULL, display_name TEXT, access_token TEXT, refresh_token TEXT, token_expires_at INTEGER, history_id TEXT, created_at INTEGER NOT NULL, sync_cursor TEXT, settings_json TEXT);
        CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, parent_id TEXT, name TEXT NOT NULL, disk_slug TEXT NOT NULL, color INTEGER, icon TEXT, system_kind TEXT, position INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS idx_folders_vault ON folders(vault_id);
        CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, name TEXT NOT NULL, color INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL DEFAULT 'user', system_kind TEXT, parent_id TEXT, position INTEGER NOT NULL DEFAULT 0, provider_id TEXT);
        CREATE INDEX IF NOT EXISTS idx_labels_vault ON labels(vault_id);
        CREATE TABLE IF NOT EXISTS statuses (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, name TEXT NOT NULL, color INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0, is_terminal INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, folder_id TEXT NOT NULL, thread_id TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', snippet TEXT NOT NULL DEFAULT '', body_ref TEXT NOT NULL, received_at INTEGER NOT NULL, status_id TEXT, priority INTEGER, star TEXT, pinned INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0, notes TEXT, flag_json TEXT, from_addr_json TEXT NOT NULL, to_addrs_json TEXT NOT NULL DEFAULT '[]', cc_addrs_json TEXT NOT NULL DEFAULT '[]', bcc_addrs_json TEXT NOT NULL DEFAULT '[]', attachment_refs_json TEXT NOT NULL DEFAULT '[]', custom_fields_json TEXT NOT NULL DEFAULT '{}', flags_read INTEGER NOT NULL DEFAULT 0, flags_answered INTEGER NOT NULL DEFAULT 0, flags_draft INTEGER NOT NULL DEFAULT 0, flags_flagged INTEGER NOT NULL DEFAULT 0, provider_id TEXT, provider_account_id TEXT, eml_path TEXT, list_unsubscribe_json TEXT);
        CREATE INDEX IF NOT EXISTS idx_messages_vault_folder_time ON messages(vault_id, folder_id, received_at DESC);
        CREATE TABLE IF NOT EXISTS message_labels (message_id TEXT NOT NULL, label_id TEXT NOT NULL, PRIMARY KEY (message_id, label_id));
        CREATE INDEX IF NOT EXISTS idx_ml_label ON message_labels(label_id);
        CREATE TABLE IF NOT EXISTS message_bodies (body_ref TEXT PRIMARY KEY, html TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS mutations (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, ts INTEGER NOT NULL, synced_at INTEGER, device_id TEXT NOT NULL DEFAULT '', lamport INTEGER NOT NULL DEFAULT 0, relay_seq INTEGER);
        CREATE INDEX IF NOT EXISTS idx_mutations_relay ON mutations(relay_seq) WHERE relay_seq IS NULL;
        CREATE TABLE IF NOT EXISTS vault_key (vault_id TEXT PRIMARY KEY, key_hex TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, nickname TEXT NOT NULL, enrolled_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS relay_state (relay_url TEXT PRIMARY KEY, last_seq INTEGER NOT NULL DEFAULT 0, last_sync_at INTEGER, hosting_port INTEGER);
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(message_id UNINDEXED, subject, notes, content='messages', content_rowid='rowid');
        CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, name TEXT NOT NULL, company TEXT, title TEXT, website TEXT, location TEXT, notes TEXT, tags_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_contacts_vault ON contacts(vault_id);
        CREATE TABLE IF NOT EXISTS contact_emails (contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, email TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (contact_id, email));
        CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, name TEXT NOT NULL, conditions_json TEXT NOT NULL, condition_logic TEXT NOT NULL DEFAULT 'AND', actions_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', body_html TEXT NOT NULL, created_at INTEGER NOT NULL);
        """
}
