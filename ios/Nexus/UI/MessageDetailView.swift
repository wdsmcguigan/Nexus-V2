import SwiftUI
import WebKit

struct MessageDetailView: View {
    let message: NexusMessage
    @EnvironmentObject var appState: AppState
    @State private var bodyHtml: String? = nil
    @State private var isLoading = true
    @State private var showLabelPicker = false
    @State private var showStatusPicker = false
    @State private var showPriorityPicker = false
    @State private var showNotesEditor = false
    @State private var notesText = ""
    @State private var messageLabels: [NexusLabel] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerSection
                metadataBar
                Divider()
                bodySection
            }
            .padding(.vertical)
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .sheet(isPresented: $showLabelPicker) {
            LabelPickerSheet(message: message, currentLabels: $messageLabels)
                .environmentObject(appState)
        }
        .sheet(isPresented: $showStatusPicker) {
            StatusPickerSheet(message: message)
                .environmentObject(appState)
        }
        .sheet(isPresented: $showPriorityPicker) {
            PriorityPickerSheet(message: message)
                .environmentObject(appState)
        }
        .sheet(isPresented: $showNotesEditor) {
            NotesEditorSheet(
                initialText: message.notes ?? "",
                onSave: { text in
                    if text.isEmpty {
                        appState.apply(kind: .CLEAR_NOTES, payload: ["messageId": message.id])
                    } else {
                        appState.apply(kind: .SET_NOTES, payload: ["messageId": message.id, "notes": text])
                    }
                }
            )
        }
        .onAppear {
            markReadIfNeeded()
            loadBody()
            loadLabels()
            notesText = message.notes ?? ""
        }
    }

    // MARK: - Header section

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message.subject.isEmpty ? "(no subject)" : message.subject)
                .font(.title3.bold())
                .padding(.horizontal)

            HStack(alignment: .top) {
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
            .padding(.horizontal)

            if message.listUnsubscribeJson != nil {
                Button(action: handleUnsubscribe) {
                    Label("Unsubscribe", systemImage: "minus.circle")
                        .font(.caption)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .padding(.horizontal)
            }
        }
    }

    // MARK: - Metadata bar (labels, status, priority, notes)

    @ViewBuilder
    private var metadataBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Labels
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(messageLabels, id: \.id) { label in
                        LabelChip(label: label)
                            .onTapGesture { showLabelPicker = true }
                    }
                    Button {
                        showLabelPicker = true
                    } label: {
                        Label("Label", systemImage: "tag")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                }
            }
            .padding(.horizontal)

            // Status + Priority + Notes row
            HStack(spacing: 8) {
                // Status
                statusButton
                // Priority
                priorityButton
                // Notes
                notesButton

                Spacer()

                // Pin
                Button {
                    appState.apply(
                        kind: message.pinned ? .UNPIN : .PIN,
                        payload: ["messageId": message.id]
                    )
                } label: {
                    Image(systemName: message.pinned ? "pin.fill" : "pin")
                        .font(.caption)
                        .foregroundColor(message.pinned ? .orange : .secondary)
                }
                .buttonStyle(.bordered)
                .controlSize(.mini)
            }
            .padding(.horizontal)

            if let notes = message.notes, !notes.isEmpty {
                HStack {
                    Image(systemName: "note.text")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(notes)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
                .padding(.horizontal)
            }
        }
    }

    @ViewBuilder
    private var statusButton: some View {
        let currentStatus = appState.statuses.first(where: { $0.id == message.statusId })
        Button {
            showStatusPicker = true
        } label: {
            HStack(spacing: 4) {
                Circle()
                    .fill(currentStatus.map { NexusColorPalette.color($0.color) } ?? Color.secondary)
                    .frame(width: 6, height: 6)
                Text(currentStatus?.name ?? "Status")
                    .font(.caption)
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.mini)
    }

    @ViewBuilder
    private var priorityButton: some View {
        let priority = message.priority
        Button {
            showPriorityPicker = true
        } label: {
            HStack(spacing: 3) {
                Image(systemName: priority != nil ? "exclamationmark" : "flag")
                    .font(.caption2)
                Text(priorityLabel(priority))
                    .font(.caption)
            }
            .foregroundColor(priorityColor(priority))
        }
        .buttonStyle(.bordered)
        .controlSize(.mini)
    }

    @ViewBuilder
    private var notesButton: some View {
        Button {
            showNotesEditor = true
        } label: {
            Label(message.notes == nil ? "Notes" : "Edit Notes", systemImage: "note.text")
                .font(.caption)
        }
        .buttonStyle(.bordered)
        .controlSize(.mini)
    }

    // MARK: - Body section

    @ViewBuilder
    private var bodySection: some View {
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

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItemGroup(placement: .navigationBarTrailing) {
            Button {
                appState.apply(
                    kind: message.star == nil ? .STAR : .UNSTAR,
                    payload: ["messageId": message.id]
                )
            } label: {
                Image(systemName: message.star == nil ? "star" : "star.fill")
                    .foregroundColor(message.star == nil ? .primary : .yellow)
            }

            Button {
                appState.apply(kind: .ARCHIVE, payload: ["messageId": message.id])
            } label: {
                Image(systemName: "archivebox")
            }

            Button {
                appState.composeReplyTo = message
                appState.showCompose = true
            } label: {
                Image(systemName: "arrowshape.turn.up.left")
            }
        }
    }

    // MARK: - Actions

    private func markReadIfNeeded() {
        if !message.flagsRead {
            appState.apply(kind: .MARK_READ, payload: ["messageId": message.id])
        }
    }

    private func loadBody() {
        guard let db = appState.db else { isLoading = false; return }
        Task {
            let html = try? db.fetchBody(bodyRef: message.bodyRef)
            await MainActor.run {
                bodyHtml = html
                isLoading = false
            }
        }
    }

    private func loadLabels() {
        guard let db = appState.db else { return }
        messageLabels = (try? db.fetchLabelsForMessage(messageId: message.id, vaultId: appState.vaultId)) ?? []
    }

    private func handleUnsubscribe() {
        guard let json = message.listUnsubscribeJson,
              let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let header = dict["header"] else { return }

        if let urlStr = header.components(separatedBy: "<").dropFirst().first?
            .replacingOccurrences(of: ">", with: ""),
           let url = URL(string: urlStr.trimmingCharacters(in: .whitespaces)) {
            UIApplication.shared.open(url)
        }
    }

    // MARK: - Helpers

    private var senderName: String {
        message.fromAddr?.name.isEmpty == false
            ? message.fromAddr!.name
            : message.fromAddr?.email ?? "Unknown"
    }
    private var avatarInitial: String { String(senderName.prefix(1).uppercased()) }

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

    private func priorityLabel(_ p: Int?) -> String {
        switch p {
        case 2: return "High"
        case 1: return "Medium"
        case 0: return "Low"
        default: return "Priority"
        }
    }

    private func priorityColor(_ p: Int?) -> Color {
        switch p {
        case 2: return .red
        case 1: return .orange
        case 0: return .secondary
        default: return .secondary
        }
    }
}

// MARK: - Label Picker Sheet

struct LabelPickerSheet: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let message: NexusMessage
    @Binding var currentLabels: [NexusLabel]

    var body: some View {
        NavigationView {
            List(appState.labels, id: \.id) { label in
                let isActive = currentLabels.contains(where: { $0.id == label.id })
                Button {
                    if isActive {
                        appState.apply(kind: .REMOVE_LABEL, payload: ["messageId": message.id, "labelId": label.id])
                        currentLabels.removeAll { $0.id == label.id }
                    } else {
                        appState.apply(kind: .ADD_LABEL, payload: ["messageId": message.id, "labelId": label.id])
                        currentLabels.append(label)
                    }
                } label: {
                    HStack {
                        Circle()
                            .fill(NexusColorPalette.color(label.color))
                            .frame(width: 12, height: 12)
                        Text(label.name)
                            .foregroundColor(.primary)
                        Spacer()
                        if isActive {
                            Image(systemName: "checkmark")
                                .foregroundColor(.accentColor)
                        }
                    }
                }
            }
            .navigationTitle("Labels")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .navigationViewStyle(.stack)
    }
}

// MARK: - Status Picker Sheet

struct StatusPickerSheet: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let message: NexusMessage

    var body: some View {
        NavigationView {
            List {
                if message.statusId != nil {
                    Button(role: .destructive) {
                        appState.apply(kind: .CLEAR_STATUS, payload: ["messageId": message.id])
                        dismiss()
                    } label: {
                        Label("Clear Status", systemImage: "xmark.circle")
                    }
                }
                ForEach(appState.statuses, id: \.id) { status in
                    Button {
                        appState.apply(kind: .SET_STATUS, payload: ["messageId": message.id, "statusId": status.id])
                        dismiss()
                    } label: {
                        HStack {
                            Circle()
                                .fill(NexusColorPalette.color(status.color))
                                .frame(width: 12, height: 12)
                            Text(status.name)
                                .foregroundColor(.primary)
                            Spacer()
                            if message.statusId == status.id {
                                Image(systemName: "checkmark").foregroundColor(.accentColor)
                            }
                        }
                    }
                }
                if appState.statuses.isEmpty {
                    Text("No statuses configured. Add them in Settings → Statuses.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .navigationTitle("Set Status")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .navigationViewStyle(.stack)
    }
}

// MARK: - Priority Picker Sheet

struct PriorityPickerSheet: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let message: NexusMessage

    private let options: [(Int?, String, String, Color)] = [
        (nil, "None", "minus", .secondary),
        (0, "Low", "arrow.down", .secondary),
        (1, "Medium", "exclamationmark", .orange),
        (2, "High", "exclamationmark.2", .red)
    ]

    var body: some View {
        NavigationView {
            List(options, id: \.1) { (value, label, icon, color) in
                Button {
                    if let v = value {
                        appState.apply(kind: .SET_PRIORITY, payload: ["messageId": message.id, "priority": v])
                    } else {
                        appState.apply(kind: .CLEAR_PRIORITY, payload: ["messageId": message.id])
                    }
                    dismiss()
                } label: {
                    HStack {
                        Image(systemName: icon).foregroundColor(color).frame(width: 20)
                        Text(label).foregroundColor(.primary)
                        Spacer()
                        if message.priority == value {
                            Image(systemName: "checkmark").foregroundColor(.accentColor)
                        }
                    }
                }
            }
            .navigationTitle("Priority")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .navigationViewStyle(.stack)
    }
}

// MARK: - Notes Editor Sheet

struct NotesEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    let initialText: String
    let onSave: (String) -> Void
    @State private var text = ""

    var body: some View {
        NavigationView {
            TextEditor(text: $text)
                .padding()
                .navigationTitle("Notes")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("Cancel") { dismiss() }
                    }
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("Save") { onSave(text); dismiss() }
                    }
                }
                .onAppear { text = initialText }
        }
        .navigationViewStyle(.stack)
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
