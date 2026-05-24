import SwiftUI

struct MailView: View {
    @EnvironmentObject var appState: AppState
    @State private var showFolderSidebar = false
    @State private var showKanban = false

    var body: some View {
        NavigationView {
            InboxView(
                showFolderSidebar: $showFolderSidebar,
                showKanban: $showKanban
            )
        }
        .navigationViewStyle(.stack)
        .sheet(isPresented: $showFolderSidebar) {
            FolderSidebarView()
                .environmentObject(appState)
        }
        .sheet(isPresented: $showKanban) {
            KanbanView()
                .environmentObject(appState)
        }
    }
}
