import Foundation
import WebKit

enum MergeAggregationSlotStatus: String {
    case ready
    case waiting
    case collected
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
    @Published var activeProjectPathKey: String? = nil
    @Published var projectTreeNodes: [ProjectTreeNode] = []
    @Published var availableSessions: [SessionSnapshot] = []
    @Published var isLoadingSessions: Bool = false
    @Published var sessionIndicatorText: String? = nil
    @Published var isManualCollecting: Bool = false
    @Published var recentIngestEvents: [String] = []
    @Published private(set) var slotUserAgentPresets: [Int: UserAgentPreset] = [:]
    @Published private(set) var lastUserPrompt: String = ""
    @Published private(set) var globalPhoneZoomPercent: Int = 90
    /// Number of local-only sessions (`session_id >= 900000`) found at sign-in
    /// that can be uploaded to the account. Drives the migration alert. 0 = hidden.
    @Published var pendingLocalMigrationCount: Int = 0
    // Set when a Supabase call found the account session expired (refresh token
    // rejected). The UI shows a "session expired — sign in again" alert instead
    // of silently degrading to stale local sessions while in account mode.
    @Published var sessionExpiredPrompt: Bool = false

    // Prompt actually typed and sent from the composer during THIS app run.
    // In-memory on purpose (not persisted): the scrape seed must never fall
    // back to a stale prior-run prompt or a loaded session's name.
    private var freshlySentPromptThisRun: String = ""

    private static let slotsDefaultsKey = "verity.mobile.slots"
    private static let selectedSlotDefaultsKey = "verity.mobile.selectedSlotId"
    private static let slotUserAgentPresetsDefaultsKey = "verity.mobile.slotUserAgentPresets"
    private static let lastUserPromptDefaultsKey = "verity.mobile.lastUserPrompt"
    private static let globalPhoneZoomPercentDefaultsKey = "verity.mobile.globalPhoneZoomPercent"
    private static let projectTreeDefaultsKey = "verity.mobile.projectTree.v2"
    private static let projectTreeLoadedAtDefaultsKey = "verity.mobile.projectTreeLoadedAt"
    private static let sessionsLoadedAtDefaultsKey = "verity.mobile.sessionsLoadedAt"
    private static let remoteListCacheTTL: TimeInterval = 24 * 60 * 60
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
        self.activeProjectPathKey = nil
        self.projectTreeNodes = Self.loadPersistedProjectTree()
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
        let contextSessionId = await currentQuestionSessionId()
        let contextNoteId = await currentQuestionAggregatedNoteId()
        let hadCurrentQuestionContext = contextSessionId != nil && contextNoteId != nil
        let contextMatchesCurrentSlots = hasCurrentQuestionContextForCurrentSlots()
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
            freshlySentPromptThisRun = message
            let expectedSlots = activeSlots.count
            let signedIn = await AuthStore.shared.accessToken() != nil
            // The question-context reset (clearing the parallel-ingest session id
            // so a new question starts a new note) only applies to the signed-in
            // ingest path. Offline there are no notes, so this branch would fire on
            // every send (hadCurrentQuestionContext is always false), wiping the
            // local session id and making saveLocalSession allocate a fresh
            // S9000xx each time. Keep the local session stable across consecutive
            // offline questions (one session per layout, matching desktop); the
            // user can start a new one via Clear Active Session.
            if signedIn {
                if !hadCurrentQuestionContext || !contextMatchesCurrentSlots {
                    sessionManager.clearParallelIngestState()
                    sessionManager.rememberSourcePrompt(message)
                } else if shouldResetQuestionContext {
                    sessionManager.startNewQuestionInCurrentSession(sourcePrompt: message)
                }
            } else {
                // Offline: remember the latest prompt for the (reused) local
                // session name, but do NOT clear its session id.
                sessionManager.rememberSourcePrompt(message)
            }
            updateSessionIndicator()
            composerText = ""
            if signedIn {
                Task {
                    await startParallelAggregatedIngest(prompt: message, expectedSlots: expectedSlots)
                }
            } else {
                // Local-only mode: no backend ingest. Save the current slot
                // layout as a local session so it can be reopened (parity with
                // the signed-in auto-save, but on-device only).
                await saveLocalSession(prompt: message)
            }
        }
    }

    /// Local-only session save: persists the current slot layout (config/URLs/
    /// enabled + name + a local session number) to the on-device store. No
    /// backend call. Reuses the current question's local number when continuing
    /// the same context, else allocates a new one.
    private func saveLocalSession(prompt: String) async {
        var state = sessionManager.getParallelIngestState()
        let localId: Int
        // Only reuse a session id that is itself local (>= 900000). A leftover
        // real backend id (e.g. from a prior signed-in session) must NOT be
        // reused — it would collide with a real DB session and hide the row from
        // late-login migration. Allocate a fresh local number instead.
        if let existing = state.sessionId, existing >= Self.localSessionBase {
            localId = existing
        } else {
            localId = sessionManager.nextLocalSessionNumber()
            state.sessionId = localId
            sessionManager.replaceParallelIngestState(state)
        }
        let slotURLs = currentSessionSnapshotSlotURLs()
        _ = sessionManager.saveCurrentSession(
            name: String(prompt.prefix(500)).ifEmpty("Session"),
            dreamSessionId: localId,
            slotStates: slots,
            slotURLs: slotURLs,
            noteId: nil,
            slotLiveURLs: slotURLs
        )
        updateSessionIndicator()
        // Visible confirmation (parity with Android's "Saved locally" toast) and
        // a diagnostic anchor: if this shows, the signed-out save path ran.
        statusMessage = "Saved locally (S\(localId))"
        await loadSessions(forceRefresh: false)
    }

    // MARK: - Late-login session migration

    private static let localSessionBase = 900_000

    /// Called after a successful sign-in. Starts the account with a clean slate:
    /// drops any pre-login question context and suppresses slot-fingerprint
    /// restore (so the next question opens a fresh session instead of resurrecting
    /// an old one sharing the slot layout), then raises the migration prompt if
    /// there are local-only sessions to upload.
    /// Maps backend errors to user-facing status text: the RPCs' raw
    /// `account_pending_approval` rejection becomes the friendly invite-pending
    /// message; everything else passes through unchanged.
    private static func friendlyErrorText(_ error: Error) -> String {
        let text = error.localizedDescription
        return text.contains("account_pending_approval") ? AuthStore.pendingApprovalMessage : text
    }

    func detectLocalSessionsForMigration() {
        sessionManager.clearParallelIngestState()
        sessionManager.suppressSlotRestore = true
        updateSessionIndicator()
        let count = sessionManager.getAllSessions().filter {
            ($0.sessionId ?? 0) >= Self.localSessionBase
        }.count
        pendingLocalMigrationCount = count
    }

    func dismissLocalSessionMigration() {
        pendingLocalMigrationCount = 0
    }

    /// Upload local-only sessions to the account via the gated bridge `save`
    /// (carries the JWT now that we are signed in, so the backend stamps
    /// owner_id = auth.uid()). Migrated copies are removed locally so the next
    /// refresh shows the now-owned rows from the DB. See AUTH_AND_SESSION_SYNC.md.
    func confirmLocalSessionMigration() async {
        let locals = sessionManager.getAllSessions().filter {
            ($0.sessionId ?? 0) >= Self.localSessionBase
        }
        pendingLocalMigrationCount = 0
        guard !locals.isEmpty else { return }

        var migratedIds = Set<String>()
        for session in locals {
            if await SessionManager.migrateLocalSession(session) {
                migratedIds.insert(session.id)
            }
        }

        if !migratedIds.isEmpty {
            let remaining = sessionManager.getAllSessions().filter { !migratedIds.contains($0.id) }
            sessionManager.replaceSessions(remaining)
        }
        statusMessage = migratedIds.count == locals.count
            ? "Uploaded \(migratedIds.count) local session(s) to your account."
            : "Uploaded \(migratedIds.count) of \(locals.count) local session(s); the rest stayed local."
        await loadSessions(forceRefresh: true)
    }

    func setActiveProject(_ projectId: String?) {
        let normalized = projectId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedProjectId = (normalized?.isEmpty == false) ? normalized : nil
        if let resolvedProjectId,
           let node = findProjectNode(id: resolvedProjectId, pathKey: nil, nodes: projectTreeNodes) {
            setActiveProject(node)
            return
        }
        applyActiveProject(
            id: resolvedProjectId,
            pathKey: resolvedProjectId,
            inheritedSlotURLs: [:]
        )
    }

    func setActiveProject(_ project: ProjectTreeNode) {
        applyActiveProject(
            id: project.id,
            pathKey: project.pathKey,
            inheritedSlotURLs: project.slotURLs
        )
    }

    private func applyActiveProject(id: String?, pathKey: String?, inheritedSlotURLs: [String: String]) {
        guard activeProjectId != id || activeProjectPathKey != pathKey else { return }

        activeProjectId = id
        activeProjectPathKey = pathKey
        sessionManager.clearCurrentSessionLink(preservingProject: false)
        persistWorkspaceState()
        sessionManager.setActiveProjectId(activeProjectId)
        updateSessionIndicator()
        let loadGeneration = projectSlotURLLoadGeneration + 1
        projectSlotURLLoadGeneration = loadGeneration

        if let resolvedProjectId = id {
            statusMessage = "Project changed; loading slot URLs…"
            Task {
                let serviceUrls = inheritedSlotURLs.isEmpty
                    ? await loadProjectSlotURLsByService(projectId: resolvedProjectId)
                    : inheritedSlotURLs
                await MainActor.run {
                    guard self.projectSlotURLLoadGeneration == loadGeneration,
                          self.activeProjectId == resolvedProjectId,
                          self.activeProjectPathKey == pathKey
                    else { return }
                    self.applyProjectSlotURLs(serviceUrls)
                    self.statusMessage = "Project changed; session reset"
                }
            }
            return
        }

        applyProjectSlotURLs([:])
        activeProjectPathKey = nil
        statusMessage = "Project cleared; session reset"
    }

    func clearActiveSessionSelection() {
        sessionManager.clearCurrentSessionLink(preservingProject: true)
        persistWorkspaceState()
        updateSessionIndicator()
        statusMessage = "Cleared active session"
    }

    func loadProjectTree(forceRefresh: Bool = false) async {
        if !forceRefresh, !projectTreeNodes.isEmpty, Self.isFreshRemoteListCache(Self.loadPersistedProjectTreeLoadedAt()) {
            return
        }

        let rpcBaseURL = KeyObfuscation.getSupabaseRPCURL(nil)
        let apiKey = KeyObfuscation.getSupabaseAPIKey(nil)
        guard !rpcBaseURL.isEmpty, !apiKey.isEmpty else {
            statusMessage = "Dream Tracker API key is missing"
            return
        }

        do {
            projectTreeNodes = try await fetchProjectTree(rpcBaseURL: rpcBaseURL, apiKey: apiKey)
            Self.persistProjectTree(projectTreeNodes)
            Self.persistProjectTreeLoadedAt(Date())
            statusMessage = projectTreeNodes.isEmpty ? "No projects found" : "Loaded \(projectTreeNodes.count) root project(s)"
        } catch {
            statusMessage = error.localizedDescription
            if projectTreeNodes.isEmpty {
                projectTreeNodes = Self.loadPersistedProjectTree()
            }
        }
    }

    /// Diagnostic: stored (decoded from disk) vs currently-shown session counts.
    /// Surfaced in Settings → Shell diagnostics so a "saved but not listed" bug
    /// is visible on-device without log tooling.
    var diagnosticSessionCounts: String {
        "stored \(sessionManager.getAllSessions().count) / shown \(availableSessions.count)"
    }

    func loadProjectTreeIfNeeded() async {
        await loadProjectTree()
    }

    func loadSessions(forceRefresh: Bool = false) async {
        let localSessions = sessionManager.getAllSessions()
        availableSessions = sortSessionsForDisplay(localSessions)
        if !forceRefresh, Self.isFreshRemoteListCache(Self.loadPersistedSessionsLoadedAt()) {
            return
        }

        let rpcBaseURL = KeyObfuscation.getSupabaseRPCURL(nil)
        let apiKey = KeyObfuscation.getSupabaseAPIKey(nil)
        guard !rpcBaseURL.isEmpty, !apiKey.isEmpty else {
            statusMessage = localSessions.isEmpty ? "No saved sessions" : ""
            return
        }

        isLoadingSessions = true
        defer { isLoadingSessions = false }

        let remoteSessions = await SessionManager.loadSessionsFromDatabase()
        // If the load found the account session expired (refresh rejected),
        // surface it rather than quietly showing stale local sessions.
        if AuthStore.consumeSessionExpired() {
            sessionExpiredPrompt = true
        }
        let sessions: [SessionSnapshot]
        if !remoteSessions.isEmpty {
            // Cloud is the source of truth for cloud sessions, but it never
            // contains local-only sessions (session_id >= 900000, saved while
            // signed out and not yet migrated). A plain replace wiped those from
            // the on-device list. Preserve any local-only session the cloud
            // doesn't already represent so signing in never deletes a pending
            // local session before the user migrates it.
            let remoteSessionIds = Set(remoteSessions.compactMap { $0.sessionId })
            let localOnly = localSessions.filter {
                ($0.sessionId ?? 0) >= Self.localSessionBase && !remoteSessionIds.contains($0.sessionId ?? 0)
            }
            let combined = remoteSessions + localOnly
            sessionManager.replaceSessions(combined)
            sessions = combined
        } else {
            let merged = mergeSessions(remoteSessions: remoteSessions, localSessions: localSessions)
            if !merged.isEmpty {
                sessionManager.replaceSessions(merged)
            }
            sessions = merged.isEmpty ? localSessions : merged
        }

        availableSessions = sortSessionsForDisplay(sessions)
        Self.persistSessionsLoadedAt(Date())
        statusMessage = sessions.isEmpty ? "No saved sessions" : ""
    }

    func loadSessionsIfNeeded() async {
        await loadSessions()
    }

    /// Delete one saved session (parity with Android/desktop). Removes it from
    /// the on-device store and the visible list immediately, then deletes it on
    /// the backend (fire-and-forget; signed out the remote call is a no-op and
    /// the local removal still stands).
    func deleteSession(_ session: SessionSnapshot) {
        sessionManager.deleteSession(session.id)
        availableSessions.removeAll { $0.id == session.id }
        if availableSessions.isEmpty {
            statusMessage = "No saved sessions"
        }
        Task {
            let ok = await SessionManager.deleteSessionFromDatabase(session)
            if AuthStore.consumeSessionExpired() {
                sessionExpiredPrompt = true
            }
            print("[deleteSession] id=\(session.id) session=\(session.sessionId ?? -1) backend=\(ok ? "ok" : "skipped/failed")")
        }
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

        // DEBUG: Log session slot config and URLs for debugging
        print("[loadSession] session=\(session.sessionId ?? -1) noteId=\(session.noteId ?? "nil")")
        for slotKey in ["slot-1", "slot-2", "slot-3", "slot-4"] {
            let svc = session.slotConfig[slotKey] ?? "unknown"
            let url = session.slotURLs[slotKey] ?? "none"
            print("[loadSession]   \(slotKey) -> \(svc) @ \(url.prefix(60))")
        }

        // Restore the session's project (if any). Project IDENTITY only — going
        // through setActiveProject(_:) would clearCurrentSessionLink + re-apply
        // the project's slot URLs, clobbering the session URLs just restored
        // above. Mirrors applyActiveProject minus the slot-URL application.
        if let snapshotProjectId = session.projectTagId?.trimmingCharacters(in: .whitespacesAndNewlines),
           !snapshotProjectId.isEmpty,
           snapshotProjectId != activeProjectId {
            let node = findProjectNode(id: snapshotProjectId, pathKey: nil, nodes: projectTreeNodes)
            activeProjectId = snapshotProjectId
            activeProjectPathKey = node?.pathKey ?? snapshotProjectId
            persistWorkspaceState()
            sessionManager.setActiveProjectId(snapshotProjectId)
        }

        // Explicit load = the user chose this session; normal continuation
        // (incl. slot-fingerprint restore) is intended again.
        sessionManager.suppressSlotRestore = false
        sessionManager.updateSessionLink(
            sessionId: session.sessionId,
            noteId: session.noteId,
            sourcePrompt: session.name
        )

        // For note-backed sessions, point the active aggregated note at the
        // chain TAIL (last root by created_at), so Collect updates the tail and
        // new questions attach as children of the current tip instead of
        // creating parallel roots.
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

    /// Scrape-seed prompt (mirrors Android scrapeSeedPrompt): (1) freshly typed
    /// composer text, else (2) prompt actually sent from the composer THIS run,
    /// else (3) the chain-tail note's title resolved by
    /// refreshActiveNoteIdForSession, else empty — an empty seed lets the
    /// scraper take the latest DOM reply and prompt recovery re-scope it.
    /// Never a loaded session's name / persisted prior-run prompt: after Load
    /// that is q1's text while Collect targets the chain tail (root-overwrite bug).
    func resolvedMergeSourcePrompt() -> String {
        let composer = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !composer.isEmpty {
            return composer
        }
        let fresh = freshlySentPromptThisRun.trimmingCharacters(in: .whitespacesAndNewlines)
        if !fresh.isEmpty {
            return fresh
        }
        return (sessionManager.getParallelIngestState().activeNoteTitle ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
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

        isManualCollecting = true
        defer { isManualCollecting = false }

        if hasActiveSessionLink() && !hasCurrentQuestionContextForCurrentSlots() {
            sessionManager.clearParallelIngestState()
            updateSessionIndicator()
        }
        // Resolve context BEFORE the scrape seed: currentQuestionAggregatedNoteId
        // re-resolves the chain tail (id + title), and the tail title is the
        // scrape-seed fallback when nothing fresh was typed this run.
        let existingAggregatedNoteId = await currentQuestionAggregatedNoteId()
        let existingSessionId = await currentQuestionSessionId()

        // Canonical Collect model: always update the chain TAIL with the latest
        // replies; never create a note inside an existing session — new notes
        // come only from the send-new-question path. Question matching happens
        // at scrape level (prompt-scoped freshness), not in note targeting.
        let replaceExisting = existingAggregatedNoteId != nil && existingSessionId != nil
        let targetAggregatedNoteId = replaceExisting ? existingAggregatedNoteId : nil

        // Scrape seed: fresh composer/sent prompt this run, else the tail note's
        // title just resolved above, else empty (unscoped scrape + DOM prompt
        // recovery). NEVER a loaded session's name — after Load that is q1's
        // text while the tail is qN (the session-295 root-overwrite bug).
        let prompt = resolvedMergeSourcePrompt()
        guard !prompt.isEmpty || replaceExisting else {
            // No fresh prompt and no tail to update — nothing Collect can target.
            statusMessage = "Type a prompt or send one first"
            return nil
        }
        if !prompt.isEmpty {
            sessionManager.rememberSourcePrompt(prompt)
        }

        appendIngestEvent("Collect start • \(String(prompt.ifEmpty("<recover-from-dom>").prefix(60)))")

        let responses = await collectLatestRepliesForMerge(sourcePrompt: prompt, manual: true)
        guard !responses.isEmpty else {
            statusMessage = "No source replies to collect"
            appendIngestEvent("Collect empty • no replies")
            return nil
        }

        appendIngestEvent("Collected \(responses.count) reply(s) • \(responses.keys.sorted().joined(separator: ", "))")

        // With an empty seed the scrape recovery above may have found the real
        // prompt in the DOM (it lands in sourcePrompt/lastUserPrompt); use it as
        // the ingest title rather than sending an empty one.
        let ingestPrompt = prompt
            .ifEmpty(sessionManager.getParallelIngestState().sourcePrompt.trimmingCharacters(in: .whitespacesAndNewlines))
            .ifEmpty(lastUserPrompt.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !ingestPrompt.isEmpty else {
            statusMessage = "Could not identify the current question"
            appendIngestEvent("Collect abort • no prompt recovered for ingest")
            return nil
        }

        do {
            let result = try await ingestCollectedResponses(
                prompt: ingestPrompt,
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
            statusMessage = Self.friendlyErrorText(error)
            appendIngestEvent("Collect failed • \(error.localizedDescription)")
            return nil
        }
    }

    /// - Parameter manual: mirrors Android's manual Collect (MainActivity.collectNowAggregation,
    ///   called from MergeFragment.collectNowAggregationManually) which does a single immediate
    ///   scrape with no text-stability gate. Android's stability gate (stableSlotCount) only
    ///   lives in the auto-wait path (MergeFragment.waitForAggregationReadyOrPause). When
    ///   manual=true here, stabilizeResponses is skipped so any slot with non-empty text counts
    ///   as ready immediately — the per-slot scrape guards (S180, echo-reject, etc.) still apply
    ///   since they run inside scrapeRepliesRecoveringPromptIfNeeded. Still-generating slots
    ///   (empty text) are still polled in the existing loop so they get a chance to arrive.
    func collectLatestRepliesForMerge(sourcePrompt: String, manual: Bool = false) async -> [String: String] {
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
        // Streaming-completion guard: a slot's text can be non-empty while ChatGPT
        // (or any provider) is still streaming it. A slot only counts as "ready"
        // once its text is unchanged from the previous poll of that same slot
        // (see stabilizeResponses below). previousSlotTexts carries the last-seen
        // text per slot title across poll iterations so we can detect that.
        var previousSlotTexts: [String: String] = [:]
        // Last raw non-empty text per slot, stable or not — the timeout path
        // falls back to it so an oscillating slot degrades to a possibly-partial
        // reply (old behavior) instead of dropping the provider entirely.
        var latestSlotTexts: [String: String] = [:]
        func stabilizeResponses(_ raw: [String: String]) -> [String: String] {
            var stable: [String: String] = [:]
            var unstable: [String] = []
            for (title, text) in raw {
                // Compare trimmed so trailing-whitespace jitter between scrapes
                // does not keep a finished reply permanently "unstable".
                let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
                // Manual Collect (Android parity: collectNowAggregation has no
                // stability gate, only the auto-wait path does) takes any
                // non-empty text as ready immediately instead of requiring it
                // unchanged across two polls.
                if manual ? !normalized.isEmpty : previousSlotTexts[title] == normalized {
                    stable[title] = text
                } else {
                    unstable.append("\(title):\(normalized.count)")
                }
                previousSlotTexts[title] = normalized
                if !normalized.isEmpty {
                    latestSlotTexts[title] = text
                }
            }
            if !unstable.isEmpty {
                appendIngestEvent("collect-unstable \(unstable.joined(separator: ", "))")
            }
            return stable
        }

        var lastResult = await scrapeRepliesRecoveringPromptIfNeeded(sourcePrompt: sourcePrompt)
        lastResult.responses = stabilizeResponses(lastResult.responses)
        mergeAggregationSnapshots = lastResult.snapshots
        mergeAggregationSummary = formatAggregationSummary(lastResult.snapshots)
        appendIngestEvent("collect-after-scrape responses=\(lastResult.responses.count) snapshots=\(lastResult.snapshots.map { "\($0.id):\($0.status.rawValue)" }.joined(separator: ", "))")

        for attempt in 1..<maxChecks {
            if lastResult.responses.count >= enabledSlots.count {
                if settleDelayNs > 0 {
                    try? await Task.sleep(nanoseconds: settleDelayNs)
                    lastResult = await scrapeRepliesRecoveringPromptIfNeeded(sourcePrompt: sourcePrompt)
                    lastResult.responses = stabilizeResponses(lastResult.responses)
                    mergeAggregationSnapshots = lastResult.snapshots
                }
                if lastResult.responses.count >= enabledSlots.count {
                    let collectedSnapshots = makeCollectedSnapshots(enabledSlots: enabledSlots, responses: lastResult.responses)
                    mergeAggregationSnapshots = collectedSnapshots
                    // BUG-A FIX: prior code set "Collecting now..." here then returned
                    // immediately, leaving the summary permanently stuck at that transient
                    // string. Android MergeFragment shows "Collected N/M" after the loop;
                    // mirror that terminal state so the user sees a settled status.
                    mergeAggregationSummary = "Collected \(lastResult.responses.count)/\(enabledSlots.count) source reply(s)"
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
            lastResult.responses = stabilizeResponses(lastResult.responses)
            mergeAggregationSnapshots = lastResult.snapshots
            mergeAggregationSummary = formatAggregationSummary(lastResult.snapshots)

            if attempt == maxChecks - 1 {
                break
            }
        }

        // Timeout: keep every provider we ever saw text from. A slot that never
        // stabilized (its text still changed on the last polls) falls back to its
        // latest non-empty scrape — possibly partial, but not silently dropped.
        var finalResponses = lastResult.responses
        for slot in enabledSlots where finalResponses[slot.title] == nil {
            if let last = latestSlotTexts[slot.title] {
                finalResponses[slot.title] = last
                appendIngestEvent("collect-timeout-fallback slot=\(slot.title) len=\(last.count)")
            }
        }

        if mergeAggregationPolicy.allowPartialResults && finalResponses.count >= minimumRepliesRequired {
            let collectedSnapshots = makeCollectedSnapshots(enabledSlots: enabledSlots, responses: finalResponses)
            mergeAggregationSnapshots = collectedSnapshots
            mergeAggregationSummary = "Collected \(finalResponses.count)/\(enabledSlots.count) source reply(s)"
            appendIngestEvent("collect-partial responses=\(finalResponses.count)/\(enabledSlots.count)")
        } else {
            mergeAggregationSummary = "Aggregation still waiting. Use Collect now or refresh statuses."
            appendIngestEvent("collect-incomplete responses=\(finalResponses.count)/\(enabledSlots.count)")
        }

        return mergeAggregationPolicy.allowPartialResults && finalResponses.count >= minimumRepliesRequired
            ? finalResponses
            : [:]
    }

    /// Builds post-collect snapshots mirroring Android's MergeFragment behaviour:
    /// after replies are collected, slots that contributed a response become
    /// `.collected`; the rest become `.error`. Mirrors:
    ///   status = if (hasResponse) AggregationSlotStatus.COLLECTED else AggregationSlotStatus.ERROR
    private func makeCollectedSnapshots(enabledSlots: [SlotState], responses: [String: String]) -> [MergeAggregationSlotSnapshot] {
        enabledSlots.map { slot in
            let hasResponse = responses[slot.title] != nil
            return MergeAggregationSlotSnapshot(
                id: slot.id,
                title: slot.title,
                status: hasResponse ? .collected : .error
            )
        }
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

    /// Persists a finished merge or clarification response to the dream-tracker DB.
    /// If no aggregated root exists for the current question, this method first
    /// bootstraps one via Collect Now, then attaches the merge to that root.
    /// Mirrors Android's sendMergeNoteToDreamTracker / sendClarificationNoteToDreamTracker
    /// flow (kept in sync via tools/ingest-parity-check.sh).
    // ingest-parity: BOOTSTRAP_BEFORE_MERGE
    // `prebuiltResponses` lets the caller reuse the same scrape result that fed
    // the LLM merge call, so the bootstrap path does not re-scrape (which could
    // pick up a different / staler reply set than the one the merge actually
    // summarized). Pass nil only when no fresh scrape is available (e.g. cold
    // entry points outside MergeView.runMerge).
    func persistMergeMarkdown(
        _ markdown: String,
        sourcePrompt: String,
        isClarification: Bool,
        prebuiltResponses: [String: String]? = nil
    ) async -> Bool {
        let trimmedMarkdown = markdown.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedMarkdown.isEmpty else {
            appendIngestEvent("merge-persist abort empty-markdown")
            return false
        }

        let rpcBaseURL = KeyObfuscation.getSupabaseRPCURL(nil)
        let apiKey = KeyObfuscation.getSupabaseAPIKey(nil)
        guard !rpcBaseURL.isEmpty, !apiKey.isEmpty else {
            appendIngestEvent("merge-persist abort no-credentials")
            return false
        }

        // ingest-parity: BOOTSTRAP_BEFORE_MERGE
        // Merge cannot attach to a question root that does not exist yet, and must
        // not silently attach to a stale root from a previous question in the same
        // logical session. If either is missing, run Collect Now first so the
        // merge lands on the correct aggregated root.
        var sessionId = await currentQuestionSessionId()
        var aggregatedNoteId = await currentQuestionAggregatedNoteId()
        let storedPrompt = sessionManager.getParallelIngestState().sourcePrompt
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let promptMatchesLoadedRoot = !storedPrompt.isEmpty
            && promptsReferToSameQuestion(sourcePrompt, storedPrompt)
        let needsBootstrap = sessionId == nil
            || aggregatedNoteId == nil
            || !promptMatchesLoadedRoot

        if needsBootstrap {
            if let prebuilt = prebuiltResponses, !prebuilt.isEmpty {
                // Reuse the scrape that fed the LLM merge instead of triggering a
                // second scrape pass against potentially-different slot DOM state.
                // This is what keeps the aggregated root content consistent with
                // what the merge actually summarized.
                appendIngestEvent("merge-persist bootstrap reuse-responses (count=\(prebuilt.count) session=\(sessionId.map(String.init) ?? "-") note=\(aggregatedNoteId ?? "-") match=\(promptMatchesLoadedRoot))")
                do {
                    let result = try await ingestCollectedResponses(
                        prompt: sourcePrompt,
                        responses: prebuilt,
                        replaceExisting: false,
                        aggregatedNoteId: nil
                    )
                    sessionId = result.sessionId ?? sessionId
                    aggregatedNoteId = result.noteId ?? aggregatedNoteId
                } catch {
                    appendIngestEvent("merge-persist bootstrap reuse-failed • \(error.localizedDescription)")
                }
            } else {
                appendIngestEvent("merge-persist bootstrap collect-now (session=\(sessionId.map(String.init) ?? "-") note=\(aggregatedNoteId ?? "-") match=\(promptMatchesLoadedRoot))")
                if let bootstrap = await manualCollectCurrentQuestion() {
                    sessionId = bootstrap.sessionId ?? sessionId
                    aggregatedNoteId = bootstrap.noteId ?? aggregatedNoteId
                }
            }
        }

        guard let resolvedSessionId = sessionId else {
            appendIngestEvent("merge-persist abort no-session-after-bootstrap")
            return false
        }

        let traceId = sessionManager.ensureTraceId()
        let sequence = sessionManager.nextSequence()
        let kind = isClarification ? "clarification" : "merge"
        let idempotencyKey = AggregatedIngestClient.buildIdempotencyKey(
            kind: kind,
            sessionIdOrTmp: String(resolvedSessionId),
            sequence: sequence,
            traceId: traceId
        )

        let trimmedPrompt = sourcePrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = String(trimmedPrompt.prefix(120)).ifEmpty(isClarification ? "Clarification" : "Merge")

        do {
            if isClarification {
                let payload = ClarificationIngestPayload(
                    sessionId: resolvedSessionId,
                    title: title,
                    promptText: trimmedPrompt,
                    markdown: trimmedMarkdown
                )
                _ = try await AggregatedIngestClient.sendClarification(
                    rpcBaseURL: rpcBaseURL,
                    apiKey: apiKey,
                    payload: payload,
                    traceId: traceId,
                    idempotencyKey: idempotencyKey,
                    detailedLogging: true
                )
                appendIngestEvent("clarification-persist ok session=\(resolvedSessionId)")
            } else {
                let payload = MergeIngestPayload(
                    sessionId: resolvedSessionId,
                    aggregatedNoteId: aggregatedNoteId,
                    title: title,
                    promptText: trimmedPrompt,
                    markdown: trimmedMarkdown
                )
                _ = try await AggregatedIngestClient.sendMerge(
                    rpcBaseURL: rpcBaseURL,
                    apiKey: apiKey,
                    payload: payload,
                    traceId: traceId,
                    idempotencyKey: idempotencyKey,
                    detailedLogging: true
                )
                appendIngestEvent("merge-persist ok session=\(resolvedSessionId) note=\(aggregatedNoteId ?? "-")")
            }
            return true
        } catch {
            appendIngestEvent("\(kind)-persist failed • \(error.localizedDescription)")
            return false
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

    private func currentQuestionSessionId() async -> Int? {
        // Shared semantics reference:
        // Verity/docs/domains/SESSION_AND_INGEST_RULES.md
        let activeRootId = await currentQuestionAggregatedNoteId()
        guard !activeRootId.isNilOrBlank else { return nil }
        // Re-read state AFTER the await: currentQuestionAggregatedNoteId may have
        // just restored the session link (and tail-refreshed activeNoteId); a
        // pre-await snapshot would miss that and trigger a redundant second
        // restore, which re-links activeNoteId to the snapshot root and can lose
        // the first call's successful tail refresh.
        if let sessionId = sessionManager.getParallelIngestState().sessionId {
            return sessionId
        }
        return await restoreStoredQuestionContextForCurrentSlots()?.sessionId
    }

    private func currentQuestionAggregatedNoteId() async -> String? {
        let state = sessionManager.getParallelIngestState()
        let direct = state.activeNoteId.nilIfBlank
        if !direct.isNilOrBlank {
            // Already-linked in-memory/persisted state bypasses
            // restoreStoredQuestionContextForCurrentSlots entirely (that path
            // only runs when activeNoteId is still empty), so it never got the
            // chain re-resolve restore does. A stale link left over from an
            // earlier ingest in this run (or a prior app launch) can still point
            // at the chain root while the chain has grown (the session-295
            // root-overwrite bug) — re-resolve to the chain TAIL (last root by
            // created_at) before trusting it: Collect always updates the tail
            // and never creates a note.
            if let sessionId = state.sessionId {
                await sessionManager.refreshActiveNoteIdForSession(sessionId)
                return sessionManager.getParallelIngestState().activeNoteId.nilIfBlank ?? direct
            }
            return direct
        }
        return await restoreStoredQuestionContextForCurrentSlots()?.noteId.nilIfBlank
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

        var existingSessionId = sessionManager.getParallelIngestState().sessionId
        if existingSessionId == nil {
            existingSessionId = await currentQuestionSessionId()
        }
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

        let slotSourceURLs = await currentSessionSnapshotSlotURLsFresh()
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
            // A fresh ingest established the active session; normal
            // slot-fingerprint continuation is safe again.
            sessionManager.suppressSlotRestore = false
            let snapshot = sessionManager.saveCurrentSession(
                name: String(prompt.prefix(500)).ifEmpty("Session"),
                dreamSessionId: sessionId,
                slotStates: slots,
                slotURLs: slotSourceURLs,
                noteId: result.noteId,
                slotLiveURLs: slotSourceURLs
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
            let friendly = Self.friendlyErrorText(error)
            statusMessage = friendly == AuthStore.pendingApprovalMessage
                ? friendly
                : "Auto-collect failed: \(friendly)"
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
        // Mirror Android AggregationStatusFormatter.summarize:
        // READY and COLLECTED both count as "ready" for summary purposes.
        let readyCount = snapshots.filter { $0.status == .ready || $0.status == .collected }.count
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

    private static func isFreshRemoteListCache(_ date: Date?) -> Bool {
        guard let date else { return false }
        return Date().timeIntervalSince(date) < remoteListCacheTTL
    }

    private static func loadPersistedProjectTree() -> [ProjectTreeNode] {
        guard let data = UserDefaults.standard.data(forKey: projectTreeDefaultsKey) else { return [] }
        return (try? JSONDecoder().decode([ProjectTreeNode].self, from: data)) ?? []
    }

    private static func persistProjectTree(_ nodes: [ProjectTreeNode]) {
        guard let data = try? JSONEncoder().encode(nodes) else { return }
        UserDefaults.standard.set(data, forKey: projectTreeDefaultsKey)
    }

    private static func loadPersistedProjectTreeLoadedAt() -> Date? {
        let value = UserDefaults.standard.double(forKey: projectTreeLoadedAtDefaultsKey)
        guard value > 0 else { return nil }
        return Date(timeIntervalSince1970: value)
    }

    private static func persistProjectTreeLoadedAt(_ date: Date) {
        UserDefaults.standard.set(date.timeIntervalSince1970, forKey: projectTreeLoadedAtDefaultsKey)
    }

    private static func loadPersistedSessionsLoadedAt() -> Date? {
        let value = UserDefaults.standard.double(forKey: sessionsLoadedAtDefaultsKey)
        guard value > 0 else { return nil }
        return Date(timeIntervalSince1970: value)
    }

    private static func persistSessionsLoadedAt(_ date: Date) {
        UserDefaults.standard.set(date.timeIntervalSince1970, forKey: sessionsLoadedAtDefaultsKey)
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

    private func currentSessionSnapshotSlotURLsFresh() async -> [String: String] {
        var result: [String: String] = [:]
        for slot in slots {
            let liveURL = await webModel(for: slot.id)
                .resolveCurrentLocationHrefForSnapshot()
                .trimmingCharacters(in: .whitespacesAndNewlines)
            result["slot-\(slot.id)"] = liveURL.isEmpty ? slot.url : liveURL
        }
        return result
    }

    private func restoreStoredQuestionContextForCurrentSlots() async -> SessionSnapshot? {
        // After sign-in / migration, do not resurrect a pre-login session by slot
        // layout alone — the next question must start fresh.
        if sessionManager.suppressSlotRestore { return nil }
        let enabledSlotKeys = Set(slots.filter(\.isEnabled).map { "slot-\($0.id)" })
        if enabledSlotKeys.isEmpty { return nil }

        let currentSlotURLs = currentSessionSnapshotSlotURLs()
        let currentFingerprint = buildSessionFingerprint(slotURLs: currentSlotURLs, slotKeys: enabledSlotKeys)
        if currentFingerprint.isEmpty { return nil }
        // Only resurrect a prior session when the CURRENT slots point at a real,
        // identifiable conversation (chatgpt.com/c/<id>, …). A Temporary Chat or
        // a fresh home page has no conversation id, so extractConversationKey
        // degrades to a generic origin (or "temporary") that collides with any
        // old session that reduced to the same origin — that's how a new question
        // got attached to stale session 158 on Android. Desktop sidesteps this by
        // keying context on the exact real-conversation fingerprint; mirror that.
        if !fingerprintHasRealConversation(slotURLs: currentSlotURLs, slotKeys: enabledSlotKeys) { return nil }

        let currentSourcePrompt = sessionManager.getParallelIngestState().sourcePrompt
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let sessions = sessionManager.getAllSessions()
        func fingerprintMatches(_ snapshot: SessionSnapshot) -> Bool {
            guard snapshot.sessionId != nil, !(snapshot.noteId ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return false
            }
            return buildSessionFingerprint(slotURLs: snapshot.slotURLs, slotKeys: enabledSlotKeys) == currentFingerprint
        }
        // Prompt match is a PREFERENCE, not a filter: with several question
        // snapshots sharing one fingerprint, prefer the one whose name matches
        // the current prompt (old behavior, e.g. replacing an old question).
        // But a full fingerprint match alone still restores — a NEW prompt in
        // the same browser conversation is the next turn of the same session,
        // not a new session (the 288/295 split bug). Unrelated to the S180
        // in-page reply-selection guard in scrapeReply.js, which is untouched.
        let matching = sessions.first { snapshot in
            fingerprintMatches(snapshot)
                && !currentSourcePrompt.isEmpty
                && promptsReferToSameQuestion(currentSourcePrompt, snapshot.name)
        } ?? sessions.first(where: fingerprintMatches)

        guard let matching else { return nil }
        sessionManager.updateSessionLink(
            sessionId: matching.sessionId,
            noteId: matching.noteId,
            sourcePrompt: matching.name
        )
        // Late Collect must land on the current TAIL of the chain (last root by
        // created_at), not the root the session snapshot was created from —
        // refreshActiveNoteIdForSession overwrites activeNoteId set above when
        // a later note exists. Collect updates the tail, never creates a note.
        if let sessionId = matching.sessionId {
            let noteIdBeforeRefresh = sessionManager.getParallelIngestState().activeNoteId
            await sessionManager.refreshActiveNoteIdForSession(sessionId)
            let noteIdAfterRefresh = sessionManager.getParallelIngestState().activeNoteId
            if noteIdAfterRefresh == noteIdBeforeRefresh {
                // Either the root IS the tail, or the refresh silently failed
                // (network error / signed out) and we stayed on the snapshot
                // root — leave a diagnostic trace either way.
                appendIngestEvent("restore-tail-refresh no-op session=\(sessionId) note=\(noteIdBeforeRefresh.ifEmpty("-"))")
            }
        }
        updateSessionIndicator()
        return matching
    }

    private func hasCurrentQuestionContextForCurrentSlots() -> Bool {
        let state = sessionManager.getParallelIngestState()
        guard let activeSessionId = state.sessionId,
              let activeNoteId = state.activeNoteId.nilIfBlank
        else { return false }

        let enabledSlotKeys = Set(slots.filter(\.isEnabled).map { "slot-\($0.id)" })
        if enabledSlotKeys.isEmpty { return false }

        // Per-slot conversation key + whether the slot currently points at a real,
        // loaded conversation (vs a home/landing/blank page mid-load). Real-ness
        // uses the shared `conversationKeyTailIsReal` so this matcher and
        // `fingerprintHasRealConversation` cannot drift apart.
        func keyInfo(forSlotKey slotKey: String, in urls: [String: String]) -> (key: String, isReal: Bool) {
            let slotIndex = Int(slotKey.replacingOccurrences(of: "slot-", with: ""))
            let serviceId = slots.first(where: { $0.id == slotIndex })?.serviceId ?? "unknown"
            let rawURL = urls[slotKey]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let key = extractConversationKey(serviceId: serviceId, rawURL: rawURL)
            return (key, !rawURL.isEmpty && conversationKeyTailIsReal(key))
        }

        // On iOS the WKWebViews are recreated on cold start / app relaunch and on
        // `loadSession` re-navigation, so a Collect can fire before a slot has
        // navigated back to its conversation URL — its live URL is briefly the
        // service home page. Comparing the whole fingerprint then fails and the
        // session is wrongly cleared (→ a new note_session_id). Instead, ignore
        // slots that are not yet on a real conversation and require at least one
        // loaded slot to agree with the stored snapshot; a slot pointing at a
        // *different* real conversation is treated as a genuine context switch.
        let currentSlotURLs = currentSessionSnapshotSlotURLs()

        return sessionManager.getAllSessions().contains { snapshot in
            guard snapshot.sessionId == activeSessionId,
                  (snapshot.noteId ?? "").trimmingCharacters(in: .whitespacesAndNewlines) == activeNoteId
            else { return false }

            var agreements = 0
            for slotKey in enabledSlotKeys {
                let current = keyInfo(forSlotKey: slotKey, in: currentSlotURLs)
                let stored = keyInfo(forSlotKey: slotKey, in: snapshot.slotURLs)
                guard current.isReal, stored.isReal else { continue }
                if current.key == stored.key { agreements += 1 } else { return false }
            }
            // Require a loaded slot to agree. A new chat (slots still on home /
            // a different real conversation) yields no agreement → not a match →
            // a new session is correctly minted (preserves the 4b6e5a1 guard
            // against attaching a new question to a stale session).
            return agreements >= 1
        }
    }

    /// True when at least one enabled slot points at a real, identifiable
    /// conversation (a chat id), as opposed to a Temporary Chat, a home/landing
    /// page, or a blank slot whose `extractConversationKey` degrades to a generic
    /// origin. Gates slot-fingerprint restore so a new question on generic pages
    /// never resurrects an unrelated old session. Mirrors Android.
    private func fingerprintHasRealConversation(slotURLs: [String: String], slotKeys: Set<String>) -> Bool {
        slotKeys.contains { slotKey in
            let rawURL = slotURLs[slotKey]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if rawURL.isEmpty { return false }
            let slotIndex = Int(slotKey.replacingOccurrences(of: "slot-", with: ""))
            let serviceId = slots.first(where: { $0.id == slotIndex })?.serviceId ?? "unknown"
            let key = extractConversationKey(serviceId: serviceId, rawURL: rawURL)
            if conversationKeyTailIsReal(key) { return true }
            // Fallback: slot is still navigating to its conversation target (e.g.
            // right after loadSession / app relaunch). currentURL is momentarily
            // on the service home page, but loadedNavigationTarget already points
            // at the real chat — count the slot as real so fingerprint restore
            // can still find session 298 instead of minting a new 303.
            if let idx = slotIndex, let model = webModels[idx] {
                return model.pendingNavigationIsRealConversation
            }
            return false
        }
    }

    /// True when a conversation key's tail is an actual chat id (a single
    /// [a-z0-9_-] token of length >= 6), not a service home page (host has a
    /// dot), a multi-segment path (has a slash), an origin fallback (has "://"),
    /// a Temporary Chat, or a blank slot. `extractConversationKey` falls back to
    /// the bare host for a home page ("chatgpt:chatgpt.com"); that must NOT count
    /// as a real conversation, or a slot still loading the home page would look
    /// like a real-but-different conversation and wrongly clear the session.
    /// Single source of truth shared by the session matcher and
    /// `fingerprintHasRealConversation` so the two cannot drift.
    private func conversationKeyTailIsReal(_ key: String) -> Bool {
        let tail = key.contains(":") ? String(key[key.index(after: key.firstIndex(of: ":")!)...]) : ""
        if tail.isEmpty || tail == "temporary" || tail == "no-url" { return false }
        return tail.range(of: #"^[a-z0-9][a-z0-9_-]{5,}$"#, options: [.regularExpression, .caseInsensitive]) != nil
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
            endpoint: "\(restBase)/tags?select=id,name,slot_urls&order=name.asc",
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
        var slotURLsById: [String: [String: String]] = [:]
        for row in tags {
            guard
                let id = row.id.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank,
                let name = row.name.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
            else { continue }
            namesById[id] = name
            slotURLsById[id] = parseProjectSlotURLs(row.slotURLs)
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

        func buildNode(
            id: String,
            path: Set<String>,
            ancestorSlotURLs: [String: String],
            pathKey: String
        ) -> ProjectTreeNode {
            let nextPath = path.union([id])
            let inheritedSlotURLs = ancestorSlotURLs.merging(slotURLsById[id] ?? [:]) { _, child in child }
            let childNodes = (childrenByParent[id] ?? [])
                .filter { !nextPath.contains($0) }
                .map { buildNode(id: $0, path: nextPath, ancestorSlotURLs: inheritedSlotURLs, pathKey: "\(pathKey)>\($0)") }
            return ProjectTreeNode(
                id: id,
                pathKey: pathKey,
                name: namesById[id] ?? id,
                slotURLs: inheritedSlotURLs,
                children: childNodes
            )
        }

        let roots = (childrenByParent[nil] ?? Array(namesById.keys))
            .sorted { (namesById[$0] ?? "").localizedCaseInsensitiveCompare(namesById[$1] ?? "") == .orderedAscending }
        return roots.map { buildNode(id: $0, path: [], ancestorSlotURLs: [:], pathKey: $0) }
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

    private func parseProjectSlotURLs(_ slotObject: [String: JSONValue]?) -> [String: String] {
        guard let slotObject else { return [:] }
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
        // Gate: signed out = no remote reads (local-only mode).
        guard let authBearer = await AuthStore.shared.accessToken() else { return [] }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 8
        request.setValue(apiKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(authBearer)", forHTTPHeaderField: "Authorization")
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
        // Show the session id whenever one is active — including note-less local
        // sessions (session_id >= 900000, no aggregated note). Previously this
        // required a non-empty activeNoteId, so loading/saving a local session
        // left the indicator blank (desktop shows S<id> for any session id).
        if let sessionId = state.sessionId {
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

    func sessionsForDisplay(matching query: String = "", projectFilter: ProjectFilter = .all) -> [SessionSnapshot] {
        let sessions = sortSessionsForDisplay(availableSessions)
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        let projectFiltered: [SessionSnapshot]
        switch projectFilter {
        case .all:
            projectFiltered = sessions
        case .none:
            projectFiltered = sessions.filter { ($0.projectTagId ?? "").isEmpty }
        case .project(let id):
            // Stale-id fallback (parity with desktop/Android): a project deleted
            // from the tree behaves as All, not a silent zero-result filter.
            if !projectTreeNodes.isEmpty && findProjectNode(id: id, pathKey: nil, nodes: projectTreeNodes) == nil {
                projectFiltered = sessions
            } else {
                let allowedIds = collectProjectAndDescendantIds(id, in: projectTreeNodes)
                projectFiltered = sessions.filter { session in
                    guard let tagId = session.projectTagId, !tagId.isEmpty else { return false }
                    return allowedIds.contains(tagId)
                }
            }
        }

        guard !normalized.isEmpty else { return projectFiltered }
        return projectFiltered.filter { session in
            let sessionId = session.sessionId.map(String.init)?.lowercased() ?? ""
            let name = displaySessionName(session).lowercased()
            return sessionId.contains(normalized) || name.contains(normalized)
        }
    }

    enum ProjectFilter: Hashable {
        case all
        case none
        case project(String)
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
            if node.id == id && (activeProjectPathKey == nil || activeProjectPathKey == node.pathKey) {
                return node.name.trimmingCharacters(in: .whitespacesAndNewlines).ifEmpty("Projects")
            }
            if let nested = findProjectName(id: id, nodes: node.children) {
                return nested
            }
        }
        return nil
    }

    private func findProjectNode(id: String, pathKey: String?, nodes: [ProjectTreeNode]) -> ProjectTreeNode? {
        for node in nodes {
            if node.id == id && (pathKey == nil || pathKey == node.pathKey) {
                return node
            }
            if let nested = findProjectNode(id: id, pathKey: pathKey, nodes: node.children) {
                return nested
            }
        }
        return nil
    }

    // Faithful port of dream-tracker queries/tagGraph.ts collectDescendantTagIds — see
    // docs/PROJECT_SESSION_FILTER.md "Kernel port". Builds a parentId -> [childId] adjacency
    // by walking the whole forest once, then does an iterative stack walk from rootId with a
    // global-dedup Set (cycle-safe), instead of recursing only from the found node's own subtree.
    func collectProjectAndDescendantIds(_ projectId: String, in nodes: [ProjectTreeNode]) -> Set<String> {
        var childrenByParent: [String: [String]] = [:]
        func indexChildren(_ list: [ProjectTreeNode]) {
            for node in list {
                childrenByParent[node.id, default: []].append(contentsOf: node.children.map(\.id))
                indexChildren(node.children)
            }
        }
        indexChildren(nodes)

        var ids: Set<String> = [projectId]
        var stack: [String] = [projectId]
        while let cur = stack.popLast() {
            for child in childrenByParent[cur] ?? [] {
                guard !ids.contains(child) else { continue }
                ids.insert(child)
                stack.append(child)
            }
        }
        return ids
    }

    private func normalizePromptForComparison(_ value: String) -> String {
        value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    }

    // ingest-parity: STRIP_PROMPT_REPLY_WRAPPER
    // Removes mobile DOM "You said .. <Provider> responded/said .." wrapper from a
    // raw prompt candidate so the response body cannot bleed into an aggregated
    // note title. Mirrors Android's normalizeCollectedPromptCandidate (kept in
    // sync via tools/ingest-parity-check.sh).
    private func normalizeCollectedPromptCandidate(_ value: String) -> String {
        value
            .replacingOccurrences(
                of: #"^\s*(?:you said|you asked|user(?: asked| said)?|вы сказали|ты спросил[аи]?|ты сказал[аи]?)\s*[:\-]?\s*"#,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
            .replacingOccurrences(
                of: #"\s*##\s*(?:chatgpt|gemini|claude|grok|perplexity)\s+(?:said|responded|replied|answered)\b[\s\S]*$"#,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
            .replacingOccurrences(
                of: #"\s*(?:\([^)]{0,60}\)\s*)?(?:\d{1,2}:\d{2}(?:\s*[AP]M)?\s*)?(?:\d+\s*/\s*\d+\s*)?(?:chatgpt|gemini|claude|grok|perplexity)\s+(?:said|responded|replied|answered|ответил[аи]?|написал[аи]?)\b[\s\S]*$"#,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
            .replacingOccurrences(of: #"^[#>*\s"'`]+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"[\s"'`]+$"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func shouldRetryScrapeWithRecoveredPrompt(_ attempts: [SlotScrapeAttempt], currentPrompt: String) -> Bool {
        let recoveredPrompt = resolveSourcePromptFromScrapeAttempts(attempts)
        guard !recoveredPrompt.isEmpty else { return false }
        // Empty seed = the first pass ran UNSCOPED (no prompt gating in
        // scrapeReply.js); retry scoped to the DOM-recovered prompt so
        // prompt-scoped reply freshness still applies to the final result.
        if currentPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return true
        }
        let promptMismatchAttempts = attempts.filter {
            $0.status == .error && $0.result?.error == "Selected reply belongs to a previous prompt"
        }
        guard promptMismatchAttempts.count >= max(2, attempts.count / 2) else { return false }
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
