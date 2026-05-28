//! IMAP IDLE watcher (RFC 2177).
//!
//! Spawns a background task that holds an IMAP connection in IDLE state and
//! emits `vault:hydrate-needed` on every server-pushed mailbox change. If the
//! server does not advertise the `IDLE` capability, falls back to a 30-second
//! polling loop. RFC 2177 requires re-issuing IDLE at least every 29 minutes;
//! we re-arm every 28 to leave headroom.
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use async_imap::extensions::idle::IdleResponse;
use tauri::Emitter;

use super::imap::{ImapConfig, Security};

const IDLE_TIMEOUT: Duration = Duration::from_secs(28 * 60);
const POLL_INTERVAL: Duration = Duration::from_secs(30);
const INITIAL_BACKOFF: Duration = Duration::from_secs(5);
const MAX_BACKOFF: Duration = Duration::from_secs(300);

/// Spawn a background task that watches INBOX via IMAP IDLE.
/// On error (network drop, server bounce) reconnects with exponential backoff.
/// Falls back to 30-second polling if the server lacks the IDLE capability.
pub fn start_idle_watcher(account_id: String, config: ImapConfig, app: tauri::AppHandle) {
    tokio::spawn(async move {
        let mut backoff = INITIAL_BACKOFF;
        loop {
            match run_session(&account_id, &config, &app).await {
                Ok(()) => {
                    backoff = INITIAL_BACKOFF;
                }
                Err(e) => {
                    log::warn!(
                        "IMAP IDLE error for {account_id}: {e} — reconnecting in {}s",
                        backoff.as_secs()
                    );
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(MAX_BACKOFF);
                }
            }
        }
    });
}

async fn run_session(account_id: &str, config: &ImapConfig, app: &tauri::AppHandle) -> Result<()> {
    match &config.security {
        Security::Tls => run_session_tls(account_id, config, app).await,
        Security::StartTls | Security::Plain => run_session_plain(account_id, config, app).await,
    }
}

async fn run_session_tls(
    account_id: &str,
    config: &ImapConfig,
    app: &tauri::AppHandle,
) -> Result<()> {
    use tokio_rustls::rustls;

    let tcp = tokio::time::timeout(
        Duration::from_secs(30),
        tokio::net::TcpStream::connect(format!("{}:{}", config.host, config.port)),
    )
    .await
    .context("connect timeout")?
    .context("TCP connect")?;
    tcp.set_nodelay(true).ok();

    let mut root_store = rustls::RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls_cfg = std::sync::Arc::new(
        rustls::ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth(),
    );
    let connector = tokio_rustls::TlsConnector::from(tls_cfg);
    let server_name = rustls::pki_types::ServerName::try_from(config.host.as_str().to_owned())
        .map_err(|e| anyhow!("bad hostname: {e}"))?;
    let tls = connector.connect(server_name, tcp).await.context("TLS handshake")?;

    let client = async_imap::Client::new(tls);
    let session = client
        .login(&config.username, &config.password)
        .await
        .map_err(|(e, _)| anyhow!("IMAP login failed: {e}"))?;

    run_after_login(account_id, session, app).await
}

async fn run_session_plain(
    account_id: &str,
    config: &ImapConfig,
    app: &tauri::AppHandle,
) -> Result<()> {
    let tcp = tokio::time::timeout(
        Duration::from_secs(30),
        tokio::net::TcpStream::connect(format!("{}:{}", config.host, config.port)),
    )
    .await
    .context("connect timeout")?
    .context("TCP connect")?;
    tcp.set_nodelay(true).ok();

    let client = async_imap::Client::new(tcp);
    let session = client
        .login(&config.username, &config.password)
        .await
        .map_err(|(e, _)| anyhow!("IMAP login failed: {e}"))?;

    run_after_login(account_id, session, app).await
}

async fn run_after_login<S>(
    account_id: &str,
    mut session: async_imap::Session<S>,
    app: &tauri::AppHandle,
) -> Result<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + std::fmt::Debug,
{
    let caps = session
        .capabilities()
        .await
        .map_err(|e| anyhow!("CAPABILITY failed: {e}"))?;
    let supports_idle = caps.has_str("IDLE");

    session
        .select("INBOX")
        .await
        .map_err(|e| anyhow!("SELECT INBOX failed: {e}"))?;

    if supports_idle {
        log::info!("IMAP IDLE active for {account_id}");
        run_idle_loop(account_id, session, app).await
    } else {
        log::info!("IMAP server for {account_id} lacks IDLE — falling back to 30s polling");
        run_poll_loop(account_id, session, app).await
    }
}

async fn run_idle_loop<S>(
    account_id: &str,
    mut session: async_imap::Session<S>,
    app: &tauri::AppHandle,
) -> Result<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + std::fmt::Debug,
{
    loop {
        let mut handle = session.idle();
        handle
            .init()
            .await
            .map_err(|e| anyhow!("IDLE init failed: {e}"))?;
        let (fut, _stop) = handle.wait_with_timeout(IDLE_TIMEOUT);
        let resp = fut.await.map_err(|e| anyhow!("IDLE wait failed: {e}"))?;
        session = handle
            .done()
            .await
            .map_err(|e| anyhow!("IDLE DONE failed: {e}"))?;
        match resp {
            IdleResponse::NewData(_) => {
                log::debug!("IMAP IDLE: new data for {account_id}");
                let _ = app.emit("vault:hydrate-needed", ());
            }
            IdleResponse::Timeout => {
                log::trace!("IMAP IDLE re-arm for {account_id}");
            }
            IdleResponse::ManualInterrupt => {
                log::trace!("IMAP IDLE interrupted for {account_id}");
            }
        }
    }
}

async fn run_poll_loop<S>(
    account_id: &str,
    mut session: async_imap::Session<S>,
    app: &tauri::AppHandle,
) -> Result<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + std::fmt::Debug,
{
    let mut last_exists: Option<u32> = None;
    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        let mailbox = session
            .examine("INBOX")
            .await
            .map_err(|e| anyhow!("EXAMINE INBOX failed: {e}"))?;
        let exists = mailbox.exists;
        if last_exists.map(|prev| exists != prev).unwrap_or(true) {
            log::debug!("IMAP poll: INBOX EXISTS={exists} for {account_id}");
            let _ = app.emit("vault:hydrate-needed", ());
        }
        last_exists = Some(exists);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_are_reasonable() {
        // RFC 2177: re-issue IDLE at least every 29 minutes.
        assert!(IDLE_TIMEOUT < Duration::from_secs(29 * 60));
        assert!(POLL_INTERVAL >= Duration::from_secs(10));
        assert!(MAX_BACKOFF >= INITIAL_BACKOFF);
    }
}
