import SwiftUI

struct TemplatesView: View {
    @EnvironmentObject var appState: AppState
    @State private var showCreate = false
    @State private var editingTemplate: NexusTemplate? = nil

    var body: some View {
        List {
            if appState.templates.isEmpty {
                Section {
                    VStack(spacing: 8) {
                        Image(systemName: "doc.text")
                            .font(.system(size: 36))
                            .foregroundColor(.secondary)
                        Text("No templates yet")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Text("Save frequently-used emails as templates.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                }
                .listRowBackground(Color.clear)
            } else {
                ForEach(appState.templates, id: \.id) { template in
                    Button {
                        editingTemplate = template
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(template.name)
                                .font(.subheadline.weight(.medium))
                                .foregroundColor(.primary)
                            Text(template.subject.isEmpty ? "(no subject)" : template.subject)
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            appState.apply(kind: .DELETE_TEMPLATE, payload: ["id": template.id])
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
        }
        .navigationTitle("Templates")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    editingTemplate = nil
                    showCreate = true
                } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showCreate) {
            TemplateEditSheet(template: nil)
                .environmentObject(appState)
        }
        .sheet(item: $editingTemplate) { template in
            TemplateEditSheet(template: template)
                .environmentObject(appState)
        }
    }
}

// MARK: - Template Edit Sheet

struct TemplateEditSheet: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss

    let template: NexusTemplate?
    @State private var name = ""
    @State private var subject = ""
    @State private var bodyText = ""

    var body: some View {
        NavigationView {
            Form {
                Section("Template Name") {
                    TextField("Name", text: $name)
                }
                Section("Subject") {
                    TextField("Subject line", text: $subject)
                }
                Section("Body") {
                    TextEditor(text: $bodyText)
                        .frame(minHeight: 200)
                }
            }
            .navigationTitle(template == nil ? "New Template" : "Edit Template")
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
        guard let t = template else { return }
        name = t.name
        subject = t.subject
        // Strip basic HTML tags for editing
        bodyText = t.bodyHtml
            .replacingOccurrences(of: "<br>", with: "\n")
            .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
    }

    private func save() {
        let id = template?.id ?? "tmpl-\(UUID().uuidString.prefix(8))"
        let html = "<p>\(bodyText.replacingOccurrences(of: "\n", with: "<br>"))</p>"
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let tmplDict: [String: Any] = [
            "id": id,
            "name": name,
            "subject": subject,
            "bodyHtml": html,
            "createdAt": template?.createdAt ?? now
        ]
        appState.apply(
            kind: template == nil ? .CREATE_TEMPLATE : .UPDATE_TEMPLATE,
            payload: ["template": tmplDict]
        )
        dismiss()
    }
}
