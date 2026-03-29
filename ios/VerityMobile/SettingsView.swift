import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var appState: MobileAppState

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: AppTheme.blockSpacing) {
                    ScreenHeader(
                        eyebrow: "Settings",
                        title: "Shell diagnostics",
                        subtitle: "Keep the shared mobile layer visible and easy to verify while we build parity."
                    )

                    settingsCard(title: "Status") {
                        statusRow(label: "Runtime", value: appState.statusMessage)
                    }

                    settingsCard(title: "Shared Assets") {
                        statusRow(
                            label: "sendMessage.js",
                            value: SharedScriptLoader.loadScript(named: "sendMessage.js").isEmpty ? "missing" : "loaded"
                        )
                        statusRow(
                            label: "attachFile.js",
                            value: SharedScriptLoader.loadScript(named: "attachFile.js").isEmpty ? "missing" : "loaded"
                        )
                        statusRow(
                            label: "scrapeReply.js",
                            value: SharedScriptLoader.loadScript(named: "scrapeReply.js").isEmpty ? "missing" : "loaded"
                        )
                    }
                }
                .padding(.horizontal, AppTheme.pagePadding)
                .padding(.top, AppTheme.pagePadding)
                .padding(.bottom, 28)
            }
            .shellBackground()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private func settingsCard<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionLabel(text: title)

            content()
        }
        .glassCard()
    }

    private func statusRow(label: String, value: String) -> some View {
        let indicatorColor: Color = {
            switch value.lowercased() {
            case "loaded":
                return .green.opacity(0.9)
            case "missing":
                return .orange.opacity(0.9)
            default:
                return .blue.opacity(0.9)
            }
        }()

        return HStack {
            Text(label)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(AppTheme.textSecondary)
            Spacer()
            HStack(spacing: 8) {
                Circle()
                    .fill(indicatorColor)
                    .frame(width: 7, height: 7)

                Text(value)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
            }
        }
    }
}
