import Foundation

enum SharedScriptBridge {
    static func buildInvocation(namespace: String, payload: [String: Any]) -> String {
        let data = try? JSONSerialization.data(withJSONObject: payload, options: [])
        let payloadString = data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return """
        (function() {
            try {
                \(namespace)
                return \(namespaceName(namespace)).run(\(payloadString));
            } catch (error) {
                return JSON.stringify({
                    __verityBridgeError: String(error && error.message || error || "unknown"),
                    __verityBridgeStack: String(error && error.stack || "")
                });
            }
        })();
        """
    }

    private static func namespaceName(_ namespace: String) -> String {
        if namespace.contains("VeritySharedSendMessage") { return "VeritySharedSendMessage" }
        if namespace.contains("VeritySharedAttachFile") { return "VeritySharedAttachFile" }
        if namespace.contains("VeritySharedScrapeReply") { return "VeritySharedScrapeReply" }
        if namespace.contains("VeritySharedExtractLatestAssistantRaw") { return "VeritySharedExtractLatestAssistantRaw" }
        return "VeritySharedSendMessage"
    }
}
