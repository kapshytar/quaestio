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

struct SlotState: Identifiable, Hashable, Codable {
    let id: Int
    var serviceId: String
    var title: String
    var url: String
    var isEnabled: Bool
}

struct SlotDebugEvent: Identifiable, Hashable {
    let id = UUID()
    let timestamp: Date
    let message: String
}

enum UserAgentPreset: String, CaseIterable, Identifiable, Codable {
    case systemDefault
    case iphoneSafariFull
    case desktopChrome

    var id: String { rawValue }

    var title: String {
        switch self {
        case .systemDefault: return "Default WKWebView"
        case .iphoneSafariFull: return "iPhone Safari Full"
        case .desktopChrome: return "Desktop Chrome"
        }
    }

    var customUserAgent: String? {
        switch self {
        case .systemDefault:
            return nil
        case .iphoneSafariFull:
            return "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
        case .desktopChrome:
            return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
        }
    }
}
