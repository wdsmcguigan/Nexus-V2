use anyhow::{Context, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;

use super::VaultDb;

// ─── Hydration payload ────────────────────────────────────────────────────────

/// Serialized payload sent to the JS frontend via the `load_vault_data` command.
/// Shape mirrors the argument to `localStore.hydrate()` in TypeScript.
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HydratePayload {
    pub vault: JsonValue,
    pub accounts: Vec<JsonValue>,
    pub folders: Vec<JsonValue>,
    pub labels: Vec<JsonValue>,
    pub statuses: Vec<JsonValue>,
    pub custom_field_defs: Vec<JsonValue>,
    pub messages: Vec<JsonValue>,
    pub tag_usage: Vec<JsonValue>,
    pub mutations: Vec<JsonValue>,
    pub contacts: Vec<JsonValue>,
    pub contact_groups: Vec<JsonValue>,
    pub saved_views: Vec<JsonValue>,
    pub rules: Vec<JsonValue>,
    pub templates: Vec<JsonValue>,
    pub calendar_events: Vec<JsonValue>,
}

impl VaultDb {
    /// Build the full hydration payload from SQLite.
    pub fn build_hydrate_payload(&self, vault_id: &str) -> Result<HydratePayload> {
        Ok(HydratePayload {
            vault: self.load_vault(vault_id)?,
            accounts: self.load_accounts(vault_id)?,
            folders: self.load_folders(vault_id)?,
            labels: self.load_labels(vault_id)?,
            statuses: self.load_statuses(vault_id)?,
            custom_field_defs: self.load_custom_field_defs(vault_id)?,
            messages: self.load_messages(vault_id)?,
            tag_usage: self.load_tag_usage(vault_id)?,
            mutations: vec![],
            contacts: self.load_contacts(vault_id)?,
            contact_groups: self.load_contact_groups(vault_id)?,
            saved_views: self.load_saved_views(vault_id)?,
            rules: self.get_rules(vault_id)?,
            templates: self.get_templates(vault_id)?,
            calendar_events: {
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64;
                let day_ms: i64 = 86_400_000;
                self.load_calendar_events(vault_id, now_ms - 14 * day_ms, now_ms + 90 * day_ms)?
            },
        })
    }

    fn load_vault(&self, vault_id: &str) -> Result<JsonValue> {
        let row: Option<(String, String, i64)> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, path, created_at FROM vaults WHERE id = ?1 LIMIT 1",
            )?;
            stmt.query_row(params![vault_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
            }).optional()?
        };
        if let Some((id, path, created_at)) = row {
            Ok(serde_json::json!({ "id": id, "path": path, "createdAt": created_at }))
        } else {
            Ok(serde_json::json!({ "id": vault_id, "path": "", "createdAt": 0 }))
        }
    }

    pub fn load_accounts(&self, vault_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, provider, email, display_name, photo_url FROM accounts WHERE vault_id = ?1",
        )?;
        let rows = stmt.query_map(params![vault_id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "vaultId": vault_id,
                "provider": r.get::<_, String>(1)?,
                "email": r.get::<_, String>(2)?,
                "displayName": r.get::<_, Option<String>>(3)?,
                "photoUrl": r.get::<_, Option<String>>(4)?
            }))
        })?;
        rows.map(|r| r.context("loading account row")).collect()
    }

    /// Delete an account and all messages/labels associated with it.
    pub fn delete_account(&self, vault_id: &str, account_id: &str, data_action: &str) -> Result<()> {
        if data_action != "keep" {
            // Delete junction rows first (message_labels, message_tags) then bodies and messages.
            self.conn.execute(
                "DELETE FROM message_labels WHERE message_id IN (
                    SELECT id FROM messages WHERE vault_id = ?1 AND provider_account_id = ?2
                )",
                params![vault_id, account_id],
            )?;
            self.conn.execute(
                "DELETE FROM message_tags WHERE message_id IN (
                    SELECT id FROM messages WHERE vault_id = ?1 AND provider_account_id = ?2
                )",
                params![vault_id, account_id],
            )?;
            // Fix previously-leaking orphaned body blobs.
            self.conn.execute(
                "DELETE FROM message_bodies WHERE body_ref IN (
                    SELECT body_ref FROM messages WHERE vault_id = ?1 AND provider_account_id = ?2
                )",
                params![vault_id, account_id],
            )?;
            self.conn.execute(
                "DELETE FROM messages WHERE vault_id = ?1 AND provider_account_id = ?2",
                params![vault_id, account_id],
            )?;

            if data_action == "delete_all" {
                // Remove all Gmail-synced labels (identified by having a provider_id column set).
                // User-created Nexus labels (no provider_id) are preserved.
                self.conn.execute(
                    "DELETE FROM labels WHERE vault_id = ?1 AND provider_id IS NOT NULL",
                    params![vault_id],
                )?;
            }
        }

        // Always remove the account row (contains all OAuth credentials).
        self.conn.execute(
            "DELETE FROM accounts WHERE id = ?1 AND vault_id = ?2",
            params![account_id, vault_id],
        )?;
        Ok(())
    }

    fn load_folders(&self, vault_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, parent_id, name, disk_slug, color, icon, system_kind, position
             FROM folders WHERE vault_id = ?1 ORDER BY position",
        )?;
        let rows = stmt.query_map(params![vault_id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "vaultId": vault_id,
                "parentId": r.get::<_, Option<String>>(1)?,
                "name": r.get::<_, String>(2)?,
                "diskSlug": r.get::<_, String>(3)?,
                "color": r.get::<_, Option<i64>>(4)?,
                "icon": r.get::<_, Option<String>>(5)?,
                "systemKind": r.get::<_, Option<String>>(6)?,
                "position": r.get::<_, i64>(7)?
            }))
        })?;
        rows.map(|r| r.context("loading folder row")).collect()
    }

    fn load_labels(&self, vault_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, color, kind, system_kind, parent_id, position, provider_id
             FROM labels WHERE vault_id = ?1 ORDER BY position",
        )?;
        let rows = stmt.query_map(params![vault_id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "vaultId": vault_id,
                "name": r.get::<_, String>(1)?,
                "color": r.get::<_, i64>(2)?,
                "kind": r.get::<_, String>(3)?,
                "systemKind": r.get::<_, Option<String>>(4)?,
                "parentId": r.get::<_, Option<String>>(5)?,
                "position": r.get::<_, i64>(6)?,
                "providerId": r.get::<_, Option<String>>(7)?
            }))
        })?;
        rows.map(|r| r.context("loading label row")).collect()
    }

    fn load_statuses(&self, vault_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, color, position, is_default, is_terminal
             FROM statuses WHERE vault_id = ?1 ORDER BY position",
        )?;
        let rows = stmt.query_map(params![vault_id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "vaultId": vault_id,
                "name": r.get::<_, String>(1)?,
                "color": r.get::<_, i64>(2)?,
                "position": r.get::<_, i64>(3)?,
                "isDefault": r.get::<_, bool>(4)?,
                "isTerminal": r.get::<_, bool>(5)?
            }))
        })?;
        rows.map(|r| r.context("loading status row")).collect()
    }

    fn load_custom_field_defs(&self, vault_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, type, description, position, is_pinned, default_value
             FROM custom_field_defs WHERE vault_id = ?1 ORDER BY position",
        )?;
        let defs: Vec<JsonValue> = stmt.query_map(params![vault_id], |r| {
            let id: String = r.get(0)?;
            Ok((id, serde_json::json!({
                "vaultId": vault_id,
                "name": r.get::<_, String>(1)?,
                "type": r.get::<_, String>(2)?,
                "description": r.get::<_, Option<String>>(3)?,
                "position": r.get::<_, i64>(4)?,
                "isPinned": r.get::<_, bool>(5)?,
                "defaultValue": r.get::<_, Option<String>>(6)?
            })))
        })?.map(|r| r.context("loading cfd row"))
          .collect::<Result<Vec<_>>>()?
          .into_iter()
          .map(|(id, mut v)| {
              // Load options for this def
              if let Ok(opts) = self.load_field_options(&id) {
                  v["options"] = JsonValue::Array(opts);
              }
              v["id"] = JsonValue::String(id);
              v
          })
          .collect();
        Ok(defs)
    }

    fn load_field_options(&self, field_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, color, position FROM custom_field_options
             WHERE field_id = ?1 ORDER BY position",
        )?;
        let rows = stmt.query_map(params![field_id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "label": r.get::<_, String>(1)?,
                "color": r.get::<_, i64>(2)?,
                "position": r.get::<_, i64>(3)?
            }))
        })?;
        rows.map(|r| r.context("loading field option row")).collect()
    }

    fn load_messages(&self, vault_id: &str) -> Result<Vec<JsonValue>> {
        // Load the 2000 most recent messages (avoids huge IPC payloads on first hydration).
        let mut stmt = self.conn.prepare(
            "SELECT id, folder_id, thread_id, subject, snippet, body_ref, received_at,
                    status_id, priority, star, pinned, muted, notes, flag_json,
                    from_addr_json, to_addrs_json, cc_addrs_json, bcc_addrs_json,
                    attachment_refs_json, custom_fields_json,
                    flags_read, flags_answered, flags_draft, flags_flagged,
                    ical_data
             FROM messages WHERE vault_id = ?1
             ORDER BY received_at DESC LIMIT 2000",
        )?;

        let msg_rows: Vec<(String, JsonValue)> = stmt.query_map(params![vault_id], |r| {
            let id: String = r.get(0)?;
            let msg = serde_json::json!({
                "id": id.clone(),
                "vaultId": vault_id,
                "folderId": r.get::<_, String>(1)?,
                "threadId": r.get::<_, String>(2)?,
                "subject": r.get::<_, String>(3)?,
                "snippet": r.get::<_, String>(4)?,
                "bodyRef": r.get::<_, String>(5)?,
                "receivedAt": r.get::<_, i64>(6)?,
                "statusId": r.get::<_, Option<String>>(7)?,
                "priority": r.get::<_, Option<i64>>(8)?,
                "star": r.get::<_, Option<String>>(9)?,
                "pinned": r.get::<_, bool>(10)?,
                "muted": r.get::<_, bool>(11)?,
                "notes": r.get::<_, Option<String>>(12)?,
                "flag": serde_json::from_str::<JsonValue>(
                    &r.get::<_, Option<String>>(13)?.unwrap_or_default()
                ).unwrap_or(JsonValue::Null),
                "fromAddr": serde_json::from_str::<JsonValue>(
                    &r.get::<_, String>(14)?
                ).unwrap_or(JsonValue::Null),
                "toAddrs": serde_json::from_str::<JsonValue>(
                    &r.get::<_, String>(15)?
                ).unwrap_or_default(),
                "ccAddrs": serde_json::from_str::<JsonValue>(
                    &r.get::<_, String>(16)?
                ).unwrap_or_default(),
                "bccAddrs": serde_json::from_str::<JsonValue>(
                    &r.get::<_, String>(17)?
                ).unwrap_or_default(),
                "attachmentRefs": serde_json::from_str::<JsonValue>(
                    &r.get::<_, String>(18)?
                ).unwrap_or_default(),
                "customFields": serde_json::from_str::<JsonValue>(
                    &r.get::<_, String>(19)?
                ).unwrap_or_default(),
                "flags": {
                    "read": r.get::<_, bool>(20)?,
                    "answered": r.get::<_, bool>(21)?,
                    "draft": r.get::<_, bool>(22)?,
                    "flagged": r.get::<_, bool>(23)?
                },
                "icalData": r.get::<_, Option<String>>(24)?,
                "labelIds": [],
                "tags": []
            });
            Ok((id, msg))
        })?.map(|r| r.context("loading message row"))
          .collect::<Result<Vec<_>>>()?;

        // Batch-load all label associations for this vault in a single query instead of
        // one query per message. Avoids N+1 which would mean ~24k queries for 12k emails.
        let mut label_map: HashMap<String, Vec<String>> = HashMap::new();
        {
            let mut ls = self.conn.prepare(
                "SELECT ml.message_id, ml.label_id
                 FROM message_labels ml
                 INNER JOIN messages m ON ml.message_id = m.id
                 WHERE m.vault_id = ?1",
            )?;
            for row in ls.query_map(params![vault_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })? {
                let (msg_id, label_id) = row.context("loading label row")?;
                label_map.entry(msg_id).or_default().push(label_id);
            }
        }

        // Same for tags.
        let mut tag_map: HashMap<String, Vec<String>> = HashMap::new();
        {
            let mut ts = self.conn.prepare(
                "SELECT mt.message_id, mt.tag
                 FROM message_tags mt
                 INNER JOIN messages m ON mt.message_id = m.id
                 WHERE m.vault_id = ?1",
            )?;
            for row in ts.query_map(params![vault_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })? {
                let (msg_id, tag) = row.context("loading tag row")?;
                tag_map.entry(msg_id).or_default().push(tag);
            }
        }

        let mut result = Vec::with_capacity(msg_rows.len());
        for (id, mut msg) in msg_rows {
            msg["labelIds"] = label_map.remove(&id)
                .unwrap_or_default()
                .into_iter().map(JsonValue::String).collect::<Vec<_>>()
                .into();
            msg["tags"] = tag_map.remove(&id)
                .unwrap_or_default()
                .into_iter().map(JsonValue::String).collect::<Vec<_>>()
                .into();
            result.push(msg);
        }
        Ok(result)
    }

    /// Load all messages that carry a specific Nexus label ID.
    /// Used for on-demand label hydration when the label's messages fall
    /// outside the initial 2000-message hydration window.
    pub fn load_messages_for_label(&self, vault_id: &str, label_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT m.id, m.folder_id, m.thread_id, m.subject, m.snippet, m.body_ref, m.received_at,
                    m.status_id, m.priority, m.star, m.pinned, m.muted, m.notes, m.flag_json,
                    m.from_addr_json, m.to_addrs_json, m.cc_addrs_json, m.bcc_addrs_json,
                    m.attachment_refs_json, m.custom_fields_json,
                    m.flags_read, m.flags_answered, m.flags_draft, m.flags_flagged
             FROM messages m
             INNER JOIN message_labels ml ON ml.message_id = m.id
             WHERE m.vault_id = ?1 AND ml.label_id = ?2
             ORDER BY m.received_at DESC",
        )?;

        let msg_rows: Vec<(String, JsonValue)> = stmt.query_map(params![vault_id, label_id], |r| {
            let id: String = r.get(0)?;
            let msg = serde_json::json!({
                "id": id.clone(),
                "vaultId": vault_id,
                "folderId": r.get::<_, String>(1)?,
                "threadId": r.get::<_, String>(2)?,
                "subject": r.get::<_, String>(3)?,
                "snippet": r.get::<_, String>(4)?,
                "bodyRef": r.get::<_, String>(5)?,
                "receivedAt": r.get::<_, i64>(6)?,
                "statusId": r.get::<_, Option<String>>(7)?,
                "priority": r.get::<_, Option<i64>>(8)?,
                "star": r.get::<_, Option<String>>(9)?,
                "pinned": r.get::<_, bool>(10)?,
                "muted": r.get::<_, bool>(11)?,
                "notes": r.get::<_, Option<String>>(12)?,
                "flag": serde_json::from_str::<JsonValue>(
                    &r.get::<_, Option<String>>(13)?.unwrap_or_default()
                ).unwrap_or(JsonValue::Null),
                "fromAddr": serde_json::from_str::<JsonValue>(
                    &r.get::<_, String>(14)?
                ).unwrap_or(JsonValue::Null),
                "toAddrs": serde_json::from_str::<JsonValue>(
                    &r.get::<_, String>(15)?
                ).unwrap_or_default(),
                "ccAddrs": serde_json::from_str::<JsonValue>(
                    &r.get::<_, String>(16)?
                ).unwrap_or_default(),
                "bccAddrs": serde_json::from_str::<JsonValue>(
                    &r.get::<_, String>(17)?
                ).unwrap_or_default(),
                "attachmentRefs": serde_json::from_str::<JsonValue>(
                    &r.get::<_, String>(18)?
                ).unwrap_or_default(),
                "customFields": serde_json::from_str::<JsonValue>(
                    &r.get::<_, String>(19)?
                ).unwrap_or_default(),
                "flags": {
                    "read": r.get::<_, bool>(20)?,
                    "answered": r.get::<_, bool>(21)?,
                    "draft": r.get::<_, bool>(22)?,
                    "flagged": r.get::<_, bool>(23)?
                },
                "labelIds": [],
                "tags": []
            });
            Ok((id, msg))
        })?.map(|r| r.context("loading message row for label"))
          .collect::<Result<Vec<_>>>()?;

        if msg_rows.is_empty() {
            return Ok(vec![]);
        }

        // Collect message IDs to batch-load their label and tag associations.
        let ids: Vec<&str> = msg_rows.iter().map(|(id, _)| id.as_str()).collect();
        let placeholders = ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let id_params: Vec<&dyn rusqlite::types::ToSql> = ids.iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();

        let mut label_map: HashMap<String, Vec<String>> = HashMap::new();
        {
            let sql = format!(
                "SELECT message_id, label_id FROM message_labels WHERE message_id IN ({placeholders})"
            );
            let mut ls = self.conn.prepare(&sql)?;
            for row in ls.query_map(id_params.as_slice(), |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })? {
                let (msg_id, lbl_id) = row.context("loading label row")?;
                label_map.entry(msg_id).or_default().push(lbl_id);
            }
        }

        let mut tag_map: HashMap<String, Vec<String>> = HashMap::new();
        {
            let sql = format!(
                "SELECT message_id, tag FROM message_tags WHERE message_id IN ({placeholders})"
            );
            let mut ts = self.conn.prepare(&sql)?;
            for row in ts.query_map(id_params.as_slice(), |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })? {
                let (msg_id, tag) = row.context("loading tag row for label")?;
                tag_map.entry(msg_id).or_default().push(tag);
            }
        }

        let mut result = Vec::with_capacity(msg_rows.len());
        for (id, mut msg) in msg_rows {
            msg["labelIds"] = label_map.remove(&id)
                .unwrap_or_default()
                .into_iter().map(JsonValue::String).collect::<Vec<_>>()
                .into();
            msg["tags"] = tag_map.remove(&id)
                .unwrap_or_default()
                .into_iter().map(JsonValue::String).collect::<Vec<_>>()
                .into();
            result.push(msg);
        }
        Ok(result)
    }

    /// Absolute path to the message's `.eml` on disk, if one was written
    /// (local-first mode only). Returns None when the column is NULL or the
    /// message does not exist.
    pub fn get_message_eml_path(&self, vault_id: &str, message_id: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT eml_path FROM messages WHERE vault_id = ?1 AND id = ?2 LIMIT 1",
        )?;
        let path: Option<Option<String>> = stmt
            .query_row(params![vault_id, message_id], |row| row.get::<_, Option<String>>(0))
            .optional()?;
        Ok(path.flatten())
    }

    pub fn load_contacts(&self, vault_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, company, title, website, location, notes, tags_json,
                    created_at, updated_at, photo_url, always_show_images,
                    birthday, social_json, addresses_json, source, external_id, importance
             FROM contacts WHERE vault_id = ?1 ORDER BY name"
        )?;
        let rows: Vec<_> = stmt.query_map(params![vault_id], |r| Ok((
            r.get::<_, String>(0)?,       // id
            r.get::<_, String>(1)?,       // name
            r.get::<_, Option<String>>(2)?,  // company
            r.get::<_, Option<String>>(3)?,  // title
            r.get::<_, Option<String>>(4)?,  // website
            r.get::<_, Option<String>>(5)?,  // location
            r.get::<_, Option<String>>(6)?,  // notes
            r.get::<_, String>(7)?,       // tags_json
            r.get::<_, i64>(8)?,          // created_at
            r.get::<_, i64>(9)?,          // updated_at
            r.get::<_, Option<String>>(10)?, // photo_url
            r.get::<_, bool>(11)?,        // always_show_images
            r.get::<_, Option<String>>(12)?, // birthday
            r.get::<_, Option<String>>(13)?, // social_json
            r.get::<_, Option<String>>(14)?, // addresses_json
            r.get::<_, Option<String>>(15)?, // source
            r.get::<_, Option<String>>(16)?, // external_id
            r.get::<_, Option<String>>(17)?, // importance
        )))?.filter_map(|r| r.ok()).collect();

        let mut result = Vec::new();
        for (id, name, company, title, website, location, notes, tags_json,
             created_at, updated_at, photo_url, always_show_images,
             birthday, social_json, addresses_json, source, external_id, importance) in rows
        {
            let emails = self.load_contact_emails(&id)?;
            let phones = self.load_contact_phones(&id)?;
            let tags: serde_json::Value = serde_json::from_str(&tags_json).unwrap_or(serde_json::json!([]));
            let social: serde_json::Value = social_json.as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(serde_json::json!([]));
            let addresses: serde_json::Value = addresses_json.as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(serde_json::json!([]));
            result.push(serde_json::json!({
                "id": id,
                "vaultId": vault_id,
                "name": name,
                "emails": emails,
                "phones": phones,
                "company": company,
                "title": title,
                "website": website,
                "location": location,
                "notes": notes,
                "tags": tags,
                "photoUrl": photo_url,
                "alwaysShowImages": always_show_images,
                "birthday": birthday,
                "socialProfiles": social,
                "addresses": addresses,
                "source": source.unwrap_or_else(|| "manual".to_string()),
                "externalId": external_id,
                "importance": importance.unwrap_or_else(|| "normal".to_string()),
                "createdAt": created_at,
                "updatedAt": updated_at
            }));
        }
        Ok(result)
    }

    fn load_contact_emails(&self, contact_id: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT email FROM contact_emails WHERE contact_id = ?1 ORDER BY position"
        )?;
        let rows = stmt.query_map(params![contact_id], |r| r.get::<_, String>(0))?;
        rows.map(|r| r.context("loading contact email")).collect()
    }

    fn load_contact_phones(&self, contact_id: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT phone FROM contact_phones WHERE contact_id = ?1 ORDER BY position"
        )?;
        let rows = stmt.query_map(params![contact_id], |r| r.get::<_, String>(0))?;
        rows.map(|r| r.context("loading contact phone")).collect()
    }

    pub fn upsert_contact(&self, vault_id: &str, contact: &serde_json::Value) -> Result<()> {
        let id = contact["id"].as_str().unwrap_or_default();
        let name = contact["name"].as_str().unwrap_or_default();
        let company = contact["company"].as_str();
        let title = contact["title"].as_str();
        let website = contact["website"].as_str();
        let location = contact["location"].as_str();
        let notes = contact["notes"].as_str();
        let tags = contact["tags"].to_string();
        let photo_url = contact["photoUrl"].as_str();
        let always_show_images = contact["alwaysShowImages"].as_bool().unwrap_or(false) as i64;
        let birthday = contact["birthday"].as_str();
        let social = contact["socialProfiles"].to_string();
        let addresses = contact["addresses"].to_string();
        let source = contact["source"].as_str().unwrap_or("manual");
        let external_id = contact["externalId"].as_str();
        let importance = contact["importance"].as_str().unwrap_or("normal");
        let created_at = contact["createdAt"].as_i64().unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        let updated_at = contact["updatedAt"].as_i64().unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

        self.conn.execute(
            "INSERT INTO contacts (id, vault_id, name, company, title, website, location, notes,
                                   tags_json, photo_url, always_show_images,
                                   birthday, social_json, addresses_json, source, external_id, importance,
                                   created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)
             ON CONFLICT(id) DO UPDATE SET
               name=excluded.name, company=excluded.company, title=excluded.title,
               website=excluded.website, location=excluded.location, notes=excluded.notes,
               tags_json=excluded.tags_json,
               photo_url=COALESCE(excluded.photo_url, photo_url),
               always_show_images=excluded.always_show_images,
               birthday=excluded.birthday,
               social_json=excluded.social_json,
               addresses_json=excluded.addresses_json,
               source=excluded.source,
               external_id=COALESCE(excluded.external_id, external_id),
               importance=excluded.importance,
               updated_at=excluded.updated_at",
            params![id, vault_id, name, company, title, website, location, notes,
                    tags, photo_url, always_show_images,
                    birthday, social, addresses, source, external_id, importance,
                    created_at, updated_at],
        )?;

        // Rebuild email list
        self.conn.execute("DELETE FROM contact_emails WHERE contact_id = ?1", params![id])?;
        if let Some(emails) = contact["emails"].as_array() {
            for (pos, email) in emails.iter().enumerate() {
                if let Some(e) = email.as_str() {
                    self.conn.execute(
                        "INSERT OR IGNORE INTO contact_emails (contact_id, email, position) VALUES (?1, ?2, ?3)",
                        params![id, e, pos as i64],
                    )?;
                }
            }
        }

        // Rebuild phone list
        self.conn.execute("DELETE FROM contact_phones WHERE contact_id = ?1", params![id])?;
        if let Some(phones) = contact["phones"].as_array() {
            for (pos, phone) in phones.iter().enumerate() {
                if let Some(p) = phone.as_str() {
                    self.conn.execute(
                        "INSERT OR IGNORE INTO contact_phones (contact_id, phone, label, position) VALUES (?1, ?2, NULL, ?3)",
                        params![id, p, pos as i64],
                    )?;
                }
            }
        }

        Ok(())
    }

    /// Bulk-update contact photo URLs from a People API response (email → photo_url map).
    /// Only updates contacts that already exist in this vault; does not create new ones.
    pub fn update_contact_photos(
        &self,
        vault_id: &str,
        photos: &std::collections::HashMap<String, String>,
    ) -> Result<()> {
        for (email, photo_url) in photos {
            self.conn.execute(
                "UPDATE contacts SET photo_url = ?1
                 WHERE vault_id = ?2 AND id IN (
                     SELECT contact_id FROM contact_emails WHERE email = ?3
                 )",
                params![photo_url, vault_id, email],
            )?;
        }
        Ok(())
    }

    pub fn load_contact_groups(&self, vault_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, color, position, created_at FROM contact_groups WHERE vault_id = ?1 ORDER BY position"
        )?;
        let rows = stmt.query_map(params![vault_id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "vaultId": vault_id,
                "name": r.get::<_, String>(1)?,
                "color": r.get::<_, Option<String>>(2)?,
                "position": r.get::<_, i64>(3)?,
                "createdAt": r.get::<_, i64>(4)?
            }))
        })?;
        rows.map(|r| r.context("loading contact group")).collect()
    }

    pub fn upsert_contact_group(&self, vault_id: &str, group: &JsonValue) -> Result<()> {
        let id = group["id"].as_str().unwrap_or_default();
        let name = group["name"].as_str().unwrap_or_default();
        let color = group["color"].as_str();
        let position = group["position"].as_i64().unwrap_or(0);
        let created_at = group["createdAt"].as_i64()
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        self.conn.execute(
            "INSERT INTO contact_groups (id, vault_id, name, color, position, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, position=excluded.position",
            params![id, vault_id, name, color, position, created_at],
        )?;
        Ok(())
    }

    pub fn delete_contact_group(&self, group_id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM contact_groups WHERE id = ?1", params![group_id])?;
        Ok(())
    }

    pub fn add_contact_to_group(&self, group_id: &str, contact_id: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?1, ?2)",
            params![group_id, contact_id],
        )?;
        Ok(())
    }

    pub fn remove_contact_from_group(&self, group_id: &str, contact_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM contact_group_members WHERE group_id = ?1 AND contact_id = ?2",
            params![group_id, contact_id],
        )?;
        Ok(())
    }

    pub fn get_contacts_sync(&self, account_id: &str) -> Result<Option<(Option<String>, Option<i64>)>> {
        let row: Option<(Option<String>, Option<i64>)> = self.conn.query_row(
            "SELECT sync_token, last_synced_at FROM contacts_sync WHERE account_id = ?1",
            params![account_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        Ok(row)
    }

    pub fn upsert_contacts_sync(&self, account_id: &str, sync_token: Option<&str>, last_synced_at: i64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO contacts_sync (account_id, sync_token, last_synced_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(account_id) DO UPDATE SET sync_token=excluded.sync_token, last_synced_at=excluded.last_synced_at",
            params![account_id, sync_token, last_synced_at],
        )?;
        Ok(())
    }

    fn load_tag_usage(&self, vault_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT tag, count, last_used_at FROM tag_usage WHERE vault_id = ?1",
        )?;
        let rows = stmt.query_map(params![vault_id], |r| {
            Ok(serde_json::json!({
                "vaultId": vault_id,
                "tag": r.get::<_, String>(0)?,
                "count": r.get::<_, i64>(1)?,
                "lastUsedAt": r.get::<_, i64>(2)?
            }))
        })?;
        rows.map(|r| r.context("loading tag usage row")).collect()
    }

    fn load_saved_views(&self, vault_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, filter_json, position, created_at
             FROM saved_views WHERE vault_id = ?1 ORDER BY position",
        )?;
        let rows = stmt.query_map(params![vault_id], |r| {
            let filter_json: String = r.get(2)?;
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "vaultId": vault_id,
                "name": r.get::<_, String>(1)?,
                "filter": serde_json::from_str::<JsonValue>(&filter_json).unwrap_or_default(),
                "position": r.get::<_, i64>(3)?,
                "createdAt": r.get::<_, i64>(4)?
            }))
        })?;
        rows.map(|r| r.context("loading saved view row")).collect()
    }

    // ── Write helpers ─────────────────────────────────────────────────────────

    pub fn ensure_vault(&self, vault_id: &str, vault_path: &str) -> Result<()> {
        let ts = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO vaults (id, path, created_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET path = excluded.path",
            params![vault_id, vault_path, ts],
        )?;
        Ok(())
    }

    pub fn upsert_account(
        &self,
        id: &str,
        vault_id: &str,
        provider: &str,
        email: &str,
        display_name: Option<&str>,
        photo_url: Option<&str>,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO accounts (id, vault_id, provider, email, display_name, photo_url, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               provider = excluded.provider,
               email = excluded.email,
               display_name = excluded.display_name,
               photo_url = COALESCE(excluded.photo_url, photo_url)",
            params![id, vault_id, provider, email, display_name, photo_url,
                    chrono::Utc::now().timestamp_millis()],
        )?;
        Ok(())
    }

    pub fn update_account_photo(&self, account_id: &str, photo_url: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE accounts SET photo_url = ?1 WHERE id = ?2",
            params![photo_url, account_id],
        )?;
        Ok(())
    }

    pub fn save_tokens(
        &self,
        account_id: &str,
        access_token: &str,
        refresh_token: &str,
        expires_at: i64,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE accounts SET access_token = ?1, refresh_token = ?2, token_expires_at = ?3
             WHERE id = ?4",
            params![access_token, refresh_token, expires_at, account_id],
        )?;
        Ok(())
    }

    pub fn get_access_token(&self, account_id: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT access_token FROM accounts WHERE id = ?1",
        )?;
        Ok(stmt.query_row(params![account_id], |r| r.get(0)).optional()?)
    }

    pub fn get_refresh_token(&self, account_id: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT refresh_token FROM accounts WHERE id = ?1",
        )?;
        Ok(stmt.query_row(params![account_id], |r| r.get(0)).optional()?)
    }

    pub fn update_history_id(&self, account_id: &str, history_id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE accounts SET history_id = ?1 WHERE id = ?2",
            params![history_id, account_id],
        )?;
        Ok(())
    }

    pub fn get_history_id(&self, account_id: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT history_id FROM accounts WHERE id = ?1",
        )?;
        Ok(stmt.query_row(params![account_id], |r| r.get(0)).optional()?)
    }

    pub fn clear_history_id(&self, account_id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE accounts SET history_id = NULL WHERE id = ?1",
            params![account_id],
        )?;
        Ok(())
    }

    /// Insert a message parsed from a .eml file dragged into the vault.
    /// `folder_id` is derived from the directory name; `eml_path` is the absolute path.
    pub fn insert_eml_message(
        &self,
        vault_id: &str,
        id: &str,
        body_ref: &str,
        folder_id: &str,
        subject: &str,
        snippet: &str,
        from_json: &str,
        to_json: &str,
        received_at: i64,
        body_html: Option<&str>,
        eml_path: &str,
    ) -> Result<bool> {
        let inserted = self.conn.execute(
            "INSERT OR IGNORE INTO messages (
                id, vault_id, folder_id, thread_id, subject, snippet, body_ref, received_at,
                from_addr_json, to_addrs_json, cc_addrs_json, bcc_addrs_json,
                attachment_refs_json, custom_fields_json,
                flags_read, flags_answered, flags_draft, flags_flagged,
                eml_path
            ) VALUES (
                ?1, ?2, ?3, ?1, ?4, ?5, ?6, ?7,
                ?8, '[]', '[]', '[]', '[]', '{}',
                0, 0, 0, 0, ?9
            )",
            params![id, vault_id, folder_id, subject, snippet, body_ref, received_at, from_json, eml_path],
        )? > 0;
        if inserted {
            if let Some(html) = body_html {
                self.upsert_body(body_ref, html)?;
            }
        }
        Ok(inserted)
    }

    /// Soft-delete a message by its on-disk eml_path. Returns the deleted message id.
    pub fn delete_message_by_path(&self, eml_path: &str) -> Result<Option<String>> {
        let msg_id: Option<String> = {
            let mut stmt = self.conn.prepare(
                "SELECT id FROM messages WHERE eml_path = ?1 LIMIT 1",
            )?;
            stmt.query_row(params![eml_path], |r| r.get(0)).optional()?
        };
        if let Some(id) = &msg_id {
            self.conn.execute("DELETE FROM message_labels WHERE message_id = ?1", params![id])?;
            self.conn.execute("DELETE FROM message_tags WHERE message_id = ?1", params![id])?;
            self.conn.execute("DELETE FROM messages WHERE id = ?1", params![id])?;
        }
        Ok(msg_id)
    }

    /// Update a message's folder when its .eml is moved to a new directory.
    pub fn update_message_folder_by_path(&self, eml_path: &str, new_folder_id: &str) -> Result<bool> {
        let updated = self.conn.execute(
            "UPDATE messages SET folder_id = ?1, eml_path = ?2 WHERE eml_path = ?3",
            params![new_folder_id, eml_path, eml_path],
        )? > 0;
        Ok(updated)
    }

    /// Look up the system label ID whose disk_slug matches the given folder name.
    pub fn find_label_by_slug(&self, vault_id: &str, slug: &str) -> Result<Option<String>> {
        let normalized = slug.to_lowercase();
        let mut stmt = self.conn.prepare(
            "SELECT id FROM labels WHERE vault_id = ?1 AND (LOWER(name) = ?2 OR system_kind = ?2) LIMIT 1",
        )?;
        Ok(stmt.query_row(params![vault_id, normalized], |r| r.get(0)).optional()?)
    }

    /// Compute the slash-joined disk path for a folder by traversing parent slugs.
    /// Returns "" for unknown folder IDs (labels / system mailboxes don't live on disk).
    pub fn folder_disk_path(&self, folder_id: &str) -> String {
        let mut parts: Vec<String> = Vec::new();
        let mut current = folder_id.to_string();
        for _ in 0..10 {
            let row: Option<(String, Option<String>)> = self.conn.query_row(
                "SELECT disk_slug, parent_id FROM folders WHERE id = ?1",
                params![current.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            ).optional().unwrap_or(None);
            match row {
                Some((slug, parent)) => {
                    parts.push(slug);
                    match parent {
                        Some(p) => current = p,
                        None => break,
                    }
                }
                None => break,
            }
        }
        parts.reverse();
        parts.join("/")
    }

    pub fn get_body(&self, body_ref: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT html FROM message_bodies WHERE body_ref = ?1",
        )?;
        Ok(stmt.query_row(params![body_ref], |r| r.get(0)).optional()?)
    }

    pub fn upsert_body(&self, body_ref: &str, html: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO message_bodies (body_ref, html) VALUES (?1, ?2)
             ON CONFLICT(body_ref) DO UPDATE SET html = excluded.html",
            params![body_ref, html],
        )?;
        Ok(())
    }

    pub fn upsert_message_from_gmail(
        &self,
        vault_id: &str,
        msg: &crate::gmail::types::ParsedMessage,
    ) -> Result<bool> {
        // Returns true if this is a new message (not already in DB)
        let existing: Option<i64> = {
            let mut stmt = self.conn.prepare(
                "SELECT 1 FROM messages WHERE provider_id = ?1 AND provider_account_id = ?2 LIMIT 1",
            )?;
            stmt.query_row(params![&msg.provider_id, &msg.account_id], |r| r.get(0))
               .optional()?
        };
        if existing.is_some() {
            // Message record exists, but the body might never have been stored (e.g.
            // initial sync crashed mid-way, or the parse yielded None body_html at the
            // time). Fill it in now so it isn't permanently missing.
            if let Some(html) = &msg.body_html {
                self.conn.execute(
                    "INSERT OR IGNORE INTO message_bodies (body_ref, html) VALUES (?1, ?2)",
                    params![&msg.body_ref, html],
                )?;
            }
            return Ok(false);
        }

        // Build list_unsubscribe_json from parsed fields
        let list_unsubscribe_json: Option<String> = if msg.list_unsubscribe.is_some() || msg.list_unsubscribe_post.is_some() {
            let mut map = serde_json::Map::new();
            // Extract the first URL from the List-Unsubscribe header (comma-separated angle-bracket list)
            if let Some(raw) = &msg.list_unsubscribe {
                let link = raw.split(',')
                    .filter_map(|part| {
                        let trimmed = part.trim().trim_start_matches('<').trim_end_matches('>');
                        if trimmed.starts_with("http") || trimmed.starts_with("mailto") {
                            Some(trimmed.to_string())
                        } else {
                            None
                        }
                    })
                    .next();
                if let Some(url) = link {
                    map.insert("link".into(), serde_json::Value::String(url));
                }
            }
            if let Some(post) = &msg.list_unsubscribe_post {
                // Extract the https URL for POST (RFC 8058)
                let post_url = msg.list_unsubscribe.as_deref().unwrap_or("").split(',')
                    .filter_map(|part| {
                        let trimmed = part.trim().trim_start_matches('<').trim_end_matches('>');
                        if trimmed.starts_with("https") { Some(trimmed.to_string()) } else { None }
                    })
                    .next();
                if post.contains("One-Click") {
                    if let Some(url) = post_url {
                        map.insert("post".into(), serde_json::Value::String(url));
                    }
                }
            }
            if map.is_empty() { None } else { Some(serde_json::Value::Object(map).to_string()) }
        } else {
            None
        };

        let starred_label_id = format!("{vault_id}-starred");
        let initial_star: Option<&str> = if msg.label_ids.contains(&starred_label_id) {
            Some("yellow")
        } else {
            None
        };

        self.conn.execute(
            "INSERT OR IGNORE INTO messages (
                id, vault_id, folder_id, thread_id, subject, snippet, body_ref, received_at,
                from_addr_json, to_addrs_json, cc_addrs_json, bcc_addrs_json,
                attachment_refs_json, custom_fields_json,
                flags_read, flags_answered, flags_draft, flags_flagged,
                provider_id, provider_account_id, eml_path, list_unsubscribe_json, star,
                ical_data
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                ?9, ?10, ?11, ?12, ?13, '{}',
                ?14, 0, 0, 0,
                ?15, ?16, ?17, ?18, ?19,
                ?20
            )",
            params![
                msg.id, vault_id, msg.folder_id, msg.thread_id,
                msg.subject, msg.snippet, msg.body_ref, msg.received_at,
                serde_json::to_string(&msg.from_addr)?,
                serde_json::to_string(&msg.to_addrs)?,
                serde_json::to_string(&msg.cc_addrs)?,
                serde_json::to_string::<Vec<serde_json::Value>>(&vec![])?,
                serde_json::to_string(&msg.attachments)?,
                if msg.flags_read { 1 } else { 0 },
                msg.provider_id, msg.account_id,
                msg.eml_path,
                list_unsubscribe_json,
                initial_star,
                msg.ical_data
            ],
        )?;

        // Insert labels
        for label_id in &msg.label_ids {
            self.conn.execute(
                "INSERT OR IGNORE INTO message_labels (message_id, label_id) VALUES (?1, ?2)",
                params![msg.id, label_id],
            )?;
        }

        // Insert body
        if let Some(html) = &msg.body_html {
            self.upsert_body(&msg.body_ref, html)?;
        }

        // Apply rules to newly received message
        let from_str = msg.from_addr.get("email")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let subject = msg.subject.clone();
        let has_attachment = !msg.attachments.is_empty();
        self.apply_rules_to_message(vault_id, &msg.id, &from_str, &subject, has_attachment, &msg.label_ids, &[] as &[String])?;

        Ok(true)
    }

    pub fn ensure_gmail_labels(
        &self,
        vault_id: &str,
        gmail_labels: &[crate::gmail::label_map::GmailLabelInfo],
    ) -> Result<()> {
        // Process shallowest labels first so parent rows exist before children are inserted,
        // satisfying the parent_id foreign-key relationship in the application layer.
        let mut sorted: Vec<&crate::gmail::label_map::GmailLabelInfo> = gmail_labels.iter().collect();
        sorted.sort_by_key(|gl| gl.name.matches('/').count());

        for gl in sorted {
            self.conn.execute(
                "INSERT INTO labels (id, vault_id, name, color, kind, system_kind, position, parent_id, provider_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                   name = excluded.name,
                   color = excluded.color,
                   parent_id = excluded.parent_id,
                   provider_id = excluded.provider_id",
                params![
                    gl.nexus_id, vault_id, gl.name, gl.color, gl.kind, gl.system_kind,
                    gl.position, gl.parent_nexus_id, gl.gmail_id
                ],
            )?;
        }
        Ok(())
    }

    pub fn apply_mutation(
        &self,
        vault_id: &str,
        kind: &str,
        payload: &str,
        device_id: &str,
        lamport: i64,
    ) -> Result<()> {
        let id = uuid::Uuid::new_v4().to_string();
        let ts = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO mutations (id, vault_id, kind, payload_json, ts, device_id, lamport)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, vault_id, kind, payload, ts, device_id, lamport],
        )?;

        self.apply_mutation_to_tables(kind, payload)
    }

    /// Apply an inbound remote mutation to local tables WITHOUT recording it in the
    /// mutations log (avoids echoing back to the relay on next push).
    pub fn apply_remote_mutation(&self, kind: &str, payload: &str) -> Result<()> {
        self.apply_mutation_to_tables(kind, payload)
    }

    fn apply_mutation_to_tables(&self, kind: &str, payload: &str) -> Result<()> {
        let p: JsonValue = serde_json::from_str(payload)?;
        match kind {
            "SET_STATUS" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let status_id = p["statusId"].as_str();
                self.conn.execute(
                    "UPDATE messages SET status_id = ?1 WHERE id = ?2",
                    params![status_id, msg_id],
                )?;
            }
            "CLEAR_STATUS" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                self.conn.execute(
                    "UPDATE messages SET status_id = NULL WHERE id = ?1",
                    params![msg_id],
                )?;
            }
            "SET_PRIORITY" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let priority = p["priority"].as_i64();
                self.conn.execute(
                    "UPDATE messages SET priority = ?1 WHERE id = ?2",
                    params![priority, msg_id],
                )?;
            }
            "CLEAR_PRIORITY" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                self.conn.execute(
                    "UPDATE messages SET priority = NULL WHERE id = ?1",
                    params![msg_id],
                )?;
            }
            "ADD_LABEL" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let label_id = p["labelId"].as_str().unwrap_or_default();
                self.conn.execute(
                    "INSERT OR IGNORE INTO message_labels (message_id, label_id) VALUES (?1, ?2)",
                    params![msg_id, label_id],
                )?;
            }
            "REMOVE_LABEL" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let label_id = p["labelId"].as_str().unwrap_or_default();
                self.conn.execute(
                    "DELETE FROM message_labels WHERE message_id = ?1 AND label_id = ?2",
                    params![msg_id, label_id],
                )?;
            }
            "ADD_TAG" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let tag = p["tag"].as_str().unwrap_or_default();
                self.conn.execute(
                    "INSERT OR IGNORE INTO message_tags (message_id, tag) VALUES (?1, ?2)",
                    params![msg_id, tag],
                )?;
            }
            "REMOVE_TAG" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let tag = p["tag"].as_str().unwrap_or_default();
                self.conn.execute(
                    "DELETE FROM message_tags WHERE message_id = ?1 AND tag = ?2",
                    params![msg_id, tag],
                )?;
            }
            "SET_READ" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let read = p["read"].as_bool().unwrap_or_default();
                self.conn.execute(
                    "UPDATE messages SET flags_read = ?1 WHERE id = ?2",
                    params![read as i64, msg_id],
                )?;
            }
            "ARCHIVE" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                // Remove from INBOX label
                self.conn.execute(
                    "DELETE FROM message_labels WHERE message_id = ?1
                     AND label_id IN (SELECT id FROM labels WHERE system_kind = 'inbox')",
                    params![msg_id],
                )?;
            }
            "TRASH" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                // Remove from INBOX label
                self.conn.execute(
                    "DELETE FROM message_labels WHERE message_id = ?1
                     AND label_id IN (SELECT id FROM labels WHERE system_kind = 'inbox')",
                    params![msg_id],
                )?;
                // Add to TRASH label if it exists
                self.conn.execute(
                    "INSERT OR IGNORE INTO message_labels (message_id, label_id)
                     SELECT ?1, id FROM labels WHERE system_kind = 'trash' LIMIT 1",
                    params![msg_id],
                )?;
            }
            "SET_PINNED" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let pinned = p["pinned"].as_bool().unwrap_or_default();
                self.conn.execute(
                    "UPDATE messages SET pinned = ?1 WHERE id = ?2",
                    params![pinned as i64, msg_id],
                )?;
            }
            "SET_MUTED" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let muted = p["muted"].as_bool().unwrap_or_default();
                self.conn.execute(
                    "UPDATE messages SET muted = ?1 WHERE id = ?2",
                    params![muted as i64, msg_id],
                )?;
            }
            "SET_NOTE" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let notes = p["notes"].as_str();
                self.conn.execute(
                    "UPDATE messages SET notes = ?1 WHERE id = ?2",
                    params![notes, msg_id],
                )?;
            }
            "SET_STAR" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let star = p["star"].as_str();
                self.conn.execute(
                    "UPDATE messages SET star = ?1 WHERE id = ?2",
                    params![star, msg_id],
                )?;
                // Keep the starred system label in sync with the star field.
                self.conn.execute(
                    "INSERT OR IGNORE INTO message_labels (message_id, label_id)
                     SELECT ?1, l.id FROM labels l
                     WHERE l.system_kind = 'starred'
                       AND l.vault_id = (SELECT vault_id FROM messages WHERE id = ?1 LIMIT 1)",
                    params![msg_id],
                )?;
            }
            "SET_CUSTOM_FIELD_VALUE" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let field_id = p["fieldId"].as_str().unwrap_or_default();
                let value = p["value"].to_string();
                // Merge into custom_fields_json
                let current: String = self.conn.query_row(
                    "SELECT custom_fields_json FROM messages WHERE id = ?1",
                    params![msg_id],
                    |r| r.get(0),
                ).unwrap_or_else(|_| "{}".to_string());
                let mut fields: serde_json::Map<String, JsonValue> =
                    serde_json::from_str(&current).unwrap_or_default();
                fields.insert(field_id.to_string(), p["value"].clone());
                self.conn.execute(
                    "UPDATE messages SET custom_fields_json = ?1 WHERE id = ?2",
                    params![serde_json::to_string(&fields)?, msg_id],
                )?;
                drop(value); // silence unused warning
            }
            "CLEAR_CUSTOM_FIELD_VALUE" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let field_id = p["fieldId"].as_str().unwrap_or_default();
                let current: String = self.conn.query_row(
                    "SELECT custom_fields_json FROM messages WHERE id = ?1",
                    params![msg_id],
                    |r| r.get(0),
                ).unwrap_or_else(|_| "{}".to_string());
                let mut fields: serde_json::Map<String, JsonValue> =
                    serde_json::from_str(&current).unwrap_or_default();
                fields.remove(field_id);
                self.conn.execute(
                    "UPDATE messages SET custom_fields_json = ?1 WHERE id = ?2",
                    params![serde_json::to_string(&fields)?, msg_id],
                )?;
            }
            // ── Folder ops ────────────────────────────────────────
            "CREATE_FOLDER" => {
                let id = p["id"].as_str().unwrap_or_default();
                let vault_id = p["vaultId"].as_str().unwrap_or("local");
                let name = p["name"].as_str().unwrap_or_default();
                let disk_slug = p["diskSlug"].as_str().unwrap_or_default();
                let color = p["color"].as_i64();
                let icon = p["icon"].as_str();
                let system_kind = p["systemKind"].as_str();
                let position = p["position"].as_i64().unwrap_or(0);
                self.conn.execute(
                    "INSERT OR IGNORE INTO folders (id, vault_id, name, disk_slug, color, icon, system_kind, position)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![id, vault_id, name, disk_slug, color, icon, system_kind, position],
                )?;
            }
            "RENAME_FOLDER" => {
                let folder_id = p["folderId"].as_str().unwrap_or_default();
                let name = p["name"].as_str().unwrap_or_default();
                let disk_slug = p["diskSlug"].as_str().unwrap_or_default();
                self.conn.execute(
                    "UPDATE folders SET name = ?1, disk_slug = ?2 WHERE id = ?3",
                    params![name, disk_slug, folder_id],
                )?;
            }
            "RECOLOR_FOLDER" => {
                let folder_id = p["folderId"].as_str().unwrap_or_default();
                let color = p["color"].as_i64();
                self.conn.execute("UPDATE folders SET color = ?1 WHERE id = ?2", params![color, folder_id])?;
            }
            "DELETE_FOLDER" => {
                let folder_id = p["folderId"].as_str().unwrap_or_default();
                self.conn.execute("DELETE FROM folders WHERE id = ?1", params![folder_id])?;
            }
            "MOVE_TO_FOLDER" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let folder_id = p["folderId"].as_str().unwrap_or_default();
                self.conn.execute(
                    "UPDATE messages SET folder_id = ?1 WHERE id = ?2",
                    params![folder_id, msg_id],
                )?;
            }

            // ── Label CRUD ─────────────────────────────────────────
            "CREATE_LABEL" => {
                let id = p["id"].as_str().unwrap_or_default();
                let vault_id = p["vaultId"].as_str().unwrap_or("local");
                let name = p["name"].as_str().unwrap_or_default();
                let color = p["color"].as_i64().unwrap_or(1);
                let kind = p["kind"].as_str().unwrap_or("user");
                let system_kind = p["systemKind"].as_str();
                let parent_id = p["parentId"].as_str();
                let position = p["position"].as_i64().unwrap_or(0);
                let provider_id = p["providerId"].as_str();
                self.conn.execute(
                    "INSERT OR IGNORE INTO labels (id, vault_id, name, color, kind, system_kind, parent_id, position, provider_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![id, vault_id, name, color, kind, system_kind, parent_id, position, provider_id],
                )?;
            }
            "RENAME_LABEL" => {
                let label_id = p["labelId"].as_str().unwrap_or_default();
                let name = p["name"].as_str().unwrap_or_default();
                self.conn.execute("UPDATE labels SET name = ?1 WHERE id = ?2", params![name, label_id])?;
            }
            "RECOLOR_LABEL" => {
                let label_id = p["labelId"].as_str().unwrap_or_default();
                let color = p["color"].as_i64().unwrap_or(1);
                self.conn.execute("UPDATE labels SET color = ?1 WHERE id = ?2", params![color, label_id])?;
            }
            "DELETE_LABEL" => {
                let label_id = p["labelId"].as_str().unwrap_or_default();
                self.conn.execute("DELETE FROM message_labels WHERE label_id = ?1", params![label_id])?;
                self.conn.execute("DELETE FROM labels WHERE id = ?1", params![label_id])?;
            }
            "REORDER_LABELS" => {
                if let Some(ids) = p["orderedIds"].as_array() {
                    for (i, id) in ids.iter().enumerate() {
                        if let Some(s) = id.as_str() {
                            self.conn.execute("UPDATE labels SET position = ?1 WHERE id = ?2", params![i as i64, s])?;
                        }
                    }
                }
            }

            // ── Tag global ops ─────────────────────────────────────
            "RENAME_TAG_GLOBAL" => {
                let old_tag = p["oldTag"].as_str().unwrap_or_default();
                let new_tag = p["newTag"].as_str().unwrap_or_default();
                self.conn.execute("UPDATE message_tags SET tag = ?1 WHERE tag = ?2", params![new_tag, old_tag])?;
                self.conn.execute(
                    "INSERT OR REPLACE INTO tag_usage (vault_id, tag, count, last_used_at)
                     SELECT vault_id, ?1, count, last_used_at FROM tag_usage WHERE tag = ?2",
                    params![new_tag, old_tag],
                )?;
                self.conn.execute("DELETE FROM tag_usage WHERE tag = ?1", params![old_tag])?;
            }
            "DELETE_TAG_GLOBAL" => {
                let tag = p["tag"].as_str().unwrap_or_default();
                self.conn.execute("DELETE FROM message_tags WHERE tag = ?1", params![tag])?;
                self.conn.execute("DELETE FROM tag_usage WHERE tag = ?1", params![tag])?;
            }

            // ── Status CRUD ────────────────────────────────────────
            "CREATE_STATUS" => {
                let id = p["id"].as_str().unwrap_or_default();
                let vault_id = p["vaultId"].as_str().unwrap_or("local");
                let name = p["name"].as_str().unwrap_or_default();
                let color = p["color"].as_i64().unwrap_or(1);
                let position = p["position"].as_i64().unwrap_or(0);
                let is_default = p["isDefault"].as_bool().unwrap_or(false) as i64;
                let is_terminal = p["isTerminal"].as_bool().unwrap_or(false) as i64;
                self.conn.execute(
                    "INSERT OR IGNORE INTO statuses (id, vault_id, name, color, position, is_default, is_terminal)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![id, vault_id, name, color, position, is_default, is_terminal],
                )?;
            }
            "RENAME_STATUS" => {
                let status_id = p["statusId"].as_str().unwrap_or_default();
                let name = p["name"].as_str().unwrap_or_default();
                self.conn.execute("UPDATE statuses SET name = ?1 WHERE id = ?2", params![name, status_id])?;
            }
            "DELETE_STATUS" => {
                let status_id = p["statusId"].as_str().unwrap_or_default();
                self.conn.execute("UPDATE messages SET status_id = NULL WHERE status_id = ?1", params![status_id])?;
                self.conn.execute("DELETE FROM statuses WHERE id = ?1", params![status_id])?;
            }
            "REORDER_STATUSES" => {
                if let Some(ids) = p["orderedIds"].as_array() {
                    for (i, id) in ids.iter().enumerate() {
                        if let Some(s) = id.as_str() {
                            self.conn.execute("UPDATE statuses SET position = ?1 WHERE id = ?2", params![i as i64, s])?;
                        }
                    }
                }
            }

            // ── Flag lifecycle ─────────────────────────────────────
            "SET_FLAG" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let flag_json = p["flag"].to_string();
                self.conn.execute(
                    "UPDATE messages SET flag_json = ?1, flags_flagged = 1 WHERE id = ?2",
                    params![flag_json, msg_id],
                )?;
            }
            "UPDATE_FLAG" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let current: String = self.conn.query_row(
                    "SELECT COALESCE(flag_json, '{}') FROM messages WHERE id = ?1",
                    params![msg_id], |r| r.get(0),
                ).unwrap_or_else(|_| "{}".to_string());
                let mut flag: serde_json::Map<String, JsonValue> =
                    serde_json::from_str(&current).unwrap_or_default();
                if let Some(obj) = p["updates"].as_object() {
                    for (k, v) in obj { flag.insert(k.clone(), v.clone()); }
                }
                self.conn.execute(
                    "UPDATE messages SET flag_json = ?1 WHERE id = ?2",
                    params![serde_json::to_string(&flag)?, msg_id],
                )?;
            }
            "COMPLETE_FLAG" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let now = chrono::Utc::now().timestamp_millis();
                let current: String = self.conn.query_row(
                    "SELECT COALESCE(flag_json, '{}') FROM messages WHERE id = ?1",
                    params![msg_id], |r| r.get(0),
                ).unwrap_or_else(|_| "{}".to_string());
                let mut flag: serde_json::Map<String, JsonValue> =
                    serde_json::from_str(&current).unwrap_or_default();
                flag.insert("completedAt".to_string(), JsonValue::Number(now.into()));
                self.conn.execute(
                    "UPDATE messages SET flag_json = ?1 WHERE id = ?2",
                    params![serde_json::to_string(&flag)?, msg_id],
                )?;
            }
            "CLEAR_FLAG" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                self.conn.execute(
                    "UPDATE messages SET flag_json = NULL, flags_flagged = 0 WHERE id = ?1",
                    params![msg_id],
                )?;
            }

            // ── Star ───────────────────────────────────────────────
            "CLEAR_STAR" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                self.conn.execute("UPDATE messages SET star = NULL WHERE id = ?1", params![msg_id])?;
                // Keep the starred system label in sync with the star field.
                self.conn.execute(
                    "DELETE FROM message_labels
                     WHERE message_id = ?1
                       AND label_id IN (SELECT id FROM labels WHERE system_kind = 'starred')",
                    params![msg_id],
                )?;
            }

            // ── Message lifecycle ──────────────────────────────────
            "READ" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                self.conn.execute("UPDATE messages SET flags_read = 1 WHERE id = ?1", params![msg_id])?;
            }
            "UNREAD" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                self.conn.execute("UPDATE messages SET flags_read = 0 WHERE id = ?1", params![msg_id])?;
            }
            "SNOOZE" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                let until = p["until"].as_i64().unwrap_or(0);
                self.conn.execute(
                    "DELETE FROM message_labels WHERE message_id = ?1
                     AND label_id IN (SELECT id FROM labels WHERE system_kind = 'inbox')",
                    params![msg_id],
                )?;
                self.conn.execute(
                    "INSERT OR IGNORE INTO message_labels (message_id, label_id)
                     SELECT ?1, id FROM labels WHERE system_kind = 'snoozed' LIMIT 1",
                    params![msg_id],
                )?;
                let flag_json = serde_json::json!({
                    "setAt": chrono::Utc::now().timestamp_millis(),
                    "dueAt": until
                }).to_string();
                self.conn.execute(
                    "UPDATE messages SET flag_json = ?1 WHERE id = ?2",
                    params![flag_json, msg_id],
                )?;
            }
            "DELETE_MESSAGE" => {
                let msg_id = p["messageId"].as_str().unwrap_or_default();
                self.conn.execute("DELETE FROM message_labels WHERE message_id = ?1", params![msg_id])?;
                self.conn.execute("DELETE FROM message_tags WHERE message_id = ?1", params![msg_id])?;
                self.conn.execute("DELETE FROM messages WHERE id = ?1", params![msg_id])?;
            }
            // Provider sync and outbound send are handled by their own commands.
            "SEND_MESSAGE" | "RECEIVE_FROM_PROVIDER" => {}

            // ── Custom field definitions ───────────────────────────
            "CREATE_CUSTOM_FIELD" => {
                let id = p["id"].as_str().unwrap_or_default();
                let vault_id = p["vaultId"].as_str().unwrap_or("local");
                let name = p["name"].as_str().unwrap_or_default();
                let field_type = p["type"].as_str().unwrap_or("text");
                let description = p["description"].as_str();
                let position = p["position"].as_i64().unwrap_or(0);
                let is_pinned = p["isPinned"].as_bool().unwrap_or(false) as i64;
                let default_value = p["defaultValue"].as_str();
                self.conn.execute(
                    "INSERT OR IGNORE INTO custom_field_defs
                     (id, vault_id, name, type, description, position, is_pinned, default_value)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![id, vault_id, name, field_type, description, position, is_pinned, default_value],
                )?;
                if let Some(options) = p["options"].as_array() {
                    for opt in options {
                        let oid = opt["id"].as_str().unwrap_or_default();
                        let label = opt["label"].as_str().unwrap_or_default();
                        let color = opt["color"].as_i64().unwrap_or(1);
                        let opos = opt["position"].as_i64().unwrap_or(0);
                        self.conn.execute(
                            "INSERT OR IGNORE INTO custom_field_options (id, field_id, label, color, position)
                             VALUES (?1, ?2, ?3, ?4, ?5)",
                            params![oid, id, label, color, opos],
                        )?;
                    }
                }
            }
            "UPDATE_CUSTOM_FIELD" => {
                let field_id = p["fieldId"].as_str().unwrap_or_default();
                let updates = &p["updates"];
                if let Some(name) = updates["name"].as_str() {
                    self.conn.execute("UPDATE custom_field_defs SET name = ?1 WHERE id = ?2", params![name, field_id])?;
                }
                if let Some(desc) = updates["description"].as_str() {
                    self.conn.execute("UPDATE custom_field_defs SET description = ?1 WHERE id = ?2", params![desc, field_id])?;
                }
                if let Some(pinned) = updates["isPinned"].as_bool() {
                    self.conn.execute("UPDATE custom_field_defs SET is_pinned = ?1 WHERE id = ?2", params![pinned as i64, field_id])?;
                }
                if let Some(options) = updates["options"].as_array() {
                    self.conn.execute("DELETE FROM custom_field_options WHERE field_id = ?1", params![field_id])?;
                    for opt in options {
                        let oid = opt["id"].as_str().unwrap_or_default();
                        let label = opt["label"].as_str().unwrap_or_default();
                        let color = opt["color"].as_i64().unwrap_or(1);
                        let opos = opt["position"].as_i64().unwrap_or(0);
                        self.conn.execute(
                            "INSERT OR IGNORE INTO custom_field_options (id, field_id, label, color, position)
                             VALUES (?1, ?2, ?3, ?4, ?5)",
                            params![oid, field_id, label, color, opos],
                        )?;
                    }
                }
            }
            "DELETE_CUSTOM_FIELD" => {
                let field_id = p["fieldId"].as_str().unwrap_or_default();
                // custom_field_options rows cascade via ON DELETE CASCADE
                self.conn.execute("DELETE FROM custom_field_defs WHERE id = ?1", params![field_id])?;
            }

            // ── Saved views ────────────────────────────────────────
            "SAVE_VIEW" => {
                let id = p["id"].as_str().unwrap_or_default();
                let vault_id = p["vaultId"].as_str().unwrap_or("local");
                let name = p["name"].as_str().unwrap_or_default();
                let filter_json = p["filter"].to_string();
                let position = p["position"].as_i64().unwrap_or(0);
                let created_at = p["createdAt"].as_i64()
                    .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
                self.conn.execute(
                    "INSERT OR REPLACE INTO saved_views (id, vault_id, name, filter_json, position, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![id, vault_id, name, filter_json, position, created_at],
                )?;
            }
            "DELETE_VIEW" => {
                let view_id = p["viewId"].as_str().unwrap_or_default();
                self.conn.execute("DELETE FROM saved_views WHERE id = ?1", params![view_id])?;
            }
            "RENAME_VIEW" => {
                let view_id = p["viewId"].as_str().unwrap_or_default();
                let name = p["name"].as_str().unwrap_or_default();
                self.conn.execute("UPDATE saved_views SET name = ?1 WHERE id = ?2", params![name, view_id])?;
            }

            // ── Contacts ───────────────────────────────────────────
            "UPSERT_CONTACT" | "UPDATE_CONTACT" => {
                let contact = &p["contact"];
                let vault_id = contact["vaultId"].as_str().unwrap_or("local");
                self.upsert_contact(vault_id, contact)?;
            }
            "DELETE_CONTACT" => {
                let contact_id = p["contactId"].as_str().unwrap_or_default();
                self.conn.execute(
                    "DELETE FROM contacts WHERE id = ?1",
                    params![contact_id],
                )?;
            }
            "CREATE_CONTACT_GROUP" | "UPDATE_CONTACT_GROUP" => {
                let group = &p["group"];
                let vault_id = group["vaultId"].as_str().unwrap_or("local");
                self.upsert_contact_group(vault_id, group)?;
            }
            "DELETE_CONTACT_GROUP" => {
                let group_id = p["groupId"].as_str().unwrap_or_default();
                self.delete_contact_group(group_id)?;
            }
            "ADD_CONTACT_TO_GROUP" => {
                let group_id = p["groupId"].as_str().unwrap_or_default();
                let contact_id = p["contactId"].as_str().unwrap_or_default();
                self.add_contact_to_group(group_id, contact_id)?;
            }
            "REMOVE_CONTACT_FROM_GROUP" => {
                let group_id = p["groupId"].as_str().unwrap_or_default();
                let contact_id = p["contactId"].as_str().unwrap_or_default();
                self.remove_contact_from_group(group_id, contact_id)?;
            }
            "UPSERT_CALENDAR_EVENT" => {
                let event = p.get("event").ok_or_else(|| anyhow::anyhow!("missing event"))?;
                self.upsert_calendar_event(vault_id, event)?;
            }
            "DELETE_CALENDAR_EVENT" => {
                let id = p["eventId"].as_str().unwrap_or_default();
                self.delete_calendar_event(id)?;
            }
            "UPDATE_CALENDAR_EVENT_NOTES" => {
                let id = p["id"].as_str().unwrap_or_default();
                let notes = p["notes"].as_str();
                self.update_calendar_event_notes(id, notes)?;
            }
            // Unrecognised mutations are logged but not applied to the DB tables
            other => {
                log::debug!("apply_mutation: unhandled kind '{other}' (recorded in log only)");
            }
        }
        Ok(())
    }

    /// Returns (mutation_id, kind, payload_json, vault_id) for mutations not yet synced to Gmail.
    pub fn pending_outbound_mutations(&self) -> Result<Vec<(String, String, String, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, payload_json, vault_id FROM mutations WHERE synced_at IS NULL ORDER BY ts LIMIT 100",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?;
        rows.map(|r| r.context("loading pending mutation")).collect()
    }

    /// Returns (id, kind, payload_json, device_id, lamport) for mutations not yet pushed to relay.
    pub fn pending_relay_mutations(&self) -> Result<Vec<(String, String, String, String, i64)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, payload_json, device_id, lamport FROM mutations \
             WHERE relay_seq IS NULL ORDER BY lamport LIMIT 200",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })?;
        rows.map(|r| r.context("loading pending relay mutation")).collect()
    }

    pub fn mark_relay_pushed(&self, mutation_id: &str, seq: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE mutations SET relay_seq = ?1 WHERE id = ?2",
            params![seq, mutation_id],
        )?;
        Ok(())
    }

    // ─── Vault key ────────────────────────────────────────────────────────────────

    /// Returns the vault's 32-byte encryption key, generating it on first call.
    pub fn get_or_create_vault_key(&self, vault_id: &str) -> Result<[u8; 32]> {
        let existing: Option<String> = self.conn.query_row(
            "SELECT key_hex FROM vault_key WHERE vault_id = ?1",
            params![vault_id],
            |r| r.get(0),
        ).optional()?;

        if let Some(hex) = existing {
            let bytes = decode_hex(&hex).context("decoding vault key hex")?;
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }

        // Generate a new random key (two UUID v4 values = 32 cryptographically random bytes)
        let a = uuid::Uuid::new_v4();
        let b = uuid::Uuid::new_v4();
        let mut key = [0u8; 32];
        key[..16].copy_from_slice(a.as_bytes());
        key[16..].copy_from_slice(b.as_bytes());
        let hex = encode_hex(&key);
        self.conn.execute(
            "INSERT OR IGNORE INTO vault_key (vault_id, key_hex) VALUES (?1, ?2)",
            params![vault_id, hex],
        )?;
        Ok(key)
    }

    pub fn get_vault_key_hex(&self, vault_id: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row(
            "SELECT key_hex FROM vault_key WHERE vault_id = ?1",
            params![vault_id],
            |r| r.get(0),
        ).optional()?)
    }

    pub fn import_vault_key(&self, vault_id: &str, key_hex: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO vault_key (vault_id, key_hex) VALUES (?1, ?2)",
            params![vault_id, key_hex],
        )?;
        Ok(())
    }

    // ─── Device ID ────────────────────────────────────────────────────────────────

    /// Returns the stable device ID for this installation, generating it on first call.
    pub fn get_or_create_device_id(&self) -> Result<String> {
        let existing: Option<String> = self.conn.query_row(
            "SELECT device_id FROM devices ORDER BY enrolled_at LIMIT 1",
            [],
            |r| r.get(0),
        ).optional()?;

        if let Some(id) = existing {
            return Ok(id);
        }

        let id = format!("dev-{}", uuid::Uuid::new_v4().simple());
        let nickname = std::env::var("HOSTNAME")
            .or_else(|_| std::env::var("COMPUTERNAME"))
            .unwrap_or_else(|_| "Nexus Device".to_string());
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT OR IGNORE INTO devices (device_id, nickname, enrolled_at) VALUES (?1, ?2, ?3)",
            params![id, nickname, now],
        )?;
        Ok(id)
    }

    // ─── Relay state ──────────────────────────────────────────────────────────────

    pub fn get_relay_url(&self) -> Result<Option<String>> {
        Ok(self.conn.query_row(
            "SELECT relay_url FROM relay_state LIMIT 1",
            [],
            |r| r.get(0),
        ).optional()?)
    }

    pub fn set_relay_url(&self, url: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO relay_state (relay_url, last_seq, last_sync_at) VALUES (?1, 0, NULL)",
            params![url],
        )?;
        Ok(())
    }

    pub fn get_relay_cursor(&self, relay_url: &str) -> Result<i64> {
        Ok(self.conn.query_row(
            "SELECT last_seq FROM relay_state WHERE relay_url = ?1",
            params![relay_url],
            |r| r.get(0),
        ).optional()?.unwrap_or(0))
    }

    pub fn update_relay_cursor(&self, relay_url: &str, seq: i64, now_ms: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE relay_state SET last_seq = ?1, last_sync_at = ?2 WHERE relay_url = ?3",
            params![seq, now_ms, relay_url],
        )?;
        Ok(())
    }

    pub fn get_relay_last_sync_at(&self) -> Result<Option<i64>> {
        Ok(self.conn.query_row(
            "SELECT last_sync_at FROM relay_state ORDER BY last_sync_at DESC LIMIT 1",
            [],
            |r| r.get(0),
        ).optional()?.flatten())
    }

    pub fn pending_relay_count(&self) -> Result<usize> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM mutations WHERE relay_seq IS NULL",
            [],
            |r| r.get(0),
        )?;
        Ok(count as usize)
    }

    // ─── Enrollment sessions ─────────────────────────────────────────────────────

    pub fn store_enroll_session(
        &self,
        code_hash: &str,
        vault_id: &str,
        encrypted_vault_key: &[u8],
        expires_at: i64,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO enroll_sessions (code_hash, vault_id, encrypted_vault_key, expires_at, attempts) \
             VALUES (?1, ?2, ?3, ?4, 0)",
            params![code_hash, vault_id, encrypted_vault_key, expires_at],
        )?;
        Ok(())
    }

    /// Returns true if the stored access token has not yet expired.
    pub fn token_is_valid(&self, account_id: &str) -> Result<bool> {
        let mut stmt = self.conn.prepare(
            "SELECT token_expires_at FROM accounts WHERE id = ?1",
        )?;
        let expires_at: Option<i64> = stmt
            .query_row(params![account_id], |r| r.get(0))
            .optional()?;
        Ok(match expires_at {
            Some(exp) => chrono::Utc::now().timestamp() < exp - 60,
            None => false,
        })
    }

    pub fn mark_mutation_synced(&self, mutation_id: &str) -> Result<()> {
        let ts = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE mutations SET synced_at = ?1 WHERE id = ?2",
            params![ts, mutation_id],
        )?;
        Ok(())
    }

    /// Add a Nexus label to a message identified by its Gmail provider_id.
    pub fn add_label_by_provider_id(&self, provider_id: &str, label_id: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO message_labels (message_id, label_id)
             SELECT id, ?2 FROM messages WHERE provider_id = ?1",
            params![provider_id, label_id],
        )?;
        // If this is the starred system label, also set the star field (only when null
        // to preserve any custom star style the user may have set locally).
        self.conn.execute(
            "UPDATE messages SET star = 'yellow'
             WHERE provider_id = ?1
               AND star IS NULL
               AND EXISTS (SELECT 1 FROM labels WHERE id = ?2 AND system_kind = 'starred')",
            params![provider_id, label_id],
        )?;
        Ok(())
    }

    /// Remove a Nexus label from a message identified by its Gmail provider_id.
    pub fn remove_label_by_provider_id(&self, provider_id: &str, label_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM message_labels
             WHERE label_id = ?2
               AND message_id = (SELECT id FROM messages WHERE provider_id = ?1 LIMIT 1)",
            params![provider_id, label_id],
        )?;
        // If this is the starred system label, also clear the star field.
        self.conn.execute(
            "UPDATE messages SET star = NULL
             WHERE provider_id = ?1
               AND EXISTS (SELECT 1 FROM labels WHERE id = ?2 AND system_kind = 'starred')",
            params![provider_id, label_id],
        )?;
        Ok(())
    }

    /// Get the provider_id (Gmail message id) for a Nexus message id.
    pub fn get_provider_id(&self, message_id: &str) -> Result<Option<(String, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT provider_id, provider_account_id FROM messages WHERE id = ?1",
        )?;
        Ok(stmt.query_row(params![message_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        }).optional()?)
    }

    // ─── EP6 multi-provider additions ─────────────────────────────────────────────

    /// Return (account_id, vault_id, provider) for all accounts of any provider.
    pub fn all_accounts(&self) -> Result<Vec<(String, String, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, vault_id, provider FROM accounts",
        )?;
        let rows = stmt.query_map(params![], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })?;
        rows.map(|r| r.context("loading account row")).collect()
    }

    /// Get sync_cursor (falls back to history_id for backwards compatibility).
    pub fn get_sync_cursor(&self, account_id: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT COALESCE(sync_cursor, history_id) FROM accounts WHERE id = ?1",
        )?;
        Ok(stmt.query_row(params![account_id], |r| r.get(0)).optional()?)
    }

    /// Update sync_cursor.
    pub fn update_sync_cursor(&self, account_id: &str, cursor: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE accounts SET sync_cursor = ?1 WHERE id = ?2",
            params![cursor, account_id],
        )?;
        Ok(())
    }

    /// Clear sync_cursor (triggers full resync).
    pub fn clear_sync_cursor(&self, account_id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE accounts SET sync_cursor = NULL WHERE id = ?1",
            params![account_id],
        )?;
        Ok(())
    }

    /// Get settings_json for an account.
    pub fn get_settings_json(&self, account_id: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT settings_json FROM accounts WHERE id = ?1",
        )?;
        Ok(stmt.query_row(params![account_id], |r| r.get(0)).optional()?)
    }

    /// Save settings_json for an account (provider-specific connection params).
    pub fn save_settings_json(&self, account_id: &str, settings_json: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE accounts SET settings_json = ?1 WHERE id = ?2",
            params![settings_json, account_id],
        )?;
        Ok(())
    }

    /// Get user preferences JSON for an account (defaultReplyAll, externalImages, etc.).
    pub fn get_account_preferences(&self, account_id: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT preferences_json FROM accounts WHERE id = ?1",
        )?;
        Ok(stmt.query_row(params![account_id], |r| r.get(0)).optional()?)
    }

    /// Save user preferences JSON for an account.
    pub fn save_account_preferences(&self, account_id: &str, preferences_json: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE accounts SET preferences_json = ?1 WHERE id = ?2",
            params![preferences_json, account_id],
        )?;
        Ok(())
    }

    /// Get signature HTML for an account.
    pub fn get_signature_html(&self, account_id: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT signature_html FROM accounts WHERE id = ?1",
        )?;
        Ok(stmt.query_row(params![account_id], |r| r.get(0)).optional()?)
    }

    /// Save signature HTML for an account.
    pub fn save_signature_html(&self, account_id: &str, html: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE accounts SET signature_html = ?1 WHERE id = ?2",
            params![html, account_id],
        )?;
        Ok(())
    }

    /// Save encrypted credential (IMAP password stored in access_token column).
    pub fn save_credential(&self, account_id: &str, encrypted_credential: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE accounts SET access_token = ?1 WHERE id = ?2",
            params![encrypted_credential, account_id],
        )?;
        Ok(())
    }

    /// Return all Gmail accounts as (account_id, vault_id) pairs.
    pub fn all_gmail_accounts(&self) -> Result<Vec<(String, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, vault_id FROM accounts WHERE provider = 'gmail'",
        )?;
        let rows = stmt.query_map(params![], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        rows.map(|r| r.context("loading gmail account row")).collect()
    }

    /// Return (nexus_id, provider_id) for messages that have no body stored.
    /// Used by the post-migration body repair pass.
    pub fn get_messages_missing_bodies(&self, account_id: &str) -> Result<Vec<(String, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT m.id, m.provider_id FROM messages m
             LEFT JOIN message_bodies mb ON m.body_ref = mb.body_ref
             WHERE mb.body_ref IS NULL AND m.provider_account_id = ?1",
        )?;
        let rows = stmt.query_map(params![account_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        rows.map(|r| r.context("loading missing body row")).collect()
    }

    // ─── EP7: FTS5 search ─────────────────────────────────────────────────────

    pub fn search_fts5(&self, query: &str, vault_id: &str, limit: usize) -> Result<Vec<String>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(vec![]);
        }

        // Dispatch field-prefix operators to SQL, otherwise use FTS5
        if let Some(addr) = q.strip_prefix("from:") {
            let pattern = format!("%{}%", addr.trim());
            let mut stmt = self.conn.prepare(
                "SELECT id FROM messages WHERE vault_id = ?1 AND from_addr_json LIKE ?2 LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![vault_id, pattern, limit as i64], |r| r.get(0))?;
            return rows.map(|r| r.map_err(anyhow::Error::from)).collect();
        }

        if let Some(addr) = q.strip_prefix("to:") {
            let pattern = format!("%{}%", addr.trim());
            let mut stmt = self.conn.prepare(
                "SELECT id FROM messages WHERE vault_id = ?1 AND (to_addrs_json LIKE ?2 OR cc_addrs_json LIKE ?2) LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![vault_id, pattern, limit as i64], |r| r.get(0))?;
            return rows.map(|r| r.map_err(anyhow::Error::from)).collect();
        }

        if let Some(term) = q.strip_prefix("tag:") {
            let tag = term.trim();
            let mut stmt = self.conn.prepare(
                "SELECT m.id FROM messages m JOIN message_tags mt ON mt.message_id = m.id
                 WHERE m.vault_id = ?1 AND mt.tag = ?2 LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![vault_id, tag, limit as i64], |r| r.get(0))?;
            return rows.map(|r| r.map_err(anyhow::Error::from)).collect();
        }

        if let Some(name) = q.strip_prefix("label:") {
            let pattern = format!("%{}%", name.trim());
            let mut stmt = self.conn.prepare(
                "SELECT m.id FROM messages m
                 JOIN message_labels ml ON ml.message_id = m.id
                 JOIN labels l ON l.id = ml.label_id
                 WHERE m.vault_id = ?1 AND l.name LIKE ?2 LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![vault_id, pattern, limit as i64], |r| r.get(0))?;
            return rows.map(|r| r.map_err(anyhow::Error::from)).collect();
        }

        if q == "has:attachment" {
            let mut stmt = self.conn.prepare(
                "SELECT id FROM messages WHERE vault_id = ?1 AND attachment_refs_json != '[]' LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![vault_id, limit as i64], |r| r.get(0))?;
            return rows.map(|r| r.map_err(anyhow::Error::from)).collect();
        }

        // General FTS5 query — fall back to LIKE if FTS5 raises a syntax error
        let fts_result = (|| -> Result<Vec<String>> {
            let mut stmt = self.conn.prepare(
                "SELECT mf.message_id FROM messages_fts mf
                 JOIN messages m ON m.id = mf.message_id
                 WHERE m.vault_id = ?1 AND messages_fts MATCH ?2
                 ORDER BY rank LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![vault_id, q, limit as i64], |r| r.get(0))?;
            rows.map(|r| r.map_err(anyhow::Error::from)).collect()
        })();

        match fts_result {
            Ok(ids) => Ok(ids),
            Err(_) => {
                // Malformed FTS5 query — fall back to simple LIKE on subject + snippet
                let pattern = format!("%{}%", q);
                let mut stmt = self.conn.prepare(
                    "SELECT id FROM messages WHERE vault_id = ?1 AND (subject LIKE ?2 OR snippet LIKE ?2) LIMIT ?3",
                )?;
                let rows = stmt.query_map(params![vault_id, pattern, limit as i64], |r| r.get(0))?;
                rows.map(|r| r.map_err(anyhow::Error::from)).collect()
            }
        }
    }

    // ─── EP7: Rules ───────────────────────────────────────────────────────────

    pub fn get_rules(&self, vault_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, vault_id, name, conditions_json, condition_logic, actions_json, enabled, position
             FROM rules WHERE vault_id = ?1 ORDER BY position ASC",
        )?;
        let rows = stmt.query_map(params![vault_id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "vaultId": r.get::<_, String>(1)?,
                "name": r.get::<_, String>(2)?,
                "conditions": serde_json::from_str::<serde_json::Value>(&r.get::<_, String>(3)?).unwrap_or(serde_json::json!([])),
                "conditionLogic": r.get::<_, String>(4)?,
                "actions": serde_json::from_str::<serde_json::Value>(&r.get::<_, String>(5)?).unwrap_or(serde_json::json!([])),
                "enabled": r.get::<_, bool>(6)?,
                "position": r.get::<_, i64>(7)?,
            }))
        })?;
        rows.map(|r| r.context("loading rule")).collect()
    }

    pub fn upsert_rule(&self, vault_id: &str, rule: &JsonValue) -> Result<()> {
        let id = rule["id"].as_str().unwrap_or("").to_string();
        let name = rule["name"].as_str().unwrap_or("").to_string();
        let conditions = rule["conditions"].to_string();
        let condition_logic = rule["conditionLogic"].as_str().unwrap_or("AND").to_string();
        let actions = rule["actions"].to_string();
        let enabled = rule["enabled"].as_bool().unwrap_or(true);
        let position = rule["position"].as_i64().unwrap_or(0);
        self.conn.execute(
            "INSERT INTO rules (id, vault_id, name, conditions_json, condition_logic, actions_json, enabled, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               conditions_json = excluded.conditions_json,
               condition_logic = excluded.condition_logic,
               actions_json = excluded.actions_json,
               enabled = excluded.enabled,
               position = excluded.position",
            params![id, vault_id, name, conditions, condition_logic, actions, enabled, position],
        )?;
        Ok(())
    }

    pub fn delete_rule(&self, id: &str, vault_id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM rules WHERE id = ?1 AND vault_id = ?2", params![id, vault_id])?;
        Ok(())
    }

    pub fn apply_rules_to_message(
        &self,
        vault_id: &str,
        msg_id: &str,
        from_addr: &str,
        subject: &str,
        has_attachment: bool,
        label_ids: &[String],
        _tags: &[String],
    ) -> Result<()> {
        let rules = self.get_rules(vault_id)?;
        for rule in &rules {
            if !rule["enabled"].as_bool().unwrap_or(false) {
                continue;
            }
            let conditions = match rule["conditions"].as_array() {
                Some(c) => c,
                None => continue,
            };
            let logic = rule["conditionLogic"].as_str().unwrap_or("AND");

            let matches: Vec<bool> = conditions.iter().map(|cond| {
                let field = cond["field"].as_str().unwrap_or("");
                let op = cond["op"].as_str().unwrap_or("");
                let value = cond["value"].as_str().unwrap_or("").to_lowercase();
                match field {
                    "from" => apply_str_op(op, &from_addr.to_lowercase(), &value),
                    "subject" => apply_str_op(op, &subject.to_lowercase(), &value),
                    "has_attachment" => has_attachment == (value == "true"),
                    "label" => label_ids.iter().any(|id| id.to_lowercase() == value),
                    _ => false,
                }
            }).collect();

            let rule_matches = if logic == "OR" {
                matches.iter().any(|&m| m)
            } else {
                !matches.is_empty() && matches.iter().all(|&m| m)
            };

            if !rule_matches {
                continue;
            }

            let actions = match rule["actions"].as_array() {
                Some(a) => a,
                None => continue,
            };
            for action in actions {
                let kind = action["kind"].as_str().unwrap_or("");
                let value = action["value"].as_str().unwrap_or("");
                match kind {
                    "ADD_LABEL" => {
                        // Scope insert to messages owned by this vault
                        let _ = self.conn.execute(
                            "INSERT OR IGNORE INTO message_labels (message_id, label_id)
                             SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM messages WHERE id = ?1 AND vault_id = ?3)",
                            params![msg_id, value, vault_id],
                        );
                    }
                    "REMOVE_LABEL" => {
                        let _ = self.conn.execute(
                            "DELETE FROM message_labels WHERE message_id = ?1 AND label_id = ?2
                             AND EXISTS (SELECT 1 FROM messages WHERE id = ?1 AND vault_id = ?3)",
                            params![msg_id, value, vault_id],
                        );
                    }
                    "MARK_READ" => {
                        let _ = self.conn.execute(
                            "UPDATE messages SET flags_read = 1 WHERE id = ?1 AND vault_id = ?2",
                            params![msg_id, vault_id],
                        );
                    }
                    "ADD_TAG" => {
                        let _ = self.conn.execute(
                            "INSERT OR IGNORE INTO message_tags (message_id, tag)
                             SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM messages WHERE id = ?1 AND vault_id = ?3)",
                            params![msg_id, value, vault_id],
                        );
                    }
                    "SET_STATUS" => {
                        let _ = self.conn.execute(
                            "UPDATE messages SET status_id = ?1 WHERE id = ?2 AND vault_id = ?3",
                            params![value, msg_id, vault_id],
                        );
                    }
                    "SET_PRIORITY" => {
                        if let Ok(p) = value.parse::<i64>() {
                            let _ = self.conn.execute(
                                "UPDATE messages SET priority = ?1 WHERE id = ?2 AND vault_id = ?3",
                                params![p, msg_id, vault_id],
                            );
                        }
                    }
                    "STAR" => {
                        let star = if value.is_empty() { "yellow-star" } else { value };
                        let _ = self.conn.execute(
                            "UPDATE messages SET star = ?1 WHERE id = ?2 AND vault_id = ?3",
                            params![star, msg_id, vault_id],
                        );
                    }
                    "ARCHIVE" => {
                        let archive_id: Option<String> = {
                            let mut stmt = self.conn.prepare(
                                "SELECT id FROM folders WHERE vault_id = ?1 AND system_kind = 'archive' LIMIT 1",
                            )?;
                            stmt.query_row(params![vault_id], |r| r.get(0)).optional()?
                        };
                        if let Some(fid) = archive_id {
                            let _ = self.conn.execute(
                                "UPDATE messages SET folder_id = ?1 WHERE id = ?2 AND vault_id = ?3",
                                params![fid, msg_id, vault_id],
                            );
                        }
                    }
                    "TRASH" => {
                        let trash_id: Option<String> = {
                            let mut stmt = self.conn.prepare(
                                "SELECT id FROM folders WHERE vault_id = ?1 AND system_kind = 'trash-bin' LIMIT 1",
                            )?;
                            stmt.query_row(params![vault_id], |r| r.get(0)).optional()?
                        };
                        if let Some(fid) = trash_id {
                            let _ = self.conn.execute(
                                "UPDATE messages SET folder_id = ?1 WHERE id = ?2 AND vault_id = ?3",
                                params![fid, msg_id, vault_id],
                            );
                        }
                    }
                    _ => {}
                }
            }
        }
        Ok(())
    }

    // ─── EP7: Templates ───────────────────────────────────────────────────────

    pub fn get_templates(&self, vault_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, vault_id, name, subject, body_html, created_at FROM templates WHERE vault_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![vault_id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "vaultId": r.get::<_, String>(1)?,
                "name": r.get::<_, String>(2)?,
                "subject": r.get::<_, String>(3)?,
                "bodyHtml": r.get::<_, String>(4)?,
                "createdAt": r.get::<_, i64>(5)?,
            }))
        })?;
        rows.map(|r| r.context("loading template")).collect()
    }

    pub fn upsert_template(&self, vault_id: &str, tmpl: &JsonValue) -> Result<()> {
        let id = tmpl["id"].as_str().unwrap_or("").to_string();
        let name = tmpl["name"].as_str().unwrap_or("").to_string();
        let subject = tmpl["subject"].as_str().unwrap_or("").to_string();
        let body_html = tmpl["bodyHtml"].as_str().unwrap_or("").to_string();
        let created_at = tmpl["createdAt"].as_i64().unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        self.conn.execute(
            "INSERT INTO templates (id, vault_id, name, subject, body_html, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, subject = excluded.subject, body_html = excluded.body_html",
            params![id, vault_id, name, subject, body_html, created_at],
        )?;
        Ok(())
    }

    pub fn delete_template(&self, id: &str, vault_id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM templates WHERE id = ?1 AND vault_id = ?2", params![id, vault_id])?;
        Ok(())
    }

    // ─── EP7: List-Unsubscribe ────────────────────────────────────────────────

    pub fn get_list_unsubscribe(&self, message_id: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT list_unsubscribe_json FROM messages WHERE id = ?1 LIMIT 1",
        )?;
        stmt.query_row(params![message_id], |r| r.get(0)).optional()
            .map_err(anyhow::Error::from)
    }

    // ─── EP7 Stage 4: Vacation Responder ─────────────────────────────────────

    pub fn get_vacation_responder(&self, account_id: &str) -> Result<Option<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, account_id, enabled, subject, body_html, start_date, end_date, contacts_only, sent_to_json, created_at, updated_at
             FROM vacation_responders WHERE account_id = ?1 LIMIT 1",
        )?;
        Ok(stmt.query_row(params![account_id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "accountId": r.get::<_, String>(1)?,
                "enabled": r.get::<_, bool>(2)?,
                "subject": r.get::<_, String>(3)?,
                "bodyHtml": r.get::<_, String>(4)?,
                "startDate": r.get::<_, Option<i64>>(5)?,
                "endDate": r.get::<_, Option<i64>>(6)?,
                "contactsOnly": r.get::<_, bool>(7)?,
                "sentTo": serde_json::from_str::<serde_json::Value>(&r.get::<_, String>(8)?).unwrap_or(serde_json::json!([])),
                "createdAt": r.get::<_, i64>(9)?,
                "updatedAt": r.get::<_, i64>(10)?,
            }))
        }).optional()?)
    }

    pub fn save_vacation_responder(&self, responder: &JsonValue) -> Result<()> {
        let id = responder["id"].as_str().unwrap_or("").to_string();
        let account_id = responder["accountId"].as_str().unwrap_or("").to_string();
        let enabled = responder["enabled"].as_bool().unwrap_or(false) as i64;
        let subject = responder["subject"].as_str().unwrap_or("").to_string();
        let body_html = responder["bodyHtml"].as_str().unwrap_or("").to_string();
        let start_date: Option<i64> = responder["startDate"].as_i64();
        let end_date: Option<i64> = responder["endDate"].as_i64();
        let contacts_only = responder["contactsOnly"].as_bool().unwrap_or(false) as i64;
        let now = chrono::Utc::now().timestamp_millis();
        let created_at = responder["createdAt"].as_i64().unwrap_or(now);
        self.conn.execute(
            "INSERT INTO vacation_responders
             (id, account_id, enabled, subject, body_html, start_date, end_date, contacts_only, sent_to_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '[]', ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               enabled = excluded.enabled,
               subject = excluded.subject,
               body_html = excluded.body_html,
               start_date = excluded.start_date,
               end_date = excluded.end_date,
               contacts_only = excluded.contacts_only,
               updated_at = excluded.updated_at",
            params![id, account_id, enabled, subject, body_html, start_date, end_date, contacts_only, created_at, now],
        )?;
        Ok(())
    }

    pub fn delete_vacation_responder(&self, account_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM vacation_responders WHERE account_id = ?1",
            params![account_id],
        )?;
        Ok(())
    }
}

fn apply_str_op(op: &str, haystack: &str, needle: &str) -> bool {
    match op {
        "contains" => haystack.contains(needle),
        "equals" => haystack == needle,
        "starts_with" => haystack.starts_with(needle),
        "not_contains" => !haystack.contains(needle),
        _ => false,
    }
}

// ─── Hex helpers (avoids adding a hex crate dep) ─────────────────────────────

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn decode_hex(s: &str) -> Result<Vec<u8>> {
    if s.len() % 2 != 0 {
        return Err(anyhow::anyhow!("odd-length hex string"));
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| anyhow::anyhow!("hex decode: {e}")))
        .collect()
}

// ─── Calendar queries ─────────────────────────────────────────────────────────

impl VaultDb {
    pub fn load_calendar_events(&self, vault_id: &str, start_ts: i64, end_ts: i64) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, account_id, calendar_id, external_id, title, description, location,
                    start_ts, end_ts, all_day, rrule, status, organizer_email,
                    attendees_json, html_link, created_at, updated_at,
                    notes, source_message_id,
                    conference_url, color_id, ical_uid, recurring_event_id,
                    creator_email, visibility, transparency, reminders_json, attachments_json
             FROM calendar_events
             WHERE vault_id = ?1 AND end_ts >= ?2 AND start_ts <= ?3
             ORDER BY start_ts ASC",
        )?;
        stmt.query_map(params![vault_id, start_ts, end_ts], |r| {
            let parse_json = |s: Option<String>| -> JsonValue {
                s.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or(JsonValue::Null)
            };
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "vaultId": vault_id,
                "accountId": r.get::<_, String>(1)?,
                "calendarId": r.get::<_, String>(2)?,
                "externalId": r.get::<_, Option<String>>(3)?,
                "title": r.get::<_, String>(4)?,
                "description": r.get::<_, Option<String>>(5)?,
                "location": r.get::<_, Option<String>>(6)?,
                "startTs": r.get::<_, i64>(7)?,
                "endTs": r.get::<_, i64>(8)?,
                "allDay": r.get::<_, bool>(9)?,
                "rrule": r.get::<_, Option<String>>(10)?,
                "status": r.get::<_, String>(11)?,
                "organizerEmail": r.get::<_, Option<String>>(12)?,
                "attendees": serde_json::from_str::<JsonValue>(
                    &r.get::<_, Option<String>>(13)?.unwrap_or_else(|| "[]".into())
                ).unwrap_or_default(),
                "htmlLink": r.get::<_, Option<String>>(14)?,
                "createdAt": r.get::<_, i64>(15)?,
                "updatedAt": r.get::<_, i64>(16)?,
                "notes": r.get::<_, Option<String>>(17)?,
                "sourceMessageId": r.get::<_, Option<String>>(18)?,
                "conferenceUrl": r.get::<_, Option<String>>(19)?,
                "colorId": r.get::<_, Option<String>>(20)?,
                "iCalUID": r.get::<_, Option<String>>(21)?,
                "recurringEventId": r.get::<_, Option<String>>(22)?,
                "creatorEmail": r.get::<_, Option<String>>(23)?,
                "visibility": r.get::<_, Option<String>>(24)?,
                "transparency": r.get::<_, Option<String>>(25)?,
                "reminders": parse_json(r.get::<_, Option<String>>(26)?),
                "attachments": parse_json(r.get::<_, Option<String>>(27)?),
            }))
        })?.map(|r| r.context("loading calendar_events row")).collect()
    }

    pub fn upsert_calendar_event(&self, vault_id: &str, event: &JsonValue) -> Result<()> {
        let id = event["id"].as_str().unwrap_or_default();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let attachments_json = match &event["attachments"] {
            JsonValue::Null | JsonValue::Array(_) if event["attachments"].is_array() =>
                Some(event["attachments"].to_string()),
            _ => None,
        };
        let reminders_json = match &event["reminders"] {
            JsonValue::Array(_) => Some(event["reminders"].to_string()),
            _ => None,
        };
        self.conn.execute(
            "INSERT INTO calendar_events
               (id, vault_id, account_id, calendar_id, external_id, title, description,
                location, start_ts, end_ts, all_day, rrule, status, organizer_email,
                attendees_json, html_link, created_at, updated_at, notes, source_message_id,
                conference_url, color_id, ical_uid, recurring_event_id, creator_email,
                visibility, transparency, reminders_json, attachments_json)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,
                     ?21,?22,?23,?24,?25,?26,?27,?28,?29)
             ON CONFLICT(id) DO UPDATE SET
               title=excluded.title, description=excluded.description, location=excluded.location,
               start_ts=excluded.start_ts, end_ts=excluded.end_ts, all_day=excluded.all_day,
               rrule=excluded.rrule, status=excluded.status, organizer_email=excluded.organizer_email,
               attendees_json=excluded.attendees_json, html_link=excluded.html_link,
               source_message_id=COALESCE(excluded.source_message_id, calendar_events.source_message_id),
               conference_url=excluded.conference_url, color_id=excluded.color_id,
               ical_uid=excluded.ical_uid, recurring_event_id=excluded.recurring_event_id,
               creator_email=excluded.creator_email, visibility=excluded.visibility,
               transparency=excluded.transparency, reminders_json=excluded.reminders_json,
               attachments_json=excluded.attachments_json,
               updated_at=excluded.updated_at",
            params![
                id,
                vault_id,
                event["accountId"].as_str().unwrap_or(""),
                event["calendarId"].as_str().unwrap_or("primary"),
                event["externalId"].as_str(),
                event["title"].as_str().unwrap_or(""),
                event["description"].as_str(),
                event["location"].as_str(),
                event["startTs"].as_i64().unwrap_or(0),
                event["endTs"].as_i64().unwrap_or(0),
                event["allDay"].as_bool().unwrap_or(false),
                event["rrule"].as_str(),
                event["status"].as_str().unwrap_or("confirmed"),
                event["organizerEmail"].as_str(),
                event["attendees"].to_string(),
                event["htmlLink"].as_str(),
                event["createdAt"].as_i64().unwrap_or(now),
                event["updatedAt"].as_i64().unwrap_or(now),
                event["notes"].as_str(),
                event["sourceMessageId"].as_str(),
                event["conferenceUrl"].as_str(),
                event["colorId"].as_str(),
                event["iCalUID"].as_str(),
                event["recurringEventId"].as_str(),
                event["creatorEmail"].as_str(),
                event["visibility"].as_str(),
                event["transparency"].as_str(),
                reminders_json,
                attachments_json,
            ],
        )?;
        Ok(())
    }

    pub fn update_calendar_event_notes(&self, id: &str, notes: Option<&str>) -> Result<()> {
        self.conn.execute(
            "UPDATE calendar_events SET notes = ?1 WHERE id = ?2",
            params![notes, id],
        )?;
        Ok(())
    }

    pub fn search_calendar_fts5(&self, query: &str, vault_id: &str, limit: usize) -> Result<Vec<String>> {
        // Sanitize for FTS5: wrap in quotes to treat as phrase, escape internal quotes
        let safe_query = format!("\"{}\"", query.replace('"', "\"\""));
        let mut stmt = self.conn.prepare(
            "SELECT cf.event_id FROM calendar_events_fts cf
              JOIN calendar_events e ON e.id = cf.event_id
              WHERE e.vault_id = ?1 AND calendar_events_fts MATCH ?2
              ORDER BY rank
              LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![vault_id, safe_query, limit as i64], |r| {
            r.get::<_, String>(0)
        })?;
        let mut results = Vec::new();
        for row in rows {
            match row {
                Ok(id) => results.push(id),
                Err(_) => break,
            }
        }
        // Fallback to LIKE if FTS5 matched nothing (handles short/special queries)
        if results.is_empty() {
            let like = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
            let mut stmt2 = self.conn.prepare(
                "SELECT id FROM calendar_events WHERE vault_id = ?1
                  AND (title LIKE ?2 ESCAPE '\\' OR description LIKE ?2 ESCAPE '\\' OR location LIKE ?2 ESCAPE '\\')
                  LIMIT ?3",
            )?;
            let rows2 = stmt2.query_map(params![vault_id, like, limit as i64], |r| {
                r.get::<_, String>(0)
            })?;
            for row in rows2 {
                if let Ok(id) = row { results.push(id); }
            }
        }
        Ok(results)
    }

    pub fn delete_calendar_event(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM calendar_events WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_calendar_sync(&self, account_id: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT sync_token FROM calendar_sync WHERE account_id = ?1",
        )?;
        stmt.query_row(params![account_id], |r| r.get(0)).optional()
    }

    pub fn upsert_calendar_sync(&self, account_id: &str, sync_token: Option<&str>, last_synced_at: i64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO calendar_sync(account_id, sync_token, last_synced_at)
             VALUES(?1,?2,?3)
             ON CONFLICT(account_id) DO UPDATE SET
               sync_token=excluded.sync_token, last_synced_at=excluded.last_synced_at",
            params![account_id, sync_token, last_synced_at],
        )?;
        Ok(())
    }
}

// Allow rusqlite's optional() on queries returning no rows
trait OptionalExt<T> {
    fn optional(self) -> Result<Option<T>, rusqlite::Error>;
}
impl<T> OptionalExt<T> for std::result::Result<T, rusqlite::Error> {
    fn optional(self) -> std::result::Result<Option<T>, rusqlite::Error> {
        match self {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }
}
