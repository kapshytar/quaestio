import Foundation

enum SharedScriptLoader {
    static func loadScript(named fileName: String) -> String {
        let bundleCandidates = [
            Bundle.main.resourceURL?.appendingPathComponent(fileName),
            Bundle.main.bundleURL.appendingPathComponent(fileName)
        ]

        for candidate in bundleCandidates {
            guard let candidate else { continue }
            if let content = try? String(contentsOf: candidate, encoding: .utf8) {
                return content
            }
        }

        let candidates = [
            "../../shared/js/\(fileName)",
            "../shared/js/\(fileName)",
            "shared/js/\(fileName)"
        ]

        for candidate in candidates {
            let expanded = NSString(string: candidate).expandingTildeInPath
            if let content = try? String(contentsOfFile: expanded, encoding: .utf8) {
                return content
            }
        }

        return ""
    }
}
