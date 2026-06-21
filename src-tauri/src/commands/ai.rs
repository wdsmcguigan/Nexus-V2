use serde_json::json;

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MODEL: &str = "claude-haiku-4-5-20251001";

/// Summarize arbitrary thread text via the Claude Messages API. Key from env
/// (NEXUS_ANTHROPIC_API_KEY); returns the assistant text or a human-readable error.
#[tauri::command]
pub async fn ai_summarize(text: String) -> Result<String, String> {
    let api_key = std::env::var("NEXUS_ANTHROPIC_API_KEY")
        .map_err(|_| "NEXUS_ANTHROPIC_API_KEY not set".to_string())?;

    let body = json!({
        "model": MODEL,
        "max_tokens": 512,
        "system": "Summarize the following email thread in 3-5 concise sentences. Plain prose, no preamble.",
        "messages": [ { "role": "user", "content": text } ]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(ANTHROPIC_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        return Err(format!("Claude API error {status}: {detail}"));
    }

    let v: serde_json::Value = resp.json().await.map_err(|e| format!("bad response: {e}"))?;
    extract_text(&v).ok_or_else(|| "no text in response".to_string())
}

/// Pull the first text block out of a Claude Messages response.
fn extract_text(v: &serde_json::Value) -> Option<String> {
    v.get("content")?
        .as_array()?
        .iter()
        .find_map(|block| block.get("text").and_then(|t| t.as_str()))
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_text_from_response() {
        let v = json!({ "content": [ { "type": "text", "text": "hello summary" } ] });
        assert_eq!(extract_text(&v).as_deref(), Some("hello summary"));
    }

    #[test]
    fn returns_none_when_no_text() {
        let v = json!({ "content": [] });
        assert!(extract_text(&v).is_none());
    }
}
