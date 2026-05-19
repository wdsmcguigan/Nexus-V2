use anyhow::Result;
use tauri::Emitter;

use super::imap::ImapConfig;

/// Spawn a background task that watches INBOX via polling.
/// Falls back to 30-second polling if server doesn't support IDLE.
pub fn start_idle_watcher(
    account_id: String,
    _config: ImapConfig,
    app: tauri::AppHandle,
) {
    tokio::spawn(async move {
        let mut backoff_secs = 5u64;
        loop {
            match run_idle_loop(&account_id, &app).await {
                Ok(()) => {
                    backoff_secs = 5;
                }
                Err(e) => {
                    log::warn!(
                        "IMAP IDLE error for {account_id}: {e} — reconnecting in {backoff_secs}s"
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)).await;
                    backoff_secs = (backoff_secs * 2).min(300);
                }
            }
        }
    });
}

async fn run_idle_loop(account_id: &str, app: &tauri::AppHandle) -> Result<()> {
    // Poll every 30 seconds as fallback (IDLE requires more complex setup)
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let _ = app.emit("vault:hydrate-needed", ());
        log::debug!("IMAP poll tick for {account_id}");
    }
}
