/// Nexus Relay Server — standalone self-hosted binary.
///
/// Zero-knowledge: stores only encrypted ciphertext. Never has access to vault keys.
///
/// Usage:
///   RELAY_DB_PATH=./relay.db RELAY_PORT=3030 nexus-relay
///
/// Environment variables:
///   RELAY_DB_PATH   Path to the SQLite database file (default: ./relay.db)
///   RELAY_PORT      Port to listen on (default: 3030)
///   RELAY_HOST      Host to bind (default: 0.0.0.0)

mod db;
mod routes;

use std::sync::{Arc, Mutex};
use anyhow::Result;
use axum::{extract::DefaultBodyLimit, Router};
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;

/// Maximum body size per request (1 MB). Mutations are E2EE blobs; 1 MB is generous.
const MAX_BODY_BYTES: usize = 1 * 1024 * 1024;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();

    let db_path = std::env::var("RELAY_DB_PATH").unwrap_or_else(|_| "./relay.db".to_string());
    let port: u16 = std::env::var("RELAY_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3030);
    let host = std::env::var("RELAY_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());

    log::info!("Opening relay DB at {db_path}");
    let db = db::RelayDb::open(&db_path)?;
    let shared = Arc::new(Mutex::new(db));

    let app = Router::new()
        .merge(routes::router(Arc::clone(&shared)))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(CorsLayer::permissive());

    let addr = format!("{host}:{port}");
    let listener = TcpListener::bind(&addr).await?;
    let bound = listener.local_addr()?;
    log::info!("Nexus relay listening on http://{bound}");
    eprintln!("Nexus relay ready — http://{bound}");

    axum::serve(listener, app).await?;
    Ok(())
}
