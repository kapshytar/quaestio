import SwiftUI
import UIKit
import WebKit

private struct GrowingComposerTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var measuredHeight: CGFloat

    let minHeight: CGFloat
    let maxHeight: CGFloat

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.textColor = UIColor(AppTheme.textPrimary)
        view.tintColor = UIColor(AppTheme.actionFill)
        view.font = .systemFont(ofSize: 14, weight: .medium)
        view.isScrollEnabled = false
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.autocapitalizationType = .sentences
        view.autocorrectionType = .yes
        view.returnKeyType = .default
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ uiView: UITextView, context: Context) {
        if uiView.text != text {
            uiView.text = text
        }
        recalculateHeight(for: uiView)
    }

    private func recalculateHeight(for textView: UITextView) {
        let targetWidth = textView.bounds.width > 0 ? textView.bounds.width : UIScreen.main.bounds.width
        let fittingSize = CGSize(width: targetWidth, height: .greatestFiniteMagnitude)
        let measured = textView.sizeThatFits(fittingSize).height
        let clamped = min(max(measured, minHeight), maxHeight)
        if abs(measuredHeight - clamped) > 0.5 {
            DispatchQueue.main.async {
                measuredHeight = clamped
                textView.isScrollEnabled = measured > maxHeight
            }
        } else {
            textView.isScrollEnabled = measured > maxHeight
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        private let parent: GrowingComposerTextView

        init(_ parent: GrowingComposerTextView) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            let targetWidth = textView.bounds.width > 0 ? textView.bounds.width : UIScreen.main.bounds.width
            let fittingSize = CGSize(width: targetWidth, height: .greatestFiniteMagnitude)
            let measured = textView.sizeThatFits(fittingSize).height
            let clamped = min(max(measured, parent.minHeight), parent.maxHeight)
            if abs(parent.measuredHeight - clamped) > 0.5 {
                DispatchQueue.main.async {
                    self.parent.measuredHeight = clamped
                }
            }
            textView.isScrollEnabled = measured > parent.maxHeight
        }
    }
}

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
    var onSettingsLongPress: (() -> Void)? = nil
    var onSettingsFrameChange: ((CGRect) -> Void)? = nil
    @State private var showsSlotControlStrip = false
    @State private var slotAddressDraft = ""
    @StateObject private var systemAuth = SystemAuthCoordinator()
    @State private var showsProjectSheet = false
    @State private var showsSessionSheet = false
    @State private var showsSettingsQuickMenu = false
    @State private var sessionSearchText = ""
    @State private var composerHeight: CGFloat = 22
    @State private var collapsesBottomTrayForWebInput = false
    @State private var isKeyboardVisible = false
    @State private var projectRefreshLocked = false
    @State private var sessionsRefreshLocked = false
    @State private var expandedSessionTitleIds: Set<String> = []

    private var selectedSlot: SlotState? {
        appState.slots.first { $0.id == appState.selectedSlotId } ?? appState.slots.first
    }

    private func shouldShowSessionTitleMore(_ title: String) -> Bool {
        title.count > 90 || title.filter(\.isNewline).count >= 3
    }

    private func refreshProjectsWithCooldown() {
        guard !projectRefreshLocked else { return }
        projectRefreshLocked = true
        Task {
            await appState.loadProjectTree(forceRefresh: true)
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            await MainActor.run { projectRefreshLocked = false }
        }
    }

    private func refreshSessionsWithCooldown() {
        guard !sessionsRefreshLocked else { return }
        sessionsRefreshLocked = true
        Task {
            await appState.loadSessions(forceRefresh: true)
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            await MainActor.run { sessionsRefreshLocked = false }
        }
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

                    WebViewSlot(slot: slot, model: model) {
                        collapseBottomTrayForWebInput()
                    }
                        .id(slot.id)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .opacity(model.isDisplayReady ? 1 : 0.001)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .stroke(AppTheme.border, lineWidth: 1)
                        )
                        .shadow(color: Color.black.opacity(0.16), radius: 10, x: 0, y: 6)

                    if !model.isDisplayReady {
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(AppTheme.panel)
                            .overlay(
                                ProgressView()
                                    .tint(AppTheme.textSecondary)
                            )
                            .allowsHitTesting(false)
                    }

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

            Group {
                if collapsesBottomTrayForWebInput {
                    collapsedBottomTraySwipeZone
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                } else {
                    bottomPanel
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .padding(.horizontal, collapsesBottomTrayForWebInput ? 0 : 10)
            .padding(.top, collapsesBottomTrayForWebInput ? 0 : 4)
            .padding(.bottom, collapsesBottomTrayForWebInput ? 2 : 8)
        }
        .shellBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .animation(.spring(response: 0.28, dampingFraction: 0.88), value: showsSlotControlStrip)
        .onAppear {
            syncSlotAddressDraft()
            Task {
                await appState.loadProjectTreeIfNeeded()
                await appState.loadSessionsIfNeeded()
            }
        }
        .onChange(of: appState.selectedSlotId) { _, _ in
            showsSlotControlStrip = false
            collapsesBottomTrayForWebInput = false
            syncSlotAddressDraft()
        }
        .onChange(of: appState.slots) { _, _ in
            syncSlotAddressDraft()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            isKeyboardVisible = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            isKeyboardVisible = false
            collapsesBottomTrayForWebInput = false
        }
        .sheet(isPresented: $showsProjectSheet) {
            projectSheet
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showsSessionSheet) {
            sessionSheet
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
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
                                    .fill(slot.isEnabled ? tabAccent(for: slot) : AppTheme.textMuted.opacity(0.75))
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
                    showsSettingsQuickMenu = true
                }
                onLongPress: {
                    onSettingsLongPress?()
                }
                onFrameChange: { frame in
                    onSettingsFrameChange?(frame)
                }
            }
            .padding(.bottom, 1)
        }
    }

    private var projectButton: some View {
        Button {
            showsProjectSheet = true
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "folder")
                    .font(.system(size: 12, weight: .bold))
                Text(appState.activeProjectDisplayName())
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 10, weight: .bold))
            }
            .foregroundStyle(appState.activeProjectId == nil ? AppTheme.textSecondary : AppTheme.actionFill)
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(appState.activeProjectId == nil ? Color.white.opacity(0.05) : AppTheme.panelStrong)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var sessionButton: some View {
        Button {
            showsSessionSheet = true
        } label: {
            HStack(spacing: 3) {
                Circle()
                    .fill(appState.sessionIndicatorText == nil ? Color.red.opacity(0.9) : Color.green.opacity(0.9))
                    .frame(width: 6, height: 6)

                Text(appState.sessionIndicatorText ?? "Sessions")
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .lineLimit(1)
                    .foregroundStyle(appState.sessionIndicatorText == nil ? AppTheme.textSecondary : AppTheme.textPrimary)
                    .truncationMode(.tail)

                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(AppTheme.textMuted)
            }
            .padding(.horizontal, 10)
            .frame(height: 34)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(Color.white.opacity(0.04))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var projectSheet: some View {
        NavigationStack {
            List {
                Section("Current") {
                    Button("No Project") {
                        appState.setActiveProject(nil)
                        showsProjectSheet = false
                    }
                }

                Section("Projects") {
                    if appState.projectTreeNodes.isEmpty {
                        Button("Load Projects") {
                            refreshProjectsWithCooldown()
                        }
                        .disabled(projectRefreshLocked)
                    } else {
                        ForEach(flattenProjects(appState.projectTreeNodes)) { node in
                            Button {
                                appState.setActiveProject(node.project)
                                showsProjectSheet = false
                            } label: {
                                HStack {
                                    Text(String(repeating: "  ", count: node.depth) + node.name)
                                    Spacer()
                                    if appState.activeProjectId == node.project.id && appState.activeProjectPathKey == node.project.pathKey {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Projects")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        refreshProjectsWithCooldown()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(projectRefreshLocked)
                    .accessibilityLabel("Refresh projects")
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { showsProjectSheet = false }
                }
            }
            .task {
                await appState.loadProjectTreeIfNeeded()
            }
        }
    }

    private var filteredSessions: [SessionSnapshot] {
        appState.sessionsForDisplay(matching: sessionSearchText)
    }

    private var sessionSheet: some View {
        NavigationStack {
            List {
                Section("Current") {
                    LabeledContent("Active Session", value: appState.sessionIndicatorText ?? "No session")
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))

                    Button("Clear Active Session", role: .destructive) {
                        appState.clearActiveSessionSelection()
                        showsSessionSheet = false
                    }
                }

                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.textMuted)

                        TextField("Search by session id or title", text: $sessionSearchText)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .foregroundStyle(AppTheme.textPrimary)
                    }
                    .padding(.vertical, 4)
                }

                Section("Saved Sessions") {
                    if appState.isLoadingSessions {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Loading sessions…")
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    } else if appState.availableSessions.isEmpty {
                        Button("Load Sessions") {
                            refreshSessionsWithCooldown()
                        }
                        .disabled(sessionsRefreshLocked)
                    } else if filteredSessions.isEmpty {
                        ContentUnavailableView(
                            "No Matching Sessions",
                            systemImage: "magnifyingglass",
                            description: Text("Try a different session id or title.")
                        )
                        .foregroundStyle(AppTheme.textSecondary)
                    } else {
                        ForEach(filteredSessions) { session in
                            let sessionTitle = appState.displaySessionName(session)
                            let isExpanded = expandedSessionTitleIds.contains(session.id)
                            VStack(alignment: .leading, spacing: 6) {
                                Button {
                                    appState.loadSession(session)
                                    showsSessionSheet = false
                                } label: {
                                    VStack(alignment: .leading, spacing: 6) {
                                        HStack(alignment: .top, spacing: 8) {
                                            Text(session.sessionId.map { "S\($0)" } ?? "S-")
                                                .font(.system(size: 12, weight: .bold, design: .monospaced))
                                                .foregroundStyle(AppTheme.actionFill)
                                            Text(sessionTitle)
                                                .font(.system(size: 14, weight: .semibold))
                                                .foregroundStyle(AppTheme.textPrimary)
                                                .multilineTextAlignment(.leading)
                                                .lineLimit(isExpanded ? nil : 3)
                                                .truncationMode(.tail)
                                        }

                                        Text(formattedSessionTimestamp(session.timestamp))
                                            .font(.system(size: 12, weight: .medium))
                                            .foregroundStyle(AppTheme.textSecondary)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .buttonStyle(.plain)

                                if shouldShowSessionTitleMore(sessionTitle) {
                                    Button {
                                        if isExpanded {
                                            expandedSessionTitleIds.remove(session.id)
                                        } else {
                                            expandedSessionTitleIds.insert(session.id)
                                        }
                                    } label: {
                                        Text(isExpanded ? "▴ Hide" : "▾ More")
                                            .font(.system(size: 12, weight: .semibold))
                                            .foregroundStyle(Color(red: 0.56, green: 0.69, blue: 1.0))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
            .navigationTitle("Sessions")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        refreshSessionsWithCooldown()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(sessionsRefreshLocked)
                    .accessibilityLabel("Refresh sessions")
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { showsSessionSheet = false }
                }
            }
            .task {
                await appState.loadSessionsIfNeeded()
            }
            .onDisappear {
                sessionSearchText = ""
                expandedSessionTitleIds.removeAll()
            }
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

    private var collapsedBottomTraySwipeZone: some View {
        Color.clear
            .frame(maxWidth: .infinity)
            .frame(height: 12)
            .contentShape(Rectangle())
            .simultaneousGesture(
                DragGesture(minimumDistance: 12)
                    .onEnded { value in
                        if value.translation.height < -10 {
                            restoreBottomTray()
                        }
                    }
            )
    }

    private var contextCompactRow: some View {
        HStack(spacing: 8) {
            projectButton
            sessionButton
        }
    }

    private var statusRow: some View {
        HStack(spacing: 8) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(AppTheme.textMuted)

            Text(appState.statusMessage)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(AppTheme.textSecondary)
                .lineLimit(2)

            Spacer()
        }
        .padding(.horizontal, 6)
    }

    private func flattenProjects(_ roots: [ProjectTreeNode], depth: Int = 0) -> [FlatProjectNode] {
        roots.flatMap { node in
            [FlatProjectNode(project: node, name: node.name, depth: depth)] + flattenProjects(node.children, depth: depth + 1)
        }
    }

    private func formattedSessionTimestamp(_ timestamp: Int64) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.dateFormat = "d MMM, HH:mm"
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(timestamp) / 1000))
    }

    private var slotToggleRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(appState.slots) { slot in
                    Button {
                        toggleSlotEnabled(slot.id)
                    } label: {
                        slotChipLabel(for: slot)
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

                contextCompactRow
            }
            .padding(.horizontal, 2)
        }
    }

    @ViewBuilder
    private func slotChipLabel(for slot: SlotState) -> some View {
        if let iconURL = ServiceIconCatalog.faviconURL(for: slot.serviceId) {
            AsyncImage(url: iconURL, transaction: Transaction(animation: .easeInOut(duration: 0.12))) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .interpolation(.high)
                        .frame(width: 14, height: 14)
                        .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
                        .saturation(slot.isEnabled ? 1 : 0)
                        .brightness(slot.isEnabled ? 0 : -0.08)
                        .opacity(slot.isEnabled ? 1 : 0.72)
                default:
                    Circle()
                        .fill(slot.isEnabled ? tabAccent(for: slot).opacity(0.9) : AppTheme.textMuted.opacity(0.7))
                        .frame(width: 10, height: 10)
                }
            }
        } else {
            Circle()
                .fill(slot.isEnabled ? tabAccent(for: slot).opacity(0.9) : AppTheme.textMuted.opacity(0.7))
                .frame(width: 10, height: 10)
        }
    }

    private var composerBar: some View {
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(AppTheme.textMuted)

                ZStack(alignment: .topLeading) {
                    if appState.composerText.isEmpty {
                        Text("Send to active chats")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(AppTheme.textMuted)
                            .padding(.top, 1)
                            .allowsHitTesting(false)
                    }

                    GrowingComposerTextView(
                        text: $appState.composerText,
                        measuredHeight: $composerHeight,
                        minHeight: 22,
                        maxHeight: 88
                    )
                    .frame(height: composerHeight)
                }
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

    private func collapseBottomTrayForWebInput() {
        guard !collapsesBottomTrayForWebInput else { return }
        collapsesBottomTrayForWebInput = true
        Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            await MainActor.run {
                if !isKeyboardVisible {
                    collapsesBottomTrayForWebInput = false
                }
            }
        }
    }

    private func restoreBottomTray() {
        collapsesBottomTrayForWebInput = false
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

    private func utilityButton(
        kind: UtilityKind,
        action: @escaping () -> Void,
        onLongPress: (() -> Void)? = nil,
        onFrameChange: ((CGRect) -> Void)? = nil
    ) -> some View {
        let control = ZStack {
            switch kind {
            case .merge:
                MergeConvergeIcon()
                    .foregroundStyle(AppTheme.textSecondary)
            case .settings:
                Image(systemName: "ellipsis")
                    .rotationEffect(.degrees(90))
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
        .utilityCircleChrome()
        .background(
            GeometryReader { proxy in
                Color.clear
                    .onAppear {
                        guard let onFrameChange else { return }
                        DispatchQueue.main.async {
                            onFrameChange(proxy.frame(in: .named("rootShell")))
                        }
                    }
                    .onChange(of: proxy.frame(in: .named("rootShell"))) { _, frame in
                        onFrameChange?(frame)
                    }
            }
        )

        let interactiveControl: AnyView

        if let onLongPress {
            interactiveControl = AnyView(
                control
                    .contentShape(Circle())
                    .gesture(
                        LongPressGesture(minimumDuration: 0.35)
                            .onEnded { _ in onLongPress() }
                            .exclusively(before: TapGesture().onEnded { action() })
                    )
            )
        } else {
            interactiveControl = AnyView(
                Button(action: action) {
                    control
                }
                .buttonStyle(.plain)
            )
        }

        if kind == .settings {
            return AnyView(
                interactiveControl
                    .popover(isPresented: $showsSettingsQuickMenu, attachmentAnchor: .point(.bottom), arrowEdge: .top) {
                        settingsQuickActionsPopover
                            .presentationCompactAdaptation(.popover)
                    }
            )
        }

        return interactiveControl
    }

    private var settingsQuickActionsPopover: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                showsSettingsQuickMenu = false
                appState.statusMessage = "Find in Page is coming here next."
            } label: {
                Label("Find in Page", systemImage: "text.magnifyingglass")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .foregroundStyle(AppTheme.textPrimary)

            Divider()
                .overlay(Color.white.opacity(0.08))

            HStack(spacing: 8) {
                Image(systemName: "hand.point.up.left.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(AppTheme.textMuted)
                Text("Long-press this button for the full settings screen.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AppTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(width: 240, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(red: 0.10, green: 0.11, blue: 0.13))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
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
            .frame(width: 30, height: 30)
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

private struct FlatProjectNode: Identifiable {
    var id: String { project.pathKey }
    let project: ProjectTreeNode
    let name: String
    let depth: Int
}
