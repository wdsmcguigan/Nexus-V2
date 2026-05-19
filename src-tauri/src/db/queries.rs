use anyhow::{Context, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

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
    pub saved_views: Vec<JsonValue>,
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
            saved_views: self.load_saved_views(vault_id)?,
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
            "SELECT id, provider, email, display_name FROM accounts WHERE vault_id = ?1",
        )?;
        let rows = stmt.query_map(params![vault_id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "vaultId": vault_id,
                "provider": r.get::<_, String>(1)?,
                "email": r.get::<_, String>(2)?,
                "displayName": r.get::<_, Option<String>>(3)?
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
        let mut stmt = self.conn.prepare(
            "SELECT id, folder_id, thread_id, subject, snippet, body_ref, received_at,
                    status_id, priority, star, pinned, muted, notes, flag_json,
                    from_addr_json, to_addrs_json, cc_addrs_json, bcc_addrs_json,
                    attachment_refs_json, custom_fields_json,
                    flags_read, flags_answered, flags_draft, flags_flagged
             FROM messages WHERE vault_id = ?1
             ORDER BY received_at DESC",
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
                "labelIds": [],
                "tags": []
            });
            Ok((id, msg))
        })?.map(|r| r.context("loading message row"))
          .collect::<Result<Vec<_>>>()?;

        // Bulk-load label and tag associations
        let mut result = Vec::with_capacity(msg_rows.len());
        for (id, mut msg) in msg_rows {
            msg["labelIds"] = self.load_message_labels(&id)?;
            msg["tags"] = self.load_message_tags(&id)?;
            result.push(msg);
        }
        Ok(result)
    }

    fn load_message_labels(&self, message_id: &str) -> Result<JsonValue> {
        let mut stmt = self.conn.prepare(
            "SELECT label_id FROM message_labels WHERE message_id = ?1",
        )?;
        let ids: Vec<JsonValue> = stmt.query_map(params![message_id], |r| {
            r.get::<_, String>(0).map(JsonValue::String)
        })?.map(|r| r.context("loading label id")).collect::<Result<_>>()?;
        Ok(JsonValue::Array(ids))
    }

    fn load_message_tags(&self, message_id: &str) -> Result<JsonValue> {
        let mut stmt = self.conn.prepare(
            "SELECT tag FROM message_tags WHERE message_id = ?1",
        )?;
        let tags: Vec<JsonValue> = stmt.query_map(params![message_id], |r| {
            r.get::<_, String>(0).map(JsonValue::String)
        })?.map(|r| r.context("loading tag")).collect::<Result<_>>()?;
        Ok(JsonValue::Array(tags))
    }

    pub fn load_contacts(&self, vault_id: &str) -> Result<Vec<JsonValue>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, company, title, website, location, notes, tags_json, created_at, updated_at
             FROM contacts WHERE vault_id = ?1 ORDER BY name"
        )?;
        let contacts: Vec<(String, String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, String, i64, i64)> =
            stmt.query_map(params![vault_id], |r| Ok((
                r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?,
                r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?,
                r.get(8)?, r.get(9)?
            )))?.filter_map(|r| r.ok()).collect();

        let mut result = Vec::new();
        for (id, name, company, title, website, location, notes, tags_json, created_at, updated_at) in contacts {
            let emails = self.load_contact_emails(&id)?;
            let phones = self.load_contact_phones(&id)?;
            let tags: serde_json::Value = serde_json::from_str(&tags_json).unwrap_or(serde_json::json!([]));
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
        let created_at = contact["createdAt"].as_i64().unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        let updated_at = contact["updatedAt"].as_i64().unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

        self.conn.execute(
            "INSERT INTO contacts (id, vault_id, name, company, title, website, location, notes, tags_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
               name=excluded.name, company=excluded.company, title=excluded.title,
               website=excluded.website, location=excluded.location, notes=excluded.notes,
               tags_json=excluded.tags_json, updated_at=excluded.updated_at",
            params![id, vault_id, name, company, title, website, location, notes, tags, created_at, updated_at],
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
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO accounts (id, vault_id, provider, email, display_name, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               provider = excluded.provider,
               email = excluded.email,
               display_name = excluded.display_name",
            params![id, vault_id, provider, email, display_name,
                    chrono::Utc::now().timestamp_millis()],
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
            return Ok(false);
        }

        self.conn.execute(
            "INSERT OR IGNORE INTO messages (
                id, vault_id, folder_id, thread_id, subject, snippet, body_ref, received_at,
                from_addr_json, to_addrs_json, cc_addrs_json, bcc_addrs_json,
                attachment_refs_json, custom_fields_json,
                flags_read, flags_answered, flags_draft, flags_flagged,
                provider_id, provider_account_id, eml_path
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                ?9, ?10, ?11, ?12, ?13, '{}',
                ?14, 0, 0, 0,
                ?15, ?16, ?17
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
                msg.eml_path
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
