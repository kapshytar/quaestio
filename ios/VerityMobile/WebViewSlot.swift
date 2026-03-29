import SwiftUI
import WebKit

struct WebViewSlot: UIViewRepresentable {
    let slot: SlotState
    let model: SlotWebViewModel

    func makeUIView(context: Context) -> WKWebView {
        let webView = model.webView
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.keyboardDismissMode = .interactive
        model.load(url: slot.url)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        model.load(url: slot.url)
    }
}
