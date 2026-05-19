import Foundation
import CryptoKit
import _CryptoExtras

/// XChaCha20-Poly1305 with 24-byte nonces — must match the Rust `chacha20poly1305` crate layout
/// used in src-tauri/src/crypto.rs.
///
/// Wire format: | 24-byte nonce | ciphertext | 16-byte tag |
enum CryptoManager {

    // MARK: - Vault key

    /// Derive a symmetric key from a 32-byte hex-encoded vault key.
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
        let nonce = try XChaChaPoly.Nonce()
        let sealedBox = try XChaChaPoly.seal(data, using: key, nonce: nonce)
        // Layout: nonce (24) | ciphertext | tag (16)
        var out = Data()
        out.append(contentsOf: nonce)
        out.append(sealedBox.ciphertext)
        out.append(sealedBox.tag)
        return out
    }

    static func decrypt(ciphertext: Data, key: SymmetricKey) throws -> Data {
        guard ciphertext.count >= 24 + 16 else {
            throw CryptoError.ciphertextTooShort
        }
        let nonceData = ciphertext.prefix(24)
        let nonce = try XChaChaPoly.Nonce(data: nonceData)
        let rest = ciphertext.dropFirst(24)
        let tagStart = rest.index(rest.endIndex, offsetBy: -16)
        let body = rest[rest.startIndex..<tagStart]
        let tag = rest[tagStart...]
        let sealedBox = try XChaChaPoly.SealedBox(nonce: nonce, ciphertext: body, tag: tag)
        return try XChaChaPoly.open(sealedBox, using: key)
    }

    // MARK: - Enrollment code key derivation
    // Matches crypto.rs derive_code_key() which uses BLAKE3 with domain "nexus-enroll-v1".
    // On iOS we use HMAC-SHA256 as the KDF since BLAKE3 has no native Swift implementation.
    // Enrollment codes are short-lived (10 min) so this cross-platform difference is acceptable.

    static func deriveEnrollmentKey(vaultKey: Data) -> SymmetricKey {
        let domainKey = SymmetricKey(data: "nexus-enroll-v1".data(using: .utf8)!)
        let mac = HMAC<SHA256>.authenticationCode(for: vaultKey, using: domainKey)
        return SymmetricKey(data: Data(mac))
    }

    // MARK: - Code hash (SHA-256 hex, matches crypto.rs hash_enrollment_code)

    static func hashEnrollmentCode(_ code: String) -> String {
        let digest = SHA256.hash(data: code.data(using: .utf8)!)
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Error

enum CryptoError: Error {
    case invalidKeyHex
    case ciphertextTooShort
}

// MARK: - Data+hexEncoded

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

// MARK: - XChaChaPoly.Nonce Sequence conformance for appending

extension XChaChaPoly.Nonce: Sequence {
    public func makeIterator() -> Array<UInt8>.Iterator {
        withUnsafeBytes { Array($0) }.makeIterator()
    }
}
