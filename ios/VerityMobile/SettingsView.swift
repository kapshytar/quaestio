import SwiftUI
import UIKit

struct SettingsView: View {
    @EnvironmentObject private var appState: MobileAppState
    @State private var copiedMessage: String?
    @State private var sharePayload: SharePayload?
    @State private var showDiagnostics = false
    @State private var selectedDiagnosticsSlotId = 1
    private let onClose: (() -> Void)?

    init(onClose: (() -> Void)? = nil) {
        self.onClose = onClose
    }

    private var appVersionText: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "v\(short) (\(build))"
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .topTrailing) {
                ScrollView {
                    VStack(alignment: .leading, spacing: AppTheme.blockSpacing) {
                        ScreenHeader(
                            eyebrow: "Settings",
                            title: "Shell diagnostics",
                            subtitle: "Keep the shared mobile layer visible and easy to verify while we build parity."
                        )

                        settingsCard(title: "Status") {
                            statusRow(label: "Runtime", value: appState.statusMessage)
                            statusRow(label: "Cookie Store", value: "default")
                            statusRow(label: "Version", value: appVersionText)
                        }

                        settingsCard(title: "Display") {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    Text("Phone zoom")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(AppTheme.textSecondary)
                                    Spacer()
                                    Text("\(appState.globalPhoneZoomPercent)%")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(AppTheme.textPrimary)
                                }

                                Slider(
                                    value: Binding(
                                        get: { Double(appState.globalPhoneZoomPercent) },
                                        set: { appState.setGlobalPhoneZoomPercent(Int($0.rounded())) }
                                    ),
                                    in: 70...100,
                                    step: 5
                                )
                                .tint(AppTheme.actionFill)

                                HStack(spacing: 8) {
                                    ForEach([80, 90, 100], id: \.self) { percent in
                                        Button {
                                            appState.setGlobalPhoneZoomPercent(percent)
                                        } label: {
                                            Text("\(percent)%")
                                                .frame(maxWidth: .infinity)
                                        }
                                        .buttonStyle(SecondaryCapsuleButtonStyle())
                                    }
                                }
                            }
                        }

                        settingsCard(title: "User Agent Experiment") {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    Text("Apply to all slots")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(AppTheme.textSecondary)
                                    Spacer()
                                    Picker("All Slots UA", selection: Binding(
                                        get: { UserAgentPreset.systemDefault },
                                        set: { appState.applyUserAgentPresetToAllSlots($0) }
                                    )) {
                                        Text("Set All…").tag(UserAgentPreset.systemDefault)
                                        ForEach(UserAgentPreset.allCases) { preset in
                                            Text(preset.title).tag(preset)
                                        }
                                    }
                                    .pickerStyle(.menu)
                                }

                                ForEach(appState.slots) { slot in
                                    HStack {
                                        Text("S\(slot.id) \(slot.title)")
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(AppTheme.textPrimary)
                                        Spacer()
                                        Picker("UA \(slot.title)", selection: Binding(
                                            get: { appState.userAgentPreset(for: slot.id) },
                                            set: { appState.applyUserAgentPreset($0, to: slot.id) }
                                        )) {
                                            ForEach(UserAgentPreset.allCases) { preset in
                                                Text(preset.title).tag(preset)
                                            }
                                        }
                                        .pickerStyle(.menu)
                                    }
                                }
                            }
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

                        settingsCard(title: "Per-Slot Diagnostics") {
                            VStack(alignment: .leading, spacing: 16) {
                                DisclosureGroup(isExpanded: $showDiagnostics) {
                                    VStack(alignment: .leading, spacing: 16) {
                                        Picker("Slot", selection: $selectedDiagnosticsSlotId) {
                                            ForEach(appState.slots) { slot in
                                                Text("S\(slot.id) \(slot.title)").tag(slot.id)
                                            }
                                        }
                                        .pickerStyle(.segmented)

                                        HStack {
                                            Spacer()

                                            Button {
                                                appState.clearAllDiagnostics()
                                            } label: {
                                                Label("Clear All", systemImage: "trash")
                                            }
                                            .buttonStyle(SecondaryCapsuleButtonStyle())

                                            Button {
                                                UIPasteboard.general.string = allDiagnosticsText()
                                                copiedMessage = "Copied all diagnostics"
                                            } label: {
                                                Label("Copy All", systemImage: "doc.on.doc")
                                            }
                                            .buttonStyle(SecondaryCapsuleButtonStyle())

                                            Button {
                                                sharePayload = SharePayload(
                                                    title: "All Diagnostics",
                                                    text: allDiagnosticsText()
                                                )
                                            } label: {
                                                Label("Share All", systemImage: "square.and.arrow.up")
                                            }
                                            .buttonStyle(SecondaryCapsuleButtonStyle())
                                        }

                                        if let slot = appState.slots.first(where: { $0.id == selectedDiagnosticsSlotId }) {
                                            SlotDiagnosticsBlock(
                                                slot: slot,
                                                model: appState.webModel(for: slot.id),
                                                onClear: {
                                                    appState.webModel(for: slot.id).clearDiagnostics()
                                                },
                                                onShare: {
                                                    sharePayload = SharePayload(
                                                        title: slot.title,
                                                        text: SlotDiagnosticsBlock.exportText(
                                                            slot: slot,
                                                            model: appState.webModel(for: slot.id)
                                                        )
                                                    )
                                                }
                                            )
                                        }
                                    }
                                    .padding(.top, 8)
                                } label: {
                                    Text("Show diagnostics")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(AppTheme.textPrimary)
                                }
                                .tint(AppTheme.textPrimary)
                            }
                        }
                    }
                }
                .padding(.horizontal, AppTheme.pagePadding)
                .padding(.top, AppTheme.pagePadding)
                .padding(.bottom, 28)

                if let onClose {
                    Button {
                        onClose()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(AppTheme.textPrimary)
                            .utilityCircleChrome(showsShadow: false)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 6)
                    .padding(.trailing, 10)
                }
            }
        }
        .shellBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .alert("Diagnostics Copied", isPresented: Binding(
            get: { copiedMessage != nil },
            set: { if !$0 { copiedMessage = nil } }
        )) {
            Button("OK", role: .cancel) {
                copiedMessage = nil
            }
        } message: {
            Text(copiedMessage ?? "")
        }
        .sheet(item: $sharePayload) { payload in
            ShareSheet(items: [payload.text], subject: payload.title)
        }
        .onAppear {
            if appState.slots.contains(where: { $0.id == selectedDiagnosticsSlotId }) == false {
                selectedDiagnosticsSlotId = appState.slots.first?.id ?? 1
            }
        }
    }

    private func allDiagnosticsText() -> String {
        appState.slots.map { slot in
            SlotDiagnosticsBlock.exportText(
                slot: slot,
                model: appState.webModel(for: slot.id)
            )
        }
        .joined(separator: "\n\n")
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

private struct SlotDiagnosticsBlock: View {
    let slot: SlotState
    @ObservedObject var model: SlotWebViewModel
    let onClear: () -> Void
    let onShare: () -> Void
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text("S\(slot.id)")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.white.opacity(0.08))
                    .clipShape(Capsule(style: .continuous))

                Text(slot.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)

                Spacer()

                Button {
                    onClear()
                } label: {
                    Label("Clear", systemImage: "trash")
                        .labelStyle(.iconOnly)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(AppTheme.textSecondary)
                        .frame(width: 28, height: 28)
                        .background(Color.white.opacity(0.06))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)

                Button {
                    UIPasteboard.general.string = Self.exportText(slot: slot, model: model)
                    copied = true
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                        .labelStyle(.iconOnly)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(AppTheme.textSecondary)
                        .frame(width: 28, height: 28)
                        .background(Color.white.opacity(0.06))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)

                Button {
                    onShare()
                } label: {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .labelStyle(.iconOnly)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(AppTheme.textSecondary)
                        .frame(width: 28, height: 28)
                        .background(Color.white.opacity(0.06))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }

            diagnosticsRow(label: "Service", value: slot.serviceId)
            diagnosticsRow(label: "State", value: model.lastNavigationState)
            diagnosticsRow(label: "Error", value: model.lastNavigationError.isEmpty ? "none" : model.lastNavigationError)
            diagnosticsRow(label: "href", value: model.currentLocationHref.isEmpty ? slot.url : model.currentLocationHref, multiline: true)
            diagnosticsRow(label: "UA", value: model.currentUserAgent.isEmpty ? "pending" : model.currentUserAgent, multiline: true)
            diagnosticsRow(label: "Cookie Host", value: model.currentCookieHost.isEmpty ? "pending" : model.currentCookieHost)
            diagnosticsRow(label: "Host Cookies", value: "\(model.currentHostCookieCount)")
            diagnosticsRow(
                label: "Cookie Names",
                value: model.currentHostCookieNames.isEmpty ? "none" : model.currentHostCookieNames.joined(separator: ", "),
                multiline: true
            )
            diagnosticsRow(label: "Scrape State", value: model.lastScrapeState)
            diagnosticsRow(label: "Scrape Error", value: model.lastScrapeError.isEmpty ? "none" : model.lastScrapeError, multiline: true)
            diagnosticsRow(label: "Scrape Title", value: model.lastScrapeDocumentTitle.isEmpty ? "none" : model.lastScrapeDocumentTitle, multiline: true)
            diagnosticsRow(label: "Prompt Candidate", value: model.lastScrapePromptCandidate.isEmpty ? "none" : model.lastScrapePromptCandidate, multiline: true)
            diagnosticsRow(label: "Scrape Preview", value: model.lastScrapePreview.isEmpty ? "none" : model.lastScrapePreview, multiline: true)
            diagnosticsRow(label: "Candidate Trace", value: model.lastScrapeCandidateTrace.isEmpty ? "none" : model.lastScrapeCandidateTrace, multiline: true)

            if !model.popupLocationHref.isEmpty || model.popupNavigationState != "idle" || !model.popupNavigationError.isEmpty {
                diagnosticsRow(label: "Popup State", value: model.popupNavigationState)
                diagnosticsRow(label: "Popup Error", value: model.popupNavigationError.isEmpty ? "none" : model.popupNavigationError)
                diagnosticsRow(label: "Popup href", value: model.popupLocationHref.isEmpty ? "none" : model.popupLocationHref, multiline: true)
            }

            if !model.debugEvents.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Events")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(AppTheme.textMuted)

                    ForEach(model.debugEvents.prefix(12)) { event in
                        diagnosticsRow(
                            label: Self.eventTimeFormatter.string(from: event.timestamp),
                            value: event.message,
                            multiline: true
                        )
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(.top, 2)
        .alert("Slot Diagnostics Copied", isPresented: $copied) {
            Button("OK", role: .cancel) {
                copied = false
            }
        } message: {
            Text("Copied \(slot.title) diagnostics")
        }
    }

    private static let eventTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

    static func exportText(slot: SlotState, model: SlotWebViewModel) -> String {
        var lines: [String] = [
            "S\(slot.id) \(slot.title)",
            "Service: \(slot.serviceId)",
            "State: \(model.lastNavigationState)",
            "Error: \(model.lastNavigationError.isEmpty ? "none" : model.lastNavigationError)",
            "href: \(model.currentLocationHref.isEmpty ? slot.url : model.currentLocationHref)",
            "UA: \(model.currentUserAgent.isEmpty ? "pending" : model.currentUserAgent)",
            "Cookie Host: \(model.currentCookieHost.isEmpty ? "pending" : model.currentCookieHost)",
            "Host Cookies: \(model.currentHostCookieCount)",
            "Cookie Names: \(model.currentHostCookieNames.isEmpty ? "none" : model.currentHostCookieNames.joined(separator: ", "))",
            "Scrape State: \(model.lastScrapeState)",
            "Scrape Error: \(model.lastScrapeError.isEmpty ? "none" : model.lastScrapeError)",
            "Scrape Title: \(model.lastScrapeDocumentTitle.isEmpty ? "none" : model.lastScrapeDocumentTitle)",
            "Prompt Candidate: \(model.lastScrapePromptCandidate.isEmpty ? "none" : model.lastScrapePromptCandidate)",
            "Scrape Preview: \(model.lastScrapePreview.isEmpty ? "none" : model.lastScrapePreview)",
            "Candidate Trace: \(model.lastScrapeCandidateTrace.isEmpty ? "none" : model.lastScrapeCandidateTrace)"
        ]

        if !model.popupLocationHref.isEmpty || model.popupNavigationState != "idle" || !model.popupNavigationError.isEmpty {
            lines.append("Popup State: \(model.popupNavigationState)")
            lines.append("Popup Error: \(model.popupNavigationError.isEmpty ? "none" : model.popupNavigationError)")
            lines.append("Popup href: \(model.popupLocationHref.isEmpty ? "none" : model.popupLocationHref)")
        }

        if !model.debugEvents.isEmpty {
            lines.append("Events:")
            lines.append(contentsOf: model.debugEvents.prefix(20).map {
                "[\(eventTimeFormatter.string(from: $0.timestamp))] \($0.message)"
            })
        }

        return lines.joined(separator: "\n")
    }

    private func diagnosticsRow(label: String, value: String, multiline: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(AppTheme.textMuted)

            Text(value)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(AppTheme.textPrimary)
                .textSelection(.enabled)
                .lineLimit(multiline ? nil : 1)
                .fixedSize(horizontal: false, vertical: multiline)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SharePayload: Identifiable {
    let id = UUID()
    let title: String
    let text: String
}

private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    let subject: String

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        controller.setValue(subject, forKey: "subject")
        return controller
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
