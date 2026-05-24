import SwiftUI

struct FolderSidebarView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var showCreateFolder = false
    @State private var newFolderName = ""

    private var systemFolders: [NexusFolder] {
        appState.folders.filter { $0.systemKind != nil }
            .sorted { systemOrder($0) < systemOrder($1) }
    }

    private var userFolders: [NexusFolder] {
        appState.folders.filter { $0.systemKind == nil }
            .sorted { $0.position < $1.position }
    }

    var body: some View {
        NavigationView {
            List {
                Section("Mailboxes") {
                    ForEach(systemFolders, id: \.id) { folder in
                        folderRow(folder)
                    }
                }

                if !userFolders.isEmpty {
                    Section("Folders") {
                        ForEach(userFolders, id: \.id) { folder in
                            folderRow(folder)
                        }
                        .onDelete { offsets in
                            for index in offsets {
                                let folder = userFolders[index]
                                appState.apply(kind: .DELETE_FOLDER, payload: ["id": folder.id])
                            }
                        }
                    }
                }

                Section {
                    Button {
                        showCreateFolder = true
                    } label: {
                        Label("New Folder", systemImage: "folder.badge.plus")
                    }
                }
            }
            .navigationTitle("Mailboxes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .alert("New Folder", isPresented: $showCreateFolder) {
                TextField("Folder name", text: $newFolderName)
                Button("Create") { createFolder() }
                Button("Cancel", role: .cancel) { newFolderName = "" }
            }
        }
        .navigationViewStyle(.stack)
    }

    private func folderRow(_ folder: NexusFolder) -> some View {
        Button {
            appState.loadMessagesForFolder(folder.id)
            dismiss()
        } label: {
            HStack {
                Image(systemName: folderIcon(folder))
                    .foregroundColor(folderColor(folder))
                    .frame(width: 28)
                Text(folder.name)
                    .foregroundColor(.primary)
                Spacer()
                if let count = unreadCount(folder), count > 0 {
                    Text("\(count)")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.secondary)
                }
                if appState.selectedFolderId == folder.id {
                    Image(systemName: "checkmark")
                        .font(.caption.weight(.bold))
                        .foregroundColor(.accentColor)
                }
            }
        }
    }

    private func createFolder() {
        guard !newFolderName.isEmpty else { return }
        let id = "folder-\(UUID().uuidString.prefix(8))"
        let slug = newFolderName.lowercased().replacingOccurrences(of: " ", with: "-")
        appState.apply(kind: .CREATE_FOLDER, payload: [
            "id": id,
            "name": newFolderName,
            "diskSlug": slug,
            "position": appState.folders.count
        ])
        newFolderName = ""
    }

    private func unreadCount(_ folder: NexusFolder) -> Int? {
        try? appState.db?.fetchUnreadCount(vaultId: appState.vaultId, folderId: folder.id)
    }

    private func systemOrder(_ folder: NexusFolder) -> Int {
        switch folder.systemKind {
        case "inbox": return 0
        case "sent": return 1
        case "drafts": return 2
        case "archive": return 3
        case "spam": return 4
        case "trash": return 5
        default: return 99
        }
    }

    private func folderIcon(_ folder: NexusFolder) -> String {
        if let icon = folder.icon { return icon }
        switch folder.systemKind {
        case "inbox": return "tray"
        case "sent": return "paperplane"
        case "drafts": return "doc"
        case "archive": return "archivebox"
        case "spam": return "exclamationmark.octagon"
        case "trash": return "trash"
        default: return "folder"
        }
    }

    private func folderColor(_ folder: NexusFolder) -> Color {
        if let color = folder.color { return NexusColorPalette.color(color) }
        switch folder.systemKind {
        case "inbox": return .accentColor
        case "sent": return .blue
        case "drafts": return .orange
        case "archive": return .gray
        case "spam": return .red
        case "trash": return .red
        default: return .secondary
        }
    }
}
