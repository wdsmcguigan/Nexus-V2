/// Embedded relay server — runs as an axum Tokio task inside the Nexus process.
/// Opens its own SQLite DB (relay.db) alongside the vault DB; stores only
/// ciphertext so it is zero-knowledge with respect to vault data.
use anyhow::{Context, Result};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;

// ─── Shared relay DB ─────────────────────────────────────────────────────────

struct RelayDb {
    conn: Connection,
}

impl RelayDb {
    fn open(path: &str) -> Result<Self> {
        let conn = Connection::open(path).context("opening relay.db")?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS relay_mutations (
                 seq         INTEGER PRIMARY KEY AUTOINCREMENT,
                 vault_id    TEXT NOT NULL,
                 device_id   TEXT NOT NULL,
                 lamport     INTEGER NOT NULL,
                 ciphertext  BLOB NOT NULL,
                 received_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_rm_vault_seq ON relay_mutations(vault_id, seq);
             CREATE TABLE IF NOT EXISTS enroll_sessions (
                 code_hash           TEXT PRIMARY KEY,
                 vault_id            TEXT NOT NULL,
                 encrypted_vault_key BLOB NOT NULL,
                 expires_at          INTEGER NOT NULL,
                 attempts            INTEGER NOT NULL DEFAULT 0
             );",
        )
        .context("relay schema")?;
        Ok(Self { conn })
    }
}

type SharedDb = Arc<Mutex<RelayDb>>;

// ─── Request/response types ───────────────────────────────────────────────────

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

#[derive(Deserialize)]
struct PullQuery {
    vault_id: String,
    after: Option<i64>,
    exclude_device: Option<String>,
}

#[derive(Serialize)]
struct RelayMutationItem {
    seq: i64,
    device_id: String,
    lamport: i64,
    ciphertext_b64: String,
}

#[derive(Serialize)]
struct PullResp {
    mutations: Vec<RelayMutationItem>,
}

#[derive(Deserialize)]
struct EnrollReq {
    vault_id: String,
    code_hash: String,
    encrypted_vault_key_b64: String,
    expires_at: i64,
}

#[derive(Serialize)]
struct EnrollFetchResp {
    vault_id: String,
    encrypted_vault_key_b64: String,
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async fn push_mutation(
    State(db): State<SharedDb>,
    Json(req): Json<PushReq>,
) -> impl IntoResponse {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    let ciphertext = match B64.decode(&req.ciphertext_b64) {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error":"bad base64"}))).into_response(),
    };
    let now = chrono::Utc::now().timestamp_millis();
    let db = db.lock().unwrap();
    match db.conn.execute(
        "INSERT INTO relay_mutations (vault_id, device_id, lamport, ciphertext, received_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![req.vault_id, req.device_id, req.lamport, ciphertext, now],
    ) {
        Ok(_) => {
            let seq = db.conn.last_insert_rowid();
            Json(PushResp { seq }).into_response()
        }
        Err(e) => {
            log::warn!("relay push error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn pull_mutations(
    State(db): State<SharedDb>,
    Query(q): Query<PullQuery>,
) -> impl IntoResponse {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    let after = q.after.unwrap_or(0);
    let exclude = q.exclude_device.as_deref().unwrap_or("");

    let db = db.lock().unwrap();
    let mut stmt = match db.conn.prepare(
        "SELECT seq, device_id, lamport, ciphertext FROM relay_mutations \
         WHERE vault_id = ?1 AND seq > ?2 AND device_id != ?3 \
         ORDER BY seq LIMIT 200",
    ) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("relay pull prepare error: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let mutations: Vec<RelayMutationItem> = match stmt
        .query_map(params![q.vault_id, after, exclude], |r| {
            let seq: i64 = r.get(0)?;
            let device_id: String = r.get(1)?;
            let lamport: i64 = r.get(2)?;
            let ciphertext: Vec<u8> = r.get(3)?;
            Ok((seq, device_id, lamport, ciphertext))
        }) {
        Ok(rows) => rows
            .filter_map(|r| r.ok())
            .map(|(seq, device_id, lamport, ciphertext)| RelayMutationItem {
                seq,
                device_id,
                lamport,
                ciphertext_b64: B64.encode(&ciphertext),
            })
            .collect(),
        Err(e) => {
            log::warn!("relay pull query error: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    Json(PullResp { mutations }).into_response()
}

async fn create_enroll_session(
    State(db): State<SharedDb>,
    Json(req): Json<EnrollReq>,
) -> impl IntoResponse {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    let encrypted_key = match B64.decode(&req.encrypted_vault_key_b64) {
        Ok(b) => b,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    // Clean expired sessions first
    let now = chrono::Utc::now().timestamp_millis();
    let db = db.lock().unwrap();
    let _ = db.conn.execute("DELETE FROM enroll_sessions WHERE expires_at < ?1", params![now]);
    match db.conn.execute(
        "INSERT OR REPLACE INTO enroll_sessions \
         (code_hash, vault_id, encrypted_vault_key, expires_at, attempts) \
         VALUES (?1, ?2, ?3, ?4, 0)",
        params![req.code_hash, req.vault_id, encrypted_key, req.expires_at],
    ) {
        Ok(_) => StatusCode::OK.into_response(),
        Err(e) => {
            log::warn!("relay enroll insert error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn fetch_enroll_session(
    State(db): State<SharedDb>,
    Path(code_hash): Path<String>,
) -> impl IntoResponse {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    let now = chrono::Utc::now().timestamp_millis();
    let db = db.lock().unwrap();

    use rusqlite::OptionalExtension;
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

    // Increment attempt counter
    let _ = db.conn.execute(
        "UPDATE enroll_sessions SET attempts = attempts + 1 WHERE code_hash = ?1",
        params![code_hash],
    );

    // Success — delete session (one-time use)
    let _ = db.conn.execute("DELETE FROM enroll_sessions WHERE code_hash = ?1", params![code_hash]);

    Json(EnrollFetchResp {
        vault_id,
        encrypted_vault_key_b64: B64.encode(&encrypted_key),
    }).into_response()
}

// ─── Server start ─────────────────────────────────────────────────────────────

/// Spawn the embedded relay HTTP server on the given port. Returns the bound port.
pub async fn start(relay_db_path: String, port: u16) -> Result<u16> {
    let db = RelayDb::open(&relay_db_path)?;
    let shared = Arc::new(Mutex::new(db));

    let app = Router::new()
        .route("/api/v1/mutations", post(push_mutation))
        .route("/api/v1/mutations", get(pull_mutations))
        .route("/api/v1/enroll", post(create_enroll_session))
        .route("/api/v1/enroll/:code_hash", get(fetch_enroll_session))
        .with_state(shared);

    let listener = TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .with_context(|| format!("binding relay server to port {port}"))?;
    let bound_port = listener.local_addr()?.port();

    log::info!("Embedded relay server listening on port {bound_port}");
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            log::error!("Relay server error: {e}");
        }
    });

    Ok(bound_port)
}
