import SwiftUI

struct RulesView: View {
    @EnvironmentObject var appState: AppState
    @State private var showCreate = false
    @State private var editingRule: NexusRule? = nil

    var body: some View {
        List {
            if appState.rules.isEmpty {
                Section {
                    VStack(spacing: 8) {
                        Image(systemName: "list.bullet.rectangle")
                            .font(.system(size: 36))
                            .foregroundColor(.secondary)
                        Text("No rules yet")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                }
                .listRowBackground(Color.clear)
            } else {
                ForEach(appState.rules, id: \.id) { rule in
                    ruleRow(rule)
                }
                .onDelete { offsets in
                    for index in offsets {
                        let rule = appState.rules[index]
                        appState.apply(kind: .DELETE_RULE, payload: ["id": rule.id])
                    }
                }
            }
        }
        .navigationTitle("Rules")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    editingRule = nil
                    showCreate = true
                } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showCreate) {
            RuleEditSheet(rule: nil)
                .environmentObject(appState)
        }
        .sheet(item: $editingRule) { rule in
            RuleEditSheet(rule: rule)
                .environmentObject(appState)
        }
    }

    private func ruleRow(_ rule: NexusRule) -> some View {
        Button {
            editingRule = rule
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(rule.enabled ? Color.green : Color.secondary)
                            .frame(width: 8, height: 8)
                        Text(rule.name)
                            .font(.subheadline.weight(.medium))
                            .foregroundColor(.primary)
                    }
                    Text(ruleDescription(rule))
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .swipeActions(edge: .leading) {
            Button {
                appState.apply(kind: .UPDATE_RULE, payload: [
                    "rule": ["id": rule.id, "name": rule.name,
                             "conditions": [], "actions": [],
                             "conditionLogic": rule.conditionLogic,
                             "enabled": !rule.enabled, "position": rule.position]
                ])
            } label: {
                Label(rule.enabled ? "Disable" : "Enable",
                      systemImage: rule.enabled ? "pause.circle" : "play.circle")
            }
            .tint(rule.enabled ? .orange : .green)
        }
    }

    private func ruleDescription(_ rule: NexusRule) -> String {
        let conditions = (try? JSONSerialization.jsonObject(with: rule.conditionsJson.data(using: .utf8) ?? Data())) as? [[String: Any]] ?? []
        let actions = (try? JSONSerialization.jsonObject(with: rule.actionsJson.data(using: .utf8) ?? Data())) as? [[String: Any]] ?? []
        let cStr = conditions.count == 1 ? "1 condition" : "\(conditions.count) conditions"
        let aStr = actions.count == 1 ? "1 action" : "\(actions.count) actions"
        return "\(cStr) · \(aStr)"
    }
}

// MARK: - Rule Edit Sheet

struct RuleEditSheet: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss

    let rule: NexusRule?
    @State private var name = ""
    @State private var enabled = true
    @State private var conditionLogic = "AND"
    @State private var conditions: [[String: String]] = [["field": "subject", "op": "contains", "value": ""]]
    @State private var actions: [[String: String]] = [["type": "add_label", "labelId": ""]]

    private let conditionFields = ["subject", "from", "to", "snippet"]
    private let conditionOps = ["contains", "not_contains", "equals", "starts_with"]
    private let actionTypes = ["add_label", "remove_label", "move_to_folder", "mark_read", "star", "trash", "archive"]

    var body: some View {
        NavigationView {
            Form {
                Section("Rule Name") {
                    TextField("Name", text: $name)
                    Toggle("Enabled", isOn: $enabled)
                }

                Section("Conditions") {
                    Picker("Logic", selection: $conditionLogic) {
                        Text("All (AND)").tag("AND")
                        Text("Any (OR)").tag("OR")
                    }
                    .pickerStyle(.segmented)

                    ForEach(conditions.indices, id: \.self) { i in
                        conditionRow(index: i)
                    }
                    Button {
                        conditions.append(["field": "subject", "op": "contains", "value": ""])
                    } label: {
                        Label("Add Condition", systemImage: "plus.circle")
                    }
                }

                Section("Actions") {
                    ForEach(actions.indices, id: \.self) { i in
                        actionRow(index: i)
                    }
                    Button {
                        actions.append(["type": "mark_read"])
                    } label: {
                        Label("Add Action", systemImage: "plus.circle")
                    }
                }
            }
            .navigationTitle(rule == nil ? "New Rule" : "Edit Rule")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") { save() }.disabled(name.isEmpty)
                }
            }
            .onAppear { prefill() }
        }
        .navigationViewStyle(.stack)
    }

    @ViewBuilder
    private func conditionRow(index: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Picker("Field", selection: Binding(
                    get: { conditions[index]["field"] ?? "subject" },
                    set: { conditions[index]["field"] = $0 }
                )) {
                    ForEach(conditionFields, id: \.self) { Text($0.capitalized).tag($0) }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity)

                Picker("Op", selection: Binding(
                    get: { conditions[index]["op"] ?? "contains" },
                    set: { conditions[index]["op"] = $0 }
                )) {
                    ForEach(conditionOps, id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ")).tag($0) }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity)

                if conditions.count > 1 {
                    Button(role: .destructive) {
                        conditions.remove(at: index)
                    } label: {
                        Image(systemName: "minus.circle.fill")
                            .foregroundColor(.red)
                    }
                    .buttonStyle(.plain)
                }
            }
            TextField("Value", text: Binding(
                get: { conditions[index]["value"] ?? "" },
                set: { conditions[index]["value"] = $0 }
            ))
            .textFieldStyle(.roundedBorder)
        }
    }

    @ViewBuilder
    private func actionRow(index: Int) -> some View {
        HStack {
            Picker("Action", selection: Binding(
                get: { actions[index]["type"] ?? "mark_read" },
                set: { actions[index]["type"] = $0 }
            )) {
                ForEach(actionTypes, id: \.self) { t in
                    Text(t.replacingOccurrences(of: "_", with: " ").capitalized).tag(t)
                }
            }
            .pickerStyle(.menu)
            .frame(maxWidth: .infinity)

            if actions.count > 1 {
                Button(role: .destructive) {
                    actions.remove(at: index)
                } label: {
                    Image(systemName: "minus.circle.fill").foregroundColor(.red)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func prefill() {
        guard let rule else { return }
        name = rule.name
        enabled = rule.enabled
        conditionLogic = rule.conditionLogic
        if let c = try? JSONSerialization.jsonObject(with: rule.conditionsJson.data(using: .utf8) ?? Data()) as? [[String: String]], !c.isEmpty {
            conditions = c
        }
        if let a = try? JSONSerialization.jsonObject(with: rule.actionsJson.data(using: .utf8) ?? Data()) as? [[String: String]], !a.isEmpty {
            actions = a
        }
    }

    private func save() {
        let id = rule?.id ?? "rule-\(UUID().uuidString.prefix(8))"
        let condData = (try? JSONSerialization.data(withJSONObject: conditions)) ?? Data()
        let actData = (try? JSONSerialization.data(withJSONObject: actions)) ?? Data()
        let ruleDict: [String: Any] = [
            "id": id,
            "name": name,
            "conditions": (try? JSONSerialization.jsonObject(with: condData)) ?? [],
            "actions": (try? JSONSerialization.jsonObject(with: actData)) ?? [],
            "conditionLogic": conditionLogic,
            "enabled": enabled,
            "position": rule?.position ?? appState.rules.count
        ]
        appState.apply(kind: rule == nil ? .CREATE_RULE : .UPDATE_RULE, payload: ["rule": ruleDict])
        dismiss()
    }
}
