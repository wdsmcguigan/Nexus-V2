import Foundation
import GRDB

// MARK: - Address

struct EmailAddress: Codable {
    var name: String
    var email: String
}

// MARK: - Vault

struct NexusVault: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "vaults"
    var id: String
    var path: String
    var createdAt: Int64

    enum CodingKeys: String, CodingKey {
        case id, path
        case createdAt = "created_at"
    }
}

// MARK: - Account

struct NexusAccount: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "accounts"
    var id: String
    var vaultId: String
    var provider: String  // "gmail" | "imap" | "jmap"
    var email: String
    var displayName: String?
    var accessToken: String?
    var refreshToken: String?
    var tokenExpiresAt: Int64?
    var historyId: String?
    var createdAt: Int64
    var syncCursor: String?
    var settingsJson: String?

    enum CodingKeys: String, CodingKey {
        case id
        case vaultId = "vault_id"
        case provider, email
        case displayName = "display_name"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case tokenExpiresAt = "token_expires_at"
        case historyId = "history_id"
        case createdAt = "created_at"
        case syncCursor = "sync_cursor"
        case settingsJson = "settings_json"
    }
}

// MARK: - Folder

struct NexusFolder: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "folders"
    var id: String
    var vaultId: String
    var parentId: String?
    var name: String
    var diskSlug: String
    var color: Int?
    var icon: String?
    var systemKind: String?
    var position: Int

    enum CodingKeys: String, CodingKey {
        case id
        case vaultId = "vault_id"
        case parentId = "parent_id"
        case name
        case diskSlug = "disk_slug"
        case color, icon
        case systemKind = "system_kind"
        case position
    }
}

// MARK: - Label

struct NexusLabel: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "labels"
    var id: String
    var vaultId: String
    var name: String
    var color: Int
    var kind: String
    var systemKind: String?
    var parentId: String?
    var position: Int
    var providerId: String?

    enum CodingKeys: String, CodingKey {
        case id
        case vaultId = "vault_id"
        case name, color, kind
        case systemKind = "system_kind"
        case parentId = "parent_id"
        case position
        case providerId = "provider_id"
    }
}

// MARK: - Status

struct NexusStatus: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "statuses"
    var id: String
    var vaultId: String
    var name: String
    var color: Int
    var position: Int
    var isDefault: Bool
    var isTerminal: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case vaultId = "vault_id"
        case name, color, position
        case isDefault = "is_default"
        case isTerminal = "is_terminal"
    }
}

// MARK: - Message

struct NexusMessage: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "messages"
    var id: String
    var vaultId: String
    var folderId: String
    var threadId: String
    var subject: String
    var snippet: String
    var bodyRef: String
    var receivedAt: Int64
    var statusId: String?
    var priority: Int?
    var star: String?
    var pinned: Bool
    var muted: Bool
    var notes: String?
    var flagJson: String?
    var fromAddrJson: String
    var toAddrsJson: String
    var ccAddrsJson: String
    var bccAddrsJson: String
    var attachmentRefsJson: String
    var customFieldsJson: String
    var flagsRead: Bool
    var flagsAnswered: Bool
    var flagsDraft: Bool
    var flagsFlagged: Bool
    var providerId: String?
    var providerAccountId: String?
    var emlPath: String?
    var listUnsubscribeJson: String?

    enum CodingKeys: String, CodingKey {
        case id
        case vaultId = "vault_id"
        case folderId = "folder_id"
        case threadId = "thread_id"
        case subject, snippet
        case bodyRef = "body_ref"
        case receivedAt = "received_at"
        case statusId = "status_id"
        case priority, star, pinned, muted, notes
        case flagJson = "flag_json"
        case fromAddrJson = "from_addr_json"
        case toAddrsJson = "to_addrs_json"
        case ccAddrsJson = "cc_addrs_json"
        case bccAddrsJson = "bcc_addrs_json"
        case attachmentRefsJson = "attachment_refs_json"
        case customFieldsJson = "custom_fields_json"
        case flagsRead = "flags_read"
        case flagsAnswered = "flags_answered"
        case flagsDraft = "flags_draft"
        case flagsFlagged = "flags_flagged"
        case providerId = "provider_id"
        case providerAccountId = "provider_account_id"
        case emlPath = "eml_path"
        case listUnsubscribeJson = "list_unsubscribe_json"
    }

    var fromAddr: EmailAddress? {
        guard let data = fromAddrJson.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(EmailAddress.self, from: data)
    }

    var toAddrs: [EmailAddress] {
        guard let data = toAddrsJson.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([EmailAddress].self, from: data)) ?? []
    }
}

// MARK: - MessageBody

struct NexusMessageBody: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "message_bodies"
    var bodyRef: String
    var html: String

    enum CodingKeys: String, CodingKey {
        case bodyRef = "body_ref"
        case html
    }
}

// MARK: - MessageLabel

struct NexusMessageLabel: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "message_labels"
    var messageId: String
    var labelId: String

    enum CodingKeys: String, CodingKey {
        case messageId = "message_id"
        case labelId = "label_id"
    }
}

// MARK: - Mutation

struct NexusMutation: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "mutations"
    var id: String
    var vaultId: String
    var kind: String
    var payloadJson: String
    var ts: Int64
    var syncedAt: Int64?
    var deviceId: String
    var lamport: Int64
    var relaySeq: Int64?

    enum CodingKeys: String, CodingKey {
        case id
        case vaultId = "vault_id"
        case kind
        case payloadJson = "payload_json"
        case ts
        case syncedAt = "synced_at"
        case deviceId = "device_id"
        case lamport
        case relaySeq = "relay_seq"
    }
}

// MARK: - Rule

struct NexusRule: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "rules"
    var id: String
    var vaultId: String
    var name: String
    var conditionsJson: String
    var conditionLogic: String
    var actionsJson: String
    var enabled: Bool
    var position: Int

    enum CodingKeys: String, CodingKey {
        case id
        case vaultId = "vault_id"
        case name
        case conditionsJson = "conditions_json"
        case conditionLogic = "condition_logic"
        case actionsJson = "actions_json"
        case enabled, position
    }
}

// MARK: - Template

struct NexusTemplate: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "templates"
    var id: String
    var vaultId: String
    var name: String
    var subject: String
    var bodyHtml: String
    var createdAt: Int64

    enum CodingKeys: String, CodingKey {
        case id
        case vaultId = "vault_id"
        case name, subject
        case bodyHtml = "body_html"
        case createdAt = "created_at"
    }
}

// MARK: - Contact

struct NexusContact: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "contacts"
    var id: String
    var vaultId: String
    var name: String
    var company: String?
    var title: String?
    var website: String?
    var location: String?
    var notes: String?
    var tagsJson: String
    var createdAt: Int64
    var updatedAt: Int64

    enum CodingKeys: String, CodingKey {
        case id
        case vaultId = "vault_id"
        case name, company, title, website, location, notes
        case tagsJson = "tags_json"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

// MARK: - MutationKind

enum MutationKind: String, Codable {
    // Message actions
    case MARK_READ, MARK_UNREAD
    case STAR, UNSTAR
    case PIN, UNPIN
    case MUTE, UNMUTE
    case TRASH, UNTRASH
    case ARCHIVE, UNARCHIVE
    case MOVE_TO_FOLDER
    case ADD_LABEL, REMOVE_LABEL
    case SET_STATUS, CLEAR_STATUS
    case SET_PRIORITY, CLEAR_PRIORITY
    case ADD_TAG, REMOVE_TAG
    case SET_NOTES, CLEAR_NOTES
    case SET_FLAG, CLEAR_FLAG
    case SEND_MESSAGE
    case DELETE_MESSAGE

    // Folder / Label management
    case CREATE_FOLDER, RENAME_FOLDER, DELETE_FOLDER, REORDER_FOLDER
    case CREATE_LABEL, RENAME_LABEL, DELETE_LABEL, REORDER_LABEL, RECOLOR_LABEL

    // Status management
    case CREATE_STATUS, UPDATE_STATUS, DELETE_STATUS, REORDER_STATUSES

    // Custom fields
    case CREATE_CUSTOM_FIELD, UPDATE_CUSTOM_FIELD, DELETE_CUSTOM_FIELD
    case SET_CUSTOM_FIELD_VALUE, CLEAR_CUSTOM_FIELD_VALUE

    // Rules & Templates
    case CREATE_RULE, UPDATE_RULE, DELETE_RULE, REORDER_RULES
    case CREATE_TEMPLATE, UPDATE_TEMPLATE, DELETE_TEMPLATE

    // Contacts
    case CREATE_CONTACT, UPDATE_CONTACT, DELETE_CONTACT

    // Saved views
    case CREATE_SAVED_VIEW, UPDATE_SAVED_VIEW, DELETE_SAVED_VIEW

    // Account
    case CONNECT_ACCOUNT, DISCONNECT_ACCOUNT
}
