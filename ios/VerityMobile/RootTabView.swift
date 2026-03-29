import SwiftUI

struct RootTabView: View {
    var body: some View {
        TabView {
            NavigationStack {
                SlotGridView()
            }
            .tabItem {
                Label("Chats", systemImage: "square.grid.2x2")
            }

            MergeView()
                .tabItem {
                    Label("Merge", systemImage: "wand.and.stars")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
        }
    }
}
