import Foundation

enum KeyObfuscation {
    // Mirrors Android KeyObfuscation.getDeepSeekPreinstalledKey()
    private static let deepSeekEmbeddedKey = "***REMOVED***"

    static func getDeepSeekPreinstalledKey() -> String {
        guard let data = Data(base64Encoded: deepSeekEmbeddedKey),
              let decoded = String(data: data, encoding: .utf8)
        else {
            return ""
        }
        return decoded
    }
}
