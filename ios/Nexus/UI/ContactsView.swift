import SwiftUI

struct ContactsView: View {
    @EnvironmentObject var appState: AppState
    @State private var searchText = ""
    @State private var showCreate = false

    var filteredContacts: [NexusContact] {
        if searchText.isEmpty { return appState.contacts }
        let q = searchText.lowercased()
        return appState.contacts.filter {
            $0.name.lowercased().contains(q) ||
            ($0.company?.lowercased().contains(q) == true)
        }
    }

    var body: some View {
        NavigationView {
            Group {
                if appState.contacts.isEmpty {
                    emptyState
                } else {
                    List {
                        ForEach(filteredContacts, id: \.id) { contact in
                            NavigationLink(destination: ContactDetailView(contact: contact)) {
                                ContactRowView(contact: contact)
                            }
                        }
                        .onDelete { offsets in
                            for index in offsets {
                                let contact = filteredContacts[index]
                                appState.apply(kind: .DELETE_CONTACT, payload: ["id": contact.id])
                            }
                        }
                    }
                    .listStyle(.plain)
                    .searchable(text: $searchText, prompt: "Search contacts…")
                }
            }
            .navigationTitle("Contacts")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showCreate = true
                    } label: { Image(systemName: "plus") }
                }
            }
            .sheet(isPresented: $showCreate) {
                ContactEditSheet(contact: nil)
                    .environmentObject(appState)
            }
        }
        .navigationViewStyle(.stack)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.2")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("No contacts yet")
                .font(.headline)
            Text("Contacts are created automatically from your email correspondents, or add them manually.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
    }
}

// MARK: - Contact Row

struct ContactRowView: View {
    let contact: NexusContact

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(avatarColor)
                .frame(width: 40, height: 40)
                .overlay(
                    Text(String(contact.name.prefix(1)).uppercased())
                        .font(.subheadline.bold())
                        .foregroundColor(.white)
                )
            VStack(alignment: .leading, spacing: 2) {
                Text(contact.name)
                    .font(.subheadline.weight(.medium))
                if let company = contact.company {
                    Text(company)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
    }

    private var avatarColor: Color {
        let colors: [Color] = [.blue, .red, .green, .orange, .purple, .pink, .teal]
        let index = abs(contact.name.hashValue) % colors.count
        return colors[index]
    }
}

// MARK: - Contact Detail

struct ContactDetailView: View {
    @EnvironmentObject var appState: AppState
    let contact: NexusContact
    @State private var emails: [NexusContactEmail] = []
    @State private var recentMessages: [NexusMessage] = []
    @State private var showEdit = false

    var body: some View {
        List {
            Section {
                HStack {
                    Spacer()
                    VStack(spacing: 8) {
                        Circle()
                            .fill(Color.accentColor.opacity(0.2))
                            .frame(width: 72, height: 72)
                            .overlay(
                                Text(String(contact.name.prefix(1)).uppercased())
                                    .font(.largeTitle.bold())
                                    .foregroundColor(.accentColor)
                            )
                        Text(contact.name)
                            .font(.title3.bold())
                        if let company = contact.company {
                            Text(company)
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                    }
                    Spacer()
                }
                .listRowBackground(Color.clear)
            }

            if !emails.isEmpty {
                Section("Email") {
                    ForEach(emails, id: \.email) { ce in
                        HStack {
                            Text(ce.email)
                            Spacer()
                            Button {
                                appState.composeReplyTo = nil
                                // Pre-fill compose with this contact's email
                                appState.showCompose = true
                            } label: {
                                Image(systemName: "envelope")
                                    .foregroundColor(.accentColor)
                            }
                        }
                    }
                }
            }

            if let title = contact.title {
                Section("Title") { Text(title) }
            }
            if let website = contact.website {
                Section("Website") {
                    Link(website, destination: URL(string: website) ?? URL(string: "https://")!)
                }
            }
            if let location = contact.location {
                Section("Location") { Text(location) }
            }
            if let notes = contact.notes {
                Section("Notes") { Text(notes) }
            }

            if !recentMessages.isEmpty {
                Section("Recent Messages") {
                    ForEach(recentMessages.prefix(10), id: \.id) { message in
                        NavigationLink(destination: MessageDetailView(message: message)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(message.subject.isEmpty ? "(no subject)" : message.subject)
                                    .font(.subheadline)
                                    .lineLimit(1)
                                Text(formattedDate(message.receivedAt))
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(contact.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Edit") { showEdit = true }
            }
        }
        .sheet(isPresented: $showEdit) {
            ContactEditSheet(contact: contact)
                .environmentObject(appState)
        }
        .onAppear { loadData() }
    }

    private func loadData() {
        guard let db = appState.db else { return }
        emails = (try? db.fetchContactEmails(contactId: contact.id)) ?? []
        // Load recent messages from any of this contact's emails
        for ce in emails {
            let msgs = (try? db.fetchMessagesFromEmail(ce.email, vaultId: appState.vaultId)) ?? []
            recentMessages.append(contentsOf: msgs)
        }
        recentMessages = Array(Set(recentMessages.map { $0.id })
            .compactMap { id in recentMessages.first(where: { $0.id == id }) }
            .sorted { $0.receivedAt > $1.receivedAt }
            .prefix(20))
    }

    private func formattedDate(_ ms: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
        let fmt = DateFormatter()
        fmt.dateStyle = .short
        return fmt.string(from: date)
    }
}

// MARK: - Contact Edit Sheet

struct ContactEditSheet: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss

    let contact: NexusContact?
    @State private var name = ""
    @State private var company = ""
    @State private var title = ""
    @State private var website = ""
    @State private var location = ""
    @State private var notes = ""
    @State private var emailsText = ""

    var body: some View {
        NavigationView {
            Form {
                Section("Name") {
                    TextField("Full name", text: $name)
                }
                Section("Emails (one per line)") {
                    TextEditor(text: $emailsText)
                        .frame(minHeight: 60)
                }
                Section("Work") {
                    TextField("Company", text: $company)
                    TextField("Title", text: $title)
                }
                Section("Other") {
                    TextField("Website", text: $website)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                    TextField("Location", text: $location)
                }
                Section("Notes") {
                    TextEditor(text: $notes)
                        .frame(minHeight: 80)
                }
            }
            .navigationTitle(contact == nil ? "New Contact" : "Edit Contact")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") { save() }.disabled(name.isEmpty)
                }
            }
            .onAppear { prefill() }
        }
        .navigationViewStyle(.stack)
    }

    private func prefill() {
        guard let c = contact else { return }
        name = c.name
        company = c.company ?? ""
        title = c.title ?? ""
        website = c.website ?? ""
        location = c.location ?? ""
        notes = c.notes ?? ""
        if let db = appState.db {
            let ces = (try? db.fetchContactEmails(contactId: c.id)) ?? []
            emailsText = ces.map(\.email).joined(separator: "\n")
        }
    }

    private func save() {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let contactId = contact?.id ?? "contact-\(UUID().uuidString.prefix(8))"
        let newContact = NexusContact(
            id: contactId,
            vaultId: appState.vaultId,
            name: name,
            company: company.isEmpty ? nil : company,
            title: title.isEmpty ? nil : title,
            website: website.isEmpty ? nil : website,
            location: location.isEmpty ? nil : location,
            notes: notes.isEmpty ? nil : notes,
            tagsJson: "[]",
            createdAt: contact?.createdAt ?? now,
            updatedAt: now
        )
        appState.apply(
            kind: contact == nil ? .CREATE_CONTACT : .UPDATE_CONTACT,
            payload: [
                "id": contactId,
                "name": name,
                "company": company,
                "title": title,
                "website": website,
                "location": location,
                "notes": notes
            ]
        )
        // Save emails directly since mutation engine doesn't handle them
        if let db = appState.db {
            try? db.upsertContact(newContact)
            let emailLines = emailsText.components(separatedBy: "\n")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
            for (i, email) in emailLines.enumerated() {
                let ce = NexusContactEmail(contactId: contactId, email: email, position: i)
                try? db.upsertContactEmail(ce)
            }
            try? appState.loadData()
        }
        dismiss()
    }
}
