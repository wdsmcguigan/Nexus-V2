import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        TabView(selection: $appState.selectedTab) {
            MailView()
                .tabItem { Label("Mail", systemImage: "envelope") }
                .tag(0)

            SearchView()
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
                .tag(1)

            LabelsView()
                .tabItem { Label("Labels", systemImage: "tag") }
                .tag(2)

            ContactsView()
                .tabItem { Label("Contacts", systemImage: "person.2") }
                .tag(3)

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gear") }
                .tag(4)
        }
        .sheet(isPresented: $appState.showCompose) {
            ComposeView(replyTo: appState.composeReplyTo)
                .environmentObject(appState)
                .onDisappear { appState.composeReplyTo = nil }
        }
    }
}
