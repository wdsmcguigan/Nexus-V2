//! JMAP provider (RFC 8620 + RFC 8621).
//!
//! Implements the `MailProvider` trait against any JMAP-compliant server
//! (Fastmail, Stalwart, Cyrus). Authentication today uses a bearer token
//! the user supplies in the onboarding pane; OAuth2 / discovery via
//! `.well-known/jmap` is the next step.
//!
//! Wire-format types live in `jmap_types.rs`. The provider owns a
//! `reqwest::Client` + a `JmapConfig` describing the session/api endpoints
//! and account id; it does **not** maintain a long-lived connection.
use std::collections::HashMap;

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::jmap_types::{
    ChangesResponse, EmailGetItem, EmailGetResponse, EmailQueryResponse, JmapCursor, JmapMethodCall,
    JmapRequest, JmapResponse, JmapSession, Mailbox, MailboxGetResponse, CORE, MAIL,
};
use super::{IncrementalResult, MailProvider, ProviderLabelInfo, SyncCursor};
use crate::gmail::types::ParsedMessage;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JmapConfig {
    /// The JMAP session endpoint, e.g. `https://api.fastmail.com/jmap/session`.
    pub session_url: String,
    /// Bearer token used for the `Authorization: Bearer` header.
    pub token: String,
    /// The user's primary mail account (filled after the first session fetch).
    pub account_id: String,
    /// The api endpoint, captured from the session resource.
    pub api_url: String,
}

pub struct JmapProvider {
    pub account_id_local: String,
    pub vault_id: String,
    pub config: JmapConfig,
    pub http: reqwest::Client,
}

impl JmapProvider {
    pub fn new(account_id_local: String, vault_id: String, config: JmapConfig) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("reqwest client build");
        Self { account_id_local, vault_id, config, http }
    }

    /// Discover the api / account info from a session URL.
    pub async fn discover(session_url: &str, token: &str) -> Result<(String, String)> {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()?;
        let resp = http
            .get(session_url)
            .bearer_auth(token)
            .send()
            .await
            .context("session GET")?;
        if !resp.status().is_success() {
            return Err(anyhow!("session GET failed: {}", resp.status()));
        }
        let session: JmapSession = resp.json().await.context("session JSON")?;
        Ok((session.api_url, session.primary_accounts.mail))
    }

    async fn invoke(&self, calls: Vec<JmapMethodCall>) -> Result<JmapResponse> {
        let req = JmapRequest {
            using: &[CORE, MAIL],
            method_calls: calls,
        };
        let resp = self
            .http
            .post(&self.config.api_url)
            .bearer_auth(&self.config.token)
            .json(&req)
            .send()
            .await
            .context("JMAP invoke POST")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("JMAP invoke failed: {status} — {body}"));
        }
        Ok(resp.json().await.context("JMAP response JSON")?)
    }
}

#[async_trait]
impl MailProvider for JmapProvider {
    fn name(&self) -> &str {
        "JMAP"
    }

    async fn fetch_labels(&self) -> Result<Vec<ProviderLabelInfo>> {
        let resp = self
            .invoke(vec![JmapMethodCall(
                "Mailbox/get".into(),
                json!({ "accountId": self.config.account_id, "ids": null }),
                "a".into(),
            )])
            .await?;
        let (_, payload, _) = resp
            .method_responses
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("Mailbox/get: empty methodResponses"))?;
        let parsed: MailboxGetResponse =
            serde_json::from_value(payload).context("Mailbox/get parse")?;
        Ok(parsed.list.into_iter().map(mailbox_to_label).collect())
    }

    async fn fetch_initial(
        &self,
    ) -> Result<(Vec<ProviderLabelInfo>, Vec<ParsedMessage>, Option<SyncCursor>)> {
        // 1. Mailbox/get (all labels)
        // 2. Email/query (limit 200, sort receivedAt desc)
        // 3. Email/get (full bodies)
        let resp = self
            .invoke(vec![
                JmapMethodCall(
                    "Mailbox/get".into(),
                    json!({ "accountId": self.config.account_id, "ids": null }),
                    "mb".into(),
                ),
                JmapMethodCall(
                    "Email/query".into(),
                    json!({
                        "accountId": self.config.account_id,
                        "sort": [{ "property": "receivedAt", "isAscending": false }],
                        "limit": 200,
                        "calculateTotal": false,
                    }),
                    "q".into(),
                ),
                JmapMethodCall(
                    "Email/get".into(),
                    json!({
                        "accountId": self.config.account_id,
                        "#ids": { "resultOf": "q", "name": "Email/query", "path": "/ids" },
                        "properties": [
                            "id", "threadId", "mailboxIds", "keywords",
                            "from", "to", "cc", "subject", "preview",
                            "receivedAt", "bodyValues", "htmlBody", "textBody",
                        ],
                        "fetchHTMLBodyValues": true,
                        "fetchTextBodyValues": true,
                    }),
                    "g".into(),
                ),
            ])
            .await?;

        let mut mailboxes: Vec<Mailbox> = Vec::new();
        let mut emails: Vec<EmailGetItem> = Vec::new();
        let mut email_state = String::new();
        let mut mailbox_state = String::new();

        for (name, payload, _) in resp.method_responses {
            match name.as_str() {
                "Mailbox/get" => {
                    let parsed: MailboxGetResponse =
                        serde_json::from_value(payload).context("Mailbox/get parse")?;
                    mailbox_state = parsed.state;
                    mailboxes = parsed.list;
                }
                "Email/get" => {
                    let parsed: EmailGetResponse =
                        serde_json::from_value(payload).context("Email/get parse")?;
                    email_state = parsed.state;
                    emails = parsed.list;
                }
                _ => {}
            }
        }

        let labels: Vec<ProviderLabelInfo> =
            mailboxes.iter().cloned().map(mailbox_to_label).collect();
        let inbox_id = mailboxes
            .iter()
            .find(|m| m.role.as_deref() == Some("inbox"))
            .map(|m| m.id.clone())
            .unwrap_or_default();

        let messages: Vec<ParsedMessage> = emails
            .into_iter()
            .map(|e| email_to_parsed(&self.account_id_local, &inbox_id, e))
            .collect();

        let cursor = JmapCursor { email_state, mailbox_state };
        let cursor_str = serde_json::to_string(&cursor)?;
        Ok((labels, messages, Some(cursor_str)))
    }

    async fn fetch_incremental(&self, cursor: &SyncCursor) -> Result<Option<IncrementalResult>> {
        let prev: JmapCursor =
            serde_json::from_str(cursor).context("cursor JSON parse")?;

        let resp = self
            .invoke(vec![
                JmapMethodCall(
                    "Email/changes".into(),
                    json!({
                        "accountId": self.config.account_id,
                        "sinceState": prev.email_state,
                        "maxChanges": 200,
                    }),
                    "c".into(),
                ),
                JmapMethodCall(
                    "Mailbox/changes".into(),
                    json!({
                        "accountId": self.config.account_id,
                        "sinceState": prev.mailbox_state,
                    }),
                    "mc".into(),
                ),
            ])
            .await?;

        let mut email_changes: Option<ChangesResponse> = None;
        let mut mailbox_changes: Option<ChangesResponse> = None;
        for (name, payload, _) in resp.method_responses {
            match name.as_str() {
                "Email/changes" => {
                    email_changes = Some(
                        serde_json::from_value(payload).context("Email/changes parse")?,
                    );
                }
                "Mailbox/changes" => {
                    mailbox_changes = Some(
                        serde_json::from_value(payload).context("Mailbox/changes parse")?,
                    );
                }
                _ => {}
            }
        }
        let email_changes = email_changes
            .ok_or_else(|| anyhow!("Email/changes missing in response"))?;
        let mailbox_changes = mailbox_changes
            .ok_or_else(|| anyhow!("Mailbox/changes missing in response"))?;

        let new_cursor = JmapCursor {
            email_state: email_changes.new_state.clone(),
            mailbox_state: mailbox_changes.new_state.clone(),
        };

        if email_changes.created.is_empty()
            && email_changes.updated.is_empty()
            && email_changes.destroyed.is_empty()
        {
            return Ok(Some(IncrementalResult {
                new_messages: Vec::new(),
                label_additions: Vec::new(),
                label_removals: Vec::new(),
                new_cursor: serde_json::to_string(&new_cursor)?,
            }));
        }

        // Fetch the full email records for created+updated.
        let mut needed_ids: Vec<String> = email_changes.created.clone();
        needed_ids.extend(email_changes.updated.iter().cloned());
        let resp2 = self
            .invoke(vec![JmapMethodCall(
                "Email/get".into(),
                json!({
                    "accountId": self.config.account_id,
                    "ids": needed_ids,
                    "properties": [
                        "id", "threadId", "mailboxIds", "keywords",
                        "from", "to", "cc", "subject", "preview",
                        "receivedAt", "bodyValues", "htmlBody", "textBody",
                    ],
                    "fetchHTMLBodyValues": true,
                    "fetchTextBodyValues": true,
                }),
                "g".into(),
            )])
            .await?;

        let mut emails: Vec<EmailGetItem> = Vec::new();
        for (name, payload, _) in resp2.method_responses {
            if name == "Email/get" {
                let parsed: EmailGetResponse =
                    serde_json::from_value(payload).context("Email/get parse")?;
                emails = parsed.list;
            }
        }

        let created_set: std::collections::HashSet<&str> =
            email_changes.created.iter().map(String::as_str).collect();
        let mut new_messages = Vec::new();
        let mut label_additions: Vec<(String, Vec<String>)> = Vec::new();
        let mut label_removals: Vec<(String, Vec<String>)> = Vec::new();
        for e in emails {
            let provider_id = e.id.clone();
            let label_ids: Vec<String> = e
                .mailbox_ids
                .iter()
                .filter_map(|(k, v)| if *v { Some(k.clone()) } else { None })
                .collect();
            if created_set.contains(provider_id.as_str()) {
                new_messages.push(email_to_parsed(&self.account_id_local, "", e));
            } else {
                // For updates we only surface the latest label set; deletes are
                // handled by the destroyed branch below.
                label_additions.push((provider_id, label_ids));
            }
        }
        for id in email_changes.destroyed {
            label_removals.push((id, vec![]));
        }

        Ok(Some(IncrementalResult {
            new_messages,
            label_additions,
            label_removals,
            new_cursor: serde_json::to_string(&new_cursor)?,
        }))
    }

    async fn fetch_message_body(&self, provider_id: &str) -> Result<Option<String>> {
        let resp = self
            .invoke(vec![JmapMethodCall(
                "Email/get".into(),
                json!({
                    "accountId": self.config.account_id,
                    "ids": [provider_id],
                    "properties": ["id", "bodyValues", "htmlBody", "textBody"],
                    "fetchHTMLBodyValues": true,
                    "fetchTextBodyValues": true,
                }),
                "g".into(),
            )])
            .await?;
        for (name, payload, _) in resp.method_responses {
            if name == "Email/get" {
                let parsed: EmailGetResponse =
                    serde_json::from_value(payload).context("Email/get parse")?;
                if let Some(e) = parsed.list.into_iter().next() {
                    return Ok(extract_body(e));
                }
            }
        }
        Ok(None)
    }

    async fn apply_mutation(
        &self,
        provider_msg_id: &str,
        kind: &str,
        payload: &Value,
    ) -> Result<bool> {
        let update = match mutation_to_email_set(kind, payload) {
            Some(u) => u,
            None => return Ok(false),
        };
        let req = JmapMethodCall(
            "Email/set".into(),
            json!({
                "accountId": self.config.account_id,
                "update": { provider_msg_id: update },
            }),
            "s".into(),
        );
        let resp = self.invoke(vec![req]).await?;
        let (_, payload_resp, _) = resp
            .method_responses
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("Email/set: empty methodResponses"))?;
        if let Some(not_updated) = payload_resp.get("notUpdated") {
            if let Some(obj) = not_updated.as_object() {
                if !obj.is_empty() {
                    return Err(anyhow!("Email/set notUpdated: {obj:?}"));
                }
            }
        }
        Ok(true)
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn mailbox_to_label(m: Mailbox) -> ProviderLabelInfo {
    let (kind, system_kind) = match m.role.as_deref() {
        Some("inbox") => ("system", Some("inbox")),
        Some("sent") => ("system", Some("sent")),
        Some("drafts") => ("system", Some("drafts")),
        Some("trash") => ("system", Some("trash")),
        Some("junk") => ("system", Some("spam")),
        Some("archive") => ("system", Some("archive")),
        _ => ("user", None),
    };
    ProviderLabelInfo {
        id: format!("jmap-{}", m.id),
        name: m.name,
        kind: kind.to_string(),
        system_kind: system_kind.map(String::from),
        provider_id: m.id,
        color: None,
        position: m.sort_order,
        parent_id: m.parent_id.map(|p| format!("jmap-{p}")),
    }
}

fn email_to_parsed(account_id: &str, default_folder: &str, e: EmailGetItem) -> ParsedMessage {
    let provider_id = e.id.clone();
    let nexus_id = format!("msg-{account_id}-{provider_id}");
    let body_ref = format!("body-{account_id}-{provider_id}");
    let received_at = e
        .received_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

    let label_ids: Vec<String> = e
        .mailbox_ids
        .iter()
        .filter_map(|(k, v)| if *v { Some(format!("jmap-{k}")) } else { None })
        .collect();
    let folder_id = label_ids
        .iter()
        .find(|_| true)
        .cloned()
        .unwrap_or_else(|| default_folder.to_string());

    let body_html = extract_body(e.clone());

    let snippet = e
        .preview
        .clone()
        .unwrap_or_else(|| body_html.as_deref().unwrap_or("").chars().take(200).collect());

    let from_addr = e
        .from
        .first()
        .map(|a| json!({ "name": a.name.clone().unwrap_or_default(), "email": a.email }))
        .unwrap_or_else(|| json!({ "name": "", "email": "" }));
    let to_addrs: Vec<Value> = e
        .to
        .iter()
        .map(|a| json!({ "name": a.name.clone().unwrap_or_default(), "email": a.email }))
        .collect();
    let cc_addrs: Vec<Value> = e
        .cc
        .iter()
        .map(|a| json!({ "name": a.name.clone().unwrap_or_default(), "email": a.email }))
        .collect();

    let flags_read = e.keywords.get("$seen").copied().unwrap_or(false);

    ParsedMessage {
        id: nexus_id,
        provider_id,
        account_id: account_id.to_string(),
        folder_id,
        thread_id: format!("thr-{}", e.thread_id),
        subject: e.subject.unwrap_or_else(|| "(no subject)".into()),
        snippet,
        body_ref,
        body_html,
        received_at,
        from_addr,
        to_addrs,
        cc_addrs,
        label_ids,
        flags_read,
        eml_path: None,
        attachments: vec![],
        list_unsubscribe: None,
        list_unsubscribe_post: None,
        ical_data: None,
    }
}

fn extract_body(e: EmailGetItem) -> Option<String> {
    let body_values = e.body_values?;
    if let Some(parts) = e.html_body {
        for part in parts {
            if let Some(pid) = part.part_id {
                if let Some(bv) = body_values.get(&pid) {
                    return Some(bv.value.clone());
                }
            }
        }
    }
    if let Some(parts) = e.text_body {
        for part in parts {
            if let Some(pid) = part.part_id {
                if let Some(bv) = body_values.get(&pid) {
                    return Some(format!(
                        "<pre style=\"white-space:pre-wrap;font-family:inherit;margin:0\">{}</pre>",
                        html_escape(&bv.value)
                    ));
                }
            }
        }
    }
    None
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Translate a Nexus mutation kind + payload into the `update` patch sent in
/// `Email/set`. Returns `None` for mutations that don't make sense to push
/// (e.g. CREATE_LABEL — JMAP mailboxes are managed separately).
pub(crate) fn mutation_to_email_set(kind: &str, payload: &Value) -> Option<Value> {
    let mut patch = serde_json::Map::new();
    match kind {
        "READ" => {
            patch.insert("keywords/$seen".into(), Value::Bool(true));
        }
        "UNREAD" => {
            patch.insert("keywords/$seen".into(), Value::Null);
        }
        "SET_STAR" => {
            patch.insert("keywords/$flagged".into(), Value::Bool(true));
        }
        "CLEAR_STAR" => {
            patch.insert("keywords/$flagged".into(), Value::Null);
        }
        "MOVE_TO_FOLDER" => {
            let new = payload.get("folderId")?.as_str()?;
            // Strip "jmap-" prefix to recover JMAP mailbox id.
            let new = new.strip_prefix("jmap-").unwrap_or(new);
            let mut ids = HashMap::new();
            ids.insert(new.to_string(), Value::Bool(true));
            patch.insert("mailboxIds".into(), serde_json::to_value(ids).ok()?);
        }
        "ADD_LABEL" => {
            let lid = payload.get("labelId")?.as_str()?;
            let lid = lid.strip_prefix("jmap-").unwrap_or(lid);
            patch.insert(format!("mailboxIds/{lid}"), Value::Bool(true));
        }
        "REMOVE_LABEL" => {
            let lid = payload.get("labelId")?.as_str()?;
            let lid = lid.strip_prefix("jmap-").unwrap_or(lid);
            patch.insert(format!("mailboxIds/{lid}"), Value::Null);
        }
        _ => return None,
    }
    Some(Value::Object(patch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_translates_to_seen_true() {
        let v = mutation_to_email_set("READ", &json!({})).unwrap();
        assert_eq!(v["keywords/$seen"], Value::Bool(true));
    }

    #[test]
    fn unread_clears_seen() {
        let v = mutation_to_email_set("UNREAD", &json!({})).unwrap();
        assert_eq!(v["keywords/$seen"], Value::Null);
    }

    #[test]
    fn set_star_sets_flagged() {
        let v = mutation_to_email_set("SET_STAR", &json!({})).unwrap();
        assert_eq!(v["keywords/$flagged"], Value::Bool(true));
    }

    #[test]
    fn move_to_folder_replaces_mailbox_ids() {
        let v = mutation_to_email_set(
            "MOVE_TO_FOLDER",
            &json!({ "folderId": "jmap-INBOX" }),
        )
        .unwrap();
        let ids = v["mailboxIds"].as_object().unwrap();
        assert_eq!(ids["INBOX"], Value::Bool(true));
    }

    #[test]
    fn add_label_patches_single_id() {
        let v = mutation_to_email_set(
            "ADD_LABEL",
            &json!({ "labelId": "jmap-LBL-42" }),
        )
        .unwrap();
        assert_eq!(v["mailboxIds/LBL-42"], Value::Bool(true));
    }

    #[test]
    fn unknown_kind_returns_none() {
        assert!(mutation_to_email_set("SET_NOTE", &json!({})).is_none());
    }
}
