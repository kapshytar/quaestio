import Foundation

struct MergeProviderDescriptor: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let defaultEndpoint: String
    let defaultModel: String
    let family: String
    let supportsPreinstalledKey: Bool
    let supportsCustomEndpoint: Bool
    let supportsCustomModel: Bool
    let supportsFallbackModels: Bool
}

struct MergeAggregationPolicy: Codable, Hashable {
    let maxChecks: Int
    let waitIntervalMs: Int
    let settleDelayMs: Int
    let allowPartialResults: Bool
    let minimumRepliesRequired: Int
}

struct MergeConfigCatalog: Codable {
    let defaultProviderId: String
    let aggregationPolicy: MergeAggregationPolicy
    let providers: [MergeProviderDescriptor]
    let defaultMergeInstructions: String
    let defaultClarificationInstructions: String
}

enum MergeCatalogLoader {
    static func loadCatalog() -> MergeConfigCatalog? {
        loadJSON(named: "mergeConfig.json")
    }

    private static func loadJSON<T: Decodable>(named fileName: String) -> T? {
        let decoder = JSONDecoder()
        let bundleCandidates = [
            Bundle.main.resourceURL?.appendingPathComponent(fileName),
            Bundle.main.bundleURL.appendingPathComponent(fileName)
        ]

        for candidate in bundleCandidates {
            guard let candidate else { continue }
            if let data = try? Data(contentsOf: candidate),
               let object = try? decoder.decode(T.self, from: data) {
                return object
            }
        }

        let candidates = [
            "../../shared/contracts/\(fileName)",
            "../shared/contracts/\(fileName)",
            "shared/contracts/\(fileName)"
        ]

        for candidate in candidates {
            let expanded = NSString(string: candidate).expandingTildeInPath
            if let data = try? Data(contentsOf: URL(fileURLWithPath: expanded)),
               let object = try? decoder.decode(T.self, from: data) {
                return object
            }
        }

        return nil
    }
}
