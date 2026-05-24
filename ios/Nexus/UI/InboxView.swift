import SwiftUI

struct InboxView: View {
    @EnvironmentObject var appState: AppState
    @Binding var showFolderSidebar: Bool
    @Binding var showKanban: Bool

    @State private var editMode: EditMode = .inactive
    @State private var selectedMessageIds: Set<String> = []
    @State private var showBulkActions = false

    var body: some View {
        List(selection: $selectedMessageIds) {
            ForEach(appState.messages, id: \.id) { message in
                NavigationLink(destination: MessageDetailView(message: message)) {
                    MessageRowView(message: message)
                }
                .listRowBackground(message.flagsRead ? Color.clear : Color.accentColor.opacity(0.05))
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button {
                        appState.apply(kind: .ARCHIVE, payload: ["messageId": message.id])
                    } label: { Label("Archive", systemImage: "archivebox") }
                    .tint(.orange)

                    Button(role: .destructive) {
                        appState.apply(kind: .TRASH, payload: ["messageId": message.id])
                    } label: { Label("Trash", systemImage: "trash") }
                }
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    Button {
                        appState.apply(
                            kind: message.flagsRead ? .MARK_UNREAD : .MARK_READ,
                            payload: ["messageId": message.id]
                        )
                    } label: {
                        Label(
                            message.flagsRead ? "Unread" : "Read",
                            systemImage: message.flagsRead ? "envelope.badge" : "envelope.open"
                        )
                    }
                    .tint(.blue)

                    Button {
                        appState.apply(
                            kind: message.star == nil ? .STAR : .UNSTAR,
                            payload: ["messageId": message.id]
                        )
                    } label: {
                        Label(message.star == nil ? "Star" : "Unstar",
                              systemImage: message.star == nil ? "star" : "star.slash")
                    }
                    .tint(.yellow)
                }
                .contextMenu { contextMenuItems(for: message) }
            }
        }
        .listStyle(.plain)
        .environment(\.editMode, $editMode)
        .navigationTitle(folderTitle)
        .navigationBarTitleDisplayMode(.large)
        .toolbar { toolbarContent }
        .refreshable {
            await appState.syncEngine?.syncAll()
            try? appState.loadData()
        }
        .overlay {
            if appState.messages.isEmpty { emptyState }
        }
        .safeAreaInset(edge: .bottom) {
            if editMode == .active && !selectedMessageIds.isEmpty {
                bulkActionsBar
            }
        }
        .onChange(of: editMode) { mode in
            if mode == .inactive { selectedMessageIds.removeAll() }
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .navigationBarLeading) {
            Button { showFolderSidebar = true } label: {
                Image(systemName: "sidebar.left")
            }
        }
        ToolbarItemGroup(placement: .navigationBarTrailing) {
            if appState.syncEngine?.isSyncing == true {
                ProgressView().scaleEffect(0.8)
            }
            Button {
                withAnimation { editMode = editMode == .active ? .inactive : .active }
            } label: {
                Image(systemName: editMode == .active ? "checkmark.circle" : "checkmark.circle")
                    .symbolVariant(editMode == .active ? .fill : .none)
            }
            Button { showKanban = true } label: {
                Image(systemName: "square.3.layers.3d")
            }
            Button {
                appState.composeReplyTo = nil
                appState.showCompose = true
            } label: {
                Image(systemName: "square.and.pencil")
            }
        }
    }

    // MARK: - Bulk actions bar

    private var bulkActionsBar: some View {
        HStack(spacing: 0) {
            bulkButton("Read", systemImage: "envelope.open") {
                selectedMessageIds.forEach { id in
                    appState.apply(kind: .MARK_READ, payload: ["messageId": id])
                }
                endEdit()
            }
            Divider().frame(height: 24)
            bulkButton("Unread", systemImage: "envelope.badge") {
                selectedMessageIds.forEach { id in
                    appState.apply(kind: .MARK_UNREAD, payload: ["messageId": id])
                }
                endEdit()
            }
            Divider().frame(height: 24)
            bulkButton("Archive", systemImage: "archivebox") {
                selectedMessageIds.forEach { id in
                    appState.apply(kind: .ARCHIVE, payload: ["messageId": id])
                }
                endEdit()
            }
            Divider().frame(height: 24)
            bulkButton("Trash", systemImage: "trash", role: .destructive) {
                selectedMessageIds.forEach { id in
                    appState.apply(kind: .TRASH, payload: ["messageId": id])
                }
                endEdit()
            }
        }
        .frame(maxWidth: .infinity)
        .background(.thinMaterial)
        .overlay(alignment: .top) { Divider() }
    }

    private func bulkButton(_ title: String, systemImage: String, role: ButtonRole? = nil, action: @escaping () -> Void) -> some View {
        Button(role: role, action: action) {
            VStack(spacing: 3) {
                Image(systemName: systemImage).font(.system(size: 18))
                Text(title).font(.caption2)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .foregroundColor(role == .destructive ? .red : .primary)
        }
    }

    private func endEdit() {
        withAnimation { editMode = .inactive }
        selectedMessageIds.removeAll()
    }

    // MARK: - Empty state

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

    // MARK: - Context menu

    @ViewBuilder
    private func contextMenuItems(for message: NexusMessage) -> some View {
        Button {
            appState.apply(
                kind: message.flagsRead ? .MARK_UNREAD : .MARK_READ,
                payload: ["messageId": message.id]
            )
        } label: {
            Label(message.flagsRead ? "Mark Unread" : "Mark Read",
                  systemImage: message.flagsRead ? "envelope.badge" : "envelope.open")
        }

        Button {
            appState.apply(
                kind: message.star == nil ? .STAR : .UNSTAR,
                payload: ["messageId": message.id]
            )
        } label: {
            Label(message.star == nil ? "Star" : "Unstar",
                  systemImage: message.star == nil ? "star" : "star.slash")
        }

        Button {
            appState.apply(
                kind: message.pinned ? .UNPIN : .PIN,
                payload: ["messageId": message.id]
            )
        } label: {
            Label(message.pinned ? "Unpin" : "Pin",
                  systemImage: message.pinned ? "pin.slash" : "pin")
        }

        Button {
            appState.apply(kind: .ARCHIVE, payload: ["messageId": message.id])
        } label: {
            Label("Archive", systemImage: "archivebox")
        }

        Button(role: .destructive) {
            appState.apply(kind: .TRASH, payload: ["messageId": message.id])
        } label: {
            Label("Trash", systemImage: "trash")
        }
    }

    // MARK: - Helpers

    private var folderTitle: String {
        if let folderId = appState.selectedFolderId,
           let folder = appState.folders.first(where: { $0.id == folderId }) {
            return folder.name
        }
        return "Inbox"
    }
}

// MARK: - Message Row

struct MessageRowView: View {
    @EnvironmentObject var appState: AppState
    let message: NexusMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if message.pinned {
                    Image(systemName: "pin.fill")
                        .font(.caption2)
                        .foregroundColor(.orange)
                }
                Text(senderName)
                    .font(.subheadline.weight(message.flagsRead ? .regular : .semibold))
                    .lineLimit(1)
                Spacer()
                priorityIndicator
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

            labelsRow
            statusRow
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var priorityIndicator: some View {
        if let priority = message.priority {
            let (icon, color): (String, Color) = priority >= 2
                ? ("exclamationmark.2", .red)
                : ("exclamationmark", .orange)
            Image(systemName: icon)
                .font(.caption2.bold())
                .foregroundColor(color)
        }
    }

    @ViewBuilder
    private var labelsRow: some View {
        let labelIds = appState.messageLabelIds[message.id] ?? []
        let msgLabels = appState.labels.filter { labelIds.contains($0.id) }
        if !msgLabels.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(msgLabels, id: \.id) { label in
                        LabelChip(label: label)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var statusRow: some View {
        if let statusId = message.statusId,
           let status = appState.statuses.first(where: { $0.id == statusId }) {
            HStack(spacing: 4) {
                Circle()
                    .fill(NexusColorPalette.color(status.color))
                    .frame(width: 6, height: 6)
                Text(status.name)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
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

// MARK: - Label chip

struct LabelChip: View {
    let label: NexusLabel

    var body: some View {
        Text(label.name)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(NexusColorPalette.color(label.color).opacity(0.2))
            .foregroundColor(NexusColorPalette.color(label.color))
            .cornerRadius(4)
    }
}

// MARK: - Color palette

enum NexusColorPalette {
    static let palette: [Color] = [
        .gray, .blue, .red, .green, .orange, .purple, .pink, .yellow, .teal, .indigo, .cyan, .brown
    ]

    static func color(_ index: Int) -> Color {
        guard index > 0 else { return .gray }
        return palette[(index - 1) % (palette.count - 1) + 1]
    }
}
