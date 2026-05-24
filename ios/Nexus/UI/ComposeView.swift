import SwiftUI

struct ComposeView: View {
    let replyTo: NexusMessage?
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var toField: String = ""
    @State private var subject: String = ""
    @State private var bodyText: String = ""
    @State private var selectedAccountId: String = ""
    @State private var isSending = false
    @State private var error: String? = nil
    @State private var showTemplatePicker = false

    init(replyTo: NexusMessage? = nil) {
        self.replyTo = replyTo
    }

    var body: some View {
        NavigationView {
            Form {
                Section {
                    if appState.accounts.count > 1 {
                        Picker("From", selection: $selectedAccountId) {
                            ForEach(appState.accounts, id: \.id) { account in
                                Text(account.email).tag(account.id)
                            }
                        }
                    } else if let account = appState.accounts.first {
                        HStack {
                            Text("From").foregroundColor(.secondary)
                            Spacer()
                            Text(account.email).foregroundColor(.primary)
                        }
                    }

                    HStack {
                        Text("To").foregroundColor(.secondary).frame(width: 44, alignment: .leading)
                        TextField("recipient@example.com", text: $toField)
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                    }

                    HStack {
                        Text("Subject").foregroundColor(.secondary).frame(width: 60, alignment: .leading)
                        TextField("Subject", text: $subject)
                    }
                }

                Section {
                    TextEditor(text: $bodyText)
                        .frame(minHeight: 200)
                }

                if !appState.templates.isEmpty && replyTo == nil {
                    Section {
                        Button {
                            showTemplatePicker = true
                        } label: {
                            Label("Use Template", systemImage: "doc.text")
                        }
                    }
                }

                if let error {
                    Section {
                        Text(error)
                            .foregroundColor(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle(replyTo != nil ? "Reply" : "New Message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: handleSend) {
                        if isSending {
                            ProgressView().scaleEffect(0.8)
                        } else {
                            Image(systemName: "paperplane.fill")
                        }
                    }
                    .disabled(isSending || toField.isEmpty)
                }
            }
        }
        .navigationViewStyle(.stack)
        .onAppear(perform: prefill)
        .sheet(isPresented: $showTemplatePicker) {
            TemplatePickerSheet { template in
                subject = template.subject
                bodyText = template.bodyHtml
                    .replacingOccurrences(of: "<br>", with: "\n")
                    .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
                showTemplatePicker = false
            }
            .environmentObject(appState)
        }
    }

    private func prefill() {
        selectedAccountId = appState.accounts.first?.id ?? ""
        if let replyTo {
            toField = replyTo.fromAddr?.email ?? ""
            subject = replyTo.subject.hasPrefix("Re:") ? replyTo.subject : "Re: \(replyTo.subject)"
            bodyText = "\n\n--- Original message ---\n"
        }
    }

    private func handleSend() {
        isSending = true
        error = nil
        let to = toField.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        let bodyHtml = "<p>\(bodyText.replacingOccurrences(of: "\n", with: "<br>"))</p>"
        let payload: [String: Any] = [
            "accountId": selectedAccountId,
            "from": appState.accounts.first(where: { $0.id == selectedAccountId })?.email ?? "",
            "to": to,
            "subject": subject,
            "bodyHtml": bodyHtml,
            "replyToMessageId": replyTo?.providerId as Any
        ]
        appState.apply(kind: .SEND_MESSAGE, payload: payload)
        dismiss()
    }
}

// MARK: - Template picker sheet

struct TemplatePickerSheet: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let onSelect: (NexusTemplate) -> Void

    var body: some View {
        NavigationView {
            List(appState.templates, id: \.id) { template in
                Button {
                    onSelect(template)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(template.name)
                            .font(.subheadline.weight(.medium))
                            .foregroundColor(.primary)
                        if !template.subject.isEmpty {
                            Text(template.subject)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("Choose Template")
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
