import Foundation
import Crypto

/// HTTP client for the Nexus E2EE relay server.
/// Wraps the 4 endpoints defined in relay-server/src/routes.rs.
final class RelayClient {
    private let baseURL: URL
    private let vaultKey: SymmetricKey
    private let vaultId: String

    init(baseURL: URL, vaultKeyHex: String, vaultId: String) throws {
        self.baseURL = baseURL
        self.vaultKey = try CryptoManager.symmetricKey(fromHex: vaultKeyHex)
        self.vaultId = vaultId
    }

    // MARK: - Push mutation

    func pushMutation(_ mutation: NexusMutation) async throws {
        let payloadData = mutation.payloadJson.data(using: .utf8) ?? Data()
        let encrypted = try CryptoManager.encrypt(data: payloadData, key: vaultKey)

        let body: [String: Any] = [
            "vault_id": vaultId,
            "device_id": mutation.deviceId,
            "kind": mutation.kind,
            "lamport": mutation.lamport,
            "payload_enc": encrypted.base64EncodedString()
        ]

        var request = URLRequest(url: baseURL.appendingPathComponent("mutations"))
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw RelayError.pushFailed
        }
    }

    // MARK: - Pull mutations

    func pullMutations(since seq: Int64) async throws -> [RemoteMutation] {
        let url = baseURL
            .appendingPathComponent("mutations")
            .appending(queryItems: [
                URLQueryItem(name: "vault_id", value: vaultId),
                URLQueryItem(name: "since", value: String(seq))
            ])

        let (data, _) = try await URLSession.shared.data(from: url)
        let json = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] ?? []

        return try json.compactMap { dict -> RemoteMutation? in
            guard let seq = dict["seq"] as? Int64,
                  let deviceId = dict["device_id"] as? String,
                  let kind = dict["kind"] as? String,
                  let lamport = dict["lamport"] as? Int64,
                  let encB64 = dict["payload_enc"] as? String,
                  let encData = Data(base64Encoded: encB64)
            else { return nil }

            let payloadData = try CryptoManager.decrypt(ciphertext: encData, key: vaultKey)
            let payloadJson = String(data: payloadData, encoding: .utf8) ?? "{}"

            return RemoteMutation(seq: seq, deviceId: deviceId, kind: kind, lamport: lamport, payloadJson: payloadJson)
        }
    }

    // MARK: - Enrollment

    func createEnrollment(codeHash: String, encryptedVaultKey: Data) async throws {
        let body: [String: Any] = [
            "vault_id": vaultId,
            "code_hash": codeHash,
            "encrypted_vault_key": encryptedVaultKey.base64EncodedString(),
            "expires_in_secs": 600  // 10 minutes
        ]
        var request = URLRequest(url: baseURL.appendingPathComponent("enroll"))
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw RelayError.enrollmentFailed
        }
    }

    func fetchEnrollment(codeHash: String) async throws -> Data {
        let url = baseURL
            .appendingPathComponent("enroll")
            .appending(queryItems: [URLQueryItem(name: "code_hash", value: codeHash)])

        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw RelayError.enrollmentNotFound
        }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let encB64 = json?["encrypted_vault_key"] as? String,
              let encData = Data(base64Encoded: encB64)
        else {
            throw RelayError.enrollmentNotFound
        }
        return encData
    }
}

// MARK: - Supporting types

struct RemoteMutation {
    var seq: Int64
    var deviceId: String
    var kind: String
    var lamport: Int64
    var payloadJson: String
}

enum RelayError: Error, LocalizedError {
    case pushFailed
    case enrollmentFailed
    case enrollmentNotFound

    var errorDescription: String? {
        switch self {
        case .pushFailed: return "Failed to push mutation to relay"
        case .enrollmentFailed: return "Failed to create enrollment session"
        case .enrollmentNotFound: return "Enrollment session not found or expired"
        }
    }
}

// MARK: - URL extension for query items (iOS 15 compat)

private extension URL {
    func appending(queryItems: [URLQueryItem]) -> URL {
        guard var components = URLComponents(url: self, resolvingAgainstBaseURL: false) else { return self }
        components.queryItems = (components.queryItems ?? []) + queryItems
        return components.url ?? self
    }
}
