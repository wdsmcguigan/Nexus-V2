import SwiftUI

struct LabelsView: View {
    @EnvironmentObject var appState: AppState
    @State private var showCreate = false
    @State private var editingLabel: NexusLabel? = nil
    @State private var newName = ""
    @State private var newColor = 2

    var userLabels: [NexusLabel] {
        appState.labels.filter { $0.systemKind == nil }.sorted { $0.position < $1.position }
    }

    var systemLabels: [NexusLabel] {
        appState.labels.filter { $0.systemKind != nil }.sorted { $0.position < $1.position }
    }

    var body: some View {
        NavigationView {
            List {
                if !systemLabels.isEmpty {
                    Section("System Labels") {
                        ForEach(systemLabels, id: \.id) { label in
                            labelRow(label)
                        }
                    }
                }

                Section("My Labels") {
                    ForEach(userLabels, id: \.id) { label in
                        labelRow(label)
                    }
                    .onDelete { offsets in
                        for index in offsets {
                            let label = userLabels[index]
                            appState.apply(kind: .DELETE_LABEL, payload: ["id": label.id])
                        }
                    }
                }
            }
            .navigationTitle("Labels")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        newName = ""
                        newColor = 2
                        showCreate = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showCreate) {
                LabelEditSheet(
                    title: "New Label",
                    name: $newName,
                    colorIndex: $newColor,
                    onSave: {
                        let id = "label-\(UUID().uuidString.prefix(8))"
                        appState.apply(kind: .CREATE_LABEL, payload: [
                            "id": id,
                            "name": newName,
                            "color": newColor,
                            "position": appState.labels.count
                        ])
                        showCreate = false
                    },
                    onCancel: { showCreate = false }
                )
            }
            .sheet(item: $editingLabel) { label in
                LabelEditSheet(
                    title: "Edit Label",
                    name: Binding(
                        get: { label.name },
                        set: { newName = $0 }
                    ),
                    colorIndex: Binding(
                        get: { label.color },
                        set: { newColor = $0 }
                    ),
                    onSave: {
                        appState.apply(kind: .RENAME_LABEL, payload: ["id": label.id, "name": newName.isEmpty ? label.name : newName])
                        if newColor != label.color {
                            appState.apply(kind: .RECOLOR_LABEL, payload: ["id": label.id, "color": newColor])
                        }
                        editingLabel = nil
                    },
                    onCancel: { editingLabel = nil }
                )
                .onAppear {
                    newName = label.name
                    newColor = label.color
                }
            }
        }
        .navigationViewStyle(.stack)
    }

    private func labelRow(_ label: NexusLabel) -> some View {
        NavigationLink(destination: LabelMessagesView(label: label)) {
            HStack(spacing: 12) {
                Circle()
                    .fill(NexusColorPalette.color(label.color))
                    .frame(width: 12, height: 12)
                Text(label.name)
                Spacer()
            }
        }
        .swipeActions(edge: .trailing) {
            if label.systemKind == nil {
                Button(role: .destructive) {
                    appState.apply(kind: .DELETE_LABEL, payload: ["id": label.id])
                } label: {
                    Label("Delete", systemImage: "trash")
                }

                Button {
                    newName = label.name
                    newColor = label.color
                    editingLabel = label
                } label: {
                    Label("Edit", systemImage: "pencil")
                }
                .tint(.blue)
            }
        }
    }
}

// MARK: - Label messages filtered view

struct LabelMessagesView: View {
    @EnvironmentObject var appState: AppState
    let label: NexusLabel
    @State private var messages: [NexusMessage] = []

    var body: some View {
        Group {
            if messages.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "tag")
                        .font(.system(size: 48))
                        .foregroundColor(.secondary)
                    Text("No messages with this label")
                        .font(.headline)
                }
            } else {
                List(messages, id: \.id) { message in
                    NavigationLink(destination: MessageDetailView(message: message)) {
                        MessageRowView(message: message)
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle(label.name)
        .onAppear { loadMessages() }
    }

    private func loadMessages() {
        guard let db = appState.db else { return }
        messages = (try? db.fetchMessagesByLabel(labelId: label.id, vaultId: appState.vaultId)) ?? []
    }
}

// MARK: - Label edit sheet

struct LabelEditSheet: View {
    let title: String
    @Binding var name: String
    @Binding var colorIndex: Int
    let onSave: () -> Void
    let onCancel: () -> Void

    private let colorOptions: [(Int, Color, String)] = [
        (2, .blue, "Blue"), (3, .red, "Red"), (4, .green, "Green"),
        (5, .orange, "Orange"), (6, .purple, "Purple"), (7, .pink, "Pink"),
        (8, .yellow, "Yellow"), (9, .teal, "Teal"), (10, .indigo, "Indigo")
    ]

    var body: some View {
        NavigationView {
            Form {
                Section("Name") {
                    TextField("Label name", text: $name)
                }
                Section("Color") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 5), spacing: 12) {
                        ForEach(colorOptions, id: \.0) { (idx, color, _) in
                            Circle()
                                .fill(color)
                                .frame(width: 32, height: 32)
                                .overlay(
                                    Circle().stroke(Color.primary, lineWidth: colorIndex == idx ? 3 : 0)
                                )
                                .onTapGesture { colorIndex = idx }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save", action: onSave).disabled(name.isEmpty)
                }
            }
        }
        .navigationViewStyle(.stack)
    }
}
