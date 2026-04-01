import Foundation
import WebKit

enum MergeAggregationSlotStatus: String {
    case ready
    case waiting
    case error
}

struct MergeAggregationSlotSnapshot: Identifiable {
    let id: Int
    let title: String
    let status: MergeAggregationSlotStatus
}

@MainActor
final class MobileAppState: ObservableObject {
    @Published var slots: [SlotState] = [] {
        didSet { persistWorkspaceState() }
    }
    @Published var selectedSlotId: Int = 1 {
        didSet { persistWorkspaceState() }
    }
    @Published var mergeOutput: String = ""
    @Published var mergeHistory: String = ""
    @Published var mergeClarificationText: String = ""
    @Published var mergeAggregationSummary: String = "Slot aggregation idle"
    @Published var mergeAggregationSnapshots: [MergeAggregationSlotSnapshot] = []
    @Published var statusMessage: String = "MVP scaffold"
    @Published var composerText: String = ""
    @Published var isSendingComposer: Bool = false
    @Published var activeProjectId: String? = nil
    @Published var projectTreeNodes: [ProjectTreeNode] = []
    @Published var availableSessions: [SessionSnapshot] = []
    @Published var isLoadingSessions: Bool = false
    @Published var sessionIndicatorText: String? = nil
    @Published var isManualCollecting: Bool = false
    @Published var recentIngestEvents: [String] = []
    @Published private(set) var slotUserAgentPresets: [Int: UserAgentPreset] = [:]
    @Published private(set) var lastUserPrompt: String = ""

    private static let slotsDefaultsKey = "verity.mobile.slots"
    private static let selectedSlotDefaultsKey = "verity.mobile.selectedSlotId"
    private static let slotUserAgentPresetsDefaultsKey = "verity.mobile.slotUserAgentPresets"
    private static let lastUserPromptDefaultsKey = "verity.mobile.lastUserPrompt"
    private static let defaultMergeAggregationPolicy = MergeAggregationPolicy(
        maxChecks: 12,
        waitIntervalMs: 2500,
        settleDelayMs: 1500,
        allowPartialResults: true,
        minimumRepliesRequired: 1
    )

    let presets: [String: ServicePreset]
    private let webModels: [Int: SlotWebViewModel]
    private let mergeAggregationPolicy: MergeAggregationPolicy
    private let sessionManager = SessionManager()
    private(set) var lastOriginalResponses: [String: String] = [:]

    init() {
        let catalog = ServicePresetLoader.loadCatalog()
        let mergeCatalog = MergeCatalogLoader.loadCatalog()
        let presets = catalog?.services ?? [:]
        let defaults = catalog?.defaultSlots ?? ["chatgpt", "claude", "gemini", "grok"]
        let defaultSlots = defaults.enumerated().map { index, serviceId in
            let preset = presets[serviceId]
            return SlotState(
                id: index + 1,
                serviceId: serviceId,
                title: preset?.name ?? "Slot \(index + 1)",
                url: preset?.url ?? "https://example.com",
                isEnabled: true
            )
        }
        let restoredSlots = Self.loadPersistedSlots()
        let slots = Self.merge(defaults: defaultSlots, restored: restoredSlots, presets: presets)
        let webModels = Dictionary(uniqueKeysWithValues: slots.map { slot -> (Int, SlotWebViewModel) in
            let model = SlotWebViewModel()
            return (slot.id, model)
        })

        self.presets = presets
        self.slots = slots
        self.selectedSlotId = Self.loadPersistedSelectedSlotId(validSlots: slots) ?? (slots.first?.id ?? 1)
        self.webModels = webModels
        self.mergeAggregationPolicy = mergeCatalog?.aggregationPolicy ?? Self.defaultMergeAggregationPolicy
        self.slotUserAgentPresets = Self.loadPersistedUserAgentPresets(validSlots: slots)
        Self.applyServiceDefaultUserAgentPresets(to: &self.slotUserAgentPresets, validSlots: slots)
        self.lastUserPrompt = Self.loadPersistedLastUserPrompt()
        let parallelState = sessionManager.getParallelIngestState()
        if self.lastUserPrompt.isEmpty, !parallelState.sourcePrompt.isEmpty {
            self.lastUserPrompt = parallelState.sourcePrompt
        }
        self.activeProjectId = nil
        self.sessionIndicatorText = nil
        sessionManager.clearCurrentSessionLink(preservingProject: false)
        if !hasActiveSessionLink() {
            self.slots = Self.slotsResetToPresetURLs(slots: self.slots, presets: presets)
        }

        applyAllSlotUserAgentPresets()

        for slot in slots {
            webModels[slot.id]?.onURLChange = { [weak self] url in
                self?.updateSlotURL(slotID: slot.id, url: url.absoluteString)
            }
        }

        // Keep slot webviews warm so send-to-all can target inactive tabs too.
        for slot in slots {
            webModels[slot.id]?.load(url: slot.url)
        }
    }

    func webModel(for slotId: Int) -> SlotWebViewModel {
        if let model = webModels[slotId] {
            return model
        }
        return SlotWebViewModel()
    }

    func sendComposerToActiveSlots() async {
        let message = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        let hadCurrentQuestionContext = currentQuestionSessionId() != nil && currentQuestionAggregatedNoteId() != nil

        isSendingComposer = true
        defer { isSendingComposer = false }

        let activeSlots = slots.filter(\.isEnabled)
        var successCount = 0
        for slot in activeSlots {
            guard let preset = presets[slot.serviceId] else { continue }
            let model = webModel(for: slot.id)
            let success = await model.sendMessage(message: message, preset: preset)
            if success {
                successCount += 1
            }
        }

        statusMessage = successCount == activeSlots.count
            ? "Sent to \(successCount) active chat\(successCount == 1 ? "" : "s")"
            : "Sent to \(successCount) of \(activeSlots.count) active chats"

        if successCount > 0 {
            lastUserPrompt = message
            persistLastUserPrompt(message)
            sessionManager.rememberSourcePrompt(message)
            if !hadCurrentQuestionContext {
                sessionManager.clearParallelIngestState()
                sessionManager.rememberSourcePrompt(message)
            }
            updateSessionIndicator()
            composerText = ""
            let expectedSlots = activeSlots.count
            Task {
                await startParallelAggregatedIngest(prompt: message, expectedSlots: expectedSlots)
            }
        }
    }

    func setActiveProject(_ projectId: String?) {
        let normalized = projectId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedProjectId = (normalized?.isEmpty == false) ? normalized : nil
        guard activeProjectId != resolvedProjectId else { return }

        activeProjectId = resolvedProjectId
        sessionManager.clearCurrentSessionLink(preservingProject: false)
        persistWorkspaceState()
        sessionManager.setActiveProjectId(activeProjectId)
        updateSessionIndicator()
        statusMessage = activeProjectId == nil
            ? "Project cleared; session reset"
            : "Project changed; session reset"
    }

    func clearActiveSessionSelection() {
        sessionManager.clearCurrentSessionLink(preservingProject: true)
        persistWorkspaceState()
        updateSessionIndicator()
        statusMessage = "Cleared active session"
    }

    func loadProjectTree() async {
        let rpcBaseURL = KeyObfuscation.getSupabaseRPCURL(nil)
        let apiKey = KeyObfuscation.getSupabaseAPIKey(nil)
        guard !rpcBaseURL.isEmpty, !apiKey.isEmpty else {
            statusMessage = "Dream Tracker API key is missing"
            return
        }

        do {
            projectTreeNodes = try await fetchProjectTree(rpcBaseURL: rpcBaseURL, apiKey: apiKey)
            statusMessage = projectTreeNodes.isEmpty ? "No projects found" : "Loaded \(projectTreeNodes.count) root project(s)"
        } catch {
            statusMessage = error.localizedDescription
            projectTreeNodes = []
        }
    }

    func loadProjectTreeIfNeeded() async {
        guard projectTreeNodes.isEmpty else { return }
        await loadProjectTree()
    }

    func loadSessions() async {
        let localSessions = sessionManager.getAllSessions()
        availableSessions = sortSessionsForDisplay(localSessions)

        let rpcBaseURL = KeyObfuscation.getSupabaseRPCURL(nil)
        let apiKey = KeyObfuscation.getSupabaseAPIKey(nil)
        guard !rpcBaseURL.isEmpty, !apiKey.isEmpty else {
            statusMessage = localSessions.isEmpty ? "No saved sessions" : "Loaded \(localSessions.count) local session(s)"
            return
        }

        isLoadingSessions = true
        defer { isLoadingSessions = false }

        let remoteSessions = await SessionManager.loadSessionsFromDatabase()
        let sessions: [SessionSnapshot]
        if !remoteSessions.isEmpty {
            sessionManager.replaceSessions(remoteSessions)
            sessions = remoteSessions
        } else {
            let merged = mergeSessions(remoteSessions: remoteSessions, localSessions: localSessions)
            if !merged.isEmpty {
                sessionManager.replaceSessions(merged)
            }
            sessions = merged.isEmpty ? localSessions : merged
        }

        availableSessions = sortSessionsForDisplay(sessions)
        statusMessage = sessions.isEmpty ? "No saved sessions" : "Loaded \(sessions.count) session(s)"
    }

    func loadSessionsIfNeeded() async {
        guard availableSessions.isEmpty else { return }
        await loadSessions()
    }

    func loadSession(_ session: SessionSnapshot) {
        let updatedSlots = slots.map { fallback -> SlotState in
            let slotKey = "slot-\(fallback.id)"
            let targetServiceId = session.slotConfig[slotKey] ?? fallback.serviceId
            let preset = presets[targetServiceId] ?? presets[fallback.serviceId]
            let resolvedURL = session.slotURLs[slotKey]?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
                ?? preset?.url
                ?? fallback.url
            let targetEnabled = session.slotEnabled[slotKey] ?? fallback.isEnabled
            return SlotState(
                id: fallback.id,
                serviceId: targetServiceId,
                title: preset?.name ?? fallback.title,
                url: resolvedURL,
                isEnabled: targetEnabled
            )
        }

        slots = updatedSlots
        if let firstEnabledSlot = updatedSlots.first(where: \.isEnabled)?.id {
            selectedSlotId = firstEnabledSlot
        }

        sessionManager.updateSessionLink(
            sessionId: session.sessionId,
            noteId: session.noteId,
            sourcePrompt: session.name
        )
        updateSessionIndicator()
        lastUserPrompt = session.name.trimmingCharacters(in: .whitespacesAndNewlines)
        persistLastUserPrompt(lastUserPrompt)

        for slot in updatedSlots {
            webModel(for: slot.id).forceLoad(url: slot.url)
        }

        statusMessage = "Loaded: \(displaySessionName(session))"
    }

    func resolvedMergeSourcePrompt() -> String {
        let composer = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !composer.isEmpty {
            return composer
        }
        return lastUserPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func reloadSelectedSlot() {
        webModel(for: selectedSlotId).reloadCurrentPage()
        statusMessage = "Reloaded active slot"
    }

    func stopSelectedSlotLoading() {
        webModel(for: selectedSlotId).stopLoading()
        statusMessage = "Stopped active slot"
    }

    func refreshMergeAggregationStatuses(sourcePrompt: String) async {
        let result = await scrapeReplies(sourcePrompt: sourcePrompt)
        mergeAggregationSnapshots = result.snapshots
        mergeAggregationSummary = formatAggregationSummary(result.snapshots)
    }

    func manualCollectCurrentQuestion() async -> AggregatedIngestResult? {
        guard !isManualCollecting else {
            statusMessage = "Collect already running"
            appendIngestEvent("Collect ignored • previous collect still running")
            return nil
        }

        let prompt = resolvedMergeSourcePrompt()
        guard !prompt.isEmpty else {
            statusMessage = "Type a prompt or send one first"
            return nil
        }

        isManualCollecting = true
        defer { isManualCollecting = false }

        let existingAggregatedNoteId = currentQuestionAggregatedNoteId()
        let existingSessionId = currentQuestionSessionId()
        let hasLoadedQuestionContext = existingAggregatedNoteId != nil && existingSessionId != nil
        let loadedQuestionPrompt = if hasLoadedQuestionContext {
            sessionManager.getParallelIngestState().sourcePrompt
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .ifEmpty(lastUserPrompt.trimmingCharacters(in: .whitespacesAndNewlines))
        } else {
            ""
        }
        let sameQuestionAsCurrentRoot = hasLoadedQuestionContext && promptsReferToSameQuestion(prompt, loadedQuestionPrompt)
        let replaceExisting = existingAggregatedNoteId != nil && sameQuestionAsCurrentRoot
        let targetAggregatedNoteId = replaceExisting ? existingAggregatedNoteId : nil

        appendIngestEvent("Collect start • \(String(prompt.prefix(60)))")

        let responses = await collectLatestRepliesForMerge(sourcePrompt: prompt)
        guard !responses.isEmpty else {
            statusMessage = "No source replies to collect"
            appendIngestEvent("Collect empty • no replies")
            return nil
        }

        appendIngestEvent("Collected \(responses.count) reply(s) • \(responses.keys.sorted().joined(separator: ", "))")

        do {
            let result = try await ingestCollectedResponses(
                prompt: prompt,
                responses: responses,
                replaceExisting: replaceExisting,
                aggregatedNoteId: targetAggregatedNoteId
            )
            statusMessage = result.sessionId != nil
                ? "Collected to session \(result.sessionId!)"
                : "Collected responses"
            appendIngestEvent("Collect ok • session \(result.sessionId.map(String.init) ?? "-") • note \(result.noteId ?? "-")")
            return result
        } catch {
            statusMessage = error.localizedDescription
            appendIngestEvent("Collect failed • \(error.localizedDescription)")
            return nil
        }
    }

    func collectLatestRepliesForMerge(sourcePrompt: String) async -> [String: String] {
        let enabledSlots = slots.filter(\.isEnabled)
        guard !enabledSlots.isEmpty else {
            mergeAggregationSnapshots = []
            mergeAggregationSummary = "No enabled slots for merge."
            return [:]
        }

        let maxChecks = max(1, mergeAggregationPolicy.maxChecks)
        let waitIntervalNs = UInt64(max(0, mergeAggregationPolicy.waitIntervalMs)) * 1_000_000
        let settleDelayNs = UInt64(max(0, mergeAggregationPolicy.settleDelayMs)) * 1_000_000
        let minimumRepliesRequired = max(1, mergeAggregationPolicy.minimumRepliesRequired)
        var lastResult = await scrapeReplies(sourcePrompt: sourcePrompt)
        mergeAggregationSnapshots = lastResult.snapshots
        mergeAggregationSummary = formatAggregationSummary(lastResult.snapshots)

        for attempt in 1..<maxChecks {
            if lastResult.responses.count >= enabledSlots.count {
                if settleDelayNs > 0 {
                    try? await Task.sleep(nanoseconds: settleDelayNs)
                    lastResult = await scrapeReplies(sourcePrompt: sourcePrompt)
                    mergeAggregationSnapshots = lastResult.snapshots
                }
                if lastResult.responses.count >= enabledSlots.count {
                    mergeAggregationSummary = "All \(enabledSlots.count) slot(s) ready. Collecting now..."
                    return lastResult.responses
                }
                mergeAggregationSummary = formatAggregationSummary(lastResult.snapshots)
            }

            let readyCount = lastResult.responses.count
            mergeAggregationSummary = "Waiting for replies: \(readyCount)/\(enabledSlots.count) ready"
            statusMessage = "Waiting for replies: \(readyCount)/\(enabledSlots.count) ready"
            try? await Task.sleep(nanoseconds: waitIntervalNs)

            lastResult = await scrapeReplies(sourcePrompt: sourcePrompt)
            mergeAggregationSnapshots = lastResult.snapshots
            mergeAggregationSummary = formatAggregationSummary(lastResult.snapshots)

            if attempt == maxChecks - 1 {
                break
            }
        }

        if mergeAggregationPolicy.allowPartialResults && lastResult.responses.count >= minimumRepliesRequired {
            mergeAggregationSummary = "Collected \(lastResult.responses.count)/\(enabledSlots.count) source reply(s)"
        } else {
            mergeAggregationSummary = "Aggregation still waiting. Use Collect now or refresh statuses."
        }

        return mergeAggregationPolicy.allowPartialResults && lastResult.responses.count >= minimumRepliesRequired
            ? lastResult.responses
            : [:]
    }

    func resetMergeConversation() {
        mergeOutput = ""
        mergeHistory = ""
        mergeClarificationText = ""
        lastOriginalResponses = [:]
    }

    func beginMergeConversation(responses: [String: String]) {
        lastOriginalResponses = responses
        mergeHistory = ""
        mergeClarificationText = ""
    }

    func finishMergeConversation(with assistantResponse: String) {
        let clean = assistantResponse.trimmingCharacters(in: .whitespacesAndNewlines)
        mergeOutput = clean
        if mergeHistory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            mergeHistory = "Assistant: \(clean)"
        } else {
            mergeHistory += "\n\nAssistant: \(clean)"
        }
    }

    func appendClarificationUserTurn(_ text: String) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        if mergeHistory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            mergeHistory = "User: \(clean)"
        } else {
            mergeHistory += "\n\nUser: \(clean)"
        }
    }

    func updateSelectedSlotService(to serviceId: String) {
        guard let index = slots.firstIndex(where: { $0.id == selectedSlotId }),
              let preset = presets[serviceId]
        else { return }

        slots[index].serviceId = serviceId
        slots[index].title = preset.name
        slots[index].url = preset.url
        let defaultPreset = Self.defaultUserAgentPreset(for: serviceId)
        slotUserAgentPresets[selectedSlotId] = defaultPreset
        persistUserAgentPresets()
        webModel(for: selectedSlotId).applyUserAgentPreset(defaultPreset)
        webModel(for: selectedSlotId).forceLoad(url: preset.url)
        statusMessage = "Switched to \(preset.name) • UA: \(defaultPreset.title)"
    }

    func navigateSelectedSlot(to rawURL: String) {
        let trimmed = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let normalized = normalizeURL(trimmed)
        guard let index = slots.firstIndex(where: { $0.id == selectedSlotId }) else { return }

        slots[index].url = normalized
        webModel(for: selectedSlotId).forceLoad(url: normalized)
        statusMessage = "Navigated active slot"
    }

    func clearAllDiagnostics() {
        for slot in slots {
            webModel(for: slot.id).clearDiagnostics()
        }
        statusMessage = "Cleared diagnostics"
    }

    func userAgentPreset(for slotId: Int) -> UserAgentPreset {
        if let preset = slotUserAgentPresets[slotId] {
            return preset
        }
        let serviceId = slots.first(where: { $0.id == slotId })?.serviceId
        return Self.defaultUserAgentPreset(for: serviceId)
    }

    func applyUserAgentPreset(_ preset: UserAgentPreset, to slotId: Int) {
        slotUserAgentPresets[slotId] = preset
        persistUserAgentPresets()
        webModel(for: slotId).applyUserAgentPreset(preset)
        let slotTitle = slots.first(where: { $0.id == slotId })?.title ?? "S\(slotId)"
        statusMessage = "\(slotTitle) UA: \(preset.title)"
    }

    func applyUserAgentPresetToAllSlots(_ preset: UserAgentPreset) {
        for slot in slots {
            slotUserAgentPresets[slot.id] = preset
            webModel(for: slot.id).applyUserAgentPreset(preset)
        }
        persistUserAgentPresets()
        statusMessage = "All slots UA: \(preset.title)"
    }

    func handleAppDidBecomeActive() {
        for slot in slots {
            webModel(for: slot.id).handleAppDidBecomeActive()
        }
    }

    private func updateSlotURL(slotID: Int, url: String) {
        guard let index = slots.firstIndex(where: { $0.id == slotID }) else { return }
        guard slots[index].url != url else { return }
        slots[index].url = url
    }

    private func hasActiveSessionLink() -> Bool {
        let state = sessionManager.getParallelIngestState()
        return state.sessionId != nil && !state.activeNoteId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func currentQuestionSessionId() -> Int? {
        let state = sessionManager.getParallelIngestState()
        guard !currentQuestionAggregatedNoteId().isNilOrBlank else { return nil }
        return state.sessionId
    }

    private func currentQuestionAggregatedNoteId() -> String? {
        sessionManager.getParallelIngestState().activeNoteId.nilIfBlank
    }

    private func updateSessionIndicator() {
        sessionIndicatorText = Self.makeSessionIndicator(from: sessionManager.getParallelIngestState())
    }

    private func appendIngestEvent(_ message: String) {
        let stamp = Self.ingestEventTimeFormatter.string(from: Date())
        recentIngestEvents.insert("[\(stamp)] \(message)", at: 0)
        if recentIngestEvents.count > 6 {
            recentIngestEvents = Array(recentIngestEvents.prefix(6))
        }
    }

    private func ingestCollectedResponses(
        prompt: String,
        responses: [String: String],
        replaceExisting: Bool,
        aggregatedNoteId: String?
    ) async throws -> AggregatedIngestResult {
        let rpcBaseURL = KeyObfuscation.getSupabaseRPCURL(nil)
        let apiKey = KeyObfuscation.getSupabaseAPIKey(nil)
        guard !rpcBaseURL.isEmpty, !apiKey.isEmpty else {
            throw NSError(domain: "MobileAppState", code: 2001, userInfo: [NSLocalizedDescriptionKey: "Supabase integration is not configured"])
        }

        let existingSessionId = currentQuestionSessionId()
        let traceId = sessionManager.ensureTraceId()
        let sequence = sessionManager.nextSequence()
        let sessionOrTmp = existingSessionId.map(String.init) ?? sessionManager.ensureExternalChatId()
        let idempotencyKey = AggregatedIngestClient.buildIdempotencyKey(
            kind: "aggregated",
            sessionIdOrTmp: sessionOrTmp,
            sequence: sequence,
            traceId: traceId
        )

        let scrapeMeta = slots
            .filter(\.isEnabled)
            .compactMap { slot -> IngestScrapeMetaRow? in
                guard responses[slot.title] != nil, let preset = presets[slot.serviceId] else { return nil }
                return IngestScrapeMetaRow(
                    slot: slot.id - 1,
                    serviceName: slot.title,
                    serviceId: preset.id,
                    sourceURL: slot.url
                )
            }

        let payload = AggregatedIngestClient.buildPayload(
            sessionId: existingSessionId,
            title: prompt,
            responses: responses,
            scrapeMeta: scrapeMeta,
            projectTagId: activeProjectId,
            aggregatedNoteId: aggregatedNoteId,
            replaceExisting: replaceExisting
        )

        let result = try await AggregatedIngestClient.sendAggregated(
            rpcBaseURL: rpcBaseURL,
            apiKey: apiKey,
            payload: payload,
            traceId: traceId,
            idempotencyKey: idempotencyKey,
            scrapeMeta: scrapeMeta
        )

        sessionManager.updateSessionLink(
            sessionId: result.sessionId,
            noteId: result.noteId,
            sourcePrompt: prompt
        )
        updateSessionIndicator()
        lastUserPrompt = prompt
        persistLastUserPrompt(prompt)

        if let sessionId = result.sessionId {
            let snapshot = sessionManager.saveCurrentSession(
                name: String(prompt.prefix(60)).ifEmpty("Session"),
                dreamSessionId: sessionId,
                slotStates: slots,
                noteId: result.noteId
            )
            Task.detached {
                _ = await SessionManager().syncSessionToDatabase(snapshot)
            }
        }

        return result
    }

    private func startParallelAggregatedIngest(prompt: String, expectedSlots: Int) async {
        guard expectedSlots > 0 else { return }
        let responses = await collectLatestRepliesForMerge(sourcePrompt: prompt)
        guard responses.count == expectedSlots else {
            if !responses.isEmpty {
                statusMessage = "Collected \(responses.count)/\(expectedSlots) replies; session bootstrap skipped"
                appendIngestEvent("Auto-collect skipped • \(responses.count)/\(expectedSlots) replies")
            }
            return
        }

        do {
            let result = try await ingestCollectedResponses(
                prompt: prompt,
                responses: responses,
                replaceExisting: false,
                aggregatedNoteId: nil
            )
            if let sessionId = result.sessionId {
                statusMessage = "Session linked: \(sessionId)"
                appendIngestEvent("Auto-collect ok • session \(sessionId) • note \(result.noteId ?? "-")")
            }
        } catch {
            statusMessage = "Auto-collect failed: \(error.localizedDescription)"
            appendIngestEvent("Auto-collect failed • \(error.localizedDescription)")
        }
    }

    private func scrapeReplies(sourcePrompt: String) async -> (responses: [String: String], snapshots: [MergeAggregationSlotSnapshot]) {
        var collected: [String: String] = [:]
        var snapshots: [MergeAggregationSlotSnapshot] = []

        for slot in slots where slot.isEnabled {
            guard let preset = presets[slot.serviceId] else { continue }
            let model = webModel(for: slot.id)
            let scrapedText = await scrapeReplyText(from: model, serviceId: preset.id, sourcePrompt: sourcePrompt)

            if let scrapedText, !scrapedText.isEmpty {
                collected[slot.title] = scrapedText
                snapshots.append(MergeAggregationSlotSnapshot(id: slot.id, title: slot.title, status: .ready))
            } else if await model.isStillGenerating(serviceId: preset.id) || isSlotLikelyStillWorking(model) {
                snapshots.append(MergeAggregationSlotSnapshot(id: slot.id, title: slot.title, status: .waiting))
            } else {
                snapshots.append(MergeAggregationSlotSnapshot(id: slot.id, title: slot.title, status: .error))
            }
        }

        return (collected, snapshots)
    }

    private func scrapeReplyText(from model: SlotWebViewModel, serviceId: String, sourcePrompt: String) async -> String? {
        guard let result = await model.scrapeLatestReply(serviceId: serviceId, sourcePrompt: sourcePrompt),
              let text = result.text?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty
        else {
            return nil
        }
        return text
    }

    private func isSlotLikelyStillWorking(_ model: SlotWebViewModel) -> Bool {
        let states = [
            model.lastNavigationState.lowercased(),
            model.popupNavigationState.lowercased()
        ]
        if states.contains(where: { ["requested", "forced", "starting", "committed", "reload", "back-navigation"].contains($0) }) {
            return true
        }

        let hrefs = [
            model.currentLocationHref.lowercased(),
            model.popupLocationHref.lowercased()
        ]
        return hrefs.contains(where: {
            $0.contains("accounts.google.com")
                || $0.contains("auth.openai.com")
                || $0.contains("claude.ai/login")
                || $0.contains("accounts.x.ai")
        })
    }

    private func formatAggregationSummary(_ snapshots: [MergeAggregationSlotSnapshot]) -> String {
        guard !snapshots.isEmpty else { return "Slot aggregation idle" }
        let readyCount = snapshots.filter { $0.status == .ready }.count
        let waitingCount = snapshots.filter { $0.status == .waiting }.count
        let errorCount = snapshots.filter { $0.status == .error }.count

        if readyCount == snapshots.count {
            return "All \(snapshots.count) slot(s) ready"
        }

        var pieces = ["\(readyCount)/\(snapshots.count) ready"]
        if waitingCount > 0 {
            pieces.append("\(waitingCount) waiting")
        }
        if errorCount > 0 {
            pieces.append("\(errorCount) empty")
        }
        return pieces.joined(separator: " • ")
    }

    private func persistWorkspaceState() {
        let encoder = JSONEncoder()
        let slotsToPersist = Self.slotsForPersistence(
            slots: slots,
            presets: presets,
            hasActiveSessionLink: hasActiveSessionLink()
        )
        if let encodedSlots = try? encoder.encode(slotsToPersist) {
            UserDefaults.standard.set(encodedSlots, forKey: Self.slotsDefaultsKey)
        }
        UserDefaults.standard.set(selectedSlotId, forKey: Self.selectedSlotDefaultsKey)
    }

    private func persistLastUserPrompt(_ prompt: String) {
        UserDefaults.standard.set(prompt, forKey: Self.lastUserPromptDefaultsKey)
    }

    private static func defaultUserAgentPreset(for serviceId: String?) -> UserAgentPreset {
        switch serviceId?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "chatgpt", "claude", "grok", "gemini":
            return .iphoneSafariFull
        default:
            return .systemDefault
        }
    }

    private static func applyServiceDefaultUserAgentPresets(to presets: inout [Int: UserAgentPreset], validSlots: [SlotState]) {
        for slot in validSlots {
            presets[slot.id] = defaultUserAgentPreset(for: slot.serviceId)
        }
    }

    private static func loadPersistedSlots() -> [SlotState]? {
        guard let data = UserDefaults.standard.data(forKey: slotsDefaultsKey) else { return nil }
        return try? JSONDecoder().decode([SlotState].self, from: data)
    }

    private static func loadPersistedSelectedSlotId(validSlots: [SlotState]) -> Int? {
        let storedId = UserDefaults.standard.integer(forKey: selectedSlotDefaultsKey)
        guard storedId != 0, validSlots.contains(where: { $0.id == storedId }) else { return nil }
        return storedId
    }

    private static func loadPersistedLastUserPrompt() -> String {
        UserDefaults.standard.string(forKey: lastUserPromptDefaultsKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private static func loadPersistedUserAgentPresets(validSlots: [SlotState]) -> [Int: UserAgentPreset] {
        guard let raw = UserDefaults.standard.dictionary(forKey: slotUserAgentPresetsDefaultsKey) as? [String: String] else {
            return Dictionary(uniqueKeysWithValues: validSlots.map { ($0.id, defaultUserAgentPreset(for: $0.serviceId)) })
        }

        var result: [Int: UserAgentPreset] = [:]
        for slot in validSlots {
            if let presetRaw = raw[String(slot.id)], let preset = UserAgentPreset(rawValue: presetRaw) {
                result[slot.id] = preset
            } else {
                result[slot.id] = defaultUserAgentPreset(for: slot.serviceId)
            }
        }
        return result
    }

    private static func merge(
        defaults: [SlotState],
        restored: [SlotState]?,
        presets: [String: ServicePreset]
    ) -> [SlotState] {
        guard let restored else { return defaults }

        return defaults.map { fallback in
            guard let saved = restored.first(where: { $0.id == fallback.id }) else {
                return fallback
            }

            let preset = presets[saved.serviceId] ?? presets[fallback.serviceId]
            return SlotState(
                id: fallback.id,
                serviceId: saved.serviceId,
                title: preset?.name ?? saved.title,
                url: saved.url.isEmpty ? (preset?.url ?? fallback.url) : saved.url,
                isEnabled: saved.isEnabled
            )
        }
    }

    private static func slotsForPersistence(
        slots: [SlotState],
        presets: [String: ServicePreset],
        hasActiveSessionLink: Bool
    ) -> [SlotState] {
        guard !hasActiveSessionLink else { return slots }
        return slotsResetToPresetURLs(slots: slots, presets: presets)
    }

    private static func slotsResetToPresetURLs(
        slots: [SlotState],
        presets: [String: ServicePreset]
    ) -> [SlotState] {
        slots.map { slot in
            guard let preset = presets[slot.serviceId] else { return slot }
            var normalized = slot
            normalized.title = preset.name
            normalized.url = preset.url
            return normalized
        }
    }

    private func normalizeURL(_ value: String) -> String {
        if value.contains("://") {
            return value
        }
        if let preset = presets[value.lowercased()] {
            return preset.url
        }
        return "https://\(value)"
    }

    private func applyAllSlotUserAgentPresets() {
        for slot in slots {
            webModel(for: slot.id).applyUserAgentPreset(userAgentPreset(for: slot.id))
        }
    }

    private func fetchProjectTree(rpcBaseURL: String, apiKey: String) async throws -> [ProjectTreeNode] {
        let restBase = normalizeRestEndpoint(rpcBaseURL)
        async let tagsRaw: [ProjectTagRow] = getJSONArray(
            endpoint: "\(restBase)/tags?select=id,name&order=name.asc",
            apiKey: apiKey,
            allow404: false
        )
        async let parentsRaw: [ProjectTagParentRow] = getJSONArray(
            endpoint: "\(restBase)/tag_parents?select=tag_id,parent_id",
            apiKey: apiKey,
            allow404: true
        )
        let (tags, tagParents) = try await (tagsRaw, parentsRaw)

        var namesById: [String: String] = [:]
        for row in tags {
            guard
                let id = row.id.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank,
                let name = row.name.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
            else { continue }
            namesById[id] = name
        }
        if namesById.isEmpty { return [] }

        var parentIdsByChild: [String: Set<String>] = [:]
        for row in tagParents {
            let childId = row.tagId?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
            let parentId = row.parentId?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
            guard let childId, namesById[childId] != nil else { continue }
            guard let parentId, namesById[parentId] != nil, parentId != childId else {
                parentIdsByChild[childId, default: []] = parentIdsByChild[childId, default: []]
                continue
            }
            parentIdsByChild[childId, default: []].insert(parentId)
        }
        for id in namesById.keys {
            parentIdsByChild[id, default: []] = parentIdsByChild[id, default: []]
        }

        var childrenByParent: [String?: [String]] = [:]
        for (childId, parentIds) in parentIdsByChild {
            if parentIds.isEmpty {
                childrenByParent[nil, default: []].append(childId)
            } else {
                for parentId in parentIds {
                    childrenByParent[parentId, default: []].append(childId)
                }
            }
        }
        for key in childrenByParent.keys {
            childrenByParent[key] = Array(Set(childrenByParent[key] ?? []))
                .sorted { (namesById[$0] ?? "").localizedCaseInsensitiveCompare(namesById[$1] ?? "") == .orderedAscending }
        }

        func buildNode(id: String, path: Set<String>) -> ProjectTreeNode {
            let nextPath = path.union([id])
            let childNodes = (childrenByParent[id] ?? [])
                .filter { !nextPath.contains($0) }
                .map { buildNode(id: $0, path: nextPath) }
            return ProjectTreeNode(id: id, name: namesById[id] ?? id, children: childNodes)
        }

        let roots = (childrenByParent[nil] ?? Array(namesById.keys))
            .sorted { (namesById[$0] ?? "").localizedCaseInsensitiveCompare(namesById[$1] ?? "") == .orderedAscending }
        return roots.map { buildNode(id: $0, path: []) }
    }

    private func normalizeRestEndpoint(_ baseInput: String) -> String {
        let base = baseInput.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let rpcMarker = "/rest/v1/rpc"
        let restMarker = "/rest/v1"
        if base.hasSuffix(rpcMarker) {
            return String(base.dropLast("/rpc".count))
        }
        if let range = base.range(of: "\(rpcMarker)/") {
            return String(base[..<range.lowerBound]) + restMarker
        }
        if base.hasSuffix(restMarker) {
            return base
        }
        if let range = base.range(of: "\(restMarker)/") {
            return String(base[..<range.lowerBound]) + restMarker
        }
        return base + restMarker
    }

    private func getJSONArray<T: Decodable & Sendable>(endpoint: String, apiKey: String, allow404: Bool) async throws -> [T] {
        guard let url = URL(string: endpoint) else {
            throw NSError(domain: "MobileAppState", code: 2101, userInfo: [NSLocalizedDescriptionKey: "Invalid project endpoint"])
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 8
        request.setValue(apiKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(domain: "MobileAppState", code: 2102, userInfo: [NSLocalizedDescriptionKey: "Missing project HTTP response"])
        }
        if allow404, http.statusCode == 404 { return [] }
        guard (200...299).contains(http.statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            if http.statusCode == 401 {
                throw NSError(
                    domain: "MobileAppState",
                    code: http.statusCode,
                    userInfo: [NSLocalizedDescriptionKey: "Invalid Dream Tracker API key"]
                )
            }
            throw NSError(domain: "MobileAppState", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "Project API error (\(http.statusCode)): \(text.prefix(200))"])
        }
        let decoder = JSONDecoder()
        return try decoder.decode([T].self, from: data)
    }

    private static func makeSessionIndicator(from state: ParallelIngestState) -> String? {
        if let sessionId = state.sessionId, !state.activeNoteId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "S\(sessionId)"
        }
        return nil
    }

    private func mergeSessions(
        remoteSessions: [SessionSnapshot],
        localSessions: [SessionSnapshot]
    ) -> [SessionSnapshot] {
        guard !(remoteSessions.isEmpty && localSessions.isEmpty) else { return [] }
        var byKey: [String: SessionSnapshot] = [:]

        for session in remoteSessions.sorted(by: { $0.timestamp > $1.timestamp }) {
            byKey[sessionMergeKey(session)] = session
        }

        for session in localSessions.sorted(by: { $0.timestamp > $1.timestamp }) {
            let key = sessionMergeKey(session)
            let overlapsRemote = remoteSessions.contains { sameSessionEntry($0, session) }
            if byKey[key] == nil && !overlapsRemote {
                byKey[key] = session
            }
        }

        return byKey.values
            .sorted(by: { $0.timestamp > $1.timestamp })
            .prefix(1000)
            .map { $0 }
    }

    private func sameSessionEntry(_ left: SessionSnapshot, _ right: SessionSnapshot) -> Bool {
        let leftNoteId = left.noteId?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
        let rightNoteId = right.noteId?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
        if let leftNoteId, let rightNoteId {
            return leftNoteId == rightNoteId
        }

        guard let leftSessionId = left.sessionId, let rightSessionId = right.sessionId, leftSessionId == rightSessionId else {
            return false
        }

        let leftName = left.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let rightName = right.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return !leftName.isEmpty && leftName == rightName
    }

    private func sessionMergeKey(_ session: SessionSnapshot) -> String {
        let sessionPart = session.sessionId.map(String.init) ?? "id:\(session.id)"
        let notePart = session.noteId?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank ?? "row:\(session.id)"
        return "\(sessionPart)|\(notePart)"
    }

    func displaySessionName(_ session: SessionSnapshot) -> String {
        let trimmed = session.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || Self.defaultSessionNamePattern.firstMatch(in: trimmed, options: [], range: NSRange(location: 0, length: trimmed.utf16.count)) != nil {
            return "Session"
        }
        return trimmed
    }

    func activeProjectDisplayName() -> String {
        guard let activeProjectId = activeProjectId?.trimmingCharacters(in: .whitespacesAndNewlines), !activeProjectId.isEmpty else {
            return "Projects"
        }
        if let matched = findProjectName(id: activeProjectId, nodes: projectTreeNodes) {
            return matched
        }
        return "Projects"
    }

    func sessionsForDisplay(matching query: String = "") -> [SessionSnapshot] {
        let sessions = sortSessionsForDisplay(availableSessions)
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalized.isEmpty else { return sessions }
        return sessions.filter { session in
            let sessionId = session.sessionId.map(String.init)?.lowercased() ?? ""
            let name = displaySessionName(session).lowercased()
            return sessionId.contains(normalized) || name.contains(normalized)
        }
    }

    static let defaultSessionNamePattern = try! NSRegularExpression(pattern: #"^\d{2}:\d{2}\s\d{2}\.\d{2}$"#)
    static let ingestEventTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

    private func sortSessionsForDisplay(_ sessions: [SessionSnapshot]) -> [SessionSnapshot] {
        sessions.sorted { left, right in
            if left.timestamp != right.timestamp {
                return left.timestamp > right.timestamp
            }
            if (left.sessionId ?? -1) != (right.sessionId ?? -1) {
                return (left.sessionId ?? -1) > (right.sessionId ?? -1)
            }
            return left.id > right.id
        }
    }

    private func findProjectName(id: String, nodes: [ProjectTreeNode]) -> String? {
        for node in nodes {
            if node.id == id {
                return node.name.trimmingCharacters(in: .whitespacesAndNewlines).ifEmpty("Projects")
            }
            if let nested = findProjectName(id: id, nodes: node.children) {
                return nested
            }
        }
        return nil
    }

    private func normalizePromptForComparison(_ value: String) -> String {
        value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    }

    private func promptsReferToSameQuestion(_ currentPrompt: String, _ storedPrompt: String) -> Bool {
        let current = normalizePromptForComparison(currentPrompt)
        let stored = normalizePromptForComparison(storedPrompt)
        return !current.isEmpty && !stored.isEmpty && current == stored
    }

    private func persistUserAgentPresets() {
        let raw = Dictionary(uniqueKeysWithValues: slotUserAgentPresets.map { (String($0.key), $0.value.rawValue) })
        UserDefaults.standard.set(raw, forKey: Self.slotUserAgentPresetsDefaultsKey)
    }
}

private extension Optional where Wrapped == String {
    var isNilOrBlank: Bool {
        self?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true
    }

    var nilIfBlank: String? {
        guard let value = self?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    func ifEmpty(_ fallback: String) -> String {
        isEmpty ? fallback : self
    }
}
