import Foundation
import WebKit

@MainActor
final class SlotWebViewModel: NSObject, ObservableObject {
    let webView: WKWebView
    private let sendScript = SharedScriptLoader.loadScript(named: "sendMessage.js")
    private let attachScript = SharedScriptLoader.loadScript(named: "attachFile.js")
    private let scrapeScript = SharedScriptLoader.loadScript(named: "scrapeReply.js")
    private var loadedHost: String?

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        self.webView = WKWebView(frame: .zero, configuration: config)
        super.init()
    }

    func load(url: String) {
        guard let targetURL = URL(string: url) else { return }
        let targetHost = normalizedHost(for: targetURL)

        if let currentURL = webView.url {
            let currentHost = normalizedHost(for: currentURL)
            if currentHost == targetHost {
                loadedHost = targetHost
                return
            }
        }

        if loadedHost == targetHost {
            return
        }

        loadedHost = targetHost
        webView.load(URLRequest(url: targetURL))
    }

    func sendMessage(message: String, preset: ServicePreset) async -> Bool {
        let payload: [String: Any] = [
            "message": message,
            "serviceId": preset.id,
            "selectors": [
                "textarea": preset.selectors.textarea,
                "contenteditable": preset.selectors.contenteditable,
                "button": preset.selectors.button,
            ],
        ]
        let script = SharedScriptBridge.buildInvocation(namespace: sendScript, payload: payload)
        guard let rawResult = try? await webView.evaluateJavaScript(script) as? String,
              let response = decodeJSONResult(rawResult),
              response["success"] as? Bool == true
        else {
            return false
        }

        if preset.id == "grok" {
            return true
        }

        let verifyDelay: UInt64 = (preset.id == "perplexity" || preset.id == "deepseek") ? 1_000_000_000 : 600_000_000
        try? await Task.sleep(nanoseconds: verifyDelay)

        let remainingText = await currentComposerText()
        let sent = remainingText.count < max(1, Int(Double(message.count) * 0.2))
        if sent {
            return true
        }

        if preset.id == "perplexity" || preset.id == "deepseek" {
            _ = try? await webView.evaluateJavaScript(script)
            return true
        }

        return false
    }

    func openAttachChooser() async -> String? {
        let script = SharedScriptBridge.buildInvocation(namespace: attachScript, payload: [:])
        return try? await webView.evaluateJavaScript(script) as? String
    }

    func scrapeLatestReply(serviceId: String, sourcePrompt: String) async -> String? {
        let payload: [String: Any] = [
            "serviceId": serviceId,
            "sourcePrompt": sourcePrompt,
        ]
        let script = SharedScriptBridge.buildInvocation(namespace: scrapeScript, payload: payload)
        return try? await webView.evaluateJavaScript(script) as? String
    }

    private func currentComposerText() async -> String {
        let checkScript = """
        (function() {
          const nodes = document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]');
          let best = null;
          let bestBottom = -1;
          for (const node of nodes) {
            const rect = node.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const bottom = rect.bottom;
              if (bottom > bestBottom) {
                bestBottom = bottom;
                best = node;
              }
            }
          }
          if (!best) return '';
          return (best.tagName === 'TEXTAREA' || best.tagName === 'INPUT')
            ? (best.value || '')
            : (best.textContent || '');
        })()
        """

        guard let result = try? await webView.evaluateJavaScript(checkScript) else {
            return ""
        }

        if let text = result as? String {
            return text
        }

        return String(describing: result)
    }

    private func decodeJSONResult(_ rawResult: String) -> [String: Any]? {
        let cleaned = rawResult
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\\"", with: "\"")
            .replacingOccurrences(of: "\\\\", with: "\\")
            .trimmingCharacters(in: CharacterSet(charactersIn: "\""))

        guard let data = cleaned.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return nil
        }

        return object
    }

    private func normalizedHost(for url: URL) -> String {
        let host = (url.host ?? url.absoluteString).lowercased()
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}
