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
        self.lastUserPrompt = Self.loadPersistedLastUserPrompt()

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
            composerText = ""
        }
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
                mergeAggregationSummary = "All \(enabledSlots.count) slot(s) ready. Collecting now..."
                return lastResult.responses
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
        webModel(for: selectedSlotId).forceLoad(url: preset.url)
        statusMessage = "Switched to \(preset.name)"
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
        slotUserAgentPresets[slotId] ?? .systemDefault
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
            } else if isSlotLikelyStillWorking(model) {
                snapshots.append(MergeAggregationSlotSnapshot(id: slot.id, title: slot.title, status: .waiting))
            } else {
                snapshots.append(MergeAggregationSlotSnapshot(id: slot.id, title: slot.title, status: .error))
            }
        }

        return (collected, snapshots)
    }

    private func scrapeReplyText(from model: SlotWebViewModel, serviceId: String, sourcePrompt: String) async -> String? {
        guard let raw = await model.scrapeLatestReply(serviceId: serviceId, sourcePrompt: sourcePrompt),
              let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return nil
        }

        let text = (object["text"] as? String ?? object["replyText"] as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
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
        if let encodedSlots = try? encoder.encode(slots) {
            UserDefaults.standard.set(encodedSlots, forKey: Self.slotsDefaultsKey)
        }
        UserDefaults.standard.set(selectedSlotId, forKey: Self.selectedSlotDefaultsKey)
    }

    private func persistLastUserPrompt(_ prompt: String) {
        UserDefaults.standard.set(prompt, forKey: Self.lastUserPromptDefaultsKey)
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
            return Dictionary(uniqueKeysWithValues: validSlots.map { ($0.id, .systemDefault) })
        }

        var result: [Int: UserAgentPreset] = [:]
        for slot in validSlots {
            if let presetRaw = raw[String(slot.id)], let preset = UserAgentPreset(rawValue: presetRaw) {
                result[slot.id] = preset
            } else {
                result[slot.id] = .systemDefault
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

    private func persistUserAgentPresets() {
        let raw = Dictionary(uniqueKeysWithValues: slotUserAgentPresets.map { (String($0.key), $0.value.rawValue) })
        UserDefaults.standard.set(raw, forKey: Self.slotUserAgentPresetsDefaultsKey)
    }
}
