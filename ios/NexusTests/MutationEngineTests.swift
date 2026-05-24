import XCTest
@testable import Nexus

final class MutationEngineTests: XCTestCase {
    var db: VaultDB!
    var engine: MutationEngine!
    let vaultId = "test-vault"

    override func setUpWithError() throws {
        // Use in-memory database for tests
        let tmpPath = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString + ".db").path
        db = try VaultDB(path: tmpPath)

        // Seed vault and inbox folder
        try db.upsertVault(NexusVault(id: vaultId, path: tmpPath, createdAt: 0))
        try db.upsertFolder(NexusFolder(
            id: "folder-inbox", vaultId: vaultId, parentId: nil,
            name: "Inbox", diskSlug: "inbox", color: nil, icon: nil,
            systemKind: "inbox", position: 0
        ))
        try db.upsertFolder(NexusFolder(
            id: "folder-trash", vaultId: vaultId, parentId: nil,
            name: "Trash", diskSlug: "trash", color: nil, icon: nil,
            systemKind: "trash", position: 1
        ))
        try db.upsertFolder(NexusFolder(
            id: "folder-archive", vaultId: vaultId, parentId: nil,
            name: "Archive", diskSlug: "archive", color: nil, icon: nil,
            systemKind: "archive", position: 2
        ))

        engine = try MutationEngine(db: db, vaultId: vaultId)
    }

    private func seedMessage(id: String = "msg-1") throws {
        let fromJson = #"{"name":"Alice","email":"alice@example.com"}"#
        let msg = NexusMessage(
            id: id, vaultId: vaultId, folderId: "folder-inbox",
            threadId: "thread-1", subject: "Hello", snippet: "Hi there",
            bodyRef: "body-1", receivedAt: 1000, statusId: nil,
            priority: nil, star: nil, pinned: false, muted: false,
            notes: nil, flagJson: nil,
            fromAddrJson: fromJson, toAddrsJson: "[]",
            ccAddrsJson: "[]", bccAddrsJson: "[]",
            attachmentRefsJson: "[]", customFieldsJson: "{}",
            flagsRead: false, flagsAnswered: false, flagsDraft: false, flagsFlagged: false,
            providerId: nil, providerAccountId: nil, emlPath: nil, listUnsubscribeJson: nil
        )
        try db.upsertMessage(msg)
    }

    func testMarkRead() throws {
        try seedMessage()
        try engine.apply(kind: .MARK_READ, payload: ["messageId": "msg-1"])

        let msg = try db.fetchMessage(id: "msg-1")
        XCTAssertTrue(msg?.flagsRead == true)
    }

    func testMarkUnread() throws {
        try seedMessage()
        try engine.apply(kind: .MARK_READ, payload: ["messageId": "msg-1"])
        try engine.apply(kind: .MARK_UNREAD, payload: ["messageId": "msg-1"])

        let msg = try db.fetchMessage(id: "msg-1")
        XCTAssertFalse(msg?.flagsRead == true)
    }

    func testStar() throws {
        try seedMessage()
        try engine.apply(kind: .STAR, payload: ["messageId": "msg-1"])

        let msg = try db.fetchMessage(id: "msg-1")
        XCTAssertNotNil(msg?.star)
    }

    func testUnstar() throws {
        try seedMessage()
        try engine.apply(kind: .STAR, payload: ["messageId": "msg-1"])
        try engine.apply(kind: .UNSTAR, payload: ["messageId": "msg-1"])

        let msg = try db.fetchMessage(id: "msg-1")
        XCTAssertNil(msg?.star)
    }

    func testMoveToFolder() throws {
        try seedMessage()
        try engine.apply(kind: .MOVE_TO_FOLDER, payload: ["messageId": "msg-1", "folderId": "folder-archive"])

        let msg = try db.fetchMessage(id: "msg-1")
        XCTAssertEqual(msg?.folderId, "folder-archive")
    }

    func testTrash() throws {
        try seedMessage()
        try engine.apply(kind: .TRASH, payload: ["messageId": "msg-1"])

        let msg = try db.fetchMessage(id: "msg-1")
        XCTAssertEqual(msg?.folderId, "folder-trash")
    }

    func testAddLabel() throws {
        try seedMessage()
        try db.upsertLabel(NexusLabel(
            id: "lbl-1", vaultId: vaultId, name: "Work",
            color: 2, kind: "user", systemKind: nil,
            parentId: nil, position: 0, providerId: nil
        ))

        try engine.apply(kind: .ADD_LABEL, payload: ["messageId": "msg-1", "labelId": "lbl-1"])
        let labelIds = try db.fetchLabels(messageId: "msg-1")
        XCTAssertTrue(labelIds.contains("lbl-1"))
    }

    func testMutationRecorded() throws {
        try seedMessage()
        try engine.apply(kind: .MARK_READ, payload: ["messageId": "msg-1"])

        let pending = try db.fetchPendingMutations(vaultId: vaultId)
        XCTAssertFalse(pending.isEmpty)
        XCTAssertEqual(pending.first?.kind, MutationKind.MARK_READ.rawValue)
    }

    func testLamportIncrementsMonotonically() throws {
        try seedMessage(id: "msg-1")
        try seedMessage(id: "msg-2")

        try engine.apply(kind: .MARK_READ, payload: ["messageId": "msg-1"])
        try engine.apply(kind: .MARK_READ, payload: ["messageId": "msg-2"])

        let pending = try db.fetchPendingMutations(vaultId: vaultId)
        let lamports = pending.map(\.lamport).sorted()
        XCTAssertEqual(lamports.count, 2)
        XCTAssertLessThan(lamports[0], lamports[1])
    }
}
