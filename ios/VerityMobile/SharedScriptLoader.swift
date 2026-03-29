import Foundation

enum SharedScriptLoader {
    static func loadScript(named fileName: String) -> String {
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
