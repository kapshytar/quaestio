import SwiftUI

struct RootTabView: View {
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var appState: MobileAppState
    @State private var selectedSection: RootSection = .chats
    @State private var settingsButtonFrame: CGRect = .zero
    @State private var showsSettingsReveal = false
    @State private var settingsRevealScale: CGFloat = 0.08

    var body: some View {
        ZStack {
            primaryContent

            if showsSettingsReveal {
                settingsContent
                    .mask(
                        Circle()
                            .frame(width: max(settingsButtonFrame.width, 1), height: max(settingsButtonFrame.height, 1))
                            .scaleEffect(settingsRevealScale, anchor: .center)
                            .position(x: settingsButtonFrame.midX, y: settingsButtonFrame.midY)
                    )
                    .allowsHitTesting(false)
                    .transition(.identity)
            }
        }
        .coordinateSpace(name: "rootShell")
        .shellBackground()
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

    private var primaryContent: some View {
        Group {
        if selectedSection == .settings {
            settingsContent
        } else {
            chatsAndMergeContent
        }
        }
    }

    private var settingsContent: some View {
        SettingsView {
            closeSettingsWithReveal()
        }
    }

    private var chatsAndMergeContent: some View {
        TabView(selection: primarySelectionBinding) {
            NavigationStack {
                SlotGridView(
                    selectedSection: $selectedSection,
                    onSettingsLongPress: openSettingsWithReveal,
                    onSettingsFrameChange: { frame in
                        settingsButtonFrame = frame
                    }
                )
            }
            .tag(RootSection.chats)

            MergeView()
                .tag(RootSection.merge)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .indexViewStyle(.page(backgroundDisplayMode: .never))
    }

    private func openSettingsWithReveal() {
        guard settingsButtonFrame != .zero else {
            selectedSection = .settings
            return
        }

        let screen = UIScreen.main.bounds
        let maxRadius = sqrt(pow(max(settingsButtonFrame.midX, screen.width - settingsButtonFrame.midX), 2)
            + pow(max(settingsButtonFrame.midY, screen.height - settingsButtonFrame.midY), 2))
        let baseRadius = max(settingsButtonFrame.width, settingsButtonFrame.height) / 2
        let targetScale = max(1, (maxRadius * 2.1) / max(baseRadius * 2, 1))

        settingsRevealScale = 0.08
        showsSettingsReveal = true

        withAnimation(.easeInOut(duration: 0.42)) {
            settingsRevealScale = targetScale
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.42) {
            selectedSection = .settings
            showsSettingsReveal = false
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.46) {
            settingsRevealScale = 0.08
        }
    }

    private func closeSettingsWithReveal() {
        guard settingsButtonFrame != .zero else {
            selectedSection = .chats
            return
        }

        let screen = UIScreen.main.bounds
        let maxRadius = sqrt(pow(max(settingsButtonFrame.midX, screen.width - settingsButtonFrame.midX), 2)
            + pow(max(settingsButtonFrame.midY, screen.height - settingsButtonFrame.midY), 2))
        let baseRadius = max(settingsButtonFrame.width, settingsButtonFrame.height) / 2
        let expandedScale = max(1, (maxRadius * 2.1) / max(baseRadius * 2, 1))

        settingsRevealScale = expandedScale
        showsSettingsReveal = true
        selectedSection = .chats

        withAnimation(.easeInOut(duration: 0.38)) {
            settingsRevealScale = 0.08
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.38) {
            showsSettingsReveal = false
            settingsRevealScale = 0.08
        }
    }
}
