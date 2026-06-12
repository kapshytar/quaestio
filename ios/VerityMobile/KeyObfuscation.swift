import Foundation

enum KeyObfuscation {
    // Mirrors Android KeyObfuscation.getDeepSeekPreinstalledKey().
    // No key ships in the binary (repo is public). Users supply their own
    // DeepSeek key in Settings; the old embedded test key was revoked.
    private static let deepSeekEmbeddedKey = ""
    // Frankfurt project (pphntxcslmbymvcwvhnr); publishable (anon) key, base64.
    // RPCs are SECURITY DEFINER granted to anon, so no service_role in the binary.
    private static let supabaseRPCURL = "aHR0cHM6Ly9wcGhudHhjc2xtYnltdmN3dmhuci5zdXBhYmFzZS5jbw=="
    private static let supabaseAPIKey = "c2JfcHVibGlzaGFibGVfb2ZoZjRpZ1VMTGEyMHdhT3JJMzRwQV9MWHF6dnBoYg=="

    static func getDeepSeekPreinstalledKey() -> String {
        guard !deepSeekEmbeddedKey.isEmpty,
              let data = Data(base64Encoded: deepSeekEmbeddedKey),
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
