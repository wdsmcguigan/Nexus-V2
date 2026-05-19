use anyhow::Result;
use serde::{Deserialize, Serialize};

use super::imap::{ImapConfig, Security, SmtpConfig};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryResult {
    pub imap: Option<ImapConfig>,
    pub smtp: Option<SmtpConfig>,
    pub confidence: String, // "known" | "discovered" | "guessed"
    pub requires_app_password: bool,
    pub oauth_url: Option<String>,
}

struct WellKnownEntry {
    domains: &'static [&'static str],
    imap_host: &'static str,
    imap_port: u16,
    imap_security: Security,
    smtp_host: &'static str,
    smtp_port: u16,
    smtp_security: Security,
    requires_app_password: bool,
}

static WELL_KNOWN: &[WellKnownEntry] = &[
    WellKnownEntry {
        domains: &["gmail.com", "googlemail.com"],
        imap_host: "imap.gmail.com",
        imap_port: 993,
        imap_security: Security::Tls,
        smtp_host: "smtp.gmail.com",
        smtp_port: 587,
        smtp_security: Security::StartTls,
        requires_app_password: true,
    },
    WellKnownEntry {
        domains: &["icloud.com", "me.com", "mac.com"],
        imap_host: "imap.mail.me.com",
        imap_port: 993,
        imap_security: Security::Tls,
        smtp_host: "smtp.mail.me.com",
        smtp_port: 587,
        smtp_security: Security::StartTls,
        requires_app_password: true,
    },
    WellKnownEntry {
        domains: &["fastmail.com", "fastmail.fm"],
        imap_host: "imap.fastmail.com",
        imap_port: 993,
        imap_security: Security::Tls,
        smtp_host: "smtp.fastmail.com",
        smtp_port: 587,
        smtp_security: Security::StartTls,
        requires_app_password: false,
    },
    WellKnownEntry {
        domains: &["outlook.com", "hotmail.com", "live.com", "msn.com"],
        imap_host: "outlook.office365.com",
        imap_port: 993,
        imap_security: Security::Tls,
        smtp_host: "smtp.office365.com",
        smtp_port: 587,
        smtp_security: Security::StartTls,
        requires_app_password: false,
    },
    WellKnownEntry {
        domains: &["yahoo.com", "ymail.com"],
        imap_host: "imap.mail.yahoo.com",
        imap_port: 993,
        imap_security: Security::Tls,
        smtp_host: "smtp.mail.yahoo.com",
        smtp_port: 587,
        smtp_security: Security::StartTls,
        requires_app_password: true,
    },
    WellKnownEntry {
        domains: &["protonmail.com", "proton.me", "pm.me"],
        imap_host: "127.0.0.1",
        imap_port: 1143,
        imap_security: Security::StartTls,
        smtp_host: "127.0.0.1",
        smtp_port: 1025,
        smtp_security: Security::StartTls,
        requires_app_password: false,
    },
    WellKnownEntry {
        domains: &["zoho.com", "zohomail.com"],
        imap_host: "imap.zoho.com",
        imap_port: 993,
        imap_security: Security::Tls,
        smtp_host: "smtp.zoho.com",
        smtp_port: 587,
        smtp_security: Security::StartTls,
        requires_app_password: false,
    },
    WellKnownEntry {
        domains: &["aol.com"],
        imap_host: "imap.aol.com",
        imap_port: 993,
        imap_security: Security::Tls,
        smtp_host: "smtp.aol.com",
        smtp_port: 587,
        smtp_security: Security::StartTls,
        requires_app_password: true,
    },
];

pub async fn discover(email: &str) -> DiscoveryResult {
    let domain = match email.split('@').nth(1) {
        Some(d) => d.to_lowercase(),
        None => {
            return DiscoveryResult {
                imap: None,
                smtp: None,
                confidence: "guessed".into(),
                requires_app_password: false,
                oauth_url: None,
            }
        }
    };

    // 1. Check well-known providers
    for entry in WELL_KNOWN {
        if entry.domains.iter().any(|d| *d == domain.as_str()) {
            return DiscoveryResult {
                imap: Some(ImapConfig {
                    host: entry.imap_host.to_string(),
                    port: entry.imap_port,
                    security: entry.imap_security.clone(),
                    username: email.to_string(),
                    password: String::new(),
                }),
                smtp: Some(SmtpConfig {
                    host: entry.smtp_host.to_string(),
                    port: entry.smtp_port,
                    security: entry.smtp_security.clone(),
                    username: email.to_string(),
                    password: String::new(),
                }),
                confidence: "known".into(),
                requires_app_password: entry.requires_app_password,
                oauth_url: None,
            };
        }
    }

    // 2. Try Thunderbird autoconfig
    if let Ok(result) = try_thunderbird_autoconfig(&domain, email).await {
        if result.imap.is_some() {
            return result;
        }
    }

    // 3. Fallback guess
    DiscoveryResult {
        imap: Some(ImapConfig {
            host: format!("imap.{domain}"),
            port: 993,
            security: Security::Tls,
            username: email.to_string(),
            password: String::new(),
        }),
        smtp: Some(SmtpConfig {
            host: format!("smtp.{domain}"),
            port: 587,
            security: Security::StartTls,
            username: email.to_string(),
            password: String::new(),
        }),
        confidence: "guessed".into(),
        requires_app_password: false,
        oauth_url: None,
    }
}

async fn try_thunderbird_autoconfig(domain: &str, email: &str) -> Result<DiscoveryResult> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;

    let urls = [
        format!(
            "https://autoconfig.{domain}/mail/config-v1.1.xml?emailaddress={email}"
        ),
        format!("https://{domain}/.well-known/autoconfig/mail/config-v1.1.xml"),
        format!("http://autoconfig.{domain}/mail/config-v1.1.xml"),
    ];

    for url in &urls {
        if let Ok(resp) = client.get(url).send().await {
            if resp.status().is_success() {
                if let Ok(text) = resp.text().await {
                    if let Some(result) = parse_thunderbird_xml(&text, email) {
                        return Ok(result);
                    }
                }
            }
        }
    }

    anyhow::bail!("autoconfig not found")
}

fn parse_thunderbird_xml(xml: &str, email: &str) -> Option<DiscoveryResult> {
    let imap_host = extract_xml_value(xml, "incomingServer", "hostname")?;
    let imap_port: u16 = extract_xml_value(xml, "incomingServer", "port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(993);
    let imap_socket = extract_xml_value(xml, "incomingServer", "socketType")
        .unwrap_or_else(|| "SSL".to_string());

    let smtp_host = extract_xml_value(xml, "outgoingServer", "hostname")
        .unwrap_or_else(|| {
            format!(
                "smtp.{}",
                email.split('@').nth(1).unwrap_or("")
            )
        });
    let smtp_port: u16 = extract_xml_value(xml, "outgoingServer", "port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(587);
    let smtp_socket = extract_xml_value(xml, "outgoingServer", "socketType")
        .unwrap_or_else(|| "STARTTLS".to_string());

    let imap_security = socket_type_to_security(&imap_socket);
    let smtp_security = socket_type_to_security(&smtp_socket);

    Some(DiscoveryResult {
        imap: Some(ImapConfig {
            host: imap_host,
            port: imap_port,
            security: imap_security,
            username: email.to_string(),
            password: String::new(),
        }),
        smtp: Some(SmtpConfig {
            host: smtp_host,
            port: smtp_port,
            security: smtp_security,
            username: email.to_string(),
            password: String::new(),
        }),
        confidence: "discovered".into(),
        requires_app_password: false,
        oauth_url: None,
    })
}

fn extract_xml_value(xml: &str, element: &str, field: &str) -> Option<String> {
    let start = xml.find(&format!("<{element}"))?;
    let end = xml[start..]
        .find(&format!("</{element}>"))
        .map(|e| start + e)
        .unwrap_or(xml.len());
    let section = &xml[start..end];

    let field_start = section.find(&format!("<{field}>"))? + field.len() + 2;
    let field_end = section[field_start..]
        .find(&format!("</{field}>"))
        .map(|e| field_start + e)?;
    Some(section[field_start..field_end].trim().to_string())
}

fn socket_type_to_security(s: &str) -> Security {
    match s.to_uppercase().as_str() {
        "SSL" | "TLS" => Security::Tls,
        "STARTTLS" => Security::StartTls,
        _ => Security::Plain,
    }
}
