use anyhow::Result;
use std::collections::HashMap;

/// Fetch all Google Contacts for the authenticated user via the People API.
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
