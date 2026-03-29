import Foundation
import WebKit

@MainActor
final class MobileAppState: ObservableObject {
    @Published var slots: [SlotState] = []
    @Published var selectedSlotId: Int = 1
    @Published var mergeOutput: String = ""
    @Published var statusMessage: String = "MVP scaffold"
    @Published var composerText: String = ""
    @Published var isSendingComposer: Bool = false

    let presets: [String: ServicePreset]
    private let webModels: [Int: SlotWebViewModel]

    init() {
        let catalog = ServicePresetLoader.loadCatalog()
        let presets = catalog?.services ?? [:]
        let defaults = catalog?.defaultSlots ?? ["chatgpt", "claude", "gemini", "grok"]
        let slots = defaults.enumerated().map { index, serviceId in
            let preset = presets[serviceId]
            return SlotState(
                id: index + 1,
                serviceId: serviceId,
                title: preset?.name ?? "Slot \(index + 1)",
                url: preset?.url ?? "https://example.com",
                isEnabled: true
            )
        }
        let webModels = Dictionary(uniqueKeysWithValues: slots.map { ($0.id, SlotWebViewModel()) })

        self.presets = presets
        self.slots = slots
        self.selectedSlotId = slots.first?.id ?? 1
        self.webModels = webModels

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
            composerText = ""
        }
    }
}
