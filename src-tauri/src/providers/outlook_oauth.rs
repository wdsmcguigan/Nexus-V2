use anyhow::{anyhow, Result};

pub struct OutlookOAuth {
    client_id: String,
    client_secret: String,
}

impl OutlookOAuth {
    pub fn new(client_id: String, client_secret: String) -> Self {
        Self {
            client_id,
            client_secret,
        }
    }

    pub async fn start_flow(
        &self,
    ) -> Result<(String, tokio::sync::oneshot::Receiver<Result<String>>)> {
        use tokio::sync::oneshot;

        let (tx, rx) = oneshot::channel();
        let port = find_free_port().await?;
        let redirect_uri = format!("http://localhost:{port}");

        let scope = "offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send";
        let state = uuid::Uuid::new_v4().to_string();

        let auth_url = format!(
            "https://login.microsoftonline.com/common/oauth2/v2.0/authorize\
            ?client_id={}\
            &response_type=code\
            &redirect_uri={}\
            &scope={}\
            &state={}",
            url_encode(&self.client_id),
            url_encode(&redirect_uri),
            url_encode(scope),
            state,
        );

        let port_clone = port;
        tokio::spawn(async move {
            match receive_oauth_code(port_clone).await {
                Ok(code) => {
                    let _ = tx.send(Ok(code));
                }
                Err(e) => {
                    let _ = tx.send(Err(e));
                }
            }
        });

        Ok((auth_url, rx))
    }

    pub async fn exchange_code(
        &self,
        code: &str,
        redirect_uri: &str,
    ) -> Result<OutlookTokenResp> {
        let client = reqwest::Client::new();
        let params = [
            ("client_id", self.client_id.as_str()),
            ("client_secret", self.client_secret.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
        ];

        let resp = client
            .post("https://login.microsoftonline.com/common/oauth2/v2.0/token")
            .form(&params)
            .send()
            .await?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Token exchange failed: {body}");
        }

        resp.json::<OutlookTokenResp>().await.map_err(Into::into)
    }
}

#[derive(serde::Deserialize)]
pub struct OutlookTokenResp {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: i64,
}

async fn find_free_port() -> Result<u16> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    Ok(listener.local_addr()?.port())
}

async fn receive_oauth_code(port: u16) -> Result<String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind(format!("127.0.0.1:{port}")).await?;
    let (mut stream, _) = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        listener.accept(),
    )
    .await??;

    let mut buf = vec![0u8; 4096];
    let n = stream.read(&mut buf).await?;
    let request = String::from_utf8_lossy(&buf[..n]);

    let code = request
        .lines()
        .next()
        .and_then(|line| {
            let path = line.split_whitespace().nth(1)?;
            let query = path.split('?').nth(1)?;
            query
                .split('&')
                .find(|p| p.starts_with("code="))
                .map(|p| p[5..].to_string())
        })
        .ok_or_else(|| anyhow!("No code in OAuth callback"))?;

    let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
        <html><body><h1>Authentication successful! You can close this window.</h1></body></html>";
    stream.write_all(response.as_bytes()).await?;

    Ok(code)
}

fn url_encode(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            other => {
                let mut buf = [0u8; 4];
                let encoded = other.encode_utf8(&mut buf);
                encoded
                    .bytes()
                    .map(|b| format!("%{b:02X}"))
                    .collect::<String>()
            }
        })
        .collect()
}
