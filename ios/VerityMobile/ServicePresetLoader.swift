import Foundation

enum ServicePresetLoader {
    static func loadCatalog() -> ServicePresetCatalog? {
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
