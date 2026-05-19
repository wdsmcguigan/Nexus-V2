use anyhow::{anyhow, Result};
use async_trait::async_trait;

use super::{IncrementalResult, MailProvider, ProviderLabelInfo, SyncCursor};
use crate::gmail::types::ParsedMessage;

pub struct JmapProvider;

#[async_trait]
impl MailProvider for JmapProvider {
    fn name(&self) -> &str {
        "JMAP"
    }

    async fn fetch_labels(&self) -> Result<Vec<ProviderLabelInfo>> {
        Err(anyhow!("JMAP coming in EP7"))
    }

    async fn fetch_initial(
        &self,
    ) -> Result<(Vec<ProviderLabelInfo>, Vec<ParsedMessage>, Option<SyncCursor>)> {
        Err(anyhow!("JMAP coming in EP7"))
    }

    async fn fetch_incremental(
        &self,
        _cursor: &SyncCursor,
    ) -> Result<Option<IncrementalResult>> {
        Err(anyhow!("JMAP coming in EP7"))
    }

    async fn fetch_message_body(&self, _provider_id: &str) -> Result<Option<String>> {
        Err(anyhow!("JMAP coming in EP7"))
    }

    async fn apply_mutation(
        &self,
        _provider_msg_id: &str,
        _kind: &str,
        _payload: &serde_json::Value,
    ) -> Result<bool> {
        Err(anyhow!("JMAP coming in EP7"))
    }
}
