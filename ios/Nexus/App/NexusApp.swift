import SwiftUI
import BackgroundTasks

@main
struct NexusApp: App {
    @StateObject private var appState = AppState()

    init() {
        SyncEngine.registerBackgroundTask()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if appState.isOnboarded {
                    ContentView()
                        .environmentObject(appState)
                } else {
                    VaultSetupView()
                        .environmentObject(appState)
                }
            }
            .onOpenURL { url in
                // Handle nexus://oauth callback
                Task { @MainActor in
                    appState.handleOAuthCallback(url: url)
                }
            }
        }
    }
}

/// Root navigation container (iOS 15 compatible).
struct ContentView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        NavigationView {
            InboxView()
        }
        .navigationViewStyle(.stack)
        .sheet(isPresented: $appState.showCompose) {
            ComposeView()
                .environmentObject(appState)
        }
        .onAppear {
            appState.syncEngine?.startForegroundSync()
        }
        .onDisappear {
            appState.syncEngine?.stopForegroundSync()
        }
    }
}
