pub mod autodiscovery;
pub mod calendar;
pub mod gmail;
pub mod imap;
pub mod imap_idle;
pub mod jmap;
pub mod jmap_types;
pub mod outlook_oauth;

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

pub use crate::gmail::types::ParsedMessage;

pub type SyncCursor = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderLabelInfo {
    pub id: String,
    pub name: String,
    pub kind: String,        // "system" | "user"
    pub system_kind: Option<String>,
    pub provider_id: String,
    pub color: Option<i64>,
    pub position: i64,
    pub parent_id: Option<String>,
}

pub struct IncrementalResult {
    pub new_messages: Vec<ParsedMessage>,
    pub label_additions: Vec<(String, Vec<String>)>,
    pub label_removals: Vec<(String, Vec<String>)>,
    pub new_cursor: SyncCursor,
}

#[async_trait]
pub trait MailProvider: Send + Sync {
    fn name(&self) -> &str;
    async fn fetch_labels(&self) -> Result<Vec<ProviderLabelInfo>>;
    async fn fetch_initial(&self) -> Result<(Vec<ProviderLabelInfo>, Vec<ParsedMessage>, Option<SyncCursor>)>;
    async fn fetch_incremental(&self, cursor: &SyncCursor) -> Result<Option<IncrementalResult>>;
    async fn fetch_message_body(&self, provider_id: &str) -> Result<Option<String>>;
    async fn apply_mutation(
        &self,
        provider_msg_id: &str,
        kind: &str,
        payload: &serde_json::Value,
    ) -> Result<bool>;
}
