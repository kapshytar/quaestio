import Foundation
import os
import Combine
import WebKit

@MainActor
final class SlotWebViewModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    private static let logger = Logger(subsystem: "com.verity.mobile", category: "SlotWebView")
    private static let maxDebugEvents = 80
    @Published private(set) var currentLocationHref: String = ""
    @Published private(set) var currentUserAgent: String = ""
    @Published private(set) var currentCookieHost: String = ""
    @Published private(set) var currentHostCookieCount: Int = 0
    @Published private(set) var currentHostCookieNames: [String] = []
    @Published private(set) var lastNavigationState: String = "idle"
    @Published private(set) var lastNavigationError: String = ""
    @Published private(set) var popupLocationHref: String = ""
    @Published private(set) var popupNavigationState: String = "idle"
    @Published private(set) var popupNavigationError: String = ""
    @Published private(set) var debugEvents: [SlotDebugEvent] = []
    @Published private(set) var popupWebView: WKWebView?
    let webView: WKWebView
    private let sendScript = SharedScriptLoader.loadScript(named: "sendMessage.js")
    private let attachScript = SharedScriptLoader.loadScript(named: "attachFile.js")
    private let scrapeScript = SharedScriptLoader.loadScript(named: "scrapeReply.js")
    private var loadedHost: String?
    private var lastClaudeVerificationRecoveryAt: Date?
    private var lastAuthReturnRecoveryAt: Date?
    private var currentUserAgentPreset: UserAgentPreset = .systemDefault
    var onURLChange: ((URL) -> Void)?

    private func shortNavigationType(_ type: WKNavigationType) -> String {
        switch type {
        case .linkActivated: return "link"
        case .formSubmitted: return "form-submit"
        case .backForward: return "back-forward"
        case .reload: return "reload"
        case .formResubmitted: return "form-resubmit"
        case .other: return "other"
        @unknown default: return "unknown"
        }
    }

    override init() {
        let config = SharedWebViewEnvironment.makeConfiguration()
        self.webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        self.webView.navigationDelegate = self
        self.webView.uiDelegate = self
    }

    func load(url: String) {
        guard let targetURL = URL(string: url) else { return }
        let targetHost = normalizedHost(for: targetURL)

        if let currentURL = webView.url {
            let currentHost = normalizedHost(for: currentURL)
            if currentHost == targetHost {
                recordEvent("skip-load same-host \(currentURL.absoluteString)")
                loadedHost = targetHost
                Self.logger.debug("skip-load same-host current=\(currentURL.absoluteString, privacy: .public)")
                return
            }
        }

        if loadedHost == targetHost {
            recordEvent("skip-load warmed-host \(targetURL.absoluteString)")
            Self.logger.debug("skip-load warmed-host target=\(targetURL.absoluteString, privacy: .public)")
            return
        }

        loadedHost = targetHost
        lastNavigationState = "requested"
        lastNavigationError = ""
        recordEvent("load \(targetURL.absoluteString)")
        Self.logger.info("load url=\(targetURL.absoluteString, privacy: .public)")
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
        recordEvent("send-start \(preset.id) chars=\(message.count)")
        Self.logger.info("send-start service=\(preset.id, privacy: .public) chars=\(message.count)")
        guard let rawResult = try? await webView.evaluateJavaScript(script) as? String,
              let response = decodeJSONResult(rawResult),
              response["success"] as? Bool == true
        else {
            recordEvent("send-failed \(preset.id) invoke")
            Self.logger.error("send-failed service=\(preset.id, privacy: .public) phase=invoke")
            return false
        }

        if preset.id == "grok" {
            recordEvent("send-success \(preset.id) invoke-only")
            Self.logger.info("send-success service=\(preset.id, privacy: .public) phase=invoke-only")
            return true
        }

        let verifyDelay: UInt64 = (preset.id == "perplexity" || preset.id == "deepseek") ? 1_000_000_000 : 600_000_000
        try? await Task.sleep(nanoseconds: verifyDelay)

        let remainingText = await currentComposerText()
        let sent = remainingText.count < max(1, Int(Double(message.count) * 0.2))
        if sent {
            recordEvent("send-success \(preset.id) verify remaining=\(remainingText.count)")
            Self.logger.info("send-success service=\(preset.id, privacy: .public) phase=verify remaining=\(remainingText.count)")
            return true
        }

        if preset.id == "perplexity" || preset.id == "deepseek" {
            _ = try? await webView.evaluateJavaScript(script)
            recordEvent("send-success \(preset.id) fallback remaining=\(remainingText.count)")
            Self.logger.info("send-success service=\(preset.id, privacy: .public) phase=fallback remaining=\(remainingText.count)")
            return true
        }

        recordEvent("send-failed \(preset.id) verify remaining=\(remainingText.count)")
        Self.logger.error("send-failed service=\(preset.id, privacy: .public) phase=verify remaining=\(remainingText.count)")
        return false
    }

    func reloadCurrentPage() {
        lastNavigationState = "reload"
        lastNavigationError = ""
        recordEvent("reload \(self.webView.url?.absoluteString ?? "about:blank")")
        Self.logger.info("reload-current-page url=\(self.webView.url?.absoluteString ?? "about:blank", privacy: .public)")
        webView.reload()
    }

    func stopLoading() {
        lastNavigationState = "stopped"
        recordEvent("stop \(self.webView.url?.absoluteString ?? "about:blank")")
        Self.logger.info("stop-loading url=\(self.webView.url?.absoluteString ?? "about:blank", privacy: .public)")
        webView.stopLoading()
    }

    func forceLoad(url: String) {
        guard let targetURL = URL(string: url) else { return }
        loadedHost = normalizedHost(for: targetURL)
        lastNavigationState = "forced"
        lastNavigationError = ""
        recordEvent("force-load \(targetURL.absoluteString)")
        Self.logger.info("force-load url=\(targetURL.absoluteString, privacy: .public)")
        webView.load(URLRequest(url: targetURL))
    }

    func openAttachChooser() async -> String? {
        let script = SharedScriptBridge.buildInvocation(namespace: attachScript, payload: [:])
        return try? await webView.evaluateJavaScript(script) as? String
    }

    func applyUserAgentPreset(_ preset: UserAgentPreset) {
        currentUserAgentPreset = preset
        webView.customUserAgent = preset.customUserAgent
        popupWebView?.customUserAgent = preset.customUserAgent
        currentUserAgent = preset.customUserAgent ?? "pending"
        recordEvent("ua-preset \(preset.rawValue)")
    }

    func clearDiagnostics() {
        debugEvents = []
        currentLocationHref = ""
        currentUserAgent = ""
        currentCookieHost = ""
        currentHostCookieCount = 0
        currentHostCookieNames = []
        lastNavigationState = "idle"
        lastNavigationError = ""
        popupLocationHref = ""
        popupNavigationState = "idle"
        popupNavigationError = ""
    }

    func closePopup() {
        popupWebView?.navigationDelegate = nil
        popupWebView?.uiDelegate = nil
        popupWebView?.stopLoading()
        popupWebView = nil
        popupLocationHref = ""
        popupNavigationState = "closed"
        popupNavigationError = ""
        recordEvent("popup-closed")
    }

    func scrapeLatestReply(serviceId: String, sourcePrompt: String) async -> String? {
        let payload: [String: Any] = [
            "serviceId": serviceId,
            "sourcePrompt": sourcePrompt,
        ]
        let script = SharedScriptBridge.buildInvocation(namespace: scrapeScript, payload: payload)
        return try? await webView.evaluateJavaScript(script) as? String
    }

    func handleAppDidBecomeActive() {
        let now = Date()
        if let lastAttempt = lastAuthReturnRecoveryAt, now.timeIntervalSince(lastAttempt) < 2 {
            return
        }

        lastAuthReturnRecoveryAt = now

        if let popup = popupWebView, shouldAttemptAuthBackNavigation(for: popupLocationHref, webView: popup) {
            recordEvent("auth-return popup goBack")
            popupNavigationState = "back-navigation"
            popup.goBack()
            return
        }

        if shouldAttemptAuthBackNavigation(for: currentLocationHref, webView: webView) {
            recordEvent("auth-return main goBack")
            lastNavigationState = "back-navigation"
            webView.goBack()
            return
        }

        refreshRuntimeSnapshot()
        if let popup = popupWebView {
            refreshPopupRuntimeSnapshot(for: popup)
        }
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

    private func shouldAttemptAuthBackNavigation(for rawURL: String, webView: WKWebView) -> Bool {
        guard webView.canGoBack else { return false }
        let value = rawURL.lowercased()
        guard !value.isEmpty else { return false }

        return value.contains("accounts.google.com")
            || value.contains("accounts.x.ai")
            || value.contains("auth.openai.com")
            || value.contains("claude.ai/login")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let url = webView.url else { return }
        if webView !== self.webView {
            popupNavigationState = "finished"
            popupNavigationError = ""
            recordEvent("popup-finish \(url.absoluteString)")
            refreshPopupRuntimeSnapshot(for: webView)
            maybeAdoptPopupURL(url)
            return
        }
        loadedHost = normalizedHost(for: url)
        lastNavigationState = "finished"
        lastNavigationError = ""
        recordEvent("did-finish \(url.absoluteString)")
        Self.logger.info("did-finish url=\(url.absoluteString, privacy: .public)")
        onURLChange?(url)
        refreshRuntimeSnapshot()
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard let url = webView.url else { return }
        if webView !== self.webView {
            popupNavigationState = "committed"
            recordEvent("popup-commit \(url.absoluteString)")
            refreshPopupRuntimeSnapshot(for: webView)
            maybeAdoptPopupURL(url)
            return
        }
        lastNavigationState = "committed"
        recordEvent("did-commit \(url.absoluteString)")
        Self.logger.debug("did-commit url=\(url.absoluteString, privacy: .public)")
        onURLChange?(url)
        refreshRuntimeSnapshot()
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if webView !== self.webView {
            popupNavigationState = "starting"
            popupNavigationError = ""
            recordEvent("popup-start provisional")
            refreshPopupRuntimeSnapshot(for: webView)
            return
        }
        lastNavigationState = "starting"
        lastNavigationError = ""
        recordEvent("did-start provisional")
        refreshRuntimeSnapshot()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        let requestURL = navigationAction.request.url?.absoluteString ?? "about:blank"
        let mainURL = navigationAction.request.mainDocumentURL?.absoluteString ?? "none"
        let navType = shortNavigationType(navigationAction.navigationType)
        let prefix = webView === self.webView ? "policy" : "popup-policy"
        recordEvent("\(prefix) \(navType) req=\(requestURL)")
        if mainURL != "none", mainURL != requestURL {
            recordEvent("\(prefix) main=\(mainURL)")
        }

        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        let popupURL = navigationAction.request.url?.absoluteString ?? "about:blank"
        recordEvent("create-webview \(popupURL)")
        Self.logger.info("create-webview url=\(popupURL, privacy: .public)")

        let popup = WKWebView(frame: .zero, configuration: configuration)
        popup.navigationDelegate = self
        popup.uiDelegate = self
        popup.allowsBackForwardNavigationGestures = true
        popup.scrollView.keyboardDismissMode = .interactive
        popup.customUserAgent = currentUserAgentPreset.customUserAgent
        popupWebView = popup
        popupNavigationState = "created"
        popupNavigationError = ""
        popupLocationHref = navigationAction.request.url?.absoluteString ?? ""

        return popup
    }

    func webViewDidClose(_ webView: WKWebView) {
        guard webView === popupWebView else { return }
        closePopup()
    }

    func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
        let redirectURL = webView.url?.absoluteString ?? "about:blank"
        if webView !== self.webView {
            recordEvent("popup-redirect \(redirectURL)")
        } else {
            recordEvent("server-redirect \(redirectURL)")
            refreshRuntimeSnapshot()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if webView !== self.webView {
            popupNavigationState = "failed"
            popupNavigationError = error.localizedDescription
            recordEvent("popup-fail \(error.localizedDescription)")
            refreshPopupRuntimeSnapshot(for: webView)
            return
        }
        lastNavigationState = "failed"
        lastNavigationError = error.localizedDescription
        recordEvent("did-fail \(error.localizedDescription)")
        Self.logger.error("did-fail error=\(error.localizedDescription, privacy: .public)")
        refreshRuntimeSnapshot()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView !== self.webView {
            popupNavigationState = "failed-provisional"
            popupNavigationError = error.localizedDescription
            recordEvent("popup-fail provisional \(error.localizedDescription)")
            refreshPopupRuntimeSnapshot(for: webView)
            return
        }
        lastNavigationState = "failed-provisional"
        lastNavigationError = error.localizedDescription
        recordEvent("did-fail provisional \(error.localizedDescription)")
        Self.logger.error("did-fail-provisional error=\(error.localizedDescription, privacy: .public)")
        refreshRuntimeSnapshot()
    }

    private func refreshRuntimeSnapshot() {
        let script = """
        (function() {
          return JSON.stringify({
            href: String(window.location && window.location.href || ''),
            userAgent: String(navigator && navigator.userAgent || ''),
            bodyText: String(document && document.body && document.body.innerText || '').slice(0, 4000)
          });
        })()
        """

        Task { @MainActor in
            guard let raw = try? await webView.evaluateJavaScript(script) as? String,
                  let data = raw.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                self.currentLocationHref = webView.url?.absoluteString ?? ""
                if self.currentUserAgent.isEmpty {
                    self.currentUserAgent = "unavailable"
                }
                await self.refreshCookieSnapshot(for: self.currentLocationHref)
                return
            }

            self.currentLocationHref = (object["href"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (webView.url?.absoluteString ?? "")
            self.currentUserAgent = (object["userAgent"] as? String) ?? "unavailable"
            if let bodyText = object["bodyText"] as? String {
                self.maybeRecoverClaudeVerificationHang(bodyText: bodyText)
            }
            await self.refreshCookieSnapshot(for: self.currentLocationHref)
        }
    }

    private func refreshPopupRuntimeSnapshot(for popup: WKWebView) {
        let script = """
        (function() {
          return JSON.stringify({
            href: String(window.location && window.location.href || ''),
            bodyText: String(document && document.body && document.body.innerText || '').slice(0, 2000)
          });
        })()
        """

        Task { @MainActor in
            guard let raw = try? await popup.evaluateJavaScript(script) as? String,
                  let data = raw.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                self.popupLocationHref = popup.url?.absoluteString ?? self.popupLocationHref
                return
            }

            self.popupLocationHref = (object["href"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (popup.url?.absoluteString ?? self.popupLocationHref)

            if let bodyText = object["bodyText"] as? String {
                self.maybeRecoverPopupGoogleHang(bodyText: bodyText)
            }
        }
    }

    private func maybeRecoverClaudeVerificationHang(bodyText: String) {
        let normalized = bodyText.lowercased()
        guard currentLocationHref.contains("claude.ai") else { return }
        guard normalized.contains("verification successful") && normalized.contains("waiting for claude.ai to respond") else { return }

        let now = Date()
        if let lastAttempt = lastClaudeVerificationRecoveryAt, now.timeIntervalSince(lastAttempt) < 8 {
            return
        }

        lastClaudeVerificationRecoveryAt = now
        recordEvent("claude-cf-recovery scheduled")
        Self.logger.info("claude-cf-recovery scheduled")

        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard self.currentLocationHref.contains("claude.ai") else { return }
            let currentBodyText = (try? await self.webView.evaluateJavaScript("String(document && document.body && document.body.innerText || '')") as? String) ?? ""
            let currentNormalized = currentBodyText.lowercased()
            guard currentNormalized.contains("verification successful"),
                  currentNormalized.contains("waiting for claude.ai to respond")
            else { return }

            self.recordEvent("claude-cf-recovery force-load https://claude.ai/login")
            Self.logger.info("claude-cf-recovery force-load")
            self.forceLoad(url: "https://claude.ai/login")
        }
    }

    private func maybeRecoverPopupGoogleHang(bodyText: String) {
        let normalized = bodyText.lowercased()
        guard popupLocationHref.contains("accounts.google.com") else { return }
        guard normalized.contains("one moment please") else { return }

        let now = Date()
        if let lastAttempt = lastClaudeVerificationRecoveryAt, now.timeIntervalSince(lastAttempt) < 8 {
            return
        }

        lastClaudeVerificationRecoveryAt = now
        recordEvent("popup-google-recovery scheduled")
        Self.logger.info("popup-google-recovery scheduled")

        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard let popup = self.popupWebView else { return }
            let currentBodyText = (try? await popup.evaluateJavaScript("String(document && document.body && document.body.innerText || '')") as? String) ?? ""
            guard currentBodyText.lowercased().contains("one moment please") else { return }

            self.recordEvent("popup-google-recovery reload")
            self.popupNavigationState = "reload"
            popup.reload()
        }
    }

    private func maybeAdoptPopupURL(_ url: URL) {
        guard let popup = popupWebView, popup.url == url else { return }
        guard let loadedHost else { return }
        let popupHost = normalizedHost(for: url)
        guard popupHost == loadedHost else { return }

        recordEvent("popup-adopt \(url.absoluteString)")
        Self.logger.info("popup-adopt url=\(url.absoluteString, privacy: .public)")
        closePopup()
        forceLoad(url: url.absoluteString)
    }

    private func refreshCookieSnapshot(for rawURL: String) async {
        guard let url = URL(string: rawURL), let host = url.host?.lowercased(), !host.isEmpty else {
            currentCookieHost = ""
            currentHostCookieCount = 0
            currentHostCookieNames = []
            return
        }

        let cookies = await allCookies()
        let normalizedHost = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        let matchingCookies = cookies.filter { cookie in
            let cookieDomain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
            let normalizedDomain = cookieDomain.hasPrefix("www.") ? String(cookieDomain.dropFirst(4)) : cookieDomain
            return normalizedHost == normalizedDomain || normalizedHost.hasSuffix(".\(normalizedDomain)")
        }

        currentCookieHost = normalizedHost
        currentHostCookieCount = matchingCookies.count
        currentHostCookieNames = matchingCookies
            .map(\.name)
            .sorted()
    }

    private func allCookies() async -> [HTTPCookie] {
        await withCheckedContinuation { continuation in
            SharedWebViewEnvironment.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                continuation.resume(returning: cookies)
            }
        }
    }

    private func recordEvent(_ message: String) {
        let event = SlotDebugEvent(timestamp: Date(), message: message)
        debugEvents.insert(event, at: 0)
        if debugEvents.count > Self.maxDebugEvents {
            debugEvents.removeLast(debugEvents.count - Self.maxDebugEvents)
        }
    }
}
