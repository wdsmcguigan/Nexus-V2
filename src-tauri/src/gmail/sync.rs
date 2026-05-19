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
    client_mode: String,
    app: tauri::AppHandle,
}

impl GmailSyncer {
    pub fn new(
        account_id: String,
        vault_id: String,
        access_token: String,
        vault_path: &std::path::Path,
        client_mode: String,
        app: tauri::AppHandle,
    ) -> Self {
        let mail_dir = vault_path.join("mail");
        Self {
            account_id,
            vault_id,
            access_token: Arc::new(tokio::sync::RwLock::new(access_token)),
            mail_dir,
            client_mode,
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

    /// Write a minimal .eml file for a newly synced message (local-first mode only).
    fn write_eml_file(&self, db: &VaultDb, msg: &ParsedMessage) -> Result<()> {
        let folder_disk_path = db.folder_disk_path(&msg.folder_id);
        let target_dir = if folder_disk_path.is_empty() {
            self.mail_dir.join("inbox")
        } else {
            self.mail_dir.join(&folder_disk_path)
        };
        std::fs::create_dir_all(&target_dir)?;

        let from_email = msg.from_addr["email"].as_str().unwrap_or_default();
        let from_name = msg.from_addr["name"].as_str().unwrap_or_default();
        let to_list: String = msg.to_addrs.iter().map(|t| {
            let name = t["name"].as_str().unwrap_or_default();
            let email = t["email"].as_str().unwrap_or_default();
            if name.is_empty() { email.to_string() } else { format!("{name} <{email}>") }
        }).collect::<Vec<_>>().join(", ");
        let date = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(msg.received_at)
            .unwrap_or_default()
            .format("%a, %d %b %Y %H:%M:%S +0000")
            .to_string();

        let html_body = msg.body_html.as_deref().unwrap_or_default();
        let eml_content = format!(
            "MIME-Version: 1.0\r\nDate: {date}\r\nFrom: {from_name} <{from_email}>\r\nTo: {to_list}\r\nSubject: {subject}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{html_body}",
            subject = msg.subject,
        );

        let eml_path = target_dir.join(format!("{}.eml", msg.id));
        std::fs::write(&eml_path, eml_content.as_bytes())?;

        // Record the on-disk path so MOVE_TO_FOLDER can relocate the file later.
        let _ = db.conn.execute(
            "UPDATE messages SET eml_path = ?1 WHERE id = ?2",
            rusqlite::params![eml_path.to_str().unwrap_or_default(), msg.id],
        );
        Ok(())
    }

    /// Write the results of `fetch_initial` to the database atomically.
    pub fn commit_initial(&self, db: &VaultDb, result: FetchResult) -> Result<SyncStats> {
        db.conn.execute_batch("BEGIN IMMEDIATE")?;
        let outcome = (|| {
            db.ensure_gmail_labels(&self.vault_id, &result.label_infos)?;
            let total = result.messages.len() as u32;
            let mut inserted = 0u32;
            for msg in &result.messages {
                if db.upsert_message_from_gmail(&self.vault_id, msg).unwrap_or(false) {
                    inserted += 1;
                    if self.client_mode == "local-first" {
                        if let Err(e) = self.write_eml_file(db, msg) {
                            log::warn!("local-first: failed to write .eml for {}: {e}", msg.id);
                        }
                    }
                }
            }
            if let Some(hid) = &result.history_id {
                db.update_history_id(&self.account_id, hid)?;
            }
            Ok(SyncStats { fetched: total, inserted, updated: 0 })
        })();
        match outcome {
            Ok(stats) => { db.conn.execute_batch("COMMIT")?; Ok(stats) }
            Err(e) => { let _ = db.conn.execute_batch("ROLLBACK"); Err(e) }
        }
    }

    /// Write incremental results to the database atomically.
    pub fn commit_incremental(&self, db: &VaultDb, result: IncrementalResult) -> Result<SyncStats> {
        db.conn.execute_batch("BEGIN IMMEDIATE")?;
        let outcome = (|| {
            let fetched = result.new_messages.len() as u32;
            let mut inserted = 0u32;
            let mut updated = 0u32;

            for msg in &result.new_messages {
                if db.upsert_message_from_gmail(&self.vault_id, msg).unwrap_or(false) {
                    inserted += 1;
                    if self.client_mode == "local-first" {
                        if let Err(e) = self.write_eml_file(db, msg) {
                            log::warn!("local-first: failed to write .eml for {}: {e}", msg.id);
                        }
                    }
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
        })();
        match outcome {
            Ok(stats) => { db.conn.execute_batch("COMMIT")?; Ok(stats) }
            Err(e) => { let _ = db.conn.execute_batch("ROLLBACK"); Err(e) }
        }
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
                    None => {
                        log::warn!("History expired for {} — clearing historyId, running full resync", self.account_id);
                        let db = VaultDb::open(db_path, "nexus")?;
                        db.clear_history_id(&self.account_id)?;
                        drop(db);
                        self.initial_sync_with_db(db_path).await
                    }
                    Some(result) => {
                        let db = VaultDb::open(db_path, "nexus")?;
                        self.commit_incremental(&db, result)
                    }
                }
            }
        }
    }

    /// Re-fetch and store HTML bodies for any messages missing from message_bodies.
    /// Uses the same 10-concurrent semaphore pattern as the initial sync.
    pub async fn repair_missing_bodies(&self, db_path: &str) -> Result<usize> {
        let missing = {
            let db = VaultDb::open(db_path, "nexus")?;
            db.get_messages_missing_bodies(&self.account_id)?
        };
        if missing.is_empty() {
            return Ok(0);
        }

        let client = reqwest::Client::new();
        let token = self.access_token.read().await.clone();
        let sem = Arc::new(Semaphore::new(CONCURRENT_FETCHES));
        let completed = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::with_capacity(missing.len());

        for (_nexus_id, provider_id) in missing {
            let client = client.clone();
            let token = token.clone();
            let account_id = self.account_id.clone();
            let vault_id = self.vault_id.clone();
            let sem = Arc::clone(&sem);
            let completed = Arc::clone(&completed);
            let db_path = db_path.to_string();

            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();
                let body_ref = format!("body-{provider_id}");
                let stored = match fetch_and_parse_message(&client, &token, &provider_id, &account_id, &vault_id).await {
                    Ok(Some(parsed)) => {
                        if let Some(html) = parsed.body_html {
                            if let Ok(db) = VaultDb::open(&db_path, "nexus") {
                                db.upsert_body(&body_ref, &html).is_ok()
                            } else { false }
                        } else { false }
                    }
                    Ok(None) => false, // deleted — skip silently
                    Err(e) => {
                        log::warn!("body repair: fetch failed for {provider_id}: {e}");
                        false
                    }
                };
                completed.fetch_add(1, Ordering::Relaxed);
                stored
            }));
        }

        let mut fixed = 0usize;
        for h in handles {
            if let Ok(true) = h.await { fixed += 1; }
        }
        Ok(fixed)
    }

    // ─── Gmail API helpers ────────────────────────────────────────────────────

    async fn fetch_current_history_id(&self, client: &reqwest::Client, token: &str) -> Result<String> {
        #[derive(serde::Deserialize)]
        struct Profile { #[serde(rename = "historyId")] history_id: String }
        let url = format!("{GMAIL_API}/profile");
        let resp = client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .context("fetching profile")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Gmail profile API {status}: {body}"));
        }
        let profile: Profile = resp.json().await.context("parsing profile")?;
        Ok(profile.history_id)
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

            let raw = client
                .get(&url)
                .bearer_auth(token)
                .send()
                .await
                .context("listing messages")?;
            if !raw.status().is_success() {
                let status = raw.status();
                let body = raw.text().await.unwrap_or_default();
                return Err(anyhow::anyhow!("Gmail list API {status}: {body}"));
            }
            let resp: GmailListResponse = raw.json().await.context("parsing message list")?;

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
                Ok(Ok(Some(msg))) => out.push(msg),
                Ok(Ok(None)) => {} // deleted — skip silently
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
        let base_url = format!(
            "{GMAIL_API}/history?startHistoryId={start_history_id}&historyTypes=messageAdded&historyTypes=labelAdded&historyTypes=labelRemoved"
        );

        let mut all_history: Vec<GmailHistory> = Vec::new();
        let mut latest_history_id: Option<String> = None;
        let mut page_token: Option<String> = None;

        loop {
            let mut url = base_url.clone();
            if let Some(ref pt) = page_token {
                url.push_str(&format!("&pageToken={pt}"));
            }

            let resp = client
                .get(&url)
                .bearer_auth(token)
                .send()
                .await
                .context("fetching history")?;

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                return Err(anyhow::anyhow!("history_expired"));
            }
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(anyhow::anyhow!("Gmail history API {status}: {body}"));
            }

            let page: GmailHistoryResponse = resp.json().await.context("parsing history response")?;

            if latest_history_id.is_none() {
                latest_history_id = page.history_id.clone();
            }
            all_history.extend(page.history.unwrap_or_default());

            match page.next_page_token {
                Some(t) if !t.is_empty() => page_token = Some(t),
                _ => break,
            }
        }

        Ok(GmailHistoryResponse {
            history: if all_history.is_empty() { None } else { Some(all_history) },
            history_id: latest_history_id,
            next_page_token: None,
        })
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
/// Returns Ok(None) when the message has been deleted (HTTP 404) — caller should skip silently.
async fn fetch_and_parse_message(
    client: &reqwest::Client,
    token: &str,
    msg_id: &str,
    account_id: &str,
    vault_id: &str,
) -> Result<Option<ParsedMessage>> {
    let url = format!("{GMAIL_API}/messages/{msg_id}?format=full");
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .context("fetching message")?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        log::debug!("Message {msg_id} not found (deleted) — skipping");
        return Ok(None);
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("Gmail message API {status}: {body}"));
    }

    let meta: GmailMessageMeta = resp.json().await.context("parsing message")?;
    parse_gmail_message_full(meta, account_id, vault_id).map(Some)
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

    // internalDate is a guaranteed ms timestamp from Gmail's servers; prefer it
    // over the RFC2822 Date header which is caller-supplied and can be malformed.
    let received_at = meta.internal_date
        .as_deref()
        .and_then(|s| s.parse::<i64>().ok())
        .or_else(|| parse_rfc2822_date(&date_raw))
        .unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64
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

    let mut attachments = Vec::new();
    if let Some(p) = meta.payload.as_ref() {
        collect_attachments(p, &mut attachments);
    }

    let list_unsubscribe = payload.and_then(|p| get_payload_header(p, "List-Unsubscribe"));
    let list_unsubscribe_post = payload.and_then(|p| get_payload_header(p, "List-Unsubscribe-Post"));

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
        attachments,
        list_unsubscribe,
        list_unsubscribe_post,
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

fn decode_b64url(data: &str) -> Option<Vec<u8>> {
    // Gmail spec: base64url, may include `=` padding. URL_SAFE_NO_PAD is strict —
    // strip trailing `=` before decoding so both padded and unpadded strings work.
    let stripped = data.trim_end_matches('=');
    base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(stripped).ok()
}

fn collect_body_from_payload(
    payload: &GmailPayload,
    text: &mut Option<String>,
    html: &mut Option<String>,
) {
    let mime = payload.mime_type.as_deref().unwrap_or("").to_lowercase();

    if mime == "text/plain" && text.is_none() {
        if let Some(data) = payload.body.as_ref().and_then(|b| b.data.as_ref()) {
            if let Some(bytes) = decode_b64url(data) {
                if let Ok(s) = String::from_utf8(bytes) {
                    if !s.trim().is_empty() {
                        *text = Some(s);
                    }
                }
            }
        }
    } else if mime == "text/html" && html.is_none() {
        if let Some(data) = payload.body.as_ref().and_then(|b| b.data.as_ref()) {
            if let Some(bytes) = decode_b64url(data) {
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

fn collect_attachments(payload: &crate::gmail::types::GmailPayload, out: &mut Vec<crate::gmail::types::ParsedAttachment>) {
    use crate::gmail::types::ParsedAttachment;
    let filename = payload.filename.as_deref().unwrap_or("").trim();
    if !filename.is_empty() {
        if let Some(body) = &payload.body {
            if let Some(att_id) = body.attachment_id.as_ref().filter(|s| !s.is_empty()) {
                let mime = payload.mime_type.as_deref().unwrap_or("application/octet-stream");
                out.push(ParsedAttachment::from_gmail(
                    filename.to_string(),
                    body.size.unwrap_or(0),
                    mime,
                    att_id.clone(),
                ));
                return; // attachment parts don't recurse
            }
        }
    }
    for part in payload.parts.as_deref().unwrap_or_default() {
        collect_attachments(part, out);
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
    mailparse::dateparse(s).ok().map(|secs| secs * 1000)
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
