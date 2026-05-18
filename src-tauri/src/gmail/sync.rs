use anyhow::{Context, Result};
use base64::Engine;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Semaphore;

use super::label_map::{gmail_to_nexus_label, map_gmail_labels};
use super::types::*;
use crate::db::VaultDb;

const GMAIL_API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const CONCURRENT_FETCHES: usize = 10;
// Per-page max allowed by Gmail API
const PAGE_SIZE: u32 = 500;

/// Intermediate result from a fetch-only pass (no DB access).
pub struct FetchResult {
    pub label_infos: Vec<super::label_map::GmailLabelInfo>,
    pub messages: Vec<ParsedMessage>,
    pub history_id: Option<String>,
}

/// Drives all Gmail synchronisation for one account.
/// Note: this struct does NOT hold a VaultDb so it is safe to use across await points.
pub struct GmailSyncer {
    pub account_id: String,
    pub vault_id: String,
    access_token: Arc<tokio::sync::RwLock<String>>,
    mail_dir: PathBuf,
    app: tauri::AppHandle,
}

impl GmailSyncer {
    pub fn new(
        account_id: String,
        vault_id: String,
        access_token: String,
        vault_path: &std::path::Path,
        app: tauri::AppHandle,
    ) -> Self {
        let mail_dir = vault_path.join("mail");
        Self {
            account_id,
            vault_id,
            access_token: Arc::new(tokio::sync::RwLock::new(access_token)),
            mail_dir,
            app,
        }
    }

    pub async fn update_access_token(&self, new_token: String) {
        *self.access_token.write().await = new_token;
    }

    fn emit_progress(&self, fetched: usize, total: usize) {
        let _ = self.app.emit(
            "gmail:sync-progress",
            serde_json::json!({
                "accountId": self.account_id,
                "fetched": fetched,
                "total": total,
            }),
        );
    }

    // ─── Phase 1: fetch-only (fully async, no DB) ─────────────────────────────

    /// Fetch labels and ALL messages (inbox, sent, archived, labeled) from the API.
    /// Excludes only trash and spam. Uses format=full (headers + body, no attachment
    /// bytes) for reliability. No DB access — safe to await freely.
    pub async fn fetch_initial(&self) -> Result<FetchResult> {
        tokio::fs::create_dir_all(&self.mail_dir).await.ok();

        let client = reqwest::Client::new();
        let token = self.access_token.read().await.clone();

        // Snapshot the current historyId BEFORE fetching messages so incremental
        // sync can start from a known-good point after the initial load completes.
        let history_id = self.fetch_current_history_id(&client, &token).await.ok();

        let labels = self.fetch_labels(&client, &token).await?;
        let label_infos = map_gmail_labels(&labels, &self.vault_id);

        // Fetch everything except trash and spam in one pass. Each message carries
        // its own labelIds (INBOX, SENT, user labels, etc.) so derive_folder_id
        // assigns the correct folder without needing separate queries.
        let all_ids = self
            .list_message_ids(&client, &token, "-in:trash -in:spam", None)
            .await?;

        // Emit total so the HUD can show "0 / N" before fetching starts.
        self.emit_progress(0, all_ids.len());

        let messages = self.fetch_messages_parallel(&client, token.clone(), all_ids).await;

        Ok(FetchResult {
            label_infos,
            messages,
            history_id,
        })
    }

    /// Fetch incremental changes since stored historyId.
    /// Returns None if history has expired (caller should fall back to full sync).
    pub async fn fetch_incremental(
        &self,
        start_history_id: &str,
    ) -> Result<Option<IncrementalResult>> {
        let client = reqwest::Client::new();
        let token = self.access_token.read().await.clone();

        let history = match self.fetch_history(&client, &token, start_history_id).await {
            Ok(h) => h,
            Err(e) if e.to_string().contains("history_expired") => return Ok(None),
            Err(e) => return Err(e),
        };

        let new_history_id = history.history_id.clone().unwrap_or_else(|| start_history_id.to_string());

        let history_items = history.history.unwrap_or_default();

        // Collect new message IDs to fetch
        let mut new_ids: Vec<GmailListEntry> = Vec::new();
        for item in &history_items {
            if let Some(added) = &item.messages_added {
                for entry in added {
                    new_ids.push(entry.message.clone());
                }
            }
        }

        let new_messages = self.fetch_messages_parallel(&client, token.clone(), new_ids).await;

        // Collect label changes
        let mut label_additions: Vec<(String, Vec<String>)> = Vec::new();
        let mut label_removals: Vec<(String, Vec<String>)> = Vec::new();

        for item in &history_items {
            if let Some(changes) = &item.labels_added {
                for ch in changes {
                    let nexus: Vec<String> = ch
                        .label_ids
                        .as_deref()
                        .unwrap_or_default()
                        .iter()
                        .filter_map(|id| gmail_to_nexus_label(id, &self.vault_id))
                        .collect();
                    if !nexus.is_empty() {
                        label_additions.push((ch.message.id.clone(), nexus));
                    }
                }
            }
            if let Some(changes) = &item.labels_removed {
                for ch in changes {
                    let nexus: Vec<String> = ch
                        .label_ids
                        .as_deref()
                        .unwrap_or_default()
                        .iter()
                        .filter_map(|id| gmail_to_nexus_label(id, &self.vault_id))
                        .collect();
                    if !nexus.is_empty() {
                        label_removals.push((ch.message.id.clone(), nexus));
                    }
                }
            }
        }

        Ok(Some(IncrementalResult {
            new_messages,
            label_additions,
            label_removals,
            new_history_id,
        }))
    }

    // ─── Phase 2: DB writes (synchronous, called from blocking context) ───────

    /// Write the results of `fetch_initial` to the database.
    /// This is synchronous — call from `tokio::task::spawn_blocking`.
    pub fn commit_initial(&self, db: &VaultDb, result: FetchResult) -> Result<SyncStats> {
        db.ensure_gmail_labels(&self.vault_id, &result.label_infos)?;
        let total = result.messages.len() as u32;
        let mut inserted = 0u32;
        for msg in &result.messages {
            if db.upsert_message_from_gmail(&self.vault_id, msg).unwrap_or(false) {
                inserted += 1;
            }
        }
        // Persist historyId so subsequent polls use incremental sync (not full re-fetch).
        if let Some(hid) = &result.history_id {
            db.update_history_id(&self.account_id, hid)?;
        }
        Ok(SyncStats {
            fetched: total,
            inserted,
            updated: 0,
        })
    }

    /// Write incremental results to the database.
    pub fn commit_incremental(&self, db: &VaultDb, result: IncrementalResult) -> Result<SyncStats> {
        let fetched = result.new_messages.len() as u32;
        let mut inserted = 0u32;
        let mut updated = 0u32;

        for msg in &result.new_messages {
            if db.upsert_message_from_gmail(&self.vault_id, msg).unwrap_or(false) {
                inserted += 1;
            }
        }
        for (provider_id, labels) in &result.label_additions {
            for label_id in labels {
                if db.add_label_by_provider_id(provider_id, label_id).is_ok() {
                    updated += 1;
                }
            }
        }
        for (provider_id, labels) in &result.label_removals {
            for label_id in labels {
                if db.remove_label_by_provider_id(provider_id, label_id).is_ok() {
                    updated += 1;
                }
            }
        }
        db.update_history_id(&self.account_id, &result.new_history_id)?;

        Ok(SyncStats { fetched, inserted, updated })
    }

    // ─── Convenience wrappers ─────────────────────────────────────────────────

    /// High-level initial sync: fetch then commit. Caller manages thread safety.
    pub async fn initial_sync_with_db(&self, db_path: &str) -> Result<SyncStats> {
        let fetch = self.fetch_initial().await?;
        let db = VaultDb::open(db_path, "nexus")?;
        self.commit_initial(&db, fetch)
    }

    /// High-level incremental sync. Falls back to initial if history expired.
    pub async fn incremental_sync_with_db(&self, db_path: &str) -> Result<SyncStats> {
        let db = VaultDb::open(db_path, "nexus")?;
        let history_id = db.get_history_id(&self.account_id)?;
        drop(db); // release before async work

        match history_id {
            None => self.initial_sync_with_db(db_path).await,
            Some(hid) => {
                match self.fetch_incremental(&hid).await? {
                    None => self.initial_sync_with_db(db_path).await, // expired
                    Some(result) => {
                        let db = VaultDb::open(db_path, "nexus")?;
                        self.commit_incremental(&db, result)
                    }
                }
            }
        }
    }

    // ─── Gmail API helpers ────────────────────────────────────────────────────

    async fn fetch_current_history_id(&self, client: &reqwest::Client, token: &str) -> Result<String> {
        #[derive(serde::Deserialize)]
        struct Profile { #[serde(rename = "historyId")] history_id: String }
        let url = format!("{GMAIL_API}/profile");
        let resp: Profile = client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .context("fetching profile")?
            .json()
            .await
            .context("parsing profile")?;
        Ok(resp.history_id)
    }

    async fn fetch_labels(
        &self,
        client: &reqwest::Client,
        token: &str,
    ) -> Result<Vec<GmailLabel>> {
        let url = format!("{GMAIL_API}/labels");
        let resp: GmailLabelsResponse = client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .context("fetching labels")?
            .json()
            .await
            .context("parsing labels")?;
        Ok(resp.labels.unwrap_or_default())
    }

    /// List message IDs matching `query`, paginating through all results.
    /// `total_limit`: if Some(n), stop after n messages; if None, fetch all.
    async fn list_message_ids(
        &self,
        client: &reqwest::Client,
        token: &str,
        query: &str,
        total_limit: Option<u32>,
    ) -> Result<Vec<GmailListEntry>> {
        let mut results = Vec::new();
        let mut page_token: Option<String> = None;

        loop {
            let mut url = format!(
                "{GMAIL_API}/messages?maxResults={PAGE_SIZE}&q={}",
                urlencoding::encode(query)
            );
            if let Some(pt) = &page_token {
                url.push_str(&format!("&pageToken={pt}"));
            }

            let resp: GmailListResponse = client
                .get(&url)
                .bearer_auth(token)
                .send()
                .await
                .context("listing messages")?
                .json()
                .await
                .context("parsing message list")?;

            let msgs = resp.messages.unwrap_or_default();
            let page_exhausted = msgs.len() < PAGE_SIZE as usize || resp.next_page_token.is_none();
            results.extend(msgs);

            // Enforce total cap if requested.
            if let Some(limit) = total_limit {
                if results.len() >= limit as usize {
                    results.truncate(limit as usize);
                    break;
                }
            }

            if page_exhausted {
                break;
            }
            page_token = resp.next_page_token;
        }

        Ok(results)
    }

    async fn fetch_messages_parallel(
        &self,
        client: &reqwest::Client,
        token: String,
        ids: Vec<GmailListEntry>,
    ) -> Vec<ParsedMessage> {
        let total = ids.len();
        let completed = Arc::new(AtomicUsize::new(0));
        let sem = Arc::new(Semaphore::new(CONCURRENT_FETCHES));
        let mut handles = Vec::with_capacity(total);

        for entry in ids {
            let client = client.clone();
            let token = token.clone();
            let account_id = self.account_id.clone();
            let vault_id = self.vault_id.clone();
            let sem = Arc::clone(&sem);
            let completed = Arc::clone(&completed);
            let app = self.app.clone();

            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();
                let result = fetch_and_parse_message(&client, &token, &entry.id, &account_id, &vault_id).await;

                // Emit progress every 10 messages so the HUD updates in real time.
                let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                if done % 10 == 0 || done == total {
                    let _ = app.emit(
                        "gmail:sync-progress",
                        serde_json::json!({
                            "accountId": account_id,
                            "fetched": done,
                            "total": total,
                        }),
                    );
                }

                result
            }));
        }

        let mut out = Vec::new();
        for h in handles {
            match h.await {
                Ok(Ok(msg)) => out.push(msg),
                Ok(Err(e)) => log::warn!("Message fetch failed: {e}"),
                Err(e) => log::warn!("Task panicked: {e}"),
            }
        }
        out
    }

    async fn fetch_history(
        &self,
        client: &reqwest::Client,
        token: &str,
        start_history_id: &str,
    ) -> Result<GmailHistoryResponse> {
        let url = format!(
            "{GMAIL_API}/history?startHistoryId={start_history_id}&historyTypes=messageAdded&historyTypes=labelAdded&historyTypes=labelRemoved"
        );
        let resp = client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .context("fetching history")?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(anyhow::anyhow!("history_expired"));
        }

        resp.json().await.context("parsing history response")
    }
}

/// Result from an incremental fetch (no DB access).
pub struct IncrementalResult {
    pub new_messages: Vec<ParsedMessage>,
    pub label_additions: Vec<(String, Vec<String>)>,
    pub label_removals: Vec<(String, Vec<String>)>,
    pub new_history_id: String,
}

// ─── Message fetching + parsing ───────────────────────────────────────────────

/// Fetch a single message using format=full (headers + body, no raw attachment bytes).
/// This is much more reliable than format=raw for large messages.
async fn fetch_and_parse_message(
    client: &reqwest::Client,
    token: &str,
    msg_id: &str,
    account_id: &str,
    vault_id: &str,
) -> Result<ParsedMessage> {
    let url = format!("{GMAIL_API}/messages/{msg_id}?format=full");
    let meta: GmailMessageMeta = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .context("fetching message")?
        .json()
        .await
        .context("parsing message")?;

    parse_gmail_message_full(meta, account_id, vault_id)
}

/// Parse a GmailMessageMeta (format=full) into a ParsedMessage.
fn parse_gmail_message_full(
    meta: GmailMessageMeta,
    account_id: &str,
    vault_id: &str,
) -> Result<ParsedMessage> {
    let payload = meta.payload.as_ref();

    let subject = payload
        .and_then(|p| get_payload_header(p, "Subject"))
        .unwrap_or_else(|| "(no subject)".into());
    let from_raw = payload
        .and_then(|p| get_payload_header(p, "From"))
        .unwrap_or_default();
    let to_raw = payload
        .and_then(|p| get_payload_header(p, "To"))
        .unwrap_or_default();
    let cc_raw = payload
        .and_then(|p| get_payload_header(p, "Cc"))
        .unwrap_or_default();
    let date_raw = payload
        .and_then(|p| get_payload_header(p, "Date"))
        .unwrap_or_default();

    let received_at = parse_rfc2822_date(&date_raw)
        .or_else(|| meta.internal_date.as_deref().and_then(|s| s.parse::<i64>().ok().map(|ms| ms / 1000)))
        .unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64
        });

    let from_addr = parse_address_json(&from_raw);
    let to_addrs = parse_addresses_json(&to_raw);
    let cc_addrs = parse_addresses_json(&cc_raw);

    let (body_text, body_html) = payload
        .map(extract_body_from_payload)
        .unwrap_or((None, None));

    let label_ids: Vec<String> = meta
        .label_ids
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter_map(|gid| gmail_to_nexus_label(gid, vault_id))
        .collect();

    let flags_read = meta
        .label_ids
        .as_deref()
        .unwrap_or_default()
        .iter()
        .all(|l| l != "UNREAD");

    let folder_id = derive_folder_id(&label_ids, vault_id);
    let nexus_id = format!("msg-{}", meta.id);
    let thread_id = format!("thr-{}", meta.thread_id);
    let body_ref = format!("body-{}", meta.id);
    let snippet = meta.snippet.clone().unwrap_or_default();

    Ok(ParsedMessage {
        id: nexus_id,
        provider_id: meta.id,
        account_id: account_id.to_string(),
        folder_id,
        thread_id,
        subject,
        snippet,
        body_ref,
        body_html: body_html.or(body_text.map(|t| format!("<pre>{t}</pre>"))),
        received_at,
        from_addr,
        to_addrs,
        cc_addrs,
        label_ids,
        flags_read,
        eml_path: None,
    })
}

fn get_payload_header(payload: &GmailPayload, name: &str) -> Option<String> {
    payload.headers.as_deref()?.iter()
        .find(|h| h.name.eq_ignore_ascii_case(name))
        .map(|h| h.value.clone())
}

fn extract_body_from_payload(payload: &GmailPayload) -> (Option<String>, Option<String>) {
    let mut text = None;
    let mut html = None;
    collect_body_from_payload(payload, &mut text, &mut html);
    (text, html)
}

fn collect_body_from_payload(
    payload: &GmailPayload,
    text: &mut Option<String>,
    html: &mut Option<String>,
) {
    let mime = payload.mime_type.as_deref().unwrap_or("").to_lowercase();

    if mime == "text/plain" && text.is_none() {
        if let Some(data) = payload.body.as_ref().and_then(|b| b.data.as_ref()) {
            if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(data) {
                if let Ok(s) = String::from_utf8(bytes) {
                    if !s.trim().is_empty() {
                        *text = Some(s);
                    }
                }
            }
        }
    } else if mime == "text/html" && html.is_none() {
        if let Some(data) = payload.body.as_ref().and_then(|b| b.data.as_ref()) {
            if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(data) {
                if let Ok(s) = String::from_utf8(bytes) {
                    if !s.trim().is_empty() {
                        *html = Some(s);
                    }
                }
            }
        }
    }

    for part in payload.parts.as_deref().unwrap_or_default() {
        collect_body_from_payload(part, text, html);
    }
}

fn derive_folder_id(label_ids: &[String], vault_id: &str) -> String {
    for pref in &["inbox", "sent", "drafts", "trash", "spam", "starred"] {
        let candidate = format!("{vault_id}-{pref}");
        if label_ids.contains(&candidate) {
            return candidate;
        }
    }
    format!("{vault_id}-inbox")
}

fn parse_rfc2822_date(s: &str) -> Option<i64> {
    mailparse::dateparse(s).ok()
}

fn parse_address_json(raw: &str) -> serde_json::Value {
    if raw.is_empty() {
        return serde_json::json!({ "name": null, "email": "" });
    }
    if let Some((name, email)) = split_name_email(raw) {
        serde_json::json!({ "name": name, "email": email })
    } else {
        serde_json::json!({ "name": null, "email": raw.trim() })
    }
}

fn parse_addresses_json(raw: &str) -> Vec<serde_json::Value> {
    if raw.is_empty() {
        return vec![];
    }
    raw.split(',')
        .map(|part| parse_address_json(part.trim()))
        .collect()
}

fn split_name_email(raw: &str) -> Option<(Option<String>, String)> {
    let raw = raw.trim();
    if let Some(angle) = raw.rfind('<') {
        let name = raw[..angle].trim().trim_matches('"').to_string();
        let email = raw[angle + 1..].trim_end_matches('>').trim().to_string();
        let name_opt = if name.is_empty() { None } else { Some(name) };
        Some((name_opt, email))
    } else {
        None
    }
}

mod urlencoding {
    pub fn encode(s: &str) -> String {
        s.chars()
            .flat_map(|c| match c {
                'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => {
                    c.to_string().into_bytes()
                }
                ' ' => vec![b'+'],
                c => {
                    let mut buf = [0u8; 4];
                    let encoded = c.encode_utf8(&mut buf);
                    encoded
                        .bytes()
                        .flat_map(|b| format!("%{b:02X}").into_bytes())
                        .collect()
                }
            })
            .map(|b| b as char)
            .collect()
    }
}
