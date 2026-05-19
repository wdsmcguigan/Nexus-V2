use anyhow::Result;
use async_trait::async_trait;

use super::{IncrementalResult, MailProvider, ProviderLabelInfo, SyncCursor};
use crate::gmail::types::ParsedMessage;
use crate::gmail::GmailSyncer;

pub struct GmailProvider {
    syncer: GmailSyncer,
}

impl GmailProvider {
    pub fn new(syncer: GmailSyncer) -> Self {
        Self { syncer }
    }
}

#[async_trait]
impl MailProvider for GmailProvider {
    fn name(&self) -> &str {
        "Gmail"
    }

    async fn fetch_labels(&self) -> Result<Vec<ProviderLabelInfo>> {
        // Labels are fetched as part of fetch_initial for Gmail
        Ok(vec![])
    }

    async fn fetch_initial(
        &self,
    ) -> Result<(Vec<ProviderLabelInfo>, Vec<ParsedMessage>, Option<SyncCursor>)> {
        let fetch = self.syncer.fetch_initial().await?;
        let labels = fetch
            .label_infos
            .iter()
            .map(|li| ProviderLabelInfo {
                id: li.nexus_id.clone(),
                name: li.name.clone(),
                kind: li.kind.to_string(),
                system_kind: li.system_kind.map(|s| s.to_string()),
                provider_id: li.gmail_id.clone(),
                color: Some(li.color),
                position: li.position,
                parent_id: li.parent_nexus_id.clone(),
            })
            .collect();
        Ok((labels, fetch.messages, fetch.history_id))
    }

    async fn fetch_incremental(&self, cursor: &SyncCursor) -> Result<Option<IncrementalResult>> {
        match self.syncer.fetch_incremental(cursor).await? {
            None => Ok(None),
            Some(r) => Ok(Some(IncrementalResult {
                new_messages: r.new_messages,
                label_additions: r.label_additions,
                label_removals: r.label_removals,
                new_cursor: r.new_history_id,
            })),
        }
    }

    async fn fetch_message_body(&self, _provider_id: &str) -> Result<Option<String>> {
        Ok(None) // body repair handled by GmailSyncer directly
    }

    async fn apply_mutation(
        &self,
        _provider_msg_id: &str,
        _kind: &str,
        _payload: &serde_json::Value,
    ) -> Result<bool> {
        Ok(false) // Gmail mutations handled by existing drainer
    }
}
