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
    pub color: i64,                // 1-8, maps to --color-link-N
}

/// Parse a #rrggbb hex string and return the RGB hue (0-360).
/// Returns None for achromatic colors (saturation < 15%).
fn hex_to_hue(hex: &str) -> Option<f64> {
    let hex = hex.trim_start_matches('#');
    if hex.len() != 6 { return None; }
    let r = u8::from_str_radix(&hex[0..2], 16).ok()? as f64 / 255.0;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()? as f64 / 255.0;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()? as f64 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    if delta < 0.15 { return None; } // achromatic
    let hue = if max == r {
        60.0 * (((g - b) / delta) % 6.0)
    } else if max == g {
        60.0 * ((b - r) / delta + 2.0)
    } else {
        60.0 * ((r - g) / delta + 4.0)
    };
    Some((hue + 360.0) % 360.0)
}

/// Map a Gmail backgroundColor hex to a Nexus color slot (1-21).
/// Slots by hue: 1=coral, 9=crimson, 10=orange, 2=amber, 11=yellow, 12=sage,
///   3=lime, 13=forest, 4=emerald, 14=seafoam, 5=teal, 15=sky, 21=steel,
///   8=slate(gray), 16=blue, 17=indigo, 6=violet, 18=grape, 19=fuchsia, 7=rose, 20=blush
fn gmail_hex_to_nexus_color(hex: &str) -> i64 {
    match hex_to_hue(hex) {
        None => 8,  // achromatic → slate/gray
        Some(h) => match h as u32 {
            0..=17            => 9,    // crimson
            18..=35           => 1,    // coral / red
            36..=63           => 10,   // orange
            64..=90           => 2,    // amber
            91..=108          => 11,   // yellow
            109..=122         => 12,   // sage
            123..=135         => 3,    // lime
            136..=145         => 13,   // forest
            146..=160         => 4,    // emerald / green
            161..=178         => 14,   // seafoam
            179..=210         => 5,    // teal
            211..=228         => 15,   // sky
            229..=245         => 21,   // steel
            246..=262         => 16,   // blue
            263..=278         => 17,   // indigo
            279..=298         => 6,    // violet / purple
            299..=310         => 18,   // grape
            311..=322         => 19,   // fuchsia
            323..=340         => 7,    // rose
            _                 => 20,   // blush
        },
    }
}

/// Deterministic color 1-21 from a Gmail label ID (stable across reconnects).
fn stable_color(id: &str) -> i64 {
    let sum: u64 = id.bytes().map(|b| b as u64).sum();
    (sum % 21) as i64 + 1
}

/// Resolve the best color for a user label: use Gmail color when set, else hash the ID.
fn user_label_color(gl: &GmailLabel) -> i64 {
    gl.color
        .as_ref()
        .and_then(|c| c.background_color.as_deref())
        .map(gmail_hex_to_nexus_color)
        .unwrap_or_else(|| stable_color(&gl.id))
}

/// Map a list of Gmail labels to Nexus label records.
/// System labels get deterministic IDs; user labels get `lbl-<gmail_id>`.
pub fn map_gmail_labels(labels: &[GmailLabel], vault_id: &str) -> Vec<GmailLabelInfo> {
    let mut out = Vec::new();
    for gl in labels {
        let info = match gl.id.as_str() {
            "INBOX"     => GmailLabelInfo { gmail_id: gl.id.clone(), nexus_id: format!("{vault_id}-inbox"),    name: "Inbox".into(),     kind: "system", system_kind: Some("inbox"),    position: 0, color: 5 },
            "SENT"      => GmailLabelInfo { gmail_id: gl.id.clone(), nexus_id: format!("{vault_id}-sent"),     name: "Sent".into(),      kind: "system", system_kind: Some("sent"),     position: 1, color: 5 },
            "DRAFT"     => GmailLabelInfo { gmail_id: gl.id.clone(), nexus_id: format!("{vault_id}-drafts"),   name: "Drafts".into(),    kind: "system", system_kind: Some("drafts"),   position: 2, color: 8 },
            "TRASH"     => GmailLabelInfo { gmail_id: gl.id.clone(), nexus_id: format!("{vault_id}-trash"),    name: "Trash".into(),     kind: "system", system_kind: Some("trash"),    position: 3, color: 1 },
            "SPAM"      => GmailLabelInfo { gmail_id: gl.id.clone(), nexus_id: format!("{vault_id}-spam"),     name: "Spam".into(),      kind: "system", system_kind: None,             position: 4, color: 1 },
            "STARRED"   => GmailLabelInfo { gmail_id: gl.id.clone(), nexus_id: format!("{vault_id}-starred"),  name: "Starred".into(),   kind: "system", system_kind: Some("starred"),  position: 5, color: 2 },
            "IMPORTANT" => GmailLabelInfo { gmail_id: gl.id.clone(), nexus_id: format!("{vault_id}-important"),name: "Important".into(), kind: "system", system_kind: Some("important"),position: 6, color: 3 },
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
                    color: user_label_color(gl),
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
