import Foundation
import WebKit

final class SlotWebViewModel: NSObject, ObservableObject {
    let webView: WKWebView
    private let sendScript = SharedScriptLoader.loadScript(named: "sendMessage.js")
    private let attachScript = SharedScriptLoader.loadScript(named: "attachFile.js")
    private let scrapeScript = SharedScriptLoader.loadScript(named: "scrapeReply.js")

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        self.webView = WKWebView(frame: .zero, configuration: config)
        super.init()
    }

    func load(url: String) {
        guard let url = URL(string: url) else { return }
        if webView.url?.absoluteString == url.absoluteString { return }
        webView.load(URLRequest(url: url))
    }

    func sendMessage(message: String, preset: ServicePreset) async -> String? {
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
        return try? await webView.evaluateJavaScript(script) as? String
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
}
