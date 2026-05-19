import SwiftUI

struct InboxView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        List {
            ForEach(appState.messages, id: \.id) { message in
                NavigationLink(destination: MessageDetailView(message: message)) {
                    MessageRowView(message: message)
                }
                .listRowBackground(message.flagsRead ? Color.clear : Color.accentColor.opacity(0.05))
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button {
                        appState.apply(kind: .ARCHIVE, payload: ["messageId": message.id])
                    } label: {
                        Label("Archive", systemImage: "archivebox")
                    }
                    .tint(.orange)
                }
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    if message.flagsRead {
                        Button {
                            appState.apply(kind: .MARK_UNREAD, payload: ["messageId": message.id])
                        } label: {
                            Label("Unread", systemImage: "envelope.badge")
                        }
                        .tint(.blue)
                    } else {
                        Button {
                            appState.apply(kind: .MARK_READ, payload: ["messageId": message.id])
                        } label: {
                            Label("Read", systemImage: "envelope.open")
                        }
                        .tint(.blue)
                    }
                }
                .contextMenu {
                    contextMenuItems(for: message)
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle(navigationTitle)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    appState.showCompose = true
                } label: {
                    Image(systemName: "square.and.pencil")
                }
            }
            ToolbarItem(placement: .navigationBarLeading) {
                if appState.syncEngine?.isSyncing == true {
                    ProgressView().scaleEffect(0.8)
                }
            }
        }
        .refreshable {
            await appState.syncEngine?.syncAll()
            try? appState.loadData()
        }
        .overlay {
            if appState.messages.isEmpty {
                emptyState
            }
        }
    }

    // MARK: - Subviews

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "envelope.open")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("No messages")
                .font(.headline)
            Text("Pull to refresh or connect an account in Settings.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }

    @ViewBuilder
    private func contextMenuItems(for message: NexusMessage) -> some View {
        if message.flagsRead {
            Button {
                appState.apply(kind: .MARK_UNREAD, payload: ["messageId": message.id])
            } label: {
                Label("Mark Unread", systemImage: "envelope.badge")
            }
        } else {
            Button {
                appState.apply(kind: .MARK_READ, payload: ["messageId": message.id])
            } label: {
                Label("Mark Read", systemImage: "envelope.open")
            }
        }

        Button {
            let isStar = message.star == nil
            appState.apply(
                kind: isStar ? .STAR : .UNSTAR,
                payload: ["messageId": message.id]
            )
        } label: {
            Label(
                message.star == nil ? "Star" : "Unstar",
                systemImage: message.star == nil ? "star" : "star.slash"
            )
        }

        Button(role: .destructive) {
            appState.apply(kind: .TRASH, payload: ["messageId": message.id])
        } label: {
            Label("Trash", systemImage: "trash")
        }
    }

    private var navigationTitle: String {
        if let folderId = appState.selectedFolderId,
           let folder = appState.folders.first(where: { $0.id == folderId }) {
            return folder.name
        }
        return "Inbox"
    }
}

// MARK: - Message Row

struct MessageRowView: View {
    let message: NexusMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(senderName)
                    .font(.subheadline.weight(message.flagsRead ? .regular : .semibold))
                    .lineLimit(1)
                Spacer()
                Text(formattedDate)
                    .font(.caption)
                    .foregroundColor(.secondary)
                if message.star != nil {
                    Image(systemName: "star.fill")
                        .font(.caption2)
                        .foregroundColor(.yellow)
                }
            }

            Text(message.subject.isEmpty ? "(no subject)" : message.subject)
                .font(.subheadline)
                .lineLimit(1)
                .foregroundColor(message.flagsRead ? .secondary : .primary)

            if !message.snippet.isEmpty {
                Text(message.snippet)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
    }

    private var senderName: String {
        message.fromAddr?.name.isEmpty == false
            ? message.fromAddr!.name
            : message.fromAddr?.email ?? "Unknown"
    }

    private var formattedDate: String {
        let date = Date(timeIntervalSince1970: TimeInterval(message.receivedAt) / 1000)
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            let fmt = DateFormatter()
            fmt.timeStyle = .short
            return fmt.string(from: date)
        } else if calendar.isDateInYesterday(date) {
            return "Yesterday"
        } else {
            let fmt = DateFormatter()
            fmt.dateStyle = .short
            return fmt.string(from: date)
        }
    }
}
