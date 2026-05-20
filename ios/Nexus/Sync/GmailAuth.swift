import Foundation
import AuthenticationServices

struct OAuthTokens {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let email: String
    let accountId: String
}

/// Handles Gmail OAuth using ASWebAuthenticationSession.
/// Redirect URI is `nexus://oauth` (registered as URL scheme in Info.plist).
@MainActor
final class GmailAuth: NSObject, ASWebAuthenticationPresentationContextProviding {

    private let clientId: String
    private let clientSecret: String
    private static let redirectUri = "nexus://oauth"
    private static let scopes = [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/userinfo.email"
    ].joined(separator: " ")

    init(clientId: String, clientSecret: String) {
        self.clientId = clientId
        self.clientSecret = clientSecret
    }

    func authenticate() async throws -> OAuthTokens {
        let state = UUID().uuidString
        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: Self.redirectUri),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: Self.scopes),
            URLQueryItem(name: "access_type", value: "offline"),
            URLQueryItem(name: "prompt", value: "consent"),
            URLQueryItem(name: "state", value: state)
        ]
        guard let authURL = components.url else {
            throw GmailAuthError.invalidURL
        }

        let callbackURL: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: "nexus"
            ) { callbackURL, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: GmailAuthError.noCallback)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            session.start()
        }

        // Parse authorization code from nexus://oauth?code=...&state=...
        guard let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
              let code = components.queryItems?.first(where: { $0.name == "code" })?.value,
              let returnedState = components.queryItems?.first(where: { $0.name == "state" })?.value,
              returnedState == state
        else {
            throw GmailAuthError.invalidCallback
        }

        return try await exchangeCode(code)
    }

    private func exchangeCode(_ code: String) async throws -> OAuthTokens {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.addValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "code": code,
            "client_id": clientId,
            "client_secret": clientSecret,
            "redirect_uri": Self.redirectUri,
            "grant_type": "authorization_code"
        ].map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }
            .joined(separator: "&")
        request.httpBody = body.data(using: .utf8)

        let (data, _) = try await URLSession.shared.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let accessToken = json?["access_token"] as? String,
              let refreshToken = json?["refresh_token"] as? String,
              let expiresIn = json?["expires_in"] as? Int
        else {
            throw GmailAuthError.tokenExchangeFailed
        }

        let expiresAt = Date().addingTimeInterval(TimeInterval(expiresIn))
        let email = try await fetchUserEmail(accessToken: accessToken)
        let accountId = "gmail-\(UUID().uuidString.prefix(8))"

        return OAuthTokens(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: expiresAt,
            email: email,
            accountId: accountId
        )
    }

    func refreshAccessToken(refreshToken: String) async throws -> (accessToken: String, expiresAt: Date) {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.addValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "refresh_token": refreshToken,
            "client_id": clientId,
            "client_secret": clientSecret,
            "grant_type": "refresh_token"
        ].map { "\($0.key)=\($0.value)" }.joined(separator: "&")
        request.httpBody = body.data(using: .utf8)

        let (data, _) = try await URLSession.shared.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let accessToken = json?["access_token"] as? String,
              let expiresIn = json?["expires_in"] as? Int
        else {
            throw GmailAuthError.tokenRefreshFailed
        }
        return (accessToken, Date().addingTimeInterval(TimeInterval(expiresIn)))
    }

    private func fetchUserEmail(accessToken: String) async throws -> String {
        var request = URLRequest(url: URL(string: "https://www.googleapis.com/oauth2/v2/userinfo")!)
        request.addValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let email = json?["email"] as? String else {
            throw GmailAuthError.noEmail
        }
        return email
    }

    // MARK: - ASWebAuthenticationPresentationContextProviding

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        DispatchQueue.main.sync {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
                .first { $0.isKeyWindow } ?? ASPresentationAnchor()
        }
    }
}

// MARK: - Error

enum GmailAuthError: Error, LocalizedError {
    case invalidURL
    case noCallback
    case invalidCallback
    case tokenExchangeFailed
    case tokenRefreshFailed
    case noEmail

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid OAuth URL"
        case .noCallback: return "OAuth callback not received"
        case .invalidCallback: return "Invalid OAuth callback"
        case .tokenExchangeFailed: return "Failed to exchange authorization code for tokens"
        case .tokenRefreshFailed: return "Failed to refresh access token"
        case .noEmail: return "Could not retrieve account email"
        }
    }
}
