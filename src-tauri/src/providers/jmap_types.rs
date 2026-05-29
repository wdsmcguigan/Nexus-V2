//! JMAP wire-format request/response types (RFC 8620 / RFC 8621).
//!
//! Only the subset Nexus actually exercises: Session, Mailbox/{get,changes},
//! Email/{query,get,changes,set}.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─── Session (RFC 8620 §2) ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct JmapSession {
    #[serde(rename = "apiUrl")]
    pub api_url: String,
    #[serde(rename = "downloadUrl")]
    pub download_url: String,
    #[serde(rename = "primaryAccounts")]
    pub primary_accounts: PrimaryAccounts,
}

#[derive(Debug, Deserialize)]
pub struct PrimaryAccounts {
    #[serde(rename = "urn:ietf:params:jmap:mail")]
    pub mail: String,
}

// ─── Request envelope ───────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct JmapRequest<'a> {
    pub using: &'a [&'a str],
    #[serde(rename = "methodCalls")]
    pub method_calls: Vec<JmapMethodCall>,
}

#[derive(Debug, Serialize)]
pub struct JmapMethodCall(pub String, pub Value, pub String);

#[derive(Debug, Deserialize)]
pub struct JmapResponse {
    #[serde(rename = "methodResponses")]
    pub method_responses: Vec<(String, Value, String)>,
}

// ─── Mailbox/get ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mailbox {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub role: Option<String>,
    #[serde(default)]
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
pub struct MailboxGetResponse {
    pub state: String,
    pub list: Vec<Mailbox>,
}

// ─── Email/get ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailGetItem {
    pub id: String,
    pub thread_id: String,
    pub mailbox_ids: std::collections::HashMap<String, bool>,
    #[serde(default)]
    pub keywords: std::collections::HashMap<String, bool>,
    pub subject: Option<String>,
    pub preview: Option<String>,
    pub received_at: Option<String>,
    #[serde(default)]
    pub from: Vec<EmailAddress>,
    #[serde(default)]
    pub to: Vec<EmailAddress>,
    #[serde(default)]
    pub cc: Vec<EmailAddress>,
    pub body_values: Option<std::collections::HashMap<String, EmailBodyValue>>,
    pub html_body: Option<Vec<EmailBodyPart>>,
    pub text_body: Option<Vec<EmailBodyPart>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailAddress {
    pub name: Option<String>,
    pub email: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailBodyValue {
    pub value: String,
    #[serde(default)]
    pub is_truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailBodyPart {
    pub part_id: Option<String>,
    pub blob_id: Option<String>,
    #[serde(rename = "type")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EmailGetResponse {
    pub state: String,
    pub list: Vec<EmailGetItem>,
}

// ─── Email/query ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailQueryResponse {
    pub query_state: String,
    pub ids: Vec<String>,
}

// ─── Email/changes + Mailbox/changes ────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangesResponse {
    pub old_state: String,
    pub new_state: String,
    pub has_more_changes: bool,
    #[serde(default)]
    pub created: Vec<String>,
    #[serde(default)]
    pub updated: Vec<String>,
    #[serde(default)]
    pub destroyed: Vec<String>,
}

// ─── Combined cursor stored in `mutations.cursor` ───────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct JmapCursor {
    pub email_state: String,
    pub mailbox_state: String,
}

// ─── URN constants ──────────────────────────────────────────────────────────

pub const CORE: &str = "urn:ietf:params:jmap:core";
pub const MAIL: &str = "urn:ietf:params:jmap:mail";
