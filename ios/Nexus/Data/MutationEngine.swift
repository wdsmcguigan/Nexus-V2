import Foundation
import GRDB

/// Applies mutations to the local VaultDB and records them in the mutations table
/// for relay sync. Mirrors src-tauri/src/db/queries.rs apply_mutation().
final class MutationEngine {
    private let db: VaultDB
    private let vaultId: String
    private var deviceId: String = ""
    private var lamport: Int64 = 0

    init(db: VaultDB, vaultId: String) throws {
        self.db = db
        self.vaultId = vaultId
        self.deviceId = try db.fetchOrCreateDeviceId()
        self.lamport = try db.fetchLamport(vaultId: vaultId)
    }

    // MARK: - Apply

    func apply(kind: MutationKind, payload: [String: Any]) throws {
        lamport += 1
        let mutationId = UUID().uuidString
        let ts = Int64(Date().timeIntervalSince1970 * 1000)
        let payloadJson = (try? JSONSerialization.data(withJSONObject: payload))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"

        let mutation = NexusMutation(
            id: mutationId,
            vaultId: vaultId,
            kind: kind.rawValue,
            payloadJson: payloadJson,
            ts: ts,
            syncedAt: nil,
            deviceId: deviceId,
            lamport: lamport,
            relaySeq: nil
        )

        try applyToDb(kind: kind, payload: payload)
        try db.insertMutation(mutation)
    }

    // MARK: - DB application

    private func applyToDb(kind: MutationKind, payload: [String: Any]) throws {
        switch kind {
        case .MARK_READ:
            guard let msgId = payload["messageId"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET flags_read = 1 WHERE id = ?", arguments: [msgId])
            }
        case .MARK_UNREAD:
            guard let msgId = payload["messageId"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET flags_read = 0 WHERE id = ?", arguments: [msgId])
            }
        case .STAR:
            guard let msgId = payload["messageId"] as? String else { return }
            let star = payload["star"] as? String ?? "star"
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET star = ? WHERE id = ?", arguments: [star, msgId])
            }
        case .UNSTAR:
            guard let msgId = payload["messageId"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET star = NULL WHERE id = ?", arguments: [msgId])
            }
        case .PIN:
            guard let msgId = payload["messageId"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET pinned = 1 WHERE id = ?", arguments: [msgId])
            }
        case .UNPIN:
            guard let msgId = payload["messageId"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET pinned = 0 WHERE id = ?", arguments: [msgId])
            }
        case .MUTE:
            guard let msgId = payload["messageId"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET muted = 1 WHERE id = ?", arguments: [msgId])
            }
        case .UNMUTE:
            guard let msgId = payload["messageId"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET muted = 0 WHERE id = ?", arguments: [msgId])
            }
        case .TRASH:
            guard let msgId = payload["messageId"] as? String else { return }
            try db.dbQueue.write { db in
                // Move to trash folder (find system_kind='trash' folder)
                let trashFolderId = try Row.fetchOne(db,
                    sql: "SELECT id FROM folders WHERE vault_id = ? AND system_kind = 'trash' LIMIT 1",
                    arguments: [vaultId]
                ).map { $0["id"] as String }
                if let trashId = trashFolderId {
                    try db.execute(sql: "UPDATE messages SET folder_id = ? WHERE id = ?", arguments: [trashId, msgId])
                }
            }
        case .ARCHIVE:
            guard let msgId = payload["messageId"] as? String else { return }
            try db.dbQueue.write { db in
                let archiveFolderId = try Row.fetchOne(db,
                    sql: "SELECT id FROM folders WHERE vault_id = ? AND system_kind = 'archive' LIMIT 1",
                    arguments: [vaultId]
                ).map { $0["id"] as String }
                if let archiveId = archiveFolderId {
                    try db.execute(sql: "UPDATE messages SET folder_id = ? WHERE id = ?", arguments: [archiveId, msgId])
                }
            }
        case .MOVE_TO_FOLDER:
            guard let msgId = payload["messageId"] as? String,
                  let folderId = payload["folderId"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET folder_id = ? WHERE id = ?", arguments: [folderId, msgId])
            }
        case .ADD_LABEL:
            guard let msgId = payload["messageId"] as? String,
                  let labelId = payload["labelId"] as? String else { return }
            try db.addLabel(messageId: msgId, labelId: labelId)
        case .REMOVE_LABEL:
            guard let msgId = payload["messageId"] as? String,
                  let labelId = payload["labelId"] as? String else { return }
            try db.removeLabel(messageId: msgId, labelId: labelId)
        case .SET_STATUS:
            guard let msgId = payload["messageId"] as? String,
                  let statusId = payload["statusId"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET status_id = ? WHERE id = ?", arguments: [statusId, msgId])
            }
        case .CLEAR_STATUS:
            guard let msgId = payload["messageId"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET status_id = NULL WHERE id = ?", arguments: [msgId])
            }
        case .SET_PRIORITY:
            guard let msgId = payload["messageId"] as? String,
                  let priority = payload["priority"] as? Int else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET priority = ? WHERE id = ?", arguments: [priority, msgId])
            }
        case .CLEAR_PRIORITY:
            guard let msgId = payload["messageId"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET priority = NULL WHERE id = ?", arguments: [msgId])
            }
        case .ADD_TAG:
            guard let msgId = payload["messageId"] as? String,
                  let tag = payload["tag"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(
                    sql: "INSERT OR IGNORE INTO message_tags(message_id, tag) VALUES (?, ?)",
                    arguments: [msgId, tag]
                )
                try db.execute(
                    sql: """
                        INSERT INTO tag_usage(vault_id, tag, count, last_used_at) VALUES (?, ?, 1, ?)
                        ON CONFLICT(vault_id, tag) DO UPDATE SET count = count + 1, last_used_at = excluded.last_used_at
                        """,
                    arguments: [vaultId, tag, Int64(Date().timeIntervalSince1970 * 1000)]
                )
            }
        case .REMOVE_TAG:
            guard let msgId = payload["messageId"] as? String,
                  let tag = payload["tag"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(
                    sql: "DELETE FROM message_tags WHERE message_id = ? AND tag = ?",
                    arguments: [msgId, tag]
                )
            }
        case .SET_NOTES:
            guard let msgId = payload["messageId"] as? String,
                  let notes = payload["notes"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET notes = ? WHERE id = ?", arguments: [notes, msgId])
            }
        case .CLEAR_NOTES:
            guard let msgId = payload["messageId"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE messages SET notes = NULL WHERE id = ?", arguments: [msgId])
            }
        case .DELETE_MESSAGE:
            guard let msgId = payload["messageId"] as? String else { return }
            try db.deleteMessage(id: msgId)

        // Folder management
        case .CREATE_FOLDER:
            guard let id = payload["id"] as? String,
                  let name = payload["name"] as? String,
                  let diskSlug = payload["diskSlug"] as? String else { return }
            let folder = NexusFolder(
                id: id, vaultId: vaultId, parentId: payload["parentId"] as? String,
                name: name, diskSlug: diskSlug, color: payload["color"] as? Int,
                icon: payload["icon"] as? String, systemKind: nil,
                position: payload["position"] as? Int ?? 0
            )
            try db.upsertFolder(folder)
        case .RENAME_FOLDER:
            guard let id = payload["id"] as? String,
                  let name = payload["name"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE folders SET name = ? WHERE id = ?", arguments: [name, id])
            }
        case .DELETE_FOLDER:
            guard let id = payload["id"] as? String else { return }
            try db.deleteFolder(id: id)

        // Label management
        case .CREATE_LABEL:
            guard let id = payload["id"] as? String,
                  let name = payload["name"] as? String else { return }
            let label = NexusLabel(
                id: id, vaultId: vaultId, name: name,
                color: payload["color"] as? Int ?? 1,
                kind: "user", systemKind: nil,
                parentId: payload["parentId"] as? String,
                position: payload["position"] as? Int ?? 0,
                providerId: nil
            )
            try db.upsertLabel(label)
        case .RENAME_LABEL:
            guard let id = payload["id"] as? String,
                  let name = payload["name"] as? String else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE labels SET name = ? WHERE id = ?", arguments: [name, id])
            }
        case .DELETE_LABEL:
            guard let id = payload["id"] as? String else { return }
            try db.deleteLabel(id: id)
        case .RECOLOR_LABEL:
            guard let id = payload["id"] as? String,
                  let color = payload["color"] as? Int else { return }
            try db.dbQueue.write { db in
                try db.execute(sql: "UPDATE labels SET color = ? WHERE id = ?", arguments: [color, id])
            }

        // Statuses
        case .CREATE_STATUS, .UPDATE_STATUS:
            guard let id = payload["id"] as? String,
                  let name = payload["name"] as? String else { return }
            let status = NexusStatus(
                id: id, vaultId: vaultId, name: name,
                color: payload["color"] as? Int ?? 1,
                position: payload["position"] as? Int ?? 0,
                isDefault: payload["isDefault"] as? Bool ?? false,
                isTerminal: payload["isTerminal"] as? Bool ?? false
            )
            try db.upsertStatus(status)
        case .DELETE_STATUS:
            guard let id = payload["id"] as? String else { return }
            try db.deleteStatus(id: id)

        // Contacts
        case .CREATE_CONTACT, .UPDATE_CONTACT:
            guard let id = payload["id"] as? String,
                  let name = payload["name"] as? String else { return }
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            let contact = NexusContact(
                id: id, vaultId: vaultId, name: name,
                company: payload["company"] as? String,
                title: payload["title"] as? String,
                website: payload["website"] as? String,
                location: payload["location"] as? String,
                notes: payload["notes"] as? String,
                tagsJson: "[]",
                createdAt: now, updatedAt: now
            )
            try db.upsertContact(contact)
        case .DELETE_CONTACT:
            guard let id = payload["id"] as? String else { return }
            try db.deleteContact(id: id)

        // Rules
        case .CREATE_RULE, .UPDATE_RULE:
            guard let ruleDict = payload["rule"] as? [String: Any],
                  let id = ruleDict["id"] as? String,
                  let name = ruleDict["name"] as? String else { return }
            let conditionsData = try JSONSerialization.data(withJSONObject: ruleDict["conditions"] ?? [])
            let actionsData = try JSONSerialization.data(withJSONObject: ruleDict["actions"] ?? [])
            let rule = NexusRule(
                id: id, vaultId: vaultId, name: name,
                conditionsJson: String(data: conditionsData, encoding: .utf8) ?? "[]",
                conditionLogic: ruleDict["conditionLogic"] as? String ?? "AND",
                actionsJson: String(data: actionsData, encoding: .utf8) ?? "[]",
                enabled: ruleDict["enabled"] as? Bool ?? true,
                position: ruleDict["position"] as? Int ?? 0
            )
            try db.upsertRule(rule)
        case .DELETE_RULE:
            guard let id = payload["id"] as? String else { return }
            try db.deleteRule(id: id)

        // Templates
        case .CREATE_TEMPLATE, .UPDATE_TEMPLATE:
            guard let tmplDict = payload["template"] as? [String: Any],
                  let id = tmplDict["id"] as? String,
                  let name = tmplDict["name"] as? String else { return }
            let template = NexusTemplate(
                id: id, vaultId: vaultId, name: name,
                subject: tmplDict["subject"] as? String ?? "",
                bodyHtml: tmplDict["bodyHtml"] as? String ?? "",
                createdAt: tmplDict["createdAt"] as? Int64 ?? Int64(Date().timeIntervalSince1970 * 1000)
            )
            try db.upsertTemplate(template)
        case .DELETE_TEMPLATE:
            guard let id = payload["id"] as? String else { return }
            try db.deleteTemplate(id: id)

        default:
            // Other mutation kinds (SEND_MESSAGE etc.) handled by sync layer
            break
        }
    }
}
