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
                        MainTabView()
                            .environmentObject(appState)
                            .onAppear { appState.syncEngine?.startForegroundSync() }
                            .onDisappear { appState.syncEngine?.stopForegroundSync() }
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

