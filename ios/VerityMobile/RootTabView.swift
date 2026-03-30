import SwiftUI

struct RootTabView: View {
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var appState: MobileAppState
    @State private var selectedSection: RootSection = .chats

    var body: some View {
        Group {
            switch selectedSection {
            case .chats:
                NavigationStack {
                    SlotGridView(selectedSection: $selectedSection)
                }
            case .merge:
                standaloneSection(section: .merge) {
                    MergeView()
                }
            case .settings:
                standaloneSection(section: .settings) {
                    SettingsView()
                }
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                appState.handleAppDidBecomeActive()
            }
        }
    }

    private func standaloneSection<Content: View>(
        section: RootSection,
        @ViewBuilder content: () -> Content
    ) -> some View {
        ZStack(alignment: .bottom) {
            content()
                .safeAreaInset(edge: .bottom) {
                    Color.clear.frame(height: 60)
                }

            compactSectionSwitcher(activeSection: section)
        }
    }

    private func compactSectionSwitcher(activeSection: RootSection) -> some View {
        HStack(spacing: 8) {
            ForEach(RootSection.primarySections) { section in
                Button {
                    selectedSection = section
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: section.icon)
                            .font(.system(size: 14, weight: .semibold))
                        Text(section.title)
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundStyle(
                        activeSection == section
                        ? AppTheme.textPrimary
                        : AppTheme.textSecondary
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(activeSection == section ? AppTheme.panelStrong : Color.clear)
                    )
                }
                .buttonStyle(.plain)
            }

            Button {
                selectedSection = .settings
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(activeSection == .settings ? AppTheme.textPrimary : AppTheme.textSecondary)
                    .frame(width: 34, height: 34)
                    .background(
                        Circle()
                            .fill(activeSection == .settings ? AppTheme.panelStrong : Color.clear)
                    )
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(
            Capsule(style: .continuous)
                .fill(Color(red: 0.08, green: 0.09, blue: 0.11).opacity(0.96))
        )
        .overlay(
            Capsule(style: .continuous)
                .stroke(Color.white.opacity(0.07), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.32), radius: 18, x: 0, y: 10)
        .padding(.horizontal, 92)
        .padding(.bottom, 8)
    }
}
