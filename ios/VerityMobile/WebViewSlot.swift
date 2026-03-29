import SwiftUI
import WebKit

struct WebViewSlot: UIViewRepresentable {
    let slot: SlotState

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.keyboardDismissMode = .interactive
        if let url = URL(string: slot.url) {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard let currentURL = webView.url?.absoluteString else {
            if let url = URL(string: slot.url) {
                webView.load(URLRequest(url: url))
            }
            return
        }
        if currentURL != slot.url, let url = URL(string: slot.url) {
            webView.load(URLRequest(url: url))
        }
    }
}
