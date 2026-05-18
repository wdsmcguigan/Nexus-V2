use anyhow::{anyhow, Result};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use rand_core::{OsRng, RngCore};

/// Encrypt plaintext with XChaCha20-Poly1305. Returns `nonce (24 bytes) || ciphertext`.
pub fn encrypt_payload(key: &[u8; 32], plaintext: &[u8]) -> Vec<u8> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let mut nonce_bytes = [0u8; 24];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, plaintext).expect("encryption failure");
    let mut out = Vec::with_capacity(24 + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend(ciphertext);
    out
}

/// Decrypt a blob produced by `encrypt_payload`. Expects `nonce (24 bytes) || ciphertext`.
pub fn decrypt_payload(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>> {
    if data.len() < 25 {
        return Err(anyhow!("ciphertext too short ({} bytes)", data.len()));
    }
    let (nonce_bytes, ciphertext) = data.split_at(24);
    let cipher = XChaCha20Poly1305::new(key.into());
    let nonce = XNonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| anyhow!("AEAD decryption failed — wrong key or corrupted data"))
}

/// Derive a 32-byte key from a 6-digit enrollment code using BLAKE3.
/// The domain separator prevents the code from being usable for anything else.
pub fn derive_code_key(code: &str) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new_derive_key("nexus-enroll-v1");
    hasher.update(code.as_bytes());
    *hasher.finalize().as_bytes()
}

/// SHA-256 hash of the code string, returned as lowercase hex (used as relay lookup key).
pub fn code_hash(code: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(code.as_bytes());
    format!("{:x}", h.finalize())
}

/// Generate a random 6-digit enrollment code (zero-padded string).
pub fn generate_enrollment_code() -> String {
    let n: u32 = OsRng.next_u32() % 1_000_000;
    format!("{:06}", n)
}
