import SwiftUI

struct KanbanView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss

    private var columns: [KanbanColumn] {
        let noStatus = KanbanColumn(
            key: "__no_status__",
            id: nil,
            name: "No Status",
            color: .secondary,
            messages: appState.messages.filter { $0.statusId == nil }
        )
        let statusCols = appState.statuses.map { status in
            KanbanColumn(
                key: status.id,
                id: status.id,
                name: status.name,
                color: NexusColorPalette.color(status.color),
                messages: appState.messages.filter { $0.statusId == status.id }
            )
        }
        return [noStatus] + statusCols
    }

    var body: some View {
        NavigationView {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(columns, id: \.key) { column in
                        KanbanColumnView(column: column)
                    }
                }
                .padding()
            }
            .navigationTitle("Kanban")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .overlay {
                if appState.messages.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "square.3.layers.3d")
                            .font(.system(size: 48))
                            .foregroundColor(.secondary)
                        Text("No messages to show")
                            .font(.headline)
                        Text("The kanban board organizes messages by status.")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding()
                }
            }
        }
        .navigationViewStyle(.stack)
    }
}

// MARK: - Column model

struct KanbanColumn {
    let key: String  // unique key for ForEach
    let id: String?  // status id, nil = no-status column
    let name: String
    let color: Color
    let messages: [NexusMessage]
}

// MARK: - Column view

struct KanbanColumnView: View {
    @EnvironmentObject var appState: AppState
    let column: KanbanColumn

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Column header
            HStack {
                Circle()
                    .fill(column.color)
                    .frame(width: 10, height: 10)
                Text(column.name)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(column.messages.count)")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.secondary.opacity(0.15))
                    .cornerRadius(8)
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)

            // Cards
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(column.messages, id: \.id) { message in
                        KanbanCardView(message: message)
                    }
                    if column.messages.isEmpty {
                        Text("No messages")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 24)
                    }
                }
                .padding(.horizontal, 8)
            }
        }
        .frame(width: 240)
        .background(Color(uiColor: .secondarySystemBackground))
        .cornerRadius(12)
    }
}

// MARK: - Card view

struct KanbanCardView: View {
    @EnvironmentObject var appState: AppState
    let message: NexusMessage
    @State private var showMoveMenu = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(message.subject.isEmpty ? "(no subject)" : message.subject)
                .font(.caption.weight(message.flagsRead ? .regular : .semibold))
                .lineLimit(2)

            if let addr = message.fromAddr {
                Text(addr.name.isEmpty ? addr.email : addr.name)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }

            HStack(spacing: 4) {
                if message.star != nil {
                    Image(systemName: "star.fill")
                        .font(.caption2)
                        .foregroundColor(.yellow)
                }
                if message.pinned {
                    Image(systemName: "pin.fill")
                        .font(.caption2)
                        .foregroundColor(.orange)
                }
                Spacer()
                priorityBadge
            }
        }
        .padding(10)
        .background(Color(uiColor: .systemBackground))
        .cornerRadius(8)
        .shadow(color: .black.opacity(0.06), radius: 2, x: 0, y: 1)
        .contextMenu {
            ForEach(appState.statuses, id: \.id) { status in
                Button {
                    appState.apply(kind: .SET_STATUS, payload: ["messageId": message.id, "statusId": status.id])
                } label: {
                    Label(status.name, systemImage: "circle.fill")
                }
            }
            if message.statusId != nil {
                Button(role: .destructive) {
                    appState.apply(kind: .CLEAR_STATUS, payload: ["messageId": message.id])
                } label: {
                    Label("Clear Status", systemImage: "xmark.circle")
                }
            }
        }
    }

    @ViewBuilder
    private var priorityBadge: some View {
        if let priority = message.priority {
            Text(priority >= 2 ? "!!" : "!")
                .font(.caption2.bold())
                .foregroundColor(priority >= 2 ? .red : .orange)
        }
    }
}
