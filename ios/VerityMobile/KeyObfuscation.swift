import Foundation

enum KeyObfuscation {
    // Mirrors Android KeyObfuscation.getDeepSeekPreinstalledKey()
    private static let deepSeekEmbeddedKey = "***REMOVED***"
    private static let supabaseRPCURL = "aHR0cHM6Ly9ianFrdmxzbmV1anJjZnB2Y3Z6Zi5zdXBhYmFzZS5jbw=="
    private static let supabaseAPIKey = "ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW1KcWNXdDJiSE51WlhWcWNtTm1jSFpqZG5wbUlpd2ljbTlzWlNJNkluTmxjblpwWTJWZmNtOXNaU0lzSW1saGRDSTZNVGMzTVRjM09UY3lNeXdpWlhod0lqb3lNRGczTXpVMU56SXpmUS5OSlFWNFY4eVpfcURhUEtsYkRrYnctaVJiWWw4ZVBVa3AxS3BxRVUxSEJv"

    static func getDeepSeekPreinstalledKey() -> String {
        guard let data = Data(base64Encoded: deepSeekEmbeddedKey),
              let decoded = String(data: data, encoding: .utf8)
        else {
            return ""
        }
        return decoded
    }

    static func getSupabaseRPCURL(_ encodedOrPlainValue: String?) -> String {
        decodeEmbeddedValue(
            encodedOrPlainValue,
            fallback: supabaseRPCURL,
            isPlaintext: { $0.starts(with: "http") }
        )
    }

    static func getSupabaseAPIKey(_ encodedOrPlainValue: String?) -> String {
        decodeEmbeddedValue(
            encodedOrPlainValue,
            fallback: supabaseAPIKey,
            isPlaintext: { $0.contains(".") }
        )
        .strippingBearerPrefix()
    }

    private static func decodeEmbeddedValue(
        _ encodedOrPlainValue: String?,
        fallback: String,
        isPlaintext: (String) -> Bool
    ) -> String {
        if let encodedOrPlainValue {
            let trimmed = encodedOrPlainValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                if isPlaintext(trimmed) {
                    return trimmed
                }
                if let data = Data(base64Encoded: trimmed),
                   let decoded = String(data: data, encoding: .utf8) {
                    return decoded
                }
                return trimmed
            }
        }

        guard let data = Data(base64Encoded: fallback),
              let decoded = String(data: data, encoding: .utf8)
        else {
            return ""
        }
        return decoded
    }
}

private extension String {
    func strippingBearerPrefix() -> String {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.lowercased().hasPrefix("bearer ") {
            return String(trimmed.dropFirst("Bearer ".count)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return trimmed
    }
}
