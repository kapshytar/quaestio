import Foundation

struct ServiceSelectors: Codable, Hashable {
    let textarea: [String]
    let contenteditable: [String]
    let button: [String]
}

struct ServicePreset: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let url: String
    let selectors: ServiceSelectors
}

struct ServicePresetCatalog: Codable {
    let defaultSlots: [String]
    let services: [String: ServicePreset]
}

struct SlotState: Identifiable, Hashable {
    let id: Int
    var serviceId: String
    var title: String
    var url: String
    var isEnabled: Bool
}
