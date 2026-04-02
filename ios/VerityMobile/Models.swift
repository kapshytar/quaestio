import Foundation

indirect enum JSONValue: Sendable, Decodable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case array([JSONValue])
    case object([String: JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    var stringValue: String? {
        if case let .string(value) = self {
            return value
        }
        return nil
    }
}

struct ServiceSelectors: Codable, Hashable {
    let textarea: [String]
    let contenteditable: [String]
    let button: [String]
}

struct ServicePreset: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let url: String
    let phoneZoomPercent: Int?
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

enum ServiceIconCatalog {
    static func faviconURL(for serviceId: String) -> URL? {
        let domain: String
        switch serviceId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "chatgpt":
            domain = "https://chatgpt.com"
        case "claude":
            domain = "https://claude.ai"
        case "gemini":
            domain = "https://gemini.google.com"
        case "grok":
            domain = "https://grok.com"
        case "deepseek":
            domain = "https://chat.deepseek.com"
        case "perplexity":
            domain = "https://www.perplexity.ai"
        default:
            return nil
        }

        let encodedDomain = domain.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? domain
        return URL(string: "https://www.google.com/s2/favicons?sz=64&domain_url=\(encodedDomain)")
    }
}

struct SlotDebugEvent: Identifiable, Hashable {
    let id = UUID()
    let timestamp: Date
    let message: String
}

struct ProjectTreeNode: Identifiable, Hashable, Codable {
    let id: String
    let name: String
    let children: [ProjectTreeNode]
}

struct ProjectTagRow: Decodable, Sendable {
    let id: String
    let name: String
}

struct ProjectTagParentRow: Decodable, Sendable {
    let tagId: String?
    let parentId: String?

    enum CodingKeys: String, CodingKey {
        case tagId = "tag_id"
        case parentId = "parent_id"
    }
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
