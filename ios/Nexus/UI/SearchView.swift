import SwiftUI

struct SearchView: View {
    @EnvironmentObject var appState: AppState
    @State private var query = ""
    @State private var debounceTask: Task<Void, Never>? = nil

    var body: some View {
        NavigationView {
            Group {
                if query.isEmpty {
                    placeholderView
                } else if appState.searchResults.isEmpty {
                    emptyView
                } else {
                    resultsList
                }
            }
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Search messages…")
            .onChange(of: query) { _ in
                debounceTask?.cancel()
                debounceTask = Task {
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    guard !Task.isCancelled else { return }
                    await MainActor.run { appState.search(query: query) }
                }
            }
        }
        .navigationViewStyle(.stack)
    }

    private var placeholderView: some View {
        VStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("Search your mail")
                .font(.headline)
            Text("Searches subject, body, and notes.")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .padding()
    }

    private var emptyView: some View {
        VStack(spacing: 12) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("No results for "\(query)"")
                .font(.headline)
        }
        .padding()
    }

    private var resultsList: some View {
        List(appState.searchResults, id: \.id) { message in
            NavigationLink(destination: MessageDetailView(message: message)) {
                MessageRowView(message: message)
            }
        }
        .listStyle(.plain)
    }
}
