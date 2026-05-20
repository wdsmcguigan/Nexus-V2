import SwiftUI
import WebKit

struct MessageDetailView: View {
    let message: NexusMessage
    @EnvironmentObject var appState: AppState
    @State private var bodyHtml: String? = nil
    @State private var isLoading = true
    @State private var showReply = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Header
                VStack(alignment: .leading, spacing: 8) {
                    Text(message.subject.isEmpty ? "(no subject)" : message.subject)
                        .font(.title3.bold())

                    HStack {
                        Circle()
                            .fill(Color.accentColor.opacity(0.2))
                            .frame(width: 36, height: 36)
                            .overlay(
                                Text(avatarInitial)
                                    .font(.subheadline.bold())
                                    .foregroundColor(.accentColor)
                            )

                        VStack(alignment: .leading, spacing: 2) {
                            Text(senderName)
                                .font(.subheadline.weight(.semibold))
                            Text(recipientSummary)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }

                        Spacer()

                        VStack(alignment: .trailing, spacing: 2) {
                            Text(formattedDate)
                                .font(.caption)
                                .foregroundColor(.secondary)
                            if message.star != nil {
                                Image(systemName: "star.fill")
                                    .font(.caption)
                                    .foregroundColor(.yellow)
                            }
                        }
                    }

                    // Unsubscribe button
                    if message.listUnsubscribeJson != nil {
                        Button(action: handleUnsubscribe) {
                            Label("Unsubscribe", systemImage: "minus.circle")
                                .font(.caption)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
                .padding(.horizontal)

                Divider()

                // Body
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else if let html = bodyHtml {
                    WebViewRepresentable(html: html)
                        .frame(minHeight: 400)
                        .padding(.horizontal, 8)
                } else {
                    Text("(no body)")
                        .foregroundColor(.secondary)
                        .padding()
                }
            }
            .padding(.vertical)
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                Button {
                    appState.apply(
                        kind: message.star == nil ? .STAR : .UNSTAR,
                        payload: ["messageId": message.id]
                    )
                } label: {
                    Image(systemName: message.star == nil ? "star" : "star.fill")
                }

                Button {
                    appState.apply(kind: .ARCHIVE, payload: ["messageId": message.id])
                } label: {
                    Image(systemName: "archivebox")
                }

                Button {
                    showReply = true
                } label: {
                    Image(systemName: "arrowshape.turn.up.left")
                }
            }
        }
        .sheet(isPresented: $showReply) {
            ComposeView(replyTo: message)
                .environmentObject(appState)
        }
        .onAppear {
            markReadIfNeeded()
            loadBody()
        }
    }

    // MARK: - Actions

    private func markReadIfNeeded() {
        if !message.flagsRead {
            appState.apply(kind: .MARK_READ, payload: ["messageId": message.id])
        }
    }

    private func loadBody() {
        guard let db = appState.db else { return }
        Task {
            let html = try? db.fetchBody(bodyRef: message.bodyRef)
            await MainActor.run {
                bodyHtml = html
                isLoading = false
            }
        }
    }

    private func handleUnsubscribe() {
        // Parse list_unsubscribe_json and open URL or send POST
        guard let json = message.listUnsubscribeJson,
              let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let header = dict["header"] else { return }

        if let urlStr = header.components(separatedBy: "<").dropFirst().first?.replacingOccurrences(of: ">", with: ""),
           let url = URL(string: urlStr.trimmingCharacters(in: .whitespaces)) {
            UIApplication.shared.open(url)
        }
    }

    // MARK: - Computed

    private var senderName: String {
        message.fromAddr?.name.isEmpty == false
            ? message.fromAddr!.name
            : message.fromAddr?.email ?? "Unknown"
    }

    private var avatarInitial: String {
        String(senderName.prefix(1).uppercased())
    }

    private var recipientSummary: String {
        let to = message.toAddrs.map { $0.name.isEmpty ? $0.email : $0.name }.joined(separator: ", ")
        return "To: \(to.isEmpty ? "me" : to)"
    }

    private var formattedDate: String {
        let date = Date(timeIntervalSince1970: TimeInterval(message.receivedAt) / 1000)
        let fmt = DateFormatter()
        fmt.dateStyle = .medium
        fmt.timeStyle = .short
        return fmt.string(from: date)
    }
}

// MARK: - WKWebView wrapper

struct WebViewRepresentable: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.dataDetectorTypes = [.link, .phoneNumber]
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Inject basic responsive styling
        let wrapped = """
            <!DOCTYPE html>
            <html>
            <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
            <style>
                body { font-family: -apple-system, sans-serif; font-size: 15px;
                       color: \(isDarkMode ? "#e5e5e5" : "#1c1c1e"); margin: 0; padding: 0; }
                img { max-width: 100%; height: auto; }
                a { color: #007AFF; }
                pre, code { overflow-x: auto; }
            </style>
            </head>
            <body>\(html)</body>
            </html>
            """
        webView.loadHTMLString(wrapped, baseURL: nil)
    }

    private var isDarkMode: Bool {
        UITraitCollection.current.userInterfaceStyle == .dark
    }
}
