use anyhow::{anyhow, Context, Result};
use lettre::{
    transport::smtp::authentication::Credentials, AsyncSmtpTransport, AsyncTransport,
    Tokio1Executor,
};

use crate::providers::imap::{Security, SmtpConfig};

pub async fn send_via_smtp(config: &SmtpConfig, raw_eml: &[u8]) -> Result<()> {
    let creds = Credentials::new(config.username.clone(), config.password.clone());

    let transport: AsyncSmtpTransport<Tokio1Executor> = match config.security {
        Security::Tls => AsyncSmtpTransport::<Tokio1Executor>::relay(&config.host)
            .map_err(|e| anyhow!("SMTP relay setup: {e}"))?
            .port(config.port)
            .credentials(creds)
            .build(),
        Security::StartTls => {
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)
                .map_err(|e| anyhow!("SMTP starttls setup: {e}"))?
                .port(config.port)
                .credentials(creds)
                .build()
        }
        Security::Plain => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.host)
            .port(config.port)
            .credentials(creds)
            .build(),
    };

    // Extract envelope addresses from raw RFC822 headers
    let parsed_headers = mailparse::parse_headers(raw_eml)
        .map_err(|e| anyhow!("Failed to parse email headers: {e}"))?;
    let headers = parsed_headers.0;

    let from_str = headers.get_first_value("From").unwrap_or_default();
    let to_str = headers.get_first_value("To").unwrap_or_default();

    let from_addr: lettre::Address = extract_email_addr(&from_str)
        .parse()
        .context("parsing From address")?;
    let to_addrs: Vec<lettre::Address> = to_str
        .split(',')
        .filter_map(|s| extract_email_addr(s.trim()).parse().ok())
        .collect();

    if to_addrs.is_empty() {
        anyhow::bail!("No valid To addresses found");
    }

    let envelope = lettre::address::Envelope::new(Some(from_addr), to_addrs)
        .context("building SMTP envelope")?;

    transport
        .send_raw(&envelope, raw_eml)
        .await
        .map_err(|e| anyhow!("SMTP send: {e}"))?;
    Ok(())
}

fn extract_email_addr(s: &str) -> String {
    if let Some(start) = s.rfind('<') {
        s[start + 1..].trim_end_matches('>').trim().to_string()
    } else {
        s.trim().to_string()
    }
}
