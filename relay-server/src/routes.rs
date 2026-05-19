use std::sync::{Arc, Mutex};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::RelayDb;

pub type SharedDb = Arc<Mutex<RelayDb>>;

/// Ten minutes in milliseconds — server-controlled enrollment window.
const ENROLL_TTL_MS: i64 = 10 * 60 * 1_000;

fn lock_db(db: &SharedDb) -> Result<std::sync::MutexGuard<RelayDb>, (StatusCode, &'static str)> {
    db.lock().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "database unavailable"))
}

pub fn router(db: SharedDb) -> Router {
    Router::new()
        .route("/api/v1/mutations", post(push_mutation))
        .route("/api/v1/mutations", get(pull_mutations))
        .route("/api/v1/enroll", post(create_enroll_session))
        .route("/api/v1/enroll/:code_hash", get(fetch_enroll_session))
        .with_state(db)
}

// ─── Push ─────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct PushReq {
    vault_id: String,
    device_id: String,
    lamport: i64,
    ciphertext_b64: String,
}

#[derive(Serialize)]
struct PushResp {
    seq: i64,
}

async fn push_mutation(State(db): State<SharedDb>, Json(req): Json<PushReq>) -> impl IntoResponse {
    let ciphertext = match B64.decode(&req.ciphertext_b64) {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "bad base64").into_response(),
    };
    let now = chrono::Utc::now().timestamp_millis();
    let db = match lock_db(&db) {
        Ok(g) => g,
        Err(e) => return e.into_response(),
    };
    match db.conn.execute(
        "INSERT INTO relay_mutations (vault_id, device_id, lamport, ciphertext, received_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![req.vault_id, req.device_id, req.lamport, ciphertext, now],
    ) {
        Ok(_) => Json(PushResp { seq: db.conn.last_insert_rowid() }).into_response(),
        Err(e) => {
            log::error!("push_mutation DB error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct PullQuery {
    vault_id: String,
    after: Option<i64>,
    exclude_device: Option<String>,
}

#[derive(Serialize)]
struct RemoteMutation {
    seq: i64,
    device_id: String,
    lamport: i64,
    ciphertext_b64: String,
}

#[derive(Serialize)]
struct PullResp {
    mutations: Vec<RemoteMutation>,
}

async fn pull_mutations(State(db): State<SharedDb>, Query(q): Query<PullQuery>) -> impl IntoResponse {
    let after = q.after.unwrap_or(0);
    let exclude = q.exclude_device.as_deref().unwrap_or("");
    let db = match lock_db(&db) {
        Ok(g) => g,
        Err(e) => return e.into_response(),
    };

    let mut stmt = match db.conn.prepare(
        "SELECT seq, device_id, lamport, ciphertext FROM relay_mutations \
         WHERE vault_id = ?1 AND seq > ?2 AND device_id != ?3 \
         ORDER BY seq LIMIT 200",
    ) {
        Ok(s) => s,
        Err(e) => {
            log::error!("pull_mutations prepare: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let mutations: Vec<RemoteMutation> = match stmt.query_map(params![q.vault_id, after, exclude], |r| {
        let seq: i64 = r.get(0)?;
        let device_id: String = r.get(1)?;
        let lamport: i64 = r.get(2)?;
        let ciphertext: Vec<u8> = r.get(3)?;
        Ok((seq, device_id, lamport, ciphertext))
    }) {
        Ok(rows) => rows
            .filter_map(|r| r.ok())
            .map(|(seq, device_id, lamport, ciphertext)| RemoteMutation {
                seq,
                device_id,
                lamport,
                ciphertext_b64: B64.encode(&ciphertext),
            })
            .collect(),
        Err(e) => {
            log::error!("pull_mutations query: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    Json(PullResp { mutations }).into_response()
}

// ─── Enrollment ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct EnrollReq {
    vault_id: String,
    code_hash: String,
    encrypted_vault_key_b64: String,
    // expires_at from client is intentionally ignored — server sets a fixed TTL
}

async fn create_enroll_session(State(db): State<SharedDb>, Json(req): Json<EnrollReq>) -> impl IntoResponse {
    let encrypted_key = match B64.decode(&req.encrypted_vault_key_b64) {
        Ok(b) => b,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let now = chrono::Utc::now().timestamp_millis();
    // Server controls TTL — client cannot extend the enrollment window
    let expires_at = now + ENROLL_TTL_MS;
    let db = match lock_db(&db) {
        Ok(g) => g,
        Err(e) => return e.into_response(),
    };
    let _ = db.conn.execute("DELETE FROM enroll_sessions WHERE expires_at < ?1", params![now]);
    match db.conn.execute(
        "INSERT OR REPLACE INTO enroll_sessions \
         (code_hash, vault_id, encrypted_vault_key, expires_at, attempts) VALUES (?1, ?2, ?3, ?4, 0)",
        params![req.code_hash, req.vault_id, encrypted_key, expires_at],
    ) {
        Ok(_) => StatusCode::OK.into_response(),
        Err(e) => {
            log::error!("enroll insert: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[derive(Serialize)]
struct EnrollFetchResp {
    vault_id: String,
    encrypted_vault_key_b64: String,
}

async fn fetch_enroll_session(
    State(db): State<SharedDb>,
    Path(code_hash): Path<String>,
) -> impl IntoResponse {
    let now = chrono::Utc::now().timestamp_millis();
    let db = match lock_db(&db) {
        Ok(g) => g,
        Err(e) => return e.into_response(),
    };

    let row: Option<(String, Vec<u8>, i64, i64)> = match db.conn.query_row(
        "SELECT vault_id, encrypted_vault_key, expires_at, attempts \
         FROM enroll_sessions WHERE code_hash = ?1",
        params![code_hash],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ).optional() {
        Ok(r) => r,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };

    let (vault_id, encrypted_key, expires_at, attempts) = match row {
        Some(r) => r,
        None => return StatusCode::NOT_FOUND.into_response(),
    };

    if expires_at < now {
        let _ = db.conn.execute("DELETE FROM enroll_sessions WHERE code_hash = ?1", params![code_hash]);
        return StatusCode::NOT_FOUND.into_response();
    }

    if attempts >= 10 {
        let _ = db.conn.execute("DELETE FROM enroll_sessions WHERE code_hash = ?1", params![code_hash]);
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }

    // One-time use — delete before returning so the key cannot be fetched again
    let _ = db.conn.execute("DELETE FROM enroll_sessions WHERE code_hash = ?1", params![code_hash]);

    Json(EnrollFetchResp {
        vault_id,
        encrypted_vault_key_b64: B64.encode(&encrypted_key),
    }).into_response()
}
