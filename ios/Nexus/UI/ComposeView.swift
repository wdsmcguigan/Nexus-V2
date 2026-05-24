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

    init(replyTo: NexusMessage? = nil) {
        self.replyTo = replyTo
    }

    var body: some View {
        NavigationView {
            Form {
                Section {
                    // From selector
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
