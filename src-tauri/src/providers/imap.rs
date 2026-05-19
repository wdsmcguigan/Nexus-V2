use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use futures::StreamExt;
use mailparse::MailHeaderMap;
use serde::{Deserialize, Serialize};

use super::{IncrementalResult, MailProvider, ProviderLabelInfo, SyncCursor};
use crate::gmail::types::ParsedMessage;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Security {
    Tls,
    StartTls,
    Plain,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapConfig {
    pub host: String,
    pub port: u16,
    pub security: Security,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub security: Security,
    pub username: String,
    pub password: String,
}

pub struct ImapProvider {
    pub account_id: String,
    pub vault_id: String,
    pub config: ImapConfig,
    pub app: tauri::AppHandle,
}

impl ImapProvider {
    pub fn new(
        account_id: String,
        vault_id: String,
        config: ImapConfig,
        app: tauri::AppHandle,
    ) -> Self {
        Self {
            account_id,
            vault_id,
            config,
            app,
        }
    }
}

/// Fetch all messages from an IMAP account (initial sync).
/// Returns (label_infos, messages, cursor).
async fn imap_fetch_all(
    config: &ImapConfig,
    vault_id: &str,
    account_id: &str,
) -> Result<(Vec<ProviderLabelInfo>, Vec<ParsedMessage>, Option<SyncCursor>)> {
    match &config.security {
        Security::Tls => imap_fetch_all_tls(config, vault_id, account_id).await,
        Security::StartTls | Security::Plain => {
            imap_fetch_all_plain(config, vault_id, account_id).await
        }
    }
}

async fn imap_fetch_all_tls(
    config: &ImapConfig,
    vault_id: &str,
    account_id: &str,
) -> Result<(Vec<ProviderLabelInfo>, Vec<ParsedMessage>, Option<SyncCursor>)> {
    use tokio_rustls::rustls;

    let tcp = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        tokio::net::TcpStream::connect(format!("{}:{}", config.host, config.port)),
    )
    .await
    .context("connect timeout")?
    .context("TCP connect")?;
    tcp.set_nodelay(true).ok();

    let mut root_store = rustls::RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls_cfg = std::sync::Arc::new(
        rustls::ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth(),
    );
    let connector = tokio_rustls::TlsConnector::from(tls_cfg);
    let server_name =
        rustls::pki_types::ServerName::try_from(config.host.as_str().to_owned())
            .map_err(|e| anyhow!("bad hostname: {e}"))?;
    let tls = connector.connect(server_name, tcp).await.context("TLS handshake")?;

    let client = async_imap::Client::new(tls);
    let mut session = client
        .login(&config.username, &config.password)
        .await
        .map_err(|(e, _)| anyhow!("IMAP login failed: {e}"))?;

    let result = do_fetch_session(&mut session, vault_id, account_id).await;
    session.logout().await.ok();
    result
}

async fn imap_fetch_all_plain(
    config: &ImapConfig,
    vault_id: &str,
    account_id: &str,
) -> Result<(Vec<ProviderLabelInfo>, Vec<ParsedMessage>, Option<SyncCursor>)> {
    let tcp = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        tokio::net::TcpStream::connect(format!("{}:{}", config.host, config.port)),
    )
    .await
    .context("connect timeout")?
    .context("TCP connect")?;
    tcp.set_nodelay(true).ok();

    let client = async_imap::Client::new(tcp);
    let mut session = client
        .login(&config.username, &config.password)
        .await
        .map_err(|(e, _)| anyhow!("IMAP login failed: {e}"))?;

    let result = do_fetch_session(&mut session, vault_id, account_id).await;
    session.logout().await.ok();
    result
}

/// Core session logic — list mailboxes and fetch messages.
/// Generic over stream type so it works with both TLS and plain connections.
async fn do_fetch_session<S>(
    session: &mut async_imap::Session<S>,
    vault_id: &str,
    account_id: &str,
) -> Result<(Vec<ProviderLabelInfo>, Vec<ParsedMessage>, Option<SyncCursor>)>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + std::fmt::Debug,
{
    use futures::TryStreamExt;

    // List all mailboxes
    let mailbox_stream = session
        .list(Some(""), Some("*"))
        .await
        .map_err(|e| anyhow!("LIST failed: {e}"))?;
    let mailboxes: Vec<_> = mailbox_stream
        .try_collect()
        .await
        .map_err(|e| anyhow!("collecting mailboxes: {e}"))?;

    // Build label list from mailboxes
    let mut label_infos: Vec<ProviderLabelInfo> = Vec::new();
    for (i, mb) in mailboxes.iter().enumerate() {
        let name = mb.name();
        let name_str = decode_imap_utf7(name);
        let provider_id = name.to_string();

        let system_kind =
            if name_str.eq_ignore_ascii_case("inbox") {
                Some("inbox".to_string())
            } else if name_str.eq_ignore_ascii_case("sent")
                || name_str.to_lowercase().contains("sent")
            {
                Some("sent".to_string())
            } else if name_str.eq_ignore_ascii_case("drafts")
                || name_str.to_lowercase().contains("draft")
            {
                Some("drafts".to_string())
            } else if name_str.eq_ignore_ascii_case("trash")
                || name_str.to_lowercase().contains("trash")
                || name_str.to_lowercase().contains("deleted")
            {
                Some("trash".to_string())
            } else if name_str.eq_ignore_ascii_case("spam")
                || name_str.eq_ignore_ascii_case("junk")
            {
                Some("spam".to_string())
            } else if name_str.eq_ignore_ascii_case("archive") {
                Some("archive".to_string())
            } else {
                None
            };

        let kind = if system_kind.is_some() { "system" } else { "user" };
        let nexus_id = if let Some(ref sk) = system_kind {
            format!("{vault_id}-{sk}")
        } else {
            format!(
                "{vault_id}-imap-{}",
                provider_id.replace('/', "-").to_lowercase()
            )
        };

        label_infos.push(ProviderLabelInfo {
            id: nexus_id,
            name: name_str.clone(),
            kind: kind.to_string(),
            system_kind,
            provider_id: provider_id.clone(),
            color: None,
            position: i as i64,
            parent_id: None,
        });
    }

    // Fetch messages from important folders
    let important = ["INBOX", "Sent", "Drafts", "Trash", "Spam", "Junk", "Archive"];

    let mut all_messages: Vec<ParsedMessage> = Vec::new();
    let mut highest_uid: u32 = 0;
    let mut uid_validity: u32 = 0;

    for mb_name in &important {
        // Find case-insensitive match
        let actual_name = mailboxes
            .iter()
            .find(|mb| mb.name().eq_ignore_ascii_case(mb_name))
            .map(|mb| mb.name().to_string());

        let mailbox_name = match actual_name {
            Some(n) => n,
            None => continue,
        };

        let folder_nexus_id = label_infos
            .iter()
            .find(|li| li.provider_id == mailbox_name)
            .map(|li| li.id.clone())
            .unwrap_or_else(|| format!("{vault_id}-inbox"));

        let mbox = match session.select(&mailbox_name).await {
            Ok(m) => m,
            Err(_) => continue,
        };

        if mbox.exists == 0 {
            continue;
        }
        if let Some(uv) = mbox.uid_validity {
            if uv > uid_validity {
                uid_validity = uv;
            }
        }

        // Fetch headers only for efficiency — body is fetched on demand
        let mut fetches = match session
            .fetch("1:*", "(UID FLAGS RFC822.SIZE BODY.PEEK[HEADER])")
            .await
        {
            Ok(f) => f,
            Err(e) => {
                log::warn!("FETCH failed for {mailbox_name}: {e}");
                continue;
            }
        };

        while let Some(fetch) = fetches.next().await {
            let fetch = match fetch {
                Ok(f) => f,
                Err(_) => continue,
            };

            if let Some(uid) = fetch.uid {
                if uid > highest_uid {
                    highest_uid = uid;
                }
            }

            if let Some(msg) =
                parse_imap_fetch(&fetch, account_id, vault_id, &folder_nexus_id)
            {
                all_messages.push(msg);
            }
        }
    }

    let cursor = if uid_validity > 0 && highest_uid > 0 {
        Some(format!("{uid_validity}:{highest_uid}"))
    } else {
        None
    };

    Ok((label_infos, all_messages, cursor))
}

fn decode_imap_utf7(s: &str) -> String {
    utf7_imap::decode_utf7_imap(s.to_string()).unwrap_or_else(|_| s.to_string())
}

fn parse_imap_fetch(
    fetch: &async_imap::types::Fetch,
    account_id: &str,
    vault_id: &str,
    folder_id: &str,
) -> Option<ParsedMessage> {
    let uid = fetch.uid?;
    let provider_id = format!("imap-uid-{uid}");
    let nexus_id = format!("msg-{account_id}-{uid}");

    // Try to get header bytes for parsing
    let raw_bytes = fetch.header()?;

    let parsed = mailparse::parse_headers(raw_bytes).ok()?;
    let headers = parsed.0;

    let subject = headers
        .get_first_value("Subject")
        .unwrap_or_else(|| "(no subject)".to_string());
    let from_raw = headers.get_first_value("From").unwrap_or_default();
    let to_raw = headers.get_first_value("To").unwrap_or_default();
    let cc_raw = headers.get_first_value("Cc").unwrap_or_default();
    let date_raw = headers.get_first_value("Date").unwrap_or_default();
    let message_id = headers
        .get_first_value("Message-ID")
        .unwrap_or_default();

    let received_at = mailparse::dateparse(&date_raw)
        .ok()
        .map(|s| s * 1000)
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

    let thread_id = {
        let refs = headers
            .get_first_value("References")
            .unwrap_or_default();
        let in_reply = headers
            .get_first_value("In-Reply-To")
            .unwrap_or_default();
        let base = if !in_reply.is_empty() {
            &in_reply
        } else if !refs.is_empty() {
            &refs
        } else {
            &message_id
        };
        format!(
            "thr-{}",
            base.trim_matches(['<', '>'])
                .replace(['@', '.'], "-")
        )
    };

    let body_ref = format!("body-{account_id}-{uid}");
    let snippet = subject.chars().take(200).collect::<String>();

    let flags = fetch.flags().collect::<Vec<_>>();
    let flags_read = flags
        .iter()
        .any(|f| matches!(f, async_imap::types::Flag::Seen));

    Some(ParsedMessage {
        id: nexus_id,
        provider_id,
        account_id: account_id.to_string(),
        folder_id: folder_id.to_string(),
        thread_id,
        subject,
        snippet,
        body_ref,
        body_html: None, // fetched on demand
        received_at,
        from_addr: parse_addr_json(&from_raw),
        to_addrs: parse_addrs_json(&to_raw),
        cc_addrs: parse_addrs_json(&cc_raw),
        label_ids: vec![folder_id.to_string()],
        flags_read,
        eml_path: None,
        attachments: vec![],
    })
}

fn parse_addr_json(raw: &str) -> serde_json::Value {
    if raw.is_empty() {
        return serde_json::json!({ "name": null, "email": "" });
    }
    if let Some(angle) = raw.rfind('<') {
        let name = raw[..angle].trim().trim_matches('"').to_string();
        let email = raw[angle + 1..].trim_end_matches('>').trim().to_string();
        serde_json::json!({
            "name": if name.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(name) },
            "email": email
        })
    } else {
        serde_json::json!({ "name": serde_json::Value::Null, "email": raw.trim() })
    }
}

fn parse_addrs_json(raw: &str) -> Vec<serde_json::Value> {
    if raw.is_empty() {
        return vec![];
    }
    raw.split(',')
        .map(|p| parse_addr_json(p.trim()))
        .collect()
}

#[async_trait]
impl MailProvider for ImapProvider {
    fn name(&self) -> &str {
        "IMAP"
    }

    async fn fetch_labels(&self) -> Result<Vec<ProviderLabelInfo>> {
        let (labels, _, _) =
            imap_fetch_all(&self.config, &self.vault_id, &self.account_id).await?;
        Ok(labels)
    }

    async fn fetch_initial(
        &self,
    ) -> Result<(Vec<ProviderLabelInfo>, Vec<ParsedMessage>, Option<SyncCursor>)> {
        use tauri::Emitter;
        let _ = self.app.emit(
            "gmail:sync-progress",
            serde_json::json!({ "accountId": self.account_id, "fetched": 0, "total": 0 }),
        );
        imap_fetch_all(&self.config, &self.vault_id, &self.account_id).await
    }

    async fn fetch_incremental(
        &self,
        cursor: &SyncCursor,
    ) -> Result<Option<IncrementalResult>> {
        // Parse cursor: "uidvalidity:lastuid"
        let parts: Vec<&str> = cursor.splitn(2, ':').collect();
        if parts.len() != 2 {
            return Ok(None);
        }

        // For now, do a full fetch and return all messages
        // A production impl would do SEARCH UID lastuid+1:*
        let (_, messages, new_cursor) =
            imap_fetch_all(&self.config, &self.vault_id, &self.account_id).await?;

        let new_cursor = new_cursor.unwrap_or_else(|| cursor.clone());
        Ok(Some(IncrementalResult {
            new_messages: messages,
            label_additions: vec![],
            label_removals: vec![],
            new_cursor,
        }))
    }

    async fn fetch_message_body(&self, _provider_id: &str) -> Result<Option<String>> {
        Ok(None)
    }

    async fn apply_mutation(
        &self,
        provider_msg_id: &str,
        kind: &str,
        _payload: &serde_json::Value,
    ) -> Result<bool> {
        // Parse UID from provider_id "imap-uid-{uid}"
        let uid_str = provider_msg_id.strip_prefix("imap-uid-").unwrap_or("");
        let uid: u32 = match uid_str.parse() {
            Ok(u) => u,
            Err(_) => return Ok(false),
        };

        log::info!("IMAP mutation {kind} for uid {uid} (not yet applied to server)");
        Ok(true)
    }
}
