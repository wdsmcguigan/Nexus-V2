use anyhow::Result;
use std::collections::HashMap;

/// Fetch all Google Contacts (full field sync) via the People API.
/// Returns a list of contact JSON objects shaped for `VaultDb::upsert_contact`.
/// Uses `sync_token` for delta sync on subsequent calls; pass `None` for a full sync.
/// Returns `(contacts, next_sync_token)`.
pub async fn fetch_google_contacts(
    client: &reqwest::Client,
    access_token: &str,
    vault_id: &str,
    sync_token: Option<&str>,
) -> Result<(Vec<serde_json::Value>, Option<String>)> {
    let mut contacts = Vec::new();
    let mut page_token: Option<String> = None;
    let mut next_sync_token: Option<String> = None;

    let base_fields = "names,emailAddresses,phoneNumbers,photos,birthdays,\
        addresses,organizations,biographies,urls,userDefined,metadata";

    loop {
        let mut url = format!(
            "https://people.googleapis.com/v1/people/me/connections\
            ?personFields={base_fields}&pageSize=1000&requestSyncToken=true"
        );
        if let Some(ref st) = sync_token {
            if page_token.is_none() {
                url.push_str(&format!("&syncToken={}", st));
            }
        }
        if let Some(ref pt) = page_token {
            url.push_str(&format!("&pageToken={pt}"));
        }

        let resp: serde_json::Value = client
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await?
            .json()
            .await?;

        if let Some(connections) = resp["connections"].as_array() {
            for person in connections {
                if let Some(contact) = map_person_to_contact(person, vault_id) {
                    contacts.push(contact);
                }
            }
        }

        if let Some(nst) = resp["nextSyncToken"].as_str() {
            next_sync_token = Some(nst.to_string());
        }

        page_token = resp["nextPageToken"].as_str().map(str::to_string);
        if page_token.is_none() {
            break;
        }
    }

    Ok((contacts, next_sync_token))
}

fn map_person_to_contact(person: &serde_json::Value, vault_id: &str) -> Option<serde_json::Value> {
    let resource_name = person["resourceName"].as_str()?;

    // Skip contacts with no name and no email
    let name = person["names"]
        .as_array()
        .and_then(|n| n.first())
        .and_then(|n| n["displayName"].as_str())
        .unwrap_or_default();

    let emails: Vec<String> = person["emailAddresses"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|e| e["value"].as_str())
                .map(|s| s.to_lowercase())
                .collect()
        })
        .unwrap_or_default();

    if name.is_empty() && emails.is_empty() {
        return None;
    }

    let phones: Vec<String> = person["phoneNumbers"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|p| p["value"].as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    let company = person["organizations"]
        .as_array()
        .and_then(|o| o.first())
        .and_then(|o| o["name"].as_str())
        .map(str::to_string);

    let title = person["organizations"]
        .as_array()
        .and_then(|o| o.first())
        .and_then(|o| o["title"].as_str())
        .map(str::to_string);

    let photo_url = person["photos"]
        .as_array()
        .and_then(|p| p.first())
        .and_then(|p| p["url"].as_str())
        .map(str::to_string);

    let notes = person["biographies"]
        .as_array()
        .and_then(|b| b.first())
        .and_then(|b| b["value"].as_str())
        .map(str::to_string);

    let birthday = person["birthdays"].as_array().and_then(|bdays| {
        bdays.first().and_then(|b| {
            let d = &b["date"];
            let y = d["year"].as_i64().unwrap_or(0);
            let m = d["month"].as_i64().unwrap_or(0);
            let day = d["day"].as_i64().unwrap_or(0);
            if m > 0 && day > 0 {
                Some(if y > 0 {
                    format!("{y:04}-{m:02}-{day:02}")
                } else {
                    format!("--{m:02}-{day:02}")
                })
            } else {
                None
            }
        })
    });

    let social_profiles: Vec<serde_json::Value> = person["urls"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|u| {
                    let url = u["value"].as_str()?;
                    let label = u["type"].as_str().unwrap_or("other");
                    Some(serde_json::json!({ "platform": label, "username": url }))
                })
                .collect()
        })
        .unwrap_or_default();

    let addresses: Vec<serde_json::Value> = person["addresses"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|a| {
                    serde_json::json!({
                        "label": a["type"].as_str().unwrap_or("home"),
                        "street": a["streetAddress"].as_str().unwrap_or(""),
                        "city": a["city"].as_str().unwrap_or(""),
                        "state": a["region"].as_str().unwrap_or(""),
                        "country": a["country"].as_str().unwrap_or(""),
                        "zip": a["postalCode"].as_str().unwrap_or("")
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let now = chrono::Utc::now().timestamp_millis();
    let id = format!("google-{}", resource_name.replace('/', "-"));

    Some(serde_json::json!({
        "id": id,
        "vaultId": vault_id,
        "name": name,
        "emails": emails,
        "phones": phones,
        "company": company,
        "title": title,
        "photoUrl": photo_url,
        "notes": notes,
        "birthday": birthday,
        "socialProfiles": social_profiles,
        "addresses": addresses,
        "source": "google",
        "externalId": resource_name,
        "importance": "normal",
        "tags": [],
        "alwaysShowImages": false,
        "location": null,
        "website": null,
        "createdAt": now,
        "updatedAt": now
    }))
}

/// Fetch contact photos only (kept for backwards compatibility with the photo-only sync path).
/// Returns a map of lowercase email address → photo URL.
pub async fn fetch_contact_photos(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<HashMap<String, String>> {
    let mut map = HashMap::new();
    let mut page_token: Option<String> = None;

    loop {
        let mut url = "https://people.googleapis.com/v1/people/me/connections\
            ?personFields=emailAddresses,photos&pageSize=1000"
            .to_string();
        if let Some(ref pt) = page_token {
            url.push_str(&format!("&pageToken={pt}"));
        }

        let resp: serde_json::Value = client
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await?
            .json()
            .await?;

        if let Some(connections) = resp["connections"].as_array() {
            for person in connections {
                let photo_url = person["photos"]
                    .as_array()
                    .and_then(|p| p.first())
                    .and_then(|p| p["url"].as_str())
                    .map(str::to_string);

                if let Some(url) = photo_url {
                    if let Some(emails) = person["emailAddresses"].as_array() {
                        for email_obj in emails {
                            if let Some(email) = email_obj["value"].as_str() {
                                map.insert(email.to_lowercase(), url.clone());
                            }
                        }
                    }
                }
            }
        }

        page_token = resp["nextPageToken"].as_str().map(str::to_string);
        if page_token.is_none() {
            break;
        }
    }

    Ok(map)
}
