import SwiftUI

enum AppTheme {
    static let backgroundTop = Color.black
    static let backgroundBottom = Color.black
    static let panel = Color.white.opacity(0.06)
    static let panelStrong = Color.white.opacity(0.1)
    static let border = Color.white.opacity(0.08)
    static let borderStrong = Color.white.opacity(0.14)
    static let textPrimary = Color.white.opacity(0.94)
    static let textSecondary = Color.white.opacity(0.64)
    static let textMuted = Color.white.opacity(0.54)
    static let actionFill = Color(red: 0.83, green: 0.88, blue: 0.94)
    static let actionText = Color.black.opacity(0.84)

    static let pagePadding: CGFloat = 16
    static let blockSpacing: CGFloat = 18
    static let cardRadius: CGFloat = 22
    static let compactRadius: CGFloat = 18
    static let chromeBand = Color.black.opacity(0.14)
    static let chromePanel = Color.black.opacity(0.20)
}

enum RootSection: String, CaseIterable, Identifiable {
    case chats
    case merge
    case settings

    var id: String { rawValue }

    static var primarySections: [RootSection] {
        [.chats, .merge]
    }

    var title: String {
        switch self {
        case .chats: return "Chats"
        case .merge: return "Merge"
        case .settings: return "Settings"
        }
    }

    var icon: String {
        switch self {
        case .chats: return "bubble.left.and.bubble.right"
        case .merge: return "square.on.square.intersection.dashed"
        case .settings: return "slider.horizontal.3"
        }
    }
}

struct ShellBackground: ViewModifier {
    func body(content: Content) -> some View {
        content.background(
            LinearGradient(
                colors: [AppTheme.backgroundTop, AppTheme.backgroundBottom],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
        )
    }
}

extension View {
    func shellBackground() -> some View {
        modifier(ShellBackground())
    }

    func utilityCircleChrome(showsShadow: Bool = true) -> some View {
        self
            .frame(width: 30, height: 30)
            .background(
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.10),
                                Color(red: 0.10, green: 0.11, blue: 0.13).opacity(0.96),
                                Color.black.opacity(0.86)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            )
            .overlay(
                Circle()
                    .stroke(Color.white.opacity(0.09), lineWidth: 1)
            )
            .overlay(
                Circle()
                    .stroke(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.18),
                                Color.white.opacity(0.02)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 0.8
                    )
                    .padding(0.5)
            )
            .shadow(
                color: showsShadow ? Color.black.opacity(0.18) : .clear,
                radius: showsShadow ? 10 : 0,
                x: 0,
                y: showsShadow ? 4 : 0
            )
    }

    func glassCard(padding: CGFloat = 16, radius: CGFloat = AppTheme.cardRadius) -> some View {
        self
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(AppTheme.panel)
            )
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )
    }
}

struct ScreenHeader: View {
    let eyebrow: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(eyebrow.uppercased())
                .font(.system(size: 11, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(AppTheme.textMuted)

            Text(title)
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundStyle(AppTheme.textPrimary)

            Text(subtitle)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(AppTheme.textSecondary)
        }
    }
}

struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .bold))
            .tracking(1.1)
            .foregroundStyle(AppTheme.textMuted)
    }
}

struct PrimaryActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(AppTheme.actionText)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(
                RoundedRectangle(cornerRadius: AppTheme.compactRadius, style: .continuous)
                    .fill(AppTheme.actionFill)
                    .opacity(configuration.isPressed ? 0.86 : 1)
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct SecondaryCapsuleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(AppTheme.textPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                Capsule(style: .continuous)
                    .fill(AppTheme.panelStrong.opacity(configuration.isPressed ? 0.78 : 1))
            )
            .overlay(
                Capsule(style: .continuous)
                    .stroke(AppTheme.borderStrong, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
