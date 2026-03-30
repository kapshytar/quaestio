import SwiftUI
import UIKit
import WebKit

private struct MergeConvergeIcon: View {
    var body: some View {
        ZStack {
            Path { path in
                path.move(to: CGPoint(x: 4.5, y: 5))
                path.addQuadCurve(to: CGPoint(x: 10, y: 11), control: CGPoint(x: 8.2, y: 6.2))
            }
            .stroke(style: StrokeStyle(lineWidth: 1.55, lineCap: .round, lineJoin: .round))

            Path { path in
                path.move(to: CGPoint(x: 15.5, y: 5))
                path.addQuadCurve(to: CGPoint(x: 10, y: 11), control: CGPoint(x: 11.8, y: 6.2))
            }
            .stroke(style: StrokeStyle(lineWidth: 1.55, lineCap: .round, lineJoin: .round))

            Path { path in
                path.move(to: CGPoint(x: 10, y: 10.5))
                path.addLine(to: CGPoint(x: 10, y: 15))
                path.move(to: CGPoint(x: 8, y: 13))
                path.addLine(to: CGPoint(x: 10, y: 15))
                path.addLine(to: CGPoint(x: 12, y: 13))
            }
            .stroke(style: StrokeStyle(lineWidth: 1.55, lineCap: .round, lineJoin: .round))
        }
        .frame(width: 18, height: 18)
    }
}

struct SlotGridView: View {
    @EnvironmentObject private var appState: MobileAppState
    @Binding var selectedSection: RootSection
    @State private var showsSlotControlStrip = false
    @State private var slotAddressDraft = ""
    @StateObject private var systemAuth = SystemAuthCoordinator()

    private var selectedSlot: SlotState? {
        appState.slots.first { $0.id == appState.selectedSlotId } ?? appState.slots.first
    }

    var body: some View {
        VStack(spacing: 0) {
            slotTabBar
                .padding(.horizontal, 10)
                .padding(.top, 6)
                .padding(.bottom, 4)

            ZStack(alignment: .top) {
                if let slot = selectedSlot {
                    let model = appState.webModel(for: slot.id)

                    WebViewSlot(slot: slot, model: model)
                    .id(slot.id)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(AppTheme.border, lineWidth: 1)
                    )
                    .shadow(color: Color.black.opacity(0.16), radius: 10, x: 0, y: 6)

                    if let popupWebView = model.popupWebView {
                        popupOverlay(webView: popupWebView) {
                            model.closePopup()
                        }
                        .padding(.horizontal, 22)
                        .padding(.top, 18)
                        .padding(.bottom, 18)
                        .zIndex(30)
                        .transition(.opacity.combined(with: .scale(scale: 0.98, anchor: .top)))
                    }
                } else {
                    ContentUnavailableView("No Slots", systemImage: "square.slash")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }

                if showsSlotControlStrip, let slot = selectedSlot {
                    slotControlStrip(for: slot)
                        .padding(.horizontal, 18)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .zIndex(20)
                }
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 4)

            bottomPanel
                .padding(.horizontal, 10)
                .padding(.top, 4)
                .padding(.bottom, 8)
        }
        .shellBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .animation(.spring(response: 0.28, dampingFraction: 0.88), value: showsSlotControlStrip)
        .onAppear {
            syncSlotAddressDraft()
        }
        .onChange(of: appState.selectedSlotId) { _, _ in
            showsSlotControlStrip = false
            syncSlotAddressDraft()
        }
        .onChange(of: appState.slots) { _, _ in
            syncSlotAddressDraft()
        }
    }

    private var slotTabBar: some View {
        HStack(alignment: .bottom, spacing: 4) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: -6) {
                    ForEach(appState.slots) { slot in
                        Button {
                            if appState.selectedSlotId == slot.id {
                                syncSlotAddressDraft()
                                showsSlotControlStrip.toggle()
                            } else {
                                appState.selectedSlotId = slot.id
                            }
                        } label: {
                            HStack(spacing: 8) {
                                Circle()
                                    .fill(tabAccent(for: slot))
                                    .frame(width: 6, height: 6)

                                Text(slot.title)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(appState.selectedSlotId == slot.id ? AppTheme.textPrimary : AppTheme.textSecondary)
                                    .lineLimit(1)
                            }
                            .padding(.horizontal, 15)
                            .padding(.top, 9)
                            .padding(.bottom, 8)
                            .background(
                                UnevenRoundedRectangle(
                                    topLeadingRadius: 15,
                                    bottomLeadingRadius: 0,
                                    bottomTrailingRadius: 0,
                                    topTrailingRadius: 15,
                                    style: .continuous
                                )
                                    .fill(
                                        appState.selectedSlotId == slot.id
                                        ? Color(red: 0.16, green: 0.17, blue: 0.20)
                                        : Color(red: 0.09, green: 0.10, blue: 0.12)
                                    )
                            )
                            .overlay(
                                UnevenRoundedRectangle(
                                    topLeadingRadius: 15,
                                    bottomLeadingRadius: 0,
                                    bottomTrailingRadius: 0,
                                    topTrailingRadius: 15,
                                    style: .continuous
                                )
                                    .stroke(
                                        appState.selectedSlotId == slot.id
                                        ? AppTheme.borderStrong
                                        : Color.white.opacity(0.06),
                                        lineWidth: 1
                                    )
                            )
                            .shadow(
                                color: appState.selectedSlotId == slot.id ? Color.black.opacity(0.18) : .clear,
                                radius: 10,
                                x: 0,
                                y: -1
                            )
                        }
                        .zIndex(appState.selectedSlotId == slot.id ? 100 : Double(99 - slot.id))
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 6)
            }

            HStack(spacing: 4) {
                utilityButton(kind: .merge) {
                    selectedSection = .merge
                }

                utilityButton(kind: .settings) {
                    selectedSection = .settings
                }
            }
            .padding(.bottom, 1)
        }
    }

    private func slotControlStrip(for slot: SlotState) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Menu {
                    ForEach(Array(appState.presets.values).sorted(by: { $0.name < $1.name })) { preset in
                        Button(preset.name) {
                            appState.updateSelectedSlotService(to: preset.id)
                            syncSlotAddressDraft()
                            showsSlotControlStrip = false
                        }
                    }
                } label: {
                    stripPillLabel(
                        systemName: "square.grid.2x2",
                        text: slot.title
                    )
                }

                Menu {
                    Button("System Auth") {
                        openSystemAuth(for: slot)
                    }

                    Button("Open in Safari") {
                        openSafari(for: slot)
                    }
                }
                label: {
                    stripPillLabel(
                        systemName: "safari",
                        text: "Auth"
                    )
                }

                Button {
                    appState.stopSelectedSlotLoading()
                    showsSlotControlStrip = false
                } label: {
                    stripIconButton(systemName: "xmark")
                }
                .buttonStyle(.plain)

                Button {
                    appState.reloadSelectedSlot()
                    showsSlotControlStrip = false
                } label: {
                    stripIconButton(systemName: "arrow.clockwise")
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "link")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(AppTheme.textMuted)

                    TextField("Paste URL or provider", text: $slotAddressDraft)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(AppTheme.textPrimary)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .onSubmit {
                            appState.navigateSelectedSlot(to: slotAddressDraft)
                            syncSlotAddressDraft()
                            showsSlotControlStrip = false
                        }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color.white.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                Button {
                    appState.navigateSelectedSlot(to: slotAddressDraft)
                    syncSlotAddressDraft()
                    showsSlotControlStrip = false
                } label: {
                    Text("Go")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(AppTheme.actionText)
                        .frame(width: 44, height: 40)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(AppTheme.actionFill)
                        )
                }
                .buttonStyle(.plain)
            }

            if systemAuth.status != "idle" {
                Text(systemAuth.status)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(AppTheme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .lineLimit(2)
            }
        }
        .padding(12)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.white.opacity(0.14), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.22), radius: 18, x: 0, y: 10)
    }

    private var bottomPanel: some View {
        VStack(spacing: 8) {
            slotToggleRow
            composerBar
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(red: 0.09, green: 0.10, blue: 0.12))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.white.opacity(0.06), lineWidth: 1)
        )
        .padding(.bottom, 4)
    }

    private var slotToggleRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(appState.slots) { slot in
                    Button {
                        toggleSlotEnabled(slot.id)
                    } label: {
                        Text("S\(slot.id)")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(slot.isEnabled ? AppTheme.textPrimary : AppTheme.textSecondary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(
                                Capsule(style: .continuous)
                                    .fill(slot.isEnabled ? tabAccent(for: slot).opacity(0.2) : Color.white.opacity(0.04))
                            )
                            .overlay(
                                Capsule(style: .continuous)
                                    .stroke(slot.isEnabled ? tabAccent(for: slot).opacity(0.6) : Color.white.opacity(0.06), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 2)
        }
    }

    private var composerBar: some View {
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(AppTheme.textMuted)

                TextField("Send to active chats", text: $appState.composerText)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(AppTheme.textPrimary)
                    .textInputAutocapitalization(.sentences)
                    .disableAutocorrection(false)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(red: 0.10, green: 0.11, blue: 0.13))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color.white.opacity(0.06), lineWidth: 1)
            )

            Button {
                Task {
                    await appState.sendComposerToActiveSlots()
                }
            } label: {
                Image(systemName: appState.isSendingComposer ? "hourglass" : "paperplane.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(AppTheme.actionText)
                    .frame(width: 42, height: 42)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(AppTheme.actionFill)
                    )
            }
            .buttonStyle(.plain)
            .disabled(appState.isSendingComposer || appState.composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .opacity(appState.isSendingComposer || appState.composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.55 : 1)
        }
    }

    private func toggleSlotEnabled(_ slotId: Int) {
        guard let index = appState.slots.firstIndex(where: { $0.id == slotId }) else { return }
        appState.slots[index].isEnabled.toggle()
    }

    private func tabAccent(for slot: SlotState) -> Color {
        switch slot.serviceId {
        case "chatgpt":
            return Color(red: 0.29, green: 0.83, blue: 0.63)
        case "claude":
            return Color(red: 0.96, green: 0.65, blue: 0.37)
        case "gemini":
            return Color(red: 0.44, green: 0.67, blue: 1.0)
        case "grok":
            return Color(red: 0.9, green: 0.46, blue: 0.92)
        default:
            return Color.white.opacity(0.7)
        }
    }

    private enum UtilityKind {
        case merge
        case settings
    }

    private func utilityButton(kind: UtilityKind, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color(red: 0.09, green: 0.10, blue: 0.12))
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.white.opacity(0.06), lineWidth: 1)

                switch kind {
                case .merge:
                    MergeConvergeIcon()
                        .foregroundStyle(AppTheme.textSecondary)
                case .settings:
                    Image(systemName: "ellipsis")
                        .rotationEffect(.degrees(90))
                        .font(.system(size: 11.5, weight: .bold))
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }
            .frame(width: 26, height: 26)
        }
        .buttonStyle(.plain)
    }

    private func stripPillLabel(systemName: String, text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: systemName)
                .font(.system(size: 11.5, weight: .bold))
            Text(text)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
        }
        .foregroundStyle(AppTheme.textPrimary)
        .padding(.horizontal, 12)
        .frame(height: 34)
        .background(Color.white.opacity(0.06))
        .clipShape(Capsule(style: .continuous))
    }

    private func stripIconButton(systemName: String) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(AppTheme.textPrimary)
            .frame(width: 34, height: 34)
            .background(Color.white.opacity(0.06))
            .clipShape(Circle())
    }

    private func popupOverlay(webView: WKWebView, onClose: @escaping () -> Void) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "globe")
                        .font(.system(size: 11, weight: .bold))
                    Text("Sign-In Window")
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                }
                .foregroundStyle(AppTheme.textPrimary)

                Spacer(minLength: 0)

                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(AppTheme.textPrimary)
                        .frame(width: 28, height: 28)
                        .background(Color.white.opacity(0.08))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Color.black.opacity(0.18))

            HostedWebView(webView: webView)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.white)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.white.opacity(0.16), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.28), radius: 24, x: 0, y: 16)
    }

    private func syncSlotAddressDraft() {
        slotAddressDraft = selectedSlot?.url ?? ""
    }

    private func openSystemAuth(for slot: SlotState) {
        let candidate = appState.webModel(for: slot.id).currentLocationHref
        let rawURL = candidate.isEmpty ? slot.url : candidate
        guard let url = URL(string: rawURL) else { return }
        systemAuth.start(url: url)
        showsSlotControlStrip = false
    }

    private func openSafari(for slot: SlotState) {
        let candidate = appState.webModel(for: slot.id).currentLocationHref
        let rawURL = candidate.isEmpty ? slot.url : candidate
        guard let url = URL(string: rawURL) else { return }
        UIApplication.shared.open(url)
        showsSlotControlStrip = false
    }
}
