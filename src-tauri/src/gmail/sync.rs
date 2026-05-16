use anyhow::{anyhow, Context, Result};
use base64::Engine;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Semaphore;

use super::label_map::{gmail_to_nexus_label, map_gmail_labels};
use super::types::*;
use crate::db::VaultDb;

const GMAIL_API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const CONCURRENT_FETCHES: usize = 10;

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
}

impl GmailSyncer {
    pub fn new(
        account_id: String,
        vault_id: String,
        access_token: String,
        vault_path: &Path,
    ) -> Self {
        let mail_dir = vault_path.join("mail");
        Self {
            account_id,
            vault_id,
            access_token: Arc::new(tokio::sync::RwLock::new(access_token)),
            mail_dir,
        }
    }

    pub async fn update_access_token(&self, new_token: String) {
        *self.access_token.write().await = new_token;
    }

    // ─── Phase 1: fetch-only (fully async, no DB) ─────────────────────────────

    /// Fetch labels and up to 500 inbox messages from the API.
    /// No DB access — safe to await freely.
    pub async fn fetch_initial(&self) -> Result<FetchResult> {
        tokio::fs::create_dir_all(&self.mail_dir).await.ok();

        let client = reqwest::Client::new();
        let token = self.access_token.read().await.clone();

        // Snapshot the current historyId BEFORE fetching messages so incremental
        // sync can start from a known-good point after the initial load completes.
        let history_id = self.fetch_current_history_id(&client, &token).await.ok();

        let labels = self.fetch_labels(&client, &token).await?;
        let label_infos = map_gmail_labels(&labels, &self.vault_id);

        let ids = self
            .list_message_ids(&client, &token, "in:inbox", Some(500))
            .await?;

        let messages = self.fetch_messages_parallel(&client, token.clone(), ids).await;

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

    async fn list_message_ids(
        &self,
        client: &reqwest::Client,
        token: &str,
        query: &str,
        max: Option<u32>,
    ) -> Result<Vec<GmailListEntry>> {
        let mut results = Vec::new();
        let mut page_token: Option<String> = None;
        let max_results = max.unwrap_or(500).min(500);

        loop {
            let mut url = format!(
                "{GMAIL_API}/messages?maxResults={max_results}&q={}",
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
            let done = msgs.len() < max_results as usize || resp.next_page_token.is_none();
            results.extend(msgs);

            if done || results.len() >= max_results as usize {
                break;
            }
            page_token = resp.next_page_token;
        }

        results.truncate(max_results as usize);
        Ok(results)
    }

    async fn fetch_messages_parallel(
        &self,
        client: &reqwest::Client,
        token: String,
        ids: Vec<GmailListEntry>,
    ) -> Vec<ParsedMessage> {
        let sem = Arc::new(Semaphore::new(CONCURRENT_FETCHES));
        let mut handles = Vec::with_capacity(ids.len());

        for entry in ids {
            let client = client.clone();
            let token = token.clone();
            let account_id = self.account_id.clone();
            let vault_id = self.vault_id.clone();
            let mail_dir = self.mail_dir.clone();
            let sem = Arc::clone(&sem);

            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();
                fetch_and_parse_message(&client, &token, &entry.id, &account_id, &vault_id, &mail_dir).await
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
            return Err(anyhow!("history_expired"));
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

async fn fetch_and_parse_message(
    client: &reqwest::Client,
    token: &str,
    msg_id: &str,
    account_id: &str,
    vault_id: &str,
    mail_dir: &Path,
) -> Result<ParsedMessage> {
    let url = format!("{GMAIL_API}/messages/{msg_id}?format=raw");
    let meta: GmailMessageMeta = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .context("fetching message")?
        .json()
        .await
        .context("parsing message")?;

    parse_gmail_message(meta, account_id, vault_id, mail_dir).await
}

async fn parse_gmail_message(
    meta: GmailMessageMeta,
    account_id: &str,
    vault_id: &str,
    mail_dir: &Path,
) -> Result<ParsedMessage> {
    let raw_b64 = meta.raw.as_deref().unwrap_or_default();
    let raw_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(raw_b64)
        .context("decoding raw message")?;

    let parsed = mailparse::parse_mail(&raw_bytes).context("parsing RFC822")?;

    let subject = header_value(&parsed, "Subject").unwrap_or_else(|| "(no subject)".into());
    let from_raw = header_value(&parsed, "From").unwrap_or_default();
    let to_raw = header_value(&parsed, "To").unwrap_or_default();
    let cc_raw = header_value(&parsed, "Cc").unwrap_or_default();
    let date_raw = header_value(&parsed, "Date").unwrap_or_default();

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

    let (body_text, body_html) = extract_body(&parsed);

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

    let eml_path = write_eml(mail_dir, &meta.id, &subject, &from_raw, received_at, &raw_bytes).await;

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
        eml_path,
    })
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

fn header_value(mail: &mailparse::ParsedMail, name: &str) -> Option<String> {
    mail.headers
        .iter()
        .find(|h| h.get_key_ref().eq_ignore_ascii_case(name))
        .map(|h| h.get_value())
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

fn extract_body(mail: &mailparse::ParsedMail) -> (Option<String>, Option<String>) {
    let mut text = None;
    let mut html = None;
    collect_body_parts(mail, &mut text, &mut html);
    (text, html)
}

fn collect_body_parts(
    part: &mailparse::ParsedMail,
    text: &mut Option<String>,
    html: &mut Option<String>,
) {
    let mime = part.ctype.mimetype.to_lowercase();

    if mime == "text/plain" && text.is_none() {
        if let Ok(body) = part.get_body() {
            *text = Some(body);
        }
    } else if mime == "text/html" && html.is_none() {
        if let Ok(body) = part.get_body() {
            *html = Some(body);
        }
    }

    for sub in &part.subparts {
        collect_body_parts(sub, text, html);
    }
}

async fn write_eml(
    mail_dir: &Path,
    msg_id: &str,
    subject: &str,
    from: &str,
    received_at: i64,
    raw: &[u8],
) -> Option<String> {
    let date = chrono::DateTime::from_timestamp(received_at, 0)
        .map(|dt| dt.format("%Y%m%d").to_string())
        .unwrap_or_else(|| "00000000".into());

    let safe_subject: String = subject
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' { c } else { '_' })
        .take(60)
        .collect();

    let safe_from: String = from
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '@' || c == '.' { c } else { '_' })
        .take(30)
        .collect();

    let filename = format!("{date}_{safe_from}_{safe_subject}_{msg_id}.eml");
    let inbox_dir = mail_dir.join("INBOX");
    tokio::fs::create_dir_all(&inbox_dir).await.ok()?;
    let path = inbox_dir.join(&filename);

    tokio::fs::write(&path, raw).await.ok()?;
    path.to_str().map(|s| s.to_string())
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
