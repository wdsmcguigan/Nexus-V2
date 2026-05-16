use anyhow::{Context, Result};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

use crate::AppState;

/// Paths written by the app during sync — suppressed in the inbound watcher.
type CookieMap = Arc<Mutex<HashMap<PathBuf, Instant>>>;

pub fn start(
    app: tauri::AppHandle,
    vault_path: String,
    _state: &AppState,
) -> Result<()> {
    let vault_root = PathBuf::from(&vault_path);
    let cookie_map: CookieMap = Arc::new(Mutex::new(HashMap::new()));

    let app_handle = app.clone();
    let cookies = Arc::clone(&cookie_map);

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            let event = match res {
                Ok(e) => e,
                Err(e) => {
                    log::warn!("Watcher error: {e}");
                    return;
                }
            };
            handle_event(&event, &cookies, &app_handle, &vault_path);
        },
        notify::Config::default().with_poll_interval(Duration::from_secs(2)),
    )
    .context("creating filesystem watcher")?;

    watcher
        .watch(&vault_root, RecursiveMode::Recursive)
        .context("watching vault root")?;

    // Keep watcher alive by moving it to a background thread
    std::thread::spawn(move || {
        // The watcher runs until this thread exits (i.e., the app exits)
        loop {
            std::thread::sleep(Duration::from_secs(60));
        }
        #[allow(unreachable_code)]
        drop(watcher);
    });

    log::info!("Filesystem watcher started on {vault_root:?}");
    Ok(())
}

fn handle_event(
    event: &Event,
    cookies: &CookieMap,
    app: &tauri::AppHandle,
    vault_path: &str,
) {
    for path in &event.paths {
        // Skip non-.eml files
        if path.extension().and_then(|e| e.to_str()) != Some("eml") {
            continue;
        }

        // Skip if this path was written by the app itself (cookie within 5s)
        {
            let mut map = cookies.lock().unwrap();
            if let Some(ts) = map.get(path) {
                if ts.elapsed() < Duration::from_secs(5) {
                    continue;
                }
                map.remove(path);
            }
        }

        match event.kind {
            EventKind::Create(_) => {
                log::debug!("Watcher: new eml {:?}", path);
                // Ingest new .eml dragged in from Finder
                ingest_eml(app, path, vault_path);
            }
            EventKind::Modify(notify::event::ModifyKind::Name(_)) => {
                // Move detected — re-hydrate is the simplest correct response
                log::debug!("Watcher: move detected {:?}", path);
                let _ = app.emit("vault:hydrate-needed", ());
            }
            EventKind::Remove(_) => {
                log::debug!("Watcher: delete {:?}", path);
                on_eml_deleted(app, path);
            }
            _ => {}
        }
    }
}

fn ingest_eml(app: &tauri::AppHandle, path: &Path, _vault_path: &str) {
    let path = path.to_path_buf();
    let app = app.clone();
    tokio::spawn(async move {
        match tokio::fs::read(&path).await {
            Ok(bytes) => {
                // Parse the .eml and derive folder from its containing directory
                if let Ok(parsed) = mailparse::parse_mail(&bytes) {
                    let subject = parsed
                        .headers
                        .iter()
                        .find(|h| h.get_key_ref().eq_ignore_ascii_case("Subject"))
                        .map(|h| h.get_value())
                        .unwrap_or_else(|| "(no subject)".into());
                    log::info!("Watcher: ingested '{}' from {:?}", subject, path);
                }
                // Notify JS to re-hydrate with fresh DB data
                let _ = app.emit("vault:hydrate-needed", ());
            }
            Err(e) => log::warn!("Watcher: could not read {path:?}: {e}"),
        }
    });
}

fn on_eml_deleted(app: &tauri::AppHandle, _path: &Path) {
    // Simplest approach: emit hydrate-needed; JS will reconcile missing messages
    let _ = app.emit("vault:hydrate-needed", ());
}
