import SwiftUI
import WebKit

struct WebViewSlot: UIViewRepresentable {
    let slot: SlotState
    let model: SlotWebViewModel
    var onUserInteraction: (() -> Void)? = nil

    func makeCoordinator() -> Coordinator {
        Coordinator(onUserInteraction: onUserInteraction)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = model.webView
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.keyboardDismissMode = .interactive
        context.coordinator.install(on: webView)
        model.load(url: slot.url)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onUserInteraction = onUserInteraction
        context.coordinator.install(on: webView)
        model.load(url: slot.url)
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        private static let tapRecognizerName = "VerityDismissComposerTap"
        var onUserInteraction: (() -> Void)?

        init(onUserInteraction: (() -> Void)?) {
            self.onUserInteraction = onUserInteraction
        }

        func install(on webView: WKWebView) {
            webView.gestureRecognizers?
                .filter { $0.name == Self.tapRecognizerName }
                .forEach { webView.removeGestureRecognizer($0) }

            let recognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap))
            recognizer.name = Self.tapRecognizerName
            recognizer.cancelsTouchesInView = false
            recognizer.delegate = self
            webView.addGestureRecognizer(recognizer)
        }

        @objc private func handleTap() {
            onUserInteraction?()
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }
    }
}

struct HostedWebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView {
        webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
