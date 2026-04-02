import SwiftUI

struct RootTabView: View {
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var appState: MobileAppState
    @State private var selectedSection: RootSection = .chats

    var body: some View {
        Group {
            if selectedSection == .settings {
                SettingsView {
                    selectedSection = .chats
                }
                .transition(.opacity)
            } else {
                TabView(selection: primarySelectionBinding) {
                    NavigationStack {
                        SlotGridView(selectedSection: $selectedSection)
                    }
                    .tag(RootSection.chats)

                    MergeView()
                        .tag(RootSection.merge)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .indexViewStyle(.page(backgroundDisplayMode: .never))
                .transition(.opacity)
            }
        }
        .shellBackground()
        .animation(.spring(response: 0.32, dampingFraction: 0.9), value: selectedSection)
        .task {
            await appState.loadProjectTreeIfNeeded()
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                appState.handleAppDidBecomeActive()
            }
        }
    }

    private var primarySelectionBinding: Binding<RootSection> {
        Binding(
            get: { selectedSection == .merge ? .merge : .chats },
            set: { newValue in
                selectedSection = newValue
            }
        )
    }
}
