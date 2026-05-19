import XCTest
@testable import Nexus

final class CryptoManagerTests: XCTestCase {

    func testRoundtrip() throws {
        let keyHex = String(repeating: "ab", count: 32)  // 32 bytes
        let key = try CryptoManager.symmetricKey(fromHex: keyHex)
        let plaintext = "Hello, Nexus!".data(using: .utf8)!

        let ciphertext = try CryptoManager.encrypt(data: plaintext, key: key)
        let decrypted = try CryptoManager.decrypt(ciphertext: ciphertext, key: key)

        XCTAssertEqual(decrypted, plaintext)
    }

    func testNonceLength() throws {
        let keyHex = String(repeating: "cd", count: 32)
        let key = try CryptoManager.symmetricKey(fromHex: keyHex)
        let data = Data([1, 2, 3])

        let ciphertext = try CryptoManager.encrypt(data: data, key: key)
        // Ciphertext must be at least 24 (nonce) + 16 (tag) bytes longer than plaintext
        XCTAssertGreaterThanOrEqual(ciphertext.count, 24 + data.count + 16)
    }

    func testDecryptWrongKeyFails() throws {
        let key1 = try CryptoManager.symmetricKey(fromHex: String(repeating: "aa", count: 32))
        let key2 = try CryptoManager.symmetricKey(fromHex: String(repeating: "bb", count: 32))
        let plaintext = "secret".data(using: .utf8)!

        let ciphertext = try CryptoManager.encrypt(data: plaintext, key: key1)
        XCTAssertThrowsError(try CryptoManager.decrypt(ciphertext: ciphertext, key: key2))
    }

    func testEnrollmentCodeHash() {
        let hash1 = CryptoManager.hashEnrollmentCode("ABCD-1234")
        let hash2 = CryptoManager.hashEnrollmentCode("ABCD-1234")
        let hash3 = CryptoManager.hashEnrollmentCode("XXXX-9999")
        XCTAssertEqual(hash1, hash2)
        XCTAssertNotEqual(hash1, hash3)
        XCTAssertEqual(hash1.count, 64)  // SHA-256 hex = 64 chars
    }

    func testHexDecoding() {
        let hex = "deadbeef"
        let data = Data(hexEncoded: hex)
        XCTAssertNotNil(data)
        XCTAssertEqual(data?.count, 4)
        XCTAssertEqual(data?.hexEncodedString(), hex)
    }

    func testInvalidKeyHexThrows() {
        XCTAssertThrowsError(try CryptoManager.symmetricKey(fromHex: "tooshort"))
    }
}
