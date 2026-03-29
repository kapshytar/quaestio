import Foundation

enum SharedScriptBridge {
    static func buildInvocation(namespace: String, payload: [String: Any]) -> String {
        let data = try? JSONSerialization.data(withJSONObject: payload, options: [])
        let payloadString = data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return """
        (function() {
            \(namespace)
            return \(namespaceName(namespace)).run(\(payloadString));
        })();
        """
    }

    private static func namespaceName(_ namespace: String) -> String {
        if namespace.contains("VeritySharedSendMessage") { return "VeritySharedSendMessage" }
        if namespace.contains("VeritySharedAttachFile") { return "VeritySharedAttachFile" }
        if namespace.contains("VeritySharedScrapeReply") { return "VeritySharedScrapeReply" }
        return "VeritySharedSendMessage"
    }
}
