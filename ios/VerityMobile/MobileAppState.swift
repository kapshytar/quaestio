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

private struct SlotScrapeAttempt {
    let slot: SlotState
    let serviceId: String
    let result: SlotScrapeReply?
    let status: MergeAggregationSlotStatus
}

private struct ProjectSlotURLsTagRow: Decodable, Sendable {
    let id: String?
    let slotURLs: [String: JSONValue]?

    enum CodingKeys: String, CodingKey {
        case id
        case slotURLs = "slot_urls"
    }
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
    @Published private(set) var globalPhoneZoomPercent: Int = 90

    private static let slotsDefaultsKey = "verity.mobile.slots"
    private static let selectedSlotDefaultsKey = "verity.mobile.selectedSlotId"
    private static let slotUserAgentPresetsDefaultsKey = "verity.mobile.slotUserAgentPresets"
    private static let lastUserPromptDefaultsKey = "verity.mobile.lastUserPrompt"
    private static let globalPhoneZoomPercentDefaultsKey = "verity.mobile.globalPhoneZoomPercent"
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
    private var projectSlotURLLoadGeneration: Int = 0

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
        self.globalPhoneZoomPercent = Self.loadPersistedGlobalPhoneZoomPercent()
        let parallelState = sessionManager.getParallelIngestState()
        if self.lastUserPrompt.isEmpty, !parallelState.sourcePrompt.isEmpty {
            self.lastUserPrompt = parallelState.sourcePrompt
        }
        self.activeProjectId = nil
        self.sessionIndicatorText = Self.makeSessionIndicator(from: parallelState)
        if !hasActiveSessionLink() {
            self.slots = Self.slotsResetToPresetURLs(slots: self.slots, presets: presets)
        }

        applyAllSlotPresentationPresets()

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
        // Question identity semantics are documented centrally in
        // Verity/docs/domains/SESSION_AND_INGEST_RULES.md.
        // Keep iOS behavior aligned with Android there; do not invent local rules here.
        let hadCurrentQuestionContext = currentQuestionSessionId() != nil && currentQuestionAggregatedNoteId() != nil
        let loadedQuestionPrompt = sessionManager.getParallelIngestState().sourcePrompt
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .ifEmpty(lastUserPrompt.trimmingCharacters(in: .whitespacesAndNewlines))
        let shouldResetQuestionContext = hadCurrentQuestionContext && !promptsReferToSameQuestion(message, loadedQuestionPrompt)

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
            if shouldResetQuestionContext {
                sessionManager.startNewQuestionInCurrentSession(sourcePrompt: message)
            } else if !hadCurrentQuestionContext {
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
        let loadGeneration = projectSlotURLLoadGeneration + 1
        projectSlotURLLoadGeneration = loadGeneration

        if let resolvedProjectId {
            statusMessage = "Project changed; loading slot URLs…"
            Task {
                let serviceUrls = await loadProjectSlotURLsByService(projectId: resolvedProjectId)
                await MainActor.run {
                    guard self.projectSlotURLLoadGeneration == loadGeneration, self.activeProjectId == resolvedProjectId else { return }
                    self.applyProjectSlotURLs(serviceUrls)
                    self.statusMessage = "Project changed; session reset"
                }
            }
            return
        }

        applyProjectSlotURLs([:])
        statusMessage = "Project cleared; session reset"
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
            statusMessage = localSessions.isEmpty ? "No saved sessions" : ""
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
        statusMessage = sessions.isEmpty ? "No saved sessions" : ""
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
            let storedURL = session.slotURLs[slotKey]?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
            let liveURL = session.slotLiveURLs[slotKey]?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
            // On cold restore, canonical slot URLs should win over stale live URLs from
            // earlier in-app navigation history.
            let resolvedURL = storedURL
                ?? liveURL
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
        applyAllSlotPresentationPresets()
        if let firstEnabledSlot = updatedSlots.first(where: \.isEnabled)?.id {
            selectedSlotId = firstEnabledSlot
        }

        sessionManager.updateSessionLink(
            sessionId: session.sessionId,
            noteId: session.noteId,
            sourcePrompt: session.name
        )

        // For note-backed sessions, always target the latest note in the chain
        // as the active aggregated note, so new questions attach as children
        // of the current tip instead of creating parallel roots.
        if let sessionId = session.sessionId, !session.noteId.isNilOrBlank {
            Task {
                await sessionManager.refreshActiveNoteIdForSession(sessionId)
            }
        }

        updateSessionIndicator()
        lastUserPrompt = session.name.trimmingCharacters(in: .whitespacesAndNewlines)
        persistLastUserPrompt(lastUserPrompt)

        for slot in updatedSlots {
            webModel(for: slot.id).forceLoad(url: slot.url)
        }

        statusMessage = ""
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
        let result = await scrapeRepliesRecoveringPromptIfNeeded(sourcePrompt: sourcePrompt)
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
        if hasLoadedQuestionContext && !sameQuestionAsCurrentRoot {
            sessionManager.startNewQuestionInCurrentSession(sourcePrompt: prompt)
            updateSessionIndicator()
        }
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
            appendIngestEvent("collect-abort no-enabled-slots")
            return [:]
        }

        appendIngestEvent("collect-start enabledSlots=\(enabledSlots.count)")

        let maxChecks = max(1, mergeAggregationPolicy.maxChecks)
        let waitIntervalNs = UInt64(max(0, mergeAggregationPolicy.waitIntervalMs)) * 1_000_000
        let settleDelayNs = UInt64(max(0, mergeAggregationPolicy.settleDelayMs)) * 1_000_000
        let minimumRepliesRequired = max(1, mergeAggregationPolicy.minimumRepliesRequired)
        var lastResult = await scrapeRepliesRecoveringPromptIfNeeded(sourcePrompt: sourcePrompt)
        mergeAggregationSnapshots = lastResult.snapshots
        mergeAggregationSummary = formatAggregationSummary(lastResult.snapshots)
        appendIngestEvent("collect-after-scrape responses=\(lastResult.responses.count) snapshots=\(lastResult.snapshots.map { "\($0.id):\($0.status.rawValue)" }.joined(separator: ", "))")

        for attempt in 1..<maxChecks {
            if lastResult.responses.count >= enabledSlots.count {
                if settleDelayNs > 0 {
                    try? await Task.sleep(nanoseconds: settleDelayNs)
                    lastResult = await scrapeRepliesRecoveringPromptIfNeeded(sourcePrompt: sourcePrompt)
                    mergeAggregationSnapshots = lastResult.snapshots
                }
                if lastResult.responses.count >= enabledSlots.count {
                    mergeAggregationSummary = "All \(enabledSlots.count) slot(s) ready. Collecting now..."
                    appendIngestEvent("collect-success all-ready responses=\(lastResult.responses.count)")
                    return lastResult.responses
                }
                mergeAggregationSummary = formatAggregationSummary(lastResult.snapshots)
            }

            let readyCount = lastResult.responses.count
            mergeAggregationSummary = "Waiting for replies: \(readyCount)/\(enabledSlots.count) ready"
            statusMessage = "Waiting for replies: \(readyCount)/\(enabledSlots.count) ready"
            try? await Task.sleep(nanoseconds: waitIntervalNs)

            lastResult = await scrapeRepliesRecoveringPromptIfNeeded(sourcePrompt: sourcePrompt)
            mergeAggregationSnapshots = lastResult.snapshots
            mergeAggregationSummary = formatAggregationSummary(lastResult.snapshots)

            if attempt == maxChecks - 1 {
                break
            }
        }

        if mergeAggregationPolicy.allowPartialResults && lastResult.responses.count >= minimumRepliesRequired {
            mergeAggregationSummary = "Collected \(lastResult.responses.count)/\(enabledSlots.count) source reply(s)"
            appendIngestEvent("collect-partial responses=\(lastResult.responses.count)/\(enabledSlots.count)")
        } else {
            mergeAggregationSummary = "Aggregation still waiting. Use Collect now or refresh statuses."
            appendIngestEvent("collect-incomplete responses=\(lastResult.responses.count)/\(enabledSlots.count)")
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
        webModel(for: selectedSlotId).applyPageZoom(Self.phoneZoomScale(percent: globalPhoneZoomPercent))
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

    func setGlobalPhoneZoomPercent(_ percent: Int) {
        let normalized = min(max(percent, 70), 100)
        guard globalPhoneZoomPercent != normalized else { return }
        globalPhoneZoomPercent = normalized
        UserDefaults.standard.set(normalized, forKey: Self.globalPhoneZoomPercentDefaultsKey)
        applyAllSlotPresentationPresets()
        statusMessage = "Phone zoom: \(normalized)%"
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
        // Shared semantics reference:
        // Verity/docs/domains/SESSION_AND_INGEST_RULES.md
        let state = sessionManager.getParallelIngestState()
        let activeRootId = currentQuestionAggregatedNoteId()
        if !activeRootId.isNilOrBlank, let sessionId = state.sessionId {
            return sessionId
        }
        return !activeRootId.isNilOrBlank ? restoreStoredQuestionContextForCurrentSlots()?.sessionId : nil
    }

    private func currentQuestionAggregatedNoteId() -> String? {
        let direct = sessionManager.getParallelIngestState().activeNoteId.nilIfBlank
        if !direct.isNilOrBlank { return direct }
        return restoreStoredQuestionContextForCurrentSlots()?.noteId.nilIfBlank
    }

    private func updateSessionIndicator() {
        sessionIndicatorText = Self.makeSessionIndicator(from: sessionManager.getParallelIngestState())
    }

    private func appendIngestEvent(_ message: String) {
        let stamp = Self.ingestEventTimeFormatter.string(from: Date())
        recentIngestEvents.insert("[\(stamp)] \(message)", at: 0)
        if recentIngestEvents.count > 40 {
            recentIngestEvents = Array(recentIngestEvents.prefix(40))
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

        let existingSessionId = sessionManager.getParallelIngestState().sessionId ?? currentQuestionSessionId()
        let traceId = sessionManager.ensureTraceId()
        let sequence = sessionManager.nextSequence()
        let sessionOrTmp = existingSessionId.map(String.init) ?? sessionManager.ensureExternalChatId()
        let idempotencyKey = AggregatedIngestClient.buildIdempotencyKey(
            kind: "aggregated",
            sessionIdOrTmp: sessionOrTmp,
            sequence: sequence,
            traceId: traceId
        )

        // DEBUG: Log ingest details
        appendIngestEvent("ingest-start seq=\(sequence) session=\(existingSessionId ?? -1) responses=\(responses.count) replace=\(replaceExisting)")

        let slotSourceURLs = currentSessionSnapshotSlotURLs()
        let scrapeMeta = slots
            .filter(\.isEnabled)
            .compactMap { slot -> IngestScrapeMetaRow? in
                guard responses[slot.title] != nil, let preset = presets[slot.serviceId] else { return nil }
                let slotKey = "slot-\(slot.id)"
                return IngestScrapeMetaRow(
                    slot: slot.id - 1,
                    serviceName: slot.title,
                    serviceId: preset.id,
                    sourceURL: slotSourceURLs[slotKey] ?? slot.url
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

        // DEBUG: Log payload info
        appendIngestEvent("ingest-payload responses=\(responses.count) sessionId=\(existingSessionId ?? -1)")

        let result = try await AggregatedIngestClient.sendAggregated(
            rpcBaseURL: rpcBaseURL,
            apiKey: apiKey,
            payload: payload,
            traceId: traceId,
            idempotencyKey: idempotencyKey,
            scrapeMeta: scrapeMeta,
            detailedLogging: true
        )

        // DEBUG: Log result
        appendIngestEvent("ingest-result sessionId=\(result.sessionId ?? -1) noteId=\(result.noteId ?? "nil") replay=\(result.idempotentReplay)")

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
                slotURLs: currentSessionSnapshotSlotURLs(),
                noteId: result.noteId,
                slotLiveURLs: currentSessionSnapshotSlotURLs()
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

    private func scrapeRepliesRecoveringPromptIfNeeded(sourcePrompt: String) async -> (responses: [String: String], snapshots: [MergeAggregationSlotSnapshot]) {
        // Prompt recovery priority is shared product semantics.
        // See Verity/docs/domains/SESSION_AND_INGEST_RULES.md before changing this flow.
        let initial = await scrapeRepliesDetailed(sourcePrompt: sourcePrompt)
        guard shouldRetryScrapeWithRecoveredPrompt(initial.attempts, currentPrompt: sourcePrompt) else {
            return (initial.responses, initial.snapshots)
        }

        let recoveredPrompt = resolveSourcePromptFromScrapeAttempts(initial.attempts)
        guard !recoveredPrompt.isEmpty, !promptsReferToSameQuestion(recoveredPrompt, sourcePrompt) else {
            return (initial.responses, initial.snapshots)
        }

        sessionManager.rememberSourcePrompt(recoveredPrompt)
        lastUserPrompt = recoveredPrompt
        persistLastUserPrompt(recoveredPrompt)

        let retried = await scrapeRepliesDetailed(sourcePrompt: recoveredPrompt)
        return (retried.responses, retried.snapshots)
    }

    private func scrapeReplies(sourcePrompt: String) async -> (responses: [String: String], snapshots: [MergeAggregationSlotSnapshot]) {
        let detailed = await scrapeRepliesDetailed(sourcePrompt: sourcePrompt)
        return (detailed.responses, detailed.snapshots)
    }

    private func scrapeRepliesDetailed(sourcePrompt: String) async -> (responses: [String: String], snapshots: [MergeAggregationSlotSnapshot], attempts: [SlotScrapeAttempt]) {
        var collected: [String: String] = [:]
        var snapshots: [MergeAggregationSlotSnapshot] = []
        var attempts: [SlotScrapeAttempt] = []

        for slot in slots where slot.isEnabled {
            guard let preset = presets[slot.serviceId] else { continue }
            let model = webModel(for: slot.id)
            let scrapeResult = await model.collectLatestReply(serviceId: preset.id, sourcePrompt: sourcePrompt)
            let scrapedText = scrapeResult?.text?.trimmingCharacters(in: .whitespacesAndNewlines)

            if let scrapedText, !scrapedText.isEmpty {
                collected[slot.title] = scrapedText
                let status: MergeAggregationSlotStatus = .ready
                snapshots.append(MergeAggregationSlotSnapshot(id: slot.id, title: slot.title, status: status))
                let attempt = SlotScrapeAttempt(slot: slot, serviceId: preset.id, result: scrapeResult, status: status)
                attempts.append(attempt)
                appendIngestEvent(formatScrapeAttemptLog(attempt))
            } else if await model.isStillGenerating(serviceId: preset.id) || isSlotLikelyStillWorking(model) {
                let status: MergeAggregationSlotStatus = .waiting
                snapshots.append(MergeAggregationSlotSnapshot(id: slot.id, title: slot.title, status: status))
                let attempt = SlotScrapeAttempt(slot: slot, serviceId: preset.id, result: scrapeResult, status: status)
                attempts.append(attempt)
                appendIngestEvent(formatScrapeAttemptLog(attempt))
            } else {
                let status: MergeAggregationSlotStatus = .error
                snapshots.append(MergeAggregationSlotSnapshot(id: slot.id, title: slot.title, status: status))
                let attempt = SlotScrapeAttempt(slot: slot, serviceId: preset.id, result: scrapeResult, status: status)
                attempts.append(attempt)
                appendIngestEvent(formatScrapeAttemptLog(attempt))
            }
        }

        return (collected, snapshots, attempts)
    }

    private func formatScrapeAttemptLog(_ attempt: SlotScrapeAttempt) -> String {
        let result = attempt.result
        let textLen = result?.text?.trimmingCharacters(in: .whitespacesAndNewlines).count ?? 0
        let method = (result?.method ?? "none").trimmingCharacters(in: .whitespacesAndNewlines).ifEmpty("none")
        let error = (result?.error ?? "").trimmingCharacters(in: .whitespacesAndNewlines).ifEmpty("none")
        let promptCandidate = (result?.promptCandidateText ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\n", with: " ")
            .ifEmpty("none")
        let debugTrace = (result?.debugTrace ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\n", with: " | ")
            .ifEmpty("none")
        let collectorTrace = (result?.collectorTrace ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\n", with: " | ")
            .ifEmpty("none")
        let debugSnippet = String(debugTrace.prefix(120))
        let collectorSnippet = String(collectorTrace.prefix(140))
        let promptSnippet = String(promptCandidate.prefix(80))

        var parts: [String] = [
            "slot=\(attempt.slot.id)",
            "provider=\(attempt.serviceId)",
            "method=\(method)",
            "status=\(attempt.status.rawValue)",
            "textLen=\(textLen)"
        ]

        if error != "none" {
            parts.append("error=\(error)")
        }

        if collectorTrace != "none" {
            parts.append("collector=\(collectorSnippet)")
        }

        if error != "none" && promptCandidate != "none" {
            parts.append("prompt=\(promptSnippet)")
        }

        if error != "none" && debugTrace != "none" {
            parts.append("debug=\(debugSnippet)")
        }

        return parts.joined(separator: " ")
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

    private func currentSessionSnapshotSlotURLs() -> [String: String] {
        Dictionary(uniqueKeysWithValues: slots.map { slot in
            let liveURL = webModel(for: slot.id)
                .currentLocationHref
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return ("slot-\(slot.id)", liveURL.isEmpty ? slot.url : liveURL)
        })
    }

    private func restoreStoredQuestionContextForCurrentSlots() -> SessionSnapshot? {
        let enabledSlotKeys = Set(slots.filter(\.isEnabled).map { "slot-\($0.id)" })
        if enabledSlotKeys.isEmpty { return nil }

        let currentFingerprint = buildSessionFingerprint(slotURLs: currentSessionSnapshotSlotURLs(), slotKeys: enabledSlotKeys)
        if currentFingerprint.isEmpty { return nil }

        let currentSourcePrompt = sessionManager.getParallelIngestState().sourcePrompt
            .trimmingCharacters(in: .whitespacesAndNewlines)

        let matching = sessionManager.getAllSessions().first { snapshot in
            guard snapshot.sessionId != nil, !(snapshot.noteId ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return false
            }
            guard buildSessionFingerprint(slotURLs: snapshot.slotURLs, slotKeys: enabledSlotKeys) == currentFingerprint else {
                return false
            }
            return currentSourcePrompt.isEmpty || promptsReferToSameQuestion(currentSourcePrompt, snapshot.name)
        }

        guard let matching else { return nil }
        sessionManager.updateSessionLink(
            sessionId: matching.sessionId,
            noteId: matching.noteId,
            sourcePrompt: matching.name
        )
        updateSessionIndicator()
        return matching
    }

    private func buildSessionFingerprint(slotURLs: [String: String], slotKeys: Set<String>) -> String {
        let parts = slotKeys.sorted().compactMap { slotKey -> String? in
            let rawURL = slotURLs[slotKey]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if rawURL.isEmpty { return nil }
            let slotIndex = Int(slotKey.replacingOccurrences(of: "slot-", with: ""))
            let serviceId = slots.first(where: { $0.id == slotIndex })?.serviceId ?? "unknown"
            return "\(slotKey):\(extractConversationKey(serviceId: serviceId, rawURL: rawURL))"
        }
        return parts.isEmpty ? "" : parts.joined(separator: "|")
    }

    private func extractConversationKey(serviceId: String?, rawURL: String?) -> String {
        let sid = serviceId?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? "unknown"
        let fallback = "\(sid):no-url"
        let trimmedURL = rawURL?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmedURL.isEmpty { return fallback }

        guard let url = URL(string: trimmedURL), let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return "\(sid):\(trimmedURL.lowercased())"
        }

        let segments = url.pathComponents
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty && $0 != "/" }

        func firstAfter(_ label: String) -> String? {
            guard let index = segments.firstIndex(of: label), index + 1 < segments.count else { return nil }
            return segments[index + 1]
        }

        func looksLikeID(_ value: String?) -> Bool {
            let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
            guard normalized.count >= 6 else { return false }
            return normalized.range(of: #"^[a-z0-9][a-z0-9_-]*$"#, options: .regularExpression) != nil
        }

        var chatID: String?
        switch sid {
        case "chatgpt":
            chatID = firstAfter("c") ?? firstAfter("chat")
            if chatID == nil,
               components.queryItems?.contains(where: { $0.name.lowercased() == "temporary-chat" }) == true {
                chatID = "temporary"
            }
        case "claude":
            chatID = firstAfter("chat")
        case "deepseek":
            chatID = firstAfter("s") ?? firstAfter("chat")
        case "perplexity":
            chatID = firstAfter("search")
        case "grok":
            chatID = firstAfter("c") ?? firstAfter("chat")
        case "gemini":
            chatID = firstAfter("app") ?? firstAfter("chat")
        default:
            chatID = nil
        }

        if chatID == nil, looksLikeID(segments.last) {
            chatID = segments.last
        }

        if let chatID, !chatID.isEmpty {
            return "\(sid):\(chatID)"
        }

        if !segments.isEmpty {
            return "\(sid):\(segments.joined(separator: "/"))"
        }

        return "\(sid):\(components.host?.lowercased() ?? "")"
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

    private func applyAllSlotPresentationPresets() {
        for slot in slots {
            webModel(for: slot.id).applyUserAgentPreset(userAgentPreset(for: slot.id))
            webModel(for: slot.id).applyPageZoom(Self.phoneZoomScale(percent: globalPhoneZoomPercent))
        }
    }

    private static let defaultPhoneZoomScale: CGFloat = 0.9

    private static func loadPersistedGlobalPhoneZoomPercent() -> Int {
        let raw = UserDefaults.standard.integer(forKey: globalPhoneZoomPercentDefaultsKey)
        if raw == 0 { return 90 }
        return min(max(raw, 70), 100)
    }

    private static func phoneZoomScale(percent: Int) -> CGFloat {
        CGFloat(min(max(percent, 70), 100)) / 100
    }

    private static func defaultPageZoomScale(for preset: ServicePreset) -> CGFloat {
        let percent = preset.phoneZoomPercent ?? 90
        return phoneZoomScale(percent: percent)
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

    private func loadProjectSlotURLsByService(projectId: String) async -> [String: String] {
        let rpcBaseURL = KeyObfuscation.getSupabaseRPCURL(nil)
        let apiKey = KeyObfuscation.getSupabaseAPIKey(nil)
        guard !rpcBaseURL.isEmpty, !apiKey.isEmpty else { return [:] }

        let restBase = normalizeRestEndpoint(rpcBaseURL)
        let encodedProjectId = projectId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? projectId
        let endpoint = "\(restBase)/tags?select=id,slot_urls&id=eq.\(encodedProjectId)&limit=1"

        guard let url = URL(string: endpoint) else { return [:] }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 8
        request.setValue(apiKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        do {
            let rows: [ProjectSlotURLsTagRow] = try await getJSONArray(
                endpoint: endpoint,
                apiKey: apiKey,
                allow404: false
            )
            guard let slotObject = rows.first?.slotURLs else { return [:] }

            var result: [String: String] = [:]
            for (key, value) in slotObject {
                let parsed = parseProjectSlotURL(value)
                if !parsed.isEmpty {
                    let normalizedKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
                    result[normalizedKey] = parsed
                    result[normalizedKey.lowercased()] = parsed
                }
            }
            return result
        } catch {
            return [:]
        }
    }

    private func parseProjectSlotURL(_ value: JSONValue) -> String {
        if let string = value.stringValue {
            return string.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if case let .object(object) = value {
            if let direct = object["url"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), !direct.isEmpty {
                return direct
            }
            if let fallback = object["value"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), !fallback.isEmpty {
                return fallback
            }
        }
        return ""
    }

    private func buildProjectURLLookupKeys(slotIndex: Int, serviceId: String) -> [String] {
        let normalizedServiceId = serviceId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let slotKey = "slot-\(slotIndex + 1)"
        return Array(Set([slotKey, normalizedServiceId]))
    }

    private func applyProjectSlotURLs(_ projectURLs: [String: String]) {
        let updatedSlots = slots.enumerated().map { index, slot -> SlotState in
            let overrideURL = buildProjectURLLookupKeys(slotIndex: index, serviceId: slot.serviceId)
                .lazy
                .compactMap { key -> String? in
                    let candidate = projectURLs[key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    return candidate.isEmpty ? nil : candidate
                }
                .first

            let targetURL = overrideURL ?? presets[slot.serviceId]?.url ?? slot.url
            var updated = slot
            updated.url = targetURL
            return updated
        }

        slots = updatedSlots
        for slot in updatedSlots {
            webModel(for: slot.id).forceLoad(url: slot.url)
        }
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

    private func normalizeCollectedPromptCandidate(_ value: String) -> String {
        value
            .replacingOccurrences(
                of: #"^\s*(?:you said|you asked|user(?: asked| said)?|вы сказали|ты спросил[аи]?|ты сказал[аи]?)\s*[:\-]?\s*"#,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
            .replacingOccurrences(
                of: #"\s*##\s*(?:chatgpt|gemini|claude|grok|perplexity)\s+said\b[\s\S]*$"#,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
            .replacingOccurrences(
                of: #"\s*(?:chatgpt|gemini|claude|grok|perplexity)\s+said\b[\s\S]*$"#,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
            .replacingOccurrences(of: #"^[#>*\s"'`]+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"[\s"'`]+$"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func shouldRetryScrapeWithRecoveredPrompt(_ attempts: [SlotScrapeAttempt], currentPrompt: String) -> Bool {
        let promptMismatchAttempts = attempts.filter {
            $0.status == .error && $0.result?.error == "Selected reply belongs to a previous prompt"
        }
        guard promptMismatchAttempts.count >= max(2, attempts.count / 2) else { return false }
        let recoveredPrompt = resolveSourcePromptFromScrapeAttempts(attempts)
        guard !recoveredPrompt.isEmpty else { return false }
        return !promptsReferToSameQuestion(recoveredPrompt, currentPrompt)
    }

    private func resolveSourcePromptFromScrapeAttempts(_ attempts: [SlotScrapeAttempt]) -> String {
        struct PromptAggregate {
            var prompt: String
            var count: Int
            var totalScore: Double
        }

        var aggregates: [String: PromptAggregate] = [:]

        for attempt in attempts {
            guard let result = attempt.result else { continue }
            let rawPrompt = result.promptCandidateText.trimmingCharacters(in: .whitespacesAndNewlines)
            let prompt = normalizeCollectedPromptCandidate(rawPrompt)
            guard !prompt.isEmpty else { continue }

            let normalizedKey = normalizePromptForComparison(prompt)
            guard !normalizedKey.isEmpty else { continue }

            let preview = result.rawResult.lowercased()
            let normalizedPrompt = prompt.lowercased()
            var score = 100.0
            if preview.contains(normalizedPrompt) { score += 80.0 }
            if rawPrompt.range(of: #"^\s*(?:you said|you asked|вы сказали)"#, options: [.regularExpression, .caseInsensitive]) != nil {
                score += 30.0
            }
            if prompt.count >= 20 { score += 20.0 }
            if prompt.count <= 8 { score -= 40.0 }
            score += Double(min(prompt.count, 120)) / 10.0

            if var existing = aggregates[normalizedKey] {
                existing.count += 1
                existing.totalScore += score
                if prompt.count > existing.prompt.count {
                    existing.prompt = prompt
                }
                aggregates[normalizedKey] = existing
            } else {
                aggregates[normalizedKey] = PromptAggregate(prompt: prompt, count: 1, totalScore: score)
            }
        }

        return aggregates.values
            .sorted {
                if $0.count != $1.count { return $0.count > $1.count }
                if $0.totalScore != $1.totalScore { return $0.totalScore > $1.totalScore }
                return $0.prompt.count > $1.prompt.count
            }
            .first?.prompt ?? ""
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
