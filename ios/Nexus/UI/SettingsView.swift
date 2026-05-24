import SwiftUI
import GRDB

struct SettingsView: View {
    @EnvironmentObject var appState: AppState
    @State private var showAddAccount = false
    @State private var relayURLText = ""
    @State private var isSavingRelay = false
    @State private var relayError: String? = nil
    @State private var showCreateStatus = false
    @State private var newStatusName = ""
    @State private var newStatusColor = 2

    var body: some View {
        NavigationView {
            Form {
                // Accounts
                Section("Accounts") {
                    ForEach(appState.accounts, id: \.id) { account in
                        HStack {
                            Image(systemName: providerIcon(account.provider))
                                .foregroundColor(.accentColor).frame(width: 28)
                            VStack(alignment: .leading) {
                                Text(account.email).font(.subheadline)
                                Text(account.provider.capitalized).font(.caption).foregroundColor(.secondary)
                            }
                            Spacer()
                            Image(systemName: "checkmark.circle.fill").foregroundColor(.green).font(.caption)
                        }
                    }
                    Button {
                        showAddAccount = true
                    } label: {
                        Label("Add Account", systemImage: "plus.circle")
                    }
                }

                // Client Mode
                Section("Client Mode") {
                    Picker("Mode", selection: $appState.clientMode) {
                        Text("Traditional").tag(AppState.ClientMode.traditional)
                        Text("Local-first").tag(AppState.ClientMode.localFirst)
                    }
                    .pickerStyle(.segmented)
                    Text(appState.clientMode == .traditional
                        ? "Mail syncs from provider servers."
                        : "Mail is stored on-device, end-to-end encrypted.")
                        .font(.caption).foregroundColor(.secondary)
                }

                // Relay Sync
                Section("Relay Sync") {
                    HStack {
                        TextField("https://relay.example.com", text: $relayURLText)
                            .keyboardType(.URL)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                        Button("Save") { handleSaveRelay() }
                            .disabled(relayURLText.isEmpty || isSavingRelay)
                    }
                    if let error = relayError {
                        Text(error).font(.caption).foregroundColor(.red)
                    }
                    Text("Optional: enter a Nexus relay URL to sync across your own devices.")
                        .font(.caption).foregroundColor(.secondary)
                }

                // Sync
                Section("Sync") {
                    HStack {
                        Text("Last synced")
                        Spacer()
                        if let date = appState.syncEngine?.lastSyncAt {
                            Text(RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date()))
                                .foregroundColor(.secondary)
                        } else {
                            Text("Never").foregroundColor(.secondary)
                        }
                    }
                    Button("Sync Now") {
                        Task { await appState.syncEngine?.syncAll() }
                    }
                    .disabled(appState.syncEngine?.isSyncing == true)
                }

                // Statuses
                Section("Statuses") {
                    ForEach(appState.statuses, id: \.id) { status in
                        HStack {
                            Circle()
                                .fill(NexusColorPalette.color(status.color))
                                .frame(width: 12, height: 12)
                            Text(status.name)
                            Spacer()
                            if status.isDefault {
                                Text("Default")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                    .onDelete { offsets in
                        for index in offsets {
                            let status = appState.statuses[index]
                            appState.apply(kind: .DELETE_STATUS, payload: ["id": status.id])
                        }
                    }
                    Button {
                        newStatusName = ""
                        newStatusColor = 2
                        showCreateStatus = true
                    } label: {
                        Label("Add Status", systemImage: "plus.circle")
                    }
                }

                // Rules
                Section("Automation") {
                    NavigationLink(destination: RulesView().environmentObject(appState)) {
                        HStack {
                            Image(systemName: "list.bullet.rectangle")
                                .foregroundColor(.accentColor).frame(width: 28)
                            Text("Rules")
                            Spacer()
                            Text("\(appState.rules.count)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    NavigationLink(destination: TemplatesView().environmentObject(appState)) {
                        HStack {
                            Image(systemName: "doc.text")
                                .foregroundColor(.accentColor).frame(width: 28)
                            Text("Templates")
                            Spacer()
                            Text("\(appState.templates.count)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }

                // About
                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text(appVersion).foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showAddAccount) {
                AddAccountSheet().environmentObject(appState)
            }
            .alert("New Status", isPresented: $showCreateStatus) {
                TextField("Status name", text: $newStatusName)
                Button("Create") { createStatus() }
                Button("Cancel", role: .cancel) { newStatusName = "" }
            }
        }
        .navigationViewStyle(.stack)
    }

    private func handleSaveRelay() {
        guard let url = URL(string: relayURLText) else {
            relayError = "Invalid URL"; return
        }
        isSavingRelay = true
        relayError = nil
        Task { @MainActor in
            do {
                let keyHex = try appState.db?.dbQueue.read { db in
                    try Row.fetchOne(db,
                        sql: "SELECT key_hex FROM vault_key WHERE vault_id = ?",
                        arguments: [appState.vaultId])
                        .map { $0["key_hex"] as String }
                } ?? nil
                if let keyHex {
                    appState.syncEngine?.configure(relayURL: url, vaultKeyHex: keyHex)
                }
                isSavingRelay = false
            } catch {
                relayError = error.localizedDescription
                isSavingRelay = false
            }
        }
    }

    private func createStatus() {
        guard !newStatusName.isEmpty else { return }
        let id = "status-\(UUID().uuidString.prefix(8))"
        appState.apply(kind: .CREATE_STATUS, payload: [
            "id": id,
            "name": newStatusName,
            "color": newStatusColor,
            "position": appState.statuses.count,
            "isDefault": false,
            "isTerminal": false
        ])
    }

    private func providerIcon(_ provider: String) -> String {
        switch provider {
        case "gmail": return "envelope.fill"
        case "imap": return "server.rack"
        default: return "at"
        }
    }

    private var appVersion: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "1.0"
    }
}

// MARK: - Add account sheet

struct AddAccountSheet: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var isConnecting = false
    @State private var error: String? = nil

    var body: some View {
        NavigationView {
            List {
                Button(action: connectGmail) {
                    HStack {
                        Image(systemName: "envelope.fill").foregroundColor(.red).frame(width: 28)
                        Text("Gmail")
                        Spacer()
                        if isConnecting { ProgressView().scaleEffect(0.8) }
                    }
                }
                .disabled(isConnecting)

                if let error {
                    Text(error).foregroundColor(.red).font(.caption)
                }
            }
            .navigationTitle("Add Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .navigationViewStyle(.stack)
    }

    private func connectGmail() {
        isConnecting = true
        error = nil
        Task { @MainActor in
            do {
                try await appState.connectGmailAccount()
                dismiss()
            } catch {
                self.error = error.localizedDescription
                isConnecting = false
            }
        }
    }
}
