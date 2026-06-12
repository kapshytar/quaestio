import Foundation

enum ServicePresetLoader {
    static func loadCatalog() -> ServicePresetCatalog? {
        let bundleCandidates: [URL?] = [
            Bundle.main.url(forResource: "servicePresets", withExtension: "json"),
            Bundle.main.resourceURL?.appendingPathComponent("servicePresets.json"),
            Bundle.main.bundleURL.appendingPathComponent("servicePresets.json")
        ]

        for candidate in bundleCandidates {
            guard let candidate, FileManager.default.fileExists(atPath: candidate.path) else {
                continue
            }

            if let data = try? Data(contentsOf: candidate),
               let catalog = try? JSONDecoder().decode(ServicePresetCatalog.self, from: data) {
                return catalog
            }
        }

        let candidates = [
            "../../shared/contracts/servicePresets.json",
            "../shared/contracts/servicePresets.json",
            "shared/contracts/servicePresets.json"
        ]

        for candidate in candidates {
            let expanded = NSString(string: candidate).expandingTildeInPath
            if FileManager.default.fileExists(atPath: expanded),
               let data = FileManager.default.contents(atPath: expanded),
               let catalog = try? JSONDecoder().decode(ServicePresetCatalog.self, from: data) {
                return catalog
            }
        }

        return nil
    }
}
