import SwiftUI

/// Three-step onboarding: vault path → client mode → connect account.
/// Mirrors src/components/onboarding/VaultSetup.tsx.
struct VaultSetupView: View {
    @EnvironmentObject var appState: AppState

    enum Step { case vault, mode, accounts, done }

    @State private var step: Step = .vault
    @State private var vaultPath: String = defaultVaultPath()
    @State private var isLoading = false
    @State private var errorMessage: String? = nil
    @State private var isConnectingAccount = false

    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground).ignoresSafeArea()

            switch step {
            case .vault:   vaultStep
            case .mode:    modeStep
            case .accounts: accountsStep
            case .done:    doneStep
            }
        }
        .animation(.easeInOut(duration: 0.2), value: step)
    }

    // MARK: - Step 1: Vault path

    private var vaultStep: some View {
        VStack(spacing: 24) {
            Image(systemName: "folder.fill")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            VStack(spacing: 6) {
                Text("Welcome to Nexus")
                    .font(.title2.bold())
                Text("Choose where to store your vault. All mail and metadata will live here.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("VAULT PATH")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.secondary)
                TextField("~/Documents/Mail", text: $vaultPath)
                    .textFieldStyle(.roundedBorder)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                if let error = errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }

            Button(action: handleVaultContinue) {
                HStack {
                    if isLoading {
                        ProgressView().tint(.white)
                    } else {
                        Text("Continue")
                        Image(systemName: "arrow.right")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.accentColor)
                .foregroundColor(.white)
                .cornerRadius(12)
            }
            .disabled(isLoading || vaultPath.isEmpty)
        }
        .padding(32)
        .frame(maxWidth: 360)
    }

    // MARK: - Step 2: Mode selection

    private var modeStep: some View {
        VStack(spacing: 24) {
            VStack(spacing: 6) {
                Text("How do you want to use Nexus?")
                    .font(.title2.bold())
                    .multilineTextAlignment(.center)
                Text("You can change this later in Settings.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }

            VStack(spacing: 12) {
                // Traditional
                Button(action: { handleModeSelect(.traditional) }) {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "cloud.fill")
                            .font(.title2)
                            .foregroundColor(.secondary)
                            .frame(width: 44)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Traditional Client")
                                .font(.headline)
                                .foregroundColor(.primary)
                            Text("Use Nexus as a fast Gmail interface. Your mail syncs from Google's servers.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.leading)
                        }
                        Spacer()
                    }
                    .padding()
                    .background(Color(uiColor: .secondarySystemBackground))
                    .cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.secondary.opacity(0.3)))
                }
                .buttonStyle(.plain)

                // Local-first
                Button(action: { handleModeSelect(.localFirst) }) {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "internaldrive.fill")
                            .font(.title2)
                            .foregroundColor(.accentColor)
                            .frame(width: 44)
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Local-first & Private")
                                    .font(.headline)
                                    .foregroundColor(.primary)
                                Text("Recommended")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundColor(.accentColor)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Color.accentColor.opacity(0.15))
                                    .cornerRadius(6)
                            }
                            Text("Your mail lives fully on this device, end-to-end encrypted.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.leading)
                        }
                        Spacer()
                    }
                    .padding()
                    .background(Color.accentColor.opacity(0.07))
                    .cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.accentColor.opacity(0.5)))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(32)
        .frame(maxWidth: 360)
    }

    // MARK: - Step 3: Connect account

    private var accountsStep: some View {
        VStack(spacing: 24) {
            VStack(spacing: 6) {
                Text("Connect an account")
                    .font(.title2.bold())
                Text("Sync Gmail, Outlook, iCloud, Fastmail, or any IMAP account.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }

            Button(action: handleConnectAccount) {
                HStack {
                    if isConnectingAccount {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "plus.circle.fill")
                        Text("Connect an account")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.accentColor)
                .foregroundColor(.white)
                .cornerRadius(12)
            }
            .disabled(isConnectingAccount)

            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
                    .multilineTextAlignment(.center)
            }

            Button("Skip for now") {
                step = .done
            }
            .font(.footnote)
            .foregroundColor(.secondary)
        }
        .padding(32)
        .frame(maxWidth: 360)
    }

    // MARK: - Done

    private var doneStep: some View {
        VStack {
            ProgressView()
            Text("Loading your inbox…")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .padding(.top, 8)
        }
    }

    // MARK: - Actions

    private func handleVaultContinue() {
        isLoading = true
        errorMessage = nil
        Task { @MainActor in
            do {
                try appState.initializeVault(path: vaultPath)
                step = .mode
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }

    private func handleModeSelect(_ mode: AppState.ClientMode) {
        appState.clientMode = mode
        step = .accounts
    }

    private func handleConnectAccount() {
        isConnectingAccount = true
        errorMessage = nil
        Task { @MainActor in
            do {
                try await appState.connectGmailAccount()
                step = .done
            } catch {
                errorMessage = error.localizedDescription
                isConnectingAccount = false
            }
        }
    }

    private static func defaultVaultPath() -> String {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        return docs?.appendingPathComponent("Mail").path ?? "~/Documents/Mail"
    }
}
