import SwiftUI
import BackgroundTasks

@main
struct NexusApp: App {
    @StateObject private var appState = AppState()
    @State private var showSplash = true

    init() {
        SyncEngine.registerBackgroundTask()
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
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
                    Task { @MainActor in
                        appState.handleOAuthCallback(url: url)
                    }
                }

                if showSplash {
                    SplashView()
                        .transition(.opacity)
                        .zIndex(1)
                }
            }
            .onAppear {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                    withAnimation(.easeOut(duration: 0.4)) { showSplash = false }
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
