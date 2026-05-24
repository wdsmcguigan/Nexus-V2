import Foundation
import CryptoKit

/// Relay payload encryption using ChaChaPoly (CryptoKit built-in, 12-byte nonces).
/// Note: the desktop Rust backend uses XChaCha20-Poly1305 (24-byte nonces via _CryptoExtras),
/// so iOS↔desktop relay payloads are not directly interoperable today. Both sides are
/// encrypted; cross-platform format bridging is tracked as future work.
///
/// Wire format: | 12-byte nonce | ciphertext | 16-byte tag |
enum CryptoManager {

    // MARK: - Vault key

    static func symmetricKey(fromHex hex: String) throws -> SymmetricKey {
        guard hex.count == 64,
              let keyData = Data(hexEncoded: hex)
        else {
            throw CryptoError.invalidKeyHex
        }
        return SymmetricKey(data: keyData)
    }

    // MARK: - Encrypt / Decrypt

    static func encrypt(data: Data, key: SymmetricKey) throws -> Data {
        let sealedBox = try ChaChaPoly.seal(data, using: key)
        var out = Data()
        out.append(contentsOf: sealedBox.nonce)
        out.append(sealedBox.ciphertext)
        out.append(sealedBox.tag)
        return out
    }

    static func decrypt(ciphertext: Data, key: SymmetricKey) throws -> Data {
        guard ciphertext.count >= 12 + 16 else {
            throw CryptoError.ciphertextTooShort
        }
        let nonceData = ciphertext.prefix(12)
        let nonce = try ChaChaPoly.Nonce(data: nonceData)
        let rest = ciphertext.dropFirst(12)
        let tagStart = rest.index(rest.endIndex, offsetBy: -16)
        let body = rest[rest.startIndex..<tagStart]
        let tag = rest[tagStart...]
        let sealedBox = try ChaChaPoly.SealedBox(nonce: nonce, ciphertext: body, tag: tag)
        return try ChaChaPoly.open(sealedBox, using: key)
    }

    // MARK: - Enrollment key derivation (HMAC-SHA256, matches crypto.rs domain "nexus-enroll-v1")

    static func deriveEnrollmentKey(vaultKey: Data) -> SymmetricKey {
        let domainKey = SymmetricKey(data: "nexus-enroll-v1".data(using: .utf8)!)
        let mac = HMAC<SHA256>.authenticationCode(for: vaultKey, using: domainKey)
        return SymmetricKey(data: Data(mac))
    }

    static func hashEnrollmentCode(_ code: String) -> String {
        let digest = SHA256.hash(data: code.data(using: .utf8)!)
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Errors

enum CryptoError: Error {
    case invalidKeyHex
    case ciphertextTooShort
}

// MARK: - Data hex helpers

extension Data {
    init?(hexEncoded hex: String) {
        guard hex.count % 2 == 0 else { return nil }
        var data = Data(capacity: hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            data.append(byte)
            index = next
        }
        self = data
    }

    func hexEncodedString() -> String {
        map { String(format: "%02x", $0) }.joined()
    }
}
