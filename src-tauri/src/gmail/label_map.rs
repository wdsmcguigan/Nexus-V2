use super::types::GmailLabel;

/// Nexus label info derived from a Gmail label.
#[derive(Debug, Clone)]
pub struct GmailLabelInfo {
    pub gmail_id: String,
    pub nexus_id: String,
    pub name: String,
    pub kind: &'static str,        // 'system' | 'user'
    pub system_kind: Option<&'static str>,
    pub position: i64,
}

/// Map a list of Gmail labels to Nexus label records.
/// System labels get deterministic IDs; user labels get `lbl-<gmail_id>`.
pub fn map_gmail_labels(labels: &[GmailLabel], vault_id: &str) -> Vec<GmailLabelInfo> {
    let mut out = Vec::new();
    for gl in labels {
        let info = match gl.id.as_str() {
            "INBOX"     => GmailLabelInfo { gmail_id: gl.id.clone(), nexus_id: format!("{vault_id}-inbox"),    name: "Inbox".into(),     kind: "system", system_kind: Some("inbox"),    position: 0 },
            "SENT"      => GmailLabelInfo { gmail_id: gl.id.clone(), nexus_id: format!("{vault_id}-sent"),     name: "Sent".into(),      kind: "system", system_kind: Some("sent"),     position: 1 },
            "DRAFT"     => GmailLabelInfo { gmail_id: gl.id.clone(), nexus_id: format!("{vault_id}-drafts"),   name: "Drafts".into(),    kind: "system", system_kind: Some("drafts"),   position: 2 },
            "TRASH"     => GmailLabelInfo { gmail_id: gl.id.clone(), nexus_id: format!("{vault_id}-trash"),    name: "Trash".into(),     kind: "system", system_kind: Some("trash"),    position: 3 },
            "SPAM"      => GmailLabelInfo { gmail_id: gl.id.clone(), nexus_id: format!("{vault_id}-spam"),     name: "Spam".into(),      kind: "system", system_kind: None,             position: 4 },
            "STARRED"   => GmailLabelInfo { gmail_id: gl.id.clone(), nexus_id: format!("{vault_id}-starred"),  name: "Starred".into(),   kind: "system", system_kind: Some("starred"),  position: 5 },
            "IMPORTANT" => GmailLabelInfo { gmail_id: gl.id.clone(), nexus_id: format!("{vault_id}-important"),name: "Important".into(), kind: "system", system_kind: Some("important"),position: 6 },
            "CATEGORY_PERSONAL" | "CATEGORY_SOCIAL" | "CATEGORY_PROMOTIONS" |
            "CATEGORY_UPDATES" | "CATEGORY_FORUMS" => continue, // skip category tabs
            _ if gl.label_type.as_deref() == Some("user") => {
                GmailLabelInfo {
                    gmail_id: gl.id.clone(),
                    nexus_id: format!("lbl-{}", gl.id),
                    name: gl.name.clone(),
                    kind: "user",
                    system_kind: None,
                    position: 100,
                }
            }
            _ => continue,
        };
        out.push(info);
    }
    out
}

/// Given a Gmail label id, return the corresponding Nexus label id (if known).
pub fn gmail_to_nexus_label(gmail_id: &str, vault_id: &str) -> Option<String> {
    Some(match gmail_id {
        "INBOX"     => format!("{vault_id}-inbox"),
        "SENT"      => format!("{vault_id}-sent"),
        "DRAFT"     => format!("{vault_id}-drafts"),
        "TRASH"     => format!("{vault_id}-trash"),
        "SPAM"      => format!("{vault_id}-spam"),
        "STARRED"   => format!("{vault_id}-starred"),
        "IMPORTANT" => format!("{vault_id}-important"),
        id if id.starts_with("Label_") => format!("lbl-{id}"),
        _ => return None,
    })
}

/// Reverse map: given a Nexus label id, return the Gmail label id.
pub fn nexus_to_gmail_label(nexus_id: &str, vault_id: &str) -> Option<String> {
    // Strip the vault_id prefix for system labels
    let suffix = nexus_id.strip_prefix(&format!("{vault_id}-"));
    Some(match suffix {
        Some("inbox")     => "INBOX".into(),
        Some("sent")      => "SENT".into(),
        Some("drafts")    => "DRAFT".into(),
        Some("trash")     => "TRASH".into(),
        Some("spam")      => "SPAM".into(),
        Some("starred")   => "STARRED".into(),
        Some("important") => "IMPORTANT".into(),
        _ if nexus_id.starts_with("lbl-") => nexus_id["lbl-".len()..].into(),
        _ => return None,
    })
}
