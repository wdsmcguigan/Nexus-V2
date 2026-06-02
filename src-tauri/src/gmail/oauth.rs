use anyhow::{anyhow, Context, Result};
use std::collections::HashMap;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use url::Url;

const REDIRECT_PORT: u16 = 9004;
const REDIRECT_URI: &str = "http://localhost:9004/callback";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const SCOPES: &str = "https://www.googleapis.com/auth/gmail.modify \
                       https://www.googleapis.com/auth/userinfo.email \
                       https://www.googleapis.com/auth/userinfo.profile \
                       https://www.googleapis.com/auth/contacts.readonly \
                       https://www.googleapis.com/auth/contacts.other.readonly \
                       https://www.googleapis.com/auth/calendar";

pub struct GmailOAuth {
    client_id: String,
    client_secret: String,
}

#[derive(Debug)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: i64,
    pub email: String,
    pub photo_url: Option<String>,
}

impl GmailOAuth {
    pub fn new(client_id: String, client_secret: String) -> Self {
        Self { client_id, client_secret }
    }

    /// Generate the authorization URL and start a localhost redirect listener.
    /// Returns (auth_url, code_receiver).
    pub async fn start_flow(&self) -> Result<(String, tokio::sync::oneshot::Receiver<Result<String>>)> {
        let state = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<String>>();

        // Start redirect listener before opening the browser
        let listener = TcpListener::bind(format!("127.0.0.1:{REDIRECT_PORT}"))
            .await
            .with_context(|| format!("binding localhost:{REDIRECT_PORT}"))?;

        let state_clone = state.clone();
        tokio::spawn(async move {
            let result = listen_for_code(listener, &state_clone).await;
            let _ = tx.send(result);
        });

        let auth_url = format!(
            "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&access_type=offline&prompt=consent",
            urlencoding::encode(&self.client_id),
            urlencoding::encode(REDIRECT_URI),
            urlencoding::encode(SCOPES),
            urlencoding::encode(&state),
        );

        Ok((auth_url, rx))
    }

    /// Exchange the authorization code for tokens and fetch the user's email.
    pub async fn exchange_code(&self, code: &str) -> Result<TokenResponse> {
        let client = reqwest::Client::new();

        let mut params = HashMap::new();
        params.insert("code", code);
        params.insert("client_id", &self.client_id);
        params.insert("client_secret", &self.client_secret);
        params.insert("redirect_uri", REDIRECT_URI);
        params.insert("grant_type", "authorization_code");

        let resp = client
            .post(TOKEN_URL)
            .form(&params)
            .send()
            .await
            .context("sending token exchange request")?;

        let json: serde_json::Value = resp.json().await.context("parsing token response")?;
        let access_token = json["access_token"]
            .as_str()
            .ok_or_else(|| anyhow!("missing access_token in response: {json}"))?
            .to_string();
        let refresh_token = json["refresh_token"].as_str().map(str::to_string);
        let expires_in = json["expires_in"].as_i64().unwrap_or(3600);

        let (email, photo_url) = fetch_userinfo(&client, &access_token).await?;

        Ok(TokenResponse {
            access_token,
            refresh_token,
            expires_in,
            email,
            photo_url,
        })
    }

    /// Use the refresh token to get a new access token.
    pub async fn refresh_access_token(&self, refresh_token: &str) -> Result<(String, i64)> {
        let client = reqwest::Client::new();
        let mut params = HashMap::new();
        params.insert("refresh_token", refresh_token);
        params.insert("client_id", &self.client_id);
        params.insert("client_secret", &self.client_secret);
        params.insert("grant_type", "refresh_token");

        let resp = client
            .post(TOKEN_URL)
            .form(&params)
            .send()
            .await
            .context("refreshing access token")?;

        let json: serde_json::Value = resp.json().await.context("parsing refresh response")?;
        let access_token = json["access_token"]
            .as_str()
            .ok_or_else(|| anyhow!("missing access_token: {json}"))?
            .to_string();
        let expires_in = json["expires_in"].as_i64().unwrap_or(3600);
        Ok((access_token, expires_in))
    }
}

async fn listen_for_code(listener: TcpListener, expected_state: &str) -> Result<String> {
    let (socket, _) = listener.accept().await.context("accepting OAuth callback")?;
    let (reader, mut writer) = socket.into_split();
    let mut lines = BufReader::new(reader).lines();

    // Read the HTTP request line
    let request_line = lines
        .next_line()
        .await
        .context("reading HTTP request")?
        .ok_or_else(|| anyhow!("empty request"))?;

    // Write a minimal HTML response
    let html = "<html><body><h2>Nexus — Authorization complete.</h2><p>You can close this tab.</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{html}",
        html.len()
    );
    writer.write_all(response.as_bytes()).await.ok();

    // Parse the code from the GET path, e.g. "GET /callback?code=xxx&state=yyy HTTP/1.1"
    let path = request_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| anyhow!("malformed request line"))?;
    let url = Url::parse(&format!("http://localhost{path}")).context("parsing callback URL")?;
    let params: HashMap<_, _> = url.query_pairs().collect();

    let state = params.get("state").map(|s| s.as_ref()).unwrap_or_default();
    if state != expected_state {
        return Err(anyhow!("OAuth state mismatch — possible CSRF"));
    }

    params
        .get("code")
        .map(|c| c.to_string())
        .ok_or_else(|| {
            let err = params.get("error").map(|e| e.as_ref()).unwrap_or("unknown");
            anyhow!("OAuth error: {err}")
        })
}

pub async fn fetch_userinfo(client: &reqwest::Client, access_token: &str) -> Result<(String, Option<String>)> {
    let resp: serde_json::Value = client
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .context("fetching userinfo")?
        .json()
        .await
        .context("parsing userinfo")?;
    let email = resp["email"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| anyhow!("no email in userinfo response: {resp}"))?;
    let photo_url = resp["picture"].as_str().map(str::to_string);
    Ok((email, photo_url))
}

// Tiny URL-encoding helper (avoids pulling percent_encoding separately since url crate is already here)
mod urlencoding {
    pub fn encode(s: &str) -> String {
        s.chars()
            .flat_map(|c| match c {
                'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => {
                    vec![c].into_iter().collect::<String>().into_bytes()
                }
                ' ' => vec![b'+'],
                c => {
                    let mut buf = [0u8; 4];
                    let encoded = c.encode_utf8(&mut buf);
                    encoded.bytes().flat_map(|b| format!("%{b:02X}").into_bytes()).collect()
                }
            })
            .map(|b| b as char)
            .collect()
    }
}
