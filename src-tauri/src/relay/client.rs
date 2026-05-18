use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::crypto;
use crate::db::VaultDb;

// ─── Wire types ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct PushBody {
    vault_id: String,
    device_id: String,
    lamport: i64,
    ciphertext_b64: String,
}

#[derive(Deserialize)]
struct PushResponse {
    seq: i64,
}

#[derive(Deserialize)]
struct RemoteMutation {
    seq: i64,
    device_id: String,
    lamport: i64,
    ciphertext_b64: String,
}

#[derive(Deserialize)]
struct PullResponse {
    mutations: Vec<RemoteMutation>,
}

#[derive(Deserialize)]
struct EnrollResponse {
    vault_id: String,
    encrypted_vault_key_b64: String,
}

// ─── Syncer ───────────────────────────────────────────────────────────────────

pub struct RelaySyncer {
    relay_url: String,
    vault_id: String,
    device_id: String,
    vault_key: [u8; 32],
    client: reqwest::Client,
}

impl RelaySyncer {
    pub fn new(
        relay_url: String,
        vault_id: String,
        device_id: String,
        vault_key: [u8; 32],
    ) -> Self {
        Self {
            relay_url,
            vault_id,
            device_id,
            vault_key,
            client: reqwest::Client::new(),
        }
    }

    /// Encrypt and push all local mutations that haven't reached the relay yet.
    pub async fn push_pending(&self, db_path: &str) -> Result<usize> {
        let db = VaultDb::open(db_path, "nexus")?;
        let pending = db.pending_relay_mutations()?;
        if pending.is_empty() {
            return Ok(0);
        }

        let mut pushed = 0;
        for (id, kind, payload_json, device_id, lamport) in &pending {
            let plaintext = serde_json::to_vec(&serde_json::json!({
                "kind": kind,
                "payload": serde_json::from_str::<serde_json::Value>(payload_json)
                    .unwrap_or(serde_json::Value::Null),
                "deviceId": device_id,
                "lamport": lamport,
            }))?;
            let ciphertext = crypto::encrypt_payload(&self.vault_key, &plaintext);
            let ciphertext_b64 = B64.encode(&ciphertext);

            let resp = self
                .client
                .post(&format!("{}/api/v1/mutations", self.relay_url))
                .json(&PushBody {
                    vault_id: self.vault_id.clone(),
                    device_id: device_id.clone(),
                    lamport: *lamport,
                    ciphertext_b64,
                })
                .send()
                .await
                .context("POST /api/v1/mutations")?;

            if resp.status().is_success() {
                let body: PushResponse = resp.json().await.unwrap_or(PushResponse { seq: 0 });
                db.mark_relay_pushed(id, body.seq)?;
                pushed += 1;
            } else {
                log::warn!("Relay push rejected {} with status {}", id, resp.status());
            }
        }
        Ok(pushed)
    }

    /// Pull remote mutations since our last cursor and apply them locally.
    pub async fn pull_remote(&self, db_path: &str, app: &tauri::AppHandle) -> Result<usize> {
        let db = VaultDb::open(db_path, "nexus")?;
        let cursor = db.get_relay_cursor(&self.relay_url)?;

        let resp = self
            .client
            .get(&format!("{}/api/v1/mutations", self.relay_url))
            .query(&[
                ("vault_id", self.vault_id.as_str()),
                ("after", &cursor.to_string()),
                ("exclude_device", self.device_id.as_str()),
            ])
            .send()
            .await
            .context("GET /api/v1/mutations")?;

        if !resp.status().is_success() {
            return Err(anyhow::anyhow!("relay pull error: {}", resp.status()));
        }

        let body: PullResponse = resp.json().await.context("parsing pull response")?;
        let mutations = body.mutations;
        if mutations.is_empty() {
            let now = chrono::Utc::now().timestamp_millis();
            db.update_relay_cursor(&self.relay_url, cursor, now)?;
            return Ok(0);
        }

        let mut applied = 0;
        let mut max_seq = cursor;

        for m in &mutations {
            max_seq = max_seq.max(m.seq);
            if m.device_id == self.device_id {
                continue; // skip own mutations echoed back
            }

            let ciphertext = B64.decode(&m.ciphertext_b64)
                .context("decoding relay ciphertext")?;
            let plaintext = match crypto::decrypt_payload(&self.vault_key, &ciphertext) {
                Ok(p) => p,
                Err(e) => {
                    log::warn!("Relay: failed to decrypt mutation seq {}: {e}", m.seq);
                    continue;
                }
            };

            let obj: serde_json::Value = serde_json::from_slice(&plaintext)
                .context("parsing decrypted mutation")?;
            let kind = obj["kind"].as_str().unwrap_or_default();
            let payload = serde_json::to_string(&obj["payload"])?;

            if let Err(e) = db.apply_remote_mutation(kind, &payload) {
                log::warn!("Relay: failed to apply mutation kind={kind}: {e}");
            } else {
                applied += 1;
            }
        }

        let now = chrono::Utc::now().timestamp_millis();
        db.update_relay_cursor(&self.relay_url, max_seq, now)?;

        if applied > 0 {
            let _ = app.emit("vault:hydrate-needed", ());
            log::info!("Relay: applied {applied} remote mutations (max_seq={max_seq})");
        }

        Ok(applied)
    }
}

// ─── Enrollment (Device A — initiating) ──────────────────────────────────────

#[derive(Serialize)]
pub struct EnrollmentSession {
    pub code: String,
    pub expires_at: i64,
}

/// Generate a 6-digit enrollment code, encrypt the vault key with it, and post
/// the session to the relay. Returns the code to display to the user.
pub async fn start_enrollment(
    relay_url: &str,
    vault_id: &str,
    vault_key: &[u8; 32],
) -> Result<EnrollmentSession> {
    let code = crypto::generate_enrollment_code();
    let code_key = crypto::derive_code_key(&code);
    let encrypted_vault_key = crypto::encrypt_payload(&code_key, vault_key);
    let expires_at = chrono::Utc::now().timestamp_millis() + 10 * 60 * 1000; // 10 min

    let client = reqwest::Client::new();
    let resp = client
        .post(&format!("{relay_url}/api/v1/enroll"))
        .json(&serde_json::json!({
            "vault_id": vault_id,
            "code_hash": crypto::code_hash(&code),
            "encrypted_vault_key_b64": B64.encode(&encrypted_vault_key),
            "expires_at": expires_at,
        }))
        .send()
        .await
        .context("POST /api/v1/enroll")?;

    if !resp.status().is_success() {
        return Err(anyhow::anyhow!("relay enroll error: {}", resp.status()));
    }

    Ok(EnrollmentSession { code, expires_at })
}

// ─── Enrollment (Device B — new device) ───────────────────────────────────────

/// Complete enrollment on a new device: fetch the encrypted vault key from the
/// relay using the 6-digit code, decrypt it, and store it locally.
/// Takes `db_path` instead of `&VaultDb` to avoid holding a non-Send reference across `.await`.
pub async fn complete_enrollment(
    db_path: &str,
    relay_url: &str,
    code: &str,
) -> Result<String> {
    let code_hash = crypto::code_hash(code);
    let client = reqwest::Client::new();

    let resp = client
        .get(&format!("{relay_url}/api/v1/enroll/{code_hash}"))
        .send()
        .await
        .context("GET /api/v1/enroll")?;

    let status = resp.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(anyhow::anyhow!("code not found or expired"));
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(anyhow::anyhow!("too many attempts — code invalidated"));
    }
    if !status.is_success() {
        return Err(anyhow::anyhow!("relay enroll fetch error: {status}"));
    }

    let body: EnrollResponse = resp.json().await.context("parsing enroll response")?;
    let encrypted = B64.decode(&body.encrypted_vault_key_b64)
        .context("decoding encrypted vault key")?;

    let code_key = crypto::derive_code_key(code);
    let vault_key_bytes = crypto::decrypt_payload(&code_key, &encrypted)
        .context("decrypting vault key — wrong code?")?;

    if vault_key_bytes.len() != 32 {
        return Err(anyhow::anyhow!("decrypted key is wrong length ({})", vault_key_bytes.len()));
    }

    let key_hex: String = vault_key_bytes.iter().map(|b| format!("{:02x}", b)).collect();

    // Open fresh DB connection to persist (no VaultDb held across await)
    let db = VaultDb::open(db_path, "nexus")?;
    db.import_vault_key(&body.vault_id, &key_hex)?;
    db.set_relay_url(relay_url)?;

    log::info!("Enrollment complete: vault={} relay={}", body.vault_id, relay_url);
    Ok(body.vault_id)
}
