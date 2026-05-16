use serde::{Deserialize, Serialize};

/// A message parsed from Gmail's raw RFC822 format and ready to insert into the DB.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedMessage {
    pub id: String,
    pub provider_id: String, // Gmail message id
    pub account_id: String,
    pub folder_id: String,
    pub thread_id: String,
    pub subject: String,
    pub snippet: String,
    pub body_ref: String,
    pub body_html: Option<String>,
    pub received_at: i64,
    pub from_addr: serde_json::Value,
    pub to_addrs: Vec<serde_json::Value>,
    pub cc_addrs: Vec<serde_json::Value>,
    pub label_ids: Vec<String>,   // Nexus label ids
    pub flags_read: bool,
    pub eml_path: Option<String>,
}

/// Minimal Gmail API message list entry
#[derive(Debug, Clone, Deserialize)]
pub struct GmailListEntry {
    pub id: String,
    #[serde(rename = "threadId")]
    pub thread_id: String,
}

#[derive(Debug, Deserialize)]
pub struct GmailListResponse {
    pub messages: Option<Vec<GmailListEntry>>,
    #[serde(rename = "nextPageToken")]
    pub next_page_token: Option<String>,
    #[serde(rename = "resultSizeEstimate")]
    pub result_size_estimate: Option<u64>,
}

/// Gmail message resource (metadata format)
#[derive(Debug, Deserialize)]
pub struct GmailMessageMeta {
    pub id: String,
    #[serde(rename = "threadId")]
    pub thread_id: String,
    #[serde(rename = "labelIds")]
    pub label_ids: Option<Vec<String>>,
    pub snippet: Option<String>,
    #[serde(rename = "internalDate")]
    pub internal_date: Option<String>,
    pub payload: Option<GmailPayload>,
    pub raw: Option<String>, // base64url-encoded RFC822, present when format=raw
    #[serde(rename = "historyId")]
    pub history_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GmailPayload {
    pub headers: Option<Vec<GmailHeader>>,
    pub parts: Option<Vec<GmailPayload>>,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    pub body: Option<GmailBody>,
}

#[derive(Debug, Deserialize)]
pub struct GmailHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct GmailBody {
    pub data: Option<String>,
}

/// Gmail label resource
#[derive(Debug, Deserialize)]
pub struct GmailLabel {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub label_type: Option<String>,
    #[serde(rename = "messageListVisibility")]
    pub message_list_visibility: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GmailLabelsResponse {
    pub labels: Option<Vec<GmailLabel>>,
}

/// History list response for incremental sync
#[derive(Debug, Deserialize)]
pub struct GmailHistoryResponse {
    pub history: Option<Vec<GmailHistory>>,
    #[serde(rename = "historyId")]
    pub history_id: Option<String>,
    #[serde(rename = "nextPageToken")]
    pub next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GmailHistory {
    #[serde(rename = "messagesAdded")]
    pub messages_added: Option<Vec<GmailHistoryMessageAdded>>,
    #[serde(rename = "labelsAdded")]
    pub labels_added: Option<Vec<GmailHistoryLabelChange>>,
    #[serde(rename = "labelsRemoved")]
    pub labels_removed: Option<Vec<GmailHistoryLabelChange>>,
}

#[derive(Debug, Deserialize)]
pub struct GmailHistoryMessageAdded {
    pub message: GmailListEntry,
}

#[derive(Debug, Deserialize)]
pub struct GmailHistoryLabelChange {
    pub message: GmailListEntry,
    #[serde(rename = "labelIds")]
    pub label_ids: Option<Vec<String>>,
}

/// SyncStats returned to the JS frontend
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStats {
    pub fetched: u32,
    pub inserted: u32,
    pub updated: u32,
}

/// Result of the OAuth flow
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthResult {
    pub account_id: String,
    pub email: String,
}
