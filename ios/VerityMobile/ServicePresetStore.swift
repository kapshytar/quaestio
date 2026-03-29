import Foundation

enum ServicePresetStore {
    static func defaultSlots() -> [ServicePreset] {
        let catalog = ServicePresetLoader.loadCatalog()
        let ids = catalog?.defaultSlots ?? ["chatgpt", "claude", "gemini", "grok"]
        return ids.compactMap { catalog?.services[$0] }
    }
}
