import Foundation

final class MobileAppState: ObservableObject {
    @Published var slots: [SlotState] = []
    @Published var mergeOutput: String = ""
    @Published var statusMessage: String = "MVP scaffold"

    let presets: [String: ServicePreset]

    init() {
        let catalog = ServicePresetLoader.loadCatalog()
        self.presets = catalog?.services ?? [:]
        let defaults = catalog?.defaultSlots ?? ["chatgpt", "claude", "gemini", "grok"]

        self.slots = defaults.enumerated().map { index, serviceId in
            let preset = catalog?.services[serviceId]
            return SlotState(
                id: index + 1,
                serviceId: serviceId,
                title: preset?.name ?? "Slot \(index + 1)",
                url: preset?.url ?? "https://example.com",
                isEnabled: true
            )
        }
    }
}
