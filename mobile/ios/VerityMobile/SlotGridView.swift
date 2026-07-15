import SwiftUI
import UIKit
import WebKit

private struct GrowingComposerTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var measuredHeight: CGFloat
    @Binding var isFocused: Bool

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

        // Synchronous on purpose: didBeginEditing fires before keyboardWillShow,
        // so the focus flag must be set before the keyboard notification lands —
        // deferring it a runloop would briefly collapse the tray under the composer.
        func textViewDidBeginEditing(_ textView: UITextView) {
            parent.isFocused = true
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            parent.isFocused = false
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
    @State private var showsChangelogSheet = false
    @State private var sessionSearchText = ""
    @State private var sessionProjectFilter: MobileAppState.ProjectFilter = .all
    @State private var showsSessionProjectFilterPopover = false
    @State private var sessionProjectFilterQuery = ""
    @State private var filterExpandedIds: Set<String> = Self.loadPersistedProjectTreeExpandedIds()
    @State private var composerHeight: CGFloat = 22
    @State private var isComposerFocused = false
    @State private var keepsTrayDuringWebInput = false
    @State private var isKeyboardVisible = false
    @State private var projectRefreshLocked = false
    @State private var sessionsRefreshLocked = false
    @State private var expandedSessionTitleIds: Set<String> = []
    @State private var sessionPendingDelete: SessionSnapshot?

    private var selectedSlot: SlotState? {
        appState.slots.first { $0.id == appState.selectedSlotId } ?? appState.slots.first
    }

    // Persisted expanded-node set for the project filter tree, keyed by pathKey
    // (unique per DAG placement — see FilterTreeRow above). Nothing stored = all
    // collapsed, which is also the default first-launch state.
    private static let projectTreeExpandedDefaultsKey = "verity.mobile.projectTreeExpanded"

    private static func loadPersistedProjectTreeExpandedIds() -> Set<String> {
        let stored = UserDefaults.standard.array(forKey: projectTreeExpandedDefaultsKey) as? [String] ?? []
        return Set(stored)
    }

    private func persistProjectTreeExpandedIds() {
        UserDefaults.standard.set(Array(filterExpandedIds), forKey: Self.projectTreeExpandedDefaultsKey)
    }

    // Tray visibility is a pure function of focus state — no tap heuristics, no timers.
    // Keyboard up for a web input (composer not focused) → tray collapses to give the page room.
    // Sheet keyboards (project/session search) don't count — they belong to the sheet, not the page.
    private var isBottomTrayCollapsed: Bool {
        isKeyboardVisible
            && !isComposerFocused
            && !keepsTrayDuringWebInput
            && !showsProjectSheet
            && !showsSessionSheet
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

                    WebViewSlot(slot: slot, model: model)
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
                if isBottomTrayCollapsed {
                    collapsedBottomTraySwipeZone
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                } else {
                    bottomPanel
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .padding(.horizontal, isBottomTrayCollapsed ? 0 : 10)
            .padding(.top, isBottomTrayCollapsed ? 0 : 4)
            .padding(.bottom, isBottomTrayCollapsed ? 2 : 8)
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.88), value: isBottomTrayCollapsed)
        .shellBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .animation(.spring(response: 0.28, dampingFraction: 0.88), value: showsSlotControlStrip)
        .onAppear {
            syncSlotAddressDraft()
            Task {
                await appState.loadProjectTreeIfNeeded()
                await appState.loadSessionsOnStartupIfNeeded()
            }
        }
        .onChange(of: appState.selectedSlotId) { _, _ in
            showsSlotControlStrip = false
            keepsTrayDuringWebInput = false
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
            keepsTrayDuringWebInput = false
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
        .sheet(isPresented: $showsChangelogSheet) {
            changelogSheet
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    private var slotTabBar: some View {
        HStack(alignment: .center, spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
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
                            .padding(.horizontal, 13)
                            .padding(.vertical, 8)
                            .background(
                                Capsule(style: .continuous)
                                    .fill(
                                        appState.selectedSlotId == slot.id
                                        ? Color.white.opacity(0.12)
                                        : Color.clear
                                    )
                            )
                            .overlay(
                                Capsule(style: .continuous)
                                    .stroke(
                                        appState.selectedSlotId == slot.id
                                        ? Color.white.opacity(0.14)
                                        : Color.clear,
                                        lineWidth: 1
                                    )
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 4)
            }
            .padding(.vertical, 4)
            .glassIsland(radius: 22)

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
                        // Same expansion-gated rows as the sessions filter tree
                        // (visibleFilterTreeRows + filterExpandedIds): collapsed by
                        // default, expansion persisted across launches.
                        ForEach(visibleFilterTreeRows()) { row in
                            HStack(spacing: 6) {
                                if row.hasChildren {
                                    Button {
                                        if filterExpandedIds.contains(row.id) {
                                            filterExpandedIds.remove(row.id)
                                        } else {
                                            filterExpandedIds.insert(row.id)
                                        }
                                        persistProjectTreeExpandedIds()
                                    } label: {
                                        Image(systemName: filterExpandedIds.contains(row.id) ? "chevron.down" : "chevron.right")
                                            .font(.system(size: 11, weight: .semibold))
                                            .foregroundStyle(AppTheme.textMuted)
                                            .frame(width: 16)
                                    }
                                    .buttonStyle(.plain)
                                } else {
                                    Spacer().frame(width: 16)
                                }

                                Button {
                                    appState.setActiveProject(row.node)
                                    showsProjectSheet = false
                                } label: {
                                    HStack {
                                        Text(String(repeating: "  ", count: row.depth) + row.name)
                                        Spacer()
                                        if appState.activeProjectId == row.projectId && appState.activeProjectPathKey == row.node.pathKey {
                                            Image(systemName: "checkmark")
                                        }
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
        appState.sessionsForDisplay(matching: sessionSearchText, projectFilter: sessionProjectFilter)
    }

    private struct ProjectFilterOption: Identifiable {
        let id: String        // pathKey — unique per DAG placement (node.id duplicates identities)
        let projectId: String
        let name: String
        let depth: Int
    }

    private func flattenedProjectFilterOptions(matching query: String = "") -> [ProjectFilterOption] {
        func flatten(_ nodes: [ProjectTreeNode], depth: Int) -> [ProjectFilterOption] {
            nodes.flatMap { node -> [ProjectFilterOption] in
                [ProjectFilterOption(id: node.pathKey, projectId: node.id, name: node.name, depth: depth)] + flatten(node.children, depth: depth + 1)
            }
        }
        let all = flatten(appState.projectTreeNodes, depth: 0)
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalized.isEmpty else { return all }
        return all.filter { $0.name.lowercased().contains(normalized) }
    }

    private var sessionProjectFilterDisplayName: String {
        switch sessionProjectFilter {
        case .all:
            return "All projects"
        case .none:
            return "No project"
        case .project(let id):
            return flattenedProjectFilterOptions().first { $0.projectId == id }?.name ?? "All projects"
        }
    }

    private var sessionProjectFilterButton: some View {
        Button {
            showsSessionProjectFilterPopover = true
        } label: {
            Image(systemName: sessionProjectFilter == .all ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
        .foregroundStyle(sessionProjectFilter == .all ? AppTheme.textSecondary : AppTheme.actionFill)
        .accessibilityLabel("Filter by project: \(sessionProjectFilterDisplayName)")
        .popover(isPresented: $showsSessionProjectFilterPopover) {
            sessionProjectFilterPopoverContent
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    private func selectSessionProjectFilter(_ filter: MobileAppState.ProjectFilter) {
        sessionProjectFilter = filter
        showsSessionProjectFilterPopover = false
    }

    private var sessionProjectFilterPopoverContent: some View {
        NavigationStack {
            List {
                TextField("Filter projects…", text: $sessionProjectFilterQuery)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .foregroundStyle(AppTheme.textPrimary)

                Section {
                    Button {
                        selectSessionProjectFilter(.all)
                    } label: {
                        sessionProjectFilterRowLabel("All projects", selected: sessionProjectFilter == .all)
                    }
                    Button {
                        selectSessionProjectFilter(.none)
                    } label: {
                        sessionProjectFilterRowLabel("No project", selected: sessionProjectFilter == .none)
                    }
                }

                Section {
                    if sessionProjectFilterQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        ForEach(visibleFilterTreeRows()) { row in
                            sessionProjectFilterTreeRow(row)
                        }
                    } else {
                        ForEach(flattenedProjectFilterOptions(matching: sessionProjectFilterQuery)) { option in
                            Button {
                                selectSessionProjectFilter(.project(option.projectId))
                            } label: {
                                sessionProjectFilterRowLabel(
                                    String(repeating: "  ", count: option.depth) + option.name,
                                    selected: sessionProjectFilter == .project(option.projectId)
                                )
                            }
                        }
                    }
                }
            }
            .navigationTitle("Filter Projects")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { showsSessionProjectFilterPopover = false }
                }
            }
        }
    }

    // Visible tree rows as plain data (SwiftUI can't recurse inside a `some View`
    // builder — the opaque type would be defined in terms of itself). The DAG-
    // expanded tree can show one project under several parents, so row identity
    // and expand state key off pathKey (unique per placement), selection off id.
    private struct FilterTreeRow: Identifiable {
        let id: String        // pathKey — unique per placement
        let projectId: String
        let name: String
        let depth: Int
        let hasChildren: Bool
        // Full node so the main project picker can reuse these rows for
        // setActiveProject (single expansion-gated tree walk for both sheets).
        let node: ProjectTreeNode
    }

    private func visibleFilterTreeRows() -> [FilterTreeRow] {
        var rows: [FilterTreeRow] = []
        func walk(_ nodes: [ProjectTreeNode], depth: Int) {
            for node in nodes {
                rows.append(FilterTreeRow(
                    id: node.pathKey,
                    projectId: node.id,
                    name: node.name,
                    depth: depth,
                    hasChildren: !node.children.isEmpty,
                    node: node
                ))
                if !node.children.isEmpty && filterExpandedIds.contains(node.pathKey) {
                    walk(node.children, depth: depth + 1)
                }
            }
        }
        walk(appState.projectTreeNodes, depth: 0)
        return rows
    }

    private func sessionProjectFilterTreeRow(_ row: FilterTreeRow) -> some View {
        HStack(spacing: 6) {
            if row.hasChildren {
                Button {
                    if filterExpandedIds.contains(row.id) {
                        filterExpandedIds.remove(row.id)
                    } else {
                        filterExpandedIds.insert(row.id)
                    }
                    persistProjectTreeExpandedIds()
                } label: {
                    Image(systemName: filterExpandedIds.contains(row.id) ? "chevron.down" : "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(AppTheme.textMuted)
                        .frame(width: 16)
                }
                .buttonStyle(.plain)
            } else {
                Spacer().frame(width: 16)
            }

            Button {
                selectSessionProjectFilter(.project(row.projectId))
            } label: {
                sessionProjectFilterRowLabel(
                    String(repeating: "  ", count: row.depth) + row.name,
                    selected: sessionProjectFilter == .project(row.projectId)
                )
            }
        }
    }

    private func sessionProjectFilterRowLabel(_ text: String, selected: Bool) -> some View {
        HStack {
            Text(text)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(1)
            Spacer()
            if selected {
                Image(systemName: "checkmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(AppTheme.actionFill)
            }
        }
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
                    Text(appState.sessionsLastWebSyncAt.map {
                        "Web sync: \(formattedSessionDate($0))"
                    } ?? "Web sync: not yet synced")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textMuted)

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
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    Button(role: .destructive) {
                                        sessionPendingDelete = session
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                        }
                    }
                }
            }
            .confirmationDialog(
                "Delete this session?",
                isPresented: Binding(
                    get: { sessionPendingDelete != nil },
                    set: { if !$0 { sessionPendingDelete = nil } }
                ),
                titleVisibility: .visible,
                presenting: sessionPendingDelete
            ) { session in
                Button("Delete \(appState.displaySessionName(session))", role: .destructive) {
                    appState.deleteSession(session)
                    sessionPendingDelete = nil
                }
                Button("Cancel", role: .cancel) { sessionPendingDelete = nil }
            } message: { session in
                Text(appState.displaySessionName(session))
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

                ToolbarItem(placement: .topBarLeading) {
                    sessionProjectFilterButton
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { showsSessionSheet = false }
                }
            }
            .task {
                await appState.loadSessionsIfNeeded()
                await appState.loadProjectTreeIfNeeded()
            }
            .onDisappear {
                sessionSearchText = ""
                sessionProjectFilter = .all
                expandedSessionTitleIds.removeAll()
                // Reset to the PERSISTED expansion, not to empty: reopening the
                // sheet mid-run must show the same tree state as after a relaunch.
                filterExpandedIds = Self.loadPersistedProjectTreeExpandedIds()
                sessionProjectFilterQuery = ""
            }
        }
    }

    private var changelogSheet: some View {
        NavigationStack {
            ScrollView {
                Text(loadLatestChangelogText())
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
            }
            .navigationTitle("Latest 30 changes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { showsChangelogSheet = false }
                }
            }
        }
    }

    private func loadLatestChangelogText() -> String {
        guard
            let url = Bundle.main.url(forResource: "ChangelogLatest", withExtension: "txt"),
            let text = try? String(contentsOf: url, encoding: .utf8)
        else {
            return "No changelog entries found."
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "No changelog entries found." : trimmed
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
        .glassIsland(radius: 20)
    }

    private var bottomPanel: some View {
        VStack(spacing: 8) {
            slotToggleRow
            composerBar
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 8)
        .glassIsland(radius: 22)
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

    private func formattedSessionTimestamp(_ timestamp: Int64) -> String {
        formattedSessionDate(Date(timeIntervalSince1970: TimeInterval(timestamp) / 1000))
    }

    private func formattedSessionDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.dateFormat = "d MMM, HH:mm"
        return formatter.string(from: date)
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
                        isFocused: $isComposerFocused,
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
                    .fill(Color.white.opacity(0.06))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
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

    private func restoreBottomTray() {
        keepsTrayDuringWebInput = true
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

            Button {
                showsSettingsQuickMenu = false
                showsChangelogSheet = true
            } label: {
                Label("Changelog", systemImage: "list.bullet.clipboard")
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
        .glassIsland(radius: 16)
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
