import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var appState: MobileAppState

    var body: some View {
        NavigationStack {
            List {
                Section("Status") {
                    Text(appState.statusMessage)
                }

                Section("Shared Assets") {
                    Text("sendMessage.js: \(SharedScriptLoader.loadScript(named: "sendMessage.js").isEmpty ? "missing" : "loaded")")
                    Text("attachFile.js: \(SharedScriptLoader.loadScript(named: "attachFile.js").isEmpty ? "missing" : "loaded")")
                }
            }
            .navigationTitle("Settings")
        }
    }
}
