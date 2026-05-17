use anyhow::{Context, Result};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

use crate::db::VaultDb;

/// Paths written by the app during sync — suppressed in the inbound watcher.
type CookieMap = Arc<Mutex<HashMap<PathBuf, Instant>>>;

pub fn start(
    app: tauri::AppHandle,
    vault_path: String,
    _state: &crate::AppState,
) -> Result<()> {
    let vault_root = PathBuf::from(expand_tilde(&vault_path));
    let cookie_map: CookieMap = Arc::new(Mutex::new(HashMap::new()));

    let app_handle = app.clone();
    let cookies = Arc::clone(&cookie_map);
    let vp = vault_path.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            let event = match res {
                Ok(e) => e,
                Err(e) => { log::warn!("Watcher error: {e}"); return; }
            };
            handle_event(&event, &cookies, &app_handle, &vault_root, &vp);
        },
        notify::Config::default().with_poll_interval(Duration::from_secs(2)),
    )
    .context("creating filesystem watcher")?;

    let watch_root = PathBuf::from(expand_tilde(&vault_path));
    watcher
        .watch(&watch_root, RecursiveMode::Recursive)
        .context("watching vault root")?;

    // Keep watcher alive by moving it to a background thread
    std::thread::spawn(move || {
        loop { std::thread::sleep(Duration::from_secs(60)); }
        #[allow(unreachable_code)]
        drop(watcher);
    });

    log::info!("Filesystem watcher started on {:?}", watch_root);
    Ok(())
}

fn handle_event(
    event: &Event,
    cookies: &CookieMap,
    app: &tauri::AppHandle,
    vault_root: &Path,
    vault_path: &str,
) {
    for path in &event.paths {
        if path.extension().and_then(|e| e.to_str()) != Some("eml") {
            continue;
        }
        // Skip app-initiated writes
        {
            let mut map = cookies.lock().unwrap();
            if let Some(ts) = map.get(path) {
                if ts.elapsed() < Duration::from_secs(5) { continue; }
                map.remove(path);
            }
        }

        match event.kind {
            EventKind::Create(_) => {
                log::debug!("Watcher: new eml {:?}", path);
                ingest_eml(app.clone(), path.clone(), vault_root.to_path_buf(), vault_path.to_string());
            }
            EventKind::Modify(notify::event::ModifyKind::Name(_)) => {
                log::debug!("Watcher: move detected {:?}", path);
                // Determine new folder from path and update DB
                on_eml_moved(app.clone(), path.clone(), vault_root.to_path_buf(), vault_path.to_string());
            }
            EventKind::Remove(_) => {
                log::debug!("Watcher: delete {:?}", path);
                on_eml_deleted(app.clone(), path.clone(), vault_path.to_string());
            }
            _ => {}
        }
    }
}

// ─── Ingest a new .eml dragged into the vault ─────────────────────────────────

fn ingest_eml(app: tauri::AppHandle, path: PathBuf, vault_root: PathBuf, vault_path: String) {
    tauri::async_runtime::spawn(async move {
        let bytes = match tokio::fs::read(&path).await {
            Ok(b) => b,
            Err(e) => { log::warn!("Watcher: could not read {:?}: {e}", path); return; }
        };

        let parsed = match mailparse::parse_mail(&bytes) {
            Ok(p) => p,
            Err(e) => { log::warn!("Watcher: could not parse {:?}: {e}", path); return; }
        };

        // Extract headers
        let subject = header(&parsed, "Subject").unwrap_or_else(|| "(no subject)".into());
        let from_raw = header(&parsed, "From").unwrap_or_default();
        let to_raw = header(&parsed, "To").unwrap_or_default();
        let date_raw = header(&parsed, "Date").unwrap_or_default();
        let received_at = parse_date_ms(&date_raw).unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0)
        });

        // Extract body HTML (or plain text wrapped in <p>)
        let body_html = extract_body_html(&parsed);
        let snippet: String = strip_html(&body_html).chars().take(200).collect();

        // Derive folder from parent directory name relative to vault root
        let folder_name = path
            .parent()
            .and_then(|p| p.strip_prefix(&vault_root).ok())
            .and_then(|p| p.iter().next())
            .and_then(|s| s.to_str())
            .unwrap_or("INBOX")
            .to_string();

        // Stable ID from path hash
        let id = format!("eml-{:x}", xxhash(&path.to_string_lossy()));
        let body_ref = format!("body-{:x}", xxhash(&String::from_utf8_lossy(&bytes)));
        let eml_path = path.to_string_lossy().to_string();

        let from_json = addr_json(&from_raw);
        let to_json = format!("[{}]", addr_json(&to_raw));

        // Open a fresh DB connection (WAL mode supports concurrent writers)
        let db = match open_db(&vault_path) {
            Ok(db) => db,
            Err(e) => { log::warn!("Watcher: DB open failed: {e}"); let _ = app.emit("vault:hydrate-needed", ()); return; }
        };

        // Resolve folder → label id
        let base = Path::new(&vault_path).file_name()
            .and_then(|n| n.to_str()).unwrap_or("default");
        let vault_id = format!("vault-{base}");

        let folder_id = db.find_label_by_slug(&vault_id, &folder_name)
            .ok().flatten()
            .unwrap_or_else(|| format!("{vault_id}-inbox"));

        match db.insert_eml_message(
            &vault_id, &id, &body_ref, &folder_id,
            &subject, &snippet, &from_json, &to_json,
            received_at, Some(&body_html), &eml_path,
        ) {
            Ok(true) => log::info!("Watcher: ingested '{}' from {:?}", subject, path),
            Ok(false) => log::debug!("Watcher: already indexed {:?}", path),
            Err(e) => log::warn!("Watcher: insert failed for {:?}: {e}", path),
        }

        let _ = app.emit("vault:hydrate-needed", ());
    });
}

// ─── Handle a .eml that was moved to a new folder ────────────────────────────

fn on_eml_moved(app: tauri::AppHandle, path: PathBuf, vault_root: PathBuf, vault_path: String) {
    tauri::async_runtime::spawn(async move {
        let folder_name = path
            .parent()
            .and_then(|p| p.strip_prefix(&vault_root).ok())
            .and_then(|p| p.iter().next())
            .and_then(|s| s.to_str())
            .unwrap_or("INBOX")
            .to_string();

        let db = match open_db(&vault_path) {
            Ok(db) => db,
            Err(e) => { log::warn!("Watcher: DB open failed: {e}"); let _ = app.emit("vault:hydrate-needed", ()); return; }
        };

        let base = Path::new(&vault_path).file_name()
            .and_then(|n| n.to_str()).unwrap_or("default");
        let vault_id = format!("vault-{base}");

        let folder_id = db.find_label_by_slug(&vault_id, &folder_name)
            .ok().flatten()
            .unwrap_or_else(|| format!("{vault_id}-inbox"));

        let eml_path = path.to_string_lossy().to_string();
        match db.update_message_folder_by_path(&eml_path, &folder_id) {
            Ok(true) => log::info!("Watcher: moved message to folder {folder_id}"),
            Ok(false) => { /* New path — may be an ingest */ ingest_eml(app.clone(), path, vault_root, vault_path); return; }
            Err(e) => log::warn!("Watcher: folder update failed: {e}"),
        }
        let _ = app.emit("vault:hydrate-needed", ());
    });
}

// ─── Handle a .eml that was deleted ─────────────────────────────────────────

fn on_eml_deleted(app: tauri::AppHandle, path: PathBuf, vault_path: String) {
    tauri::async_runtime::spawn(async move {
        let eml_path = path.to_string_lossy().to_string();
        let db = match open_db(&vault_path) {
            Ok(db) => db,
            Err(e) => { log::warn!("Watcher: DB open failed: {e}"); let _ = app.emit("vault:hydrate-needed", ()); return; }
        };
        match db.delete_message_by_path(&eml_path) {
            Ok(Some(id)) => log::info!("Watcher: deleted message {id}"),
            Ok(None) => log::debug!("Watcher: no DB record for deleted path {:?}", path),
            Err(e) => log::warn!("Watcher: delete failed for {:?}: {e}", path),
        }
        let _ = app.emit("vault:hydrate-needed", ());
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn open_db(vault_path: &str) -> Result<VaultDb> {
    let expanded = expand_tilde(vault_path);
    VaultDb::open(&format!("{expanded}/nexus.db"), "nexus")
}

fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{}{}", home, &path[1..]);
        }
    }
    path.to_string()
}

fn header(mail: &mailparse::ParsedMail, name: &str) -> Option<String> {
    mail.headers.iter()
        .find(|h| h.get_key_ref().eq_ignore_ascii_case(name))
        .map(|h| h.get_value())
}

fn extract_body_html(mail: &mailparse::ParsedMail) -> String {
    // Prefer text/html part, fall back to text/plain wrapped in <pre>
    find_part(mail, "text/html")
        .or_else(|| find_part(mail, "text/plain").map(|t| format!("<pre>{}</pre>", html_escape(&t))))
        .unwrap_or_default()
}

fn find_part(mail: &mailparse::ParsedMail, mime: &str) -> Option<String> {
    if mail.ctype.mimetype.eq_ignore_ascii_case(mime) {
        return mail.get_body().ok();
    }
    for part in &mail.subparts {
        if let Some(body) = find_part(part, mime) {
            return Some(body);
        }
    }
    None
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_date_ms(date: &str) -> Option<i64> {
    // Try mailparse's date parser
    mailparse::dateparse(date).ok().map(|secs| secs * 1000)
}

fn addr_json(raw: &str) -> String {
    let name = raw.split('<').next().unwrap_or(raw).trim().trim_matches('"');
    let email = raw.split('<').nth(1)
        .and_then(|s| s.split('>').next())
        .unwrap_or(raw)
        .trim();
    format!(r#"{{"name":{},"email":{}}}"#,
        serde_json::to_string(name).unwrap_or_else(|_| "\"\"".into()),
        serde_json::to_string(email).unwrap_or_else(|_| "\"\"".into()))
}

/// Simple non-cryptographic hash for stable IDs.
fn xxhash(s: &str) -> u64 {
    s.bytes().fold(0xcbf29ce484222325u64, |acc, b| {
        acc.wrapping_mul(0x100000001b3).wrapping_add(b as u64)
    })
}
