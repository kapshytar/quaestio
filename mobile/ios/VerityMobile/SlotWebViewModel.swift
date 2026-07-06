import Foundation
import os
import Combine
import WebKit

struct SlotScrapeReply {
    let text: String?
    let error: String
    let documentTitle: String
    let promptCandidateText: String
    let debugTrace: String
    let rawResult: String
    let method: String
    let collectorTrace: String
}

private struct DesktopDOMExtraction {
    let raw: String
    let fragmentOnly: Bool
    let reason: String
    let selectedPreview: String
}

@MainActor
final class SlotWebViewModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    private static let logger = Logger(subsystem: "com.verity.mobile", category: "SlotWebView")
    private static let maxDebugEvents = 80
    @Published private(set) var currentLocationHref: String = ""
    @Published private(set) var currentUserAgent: String = ""
    @Published private(set) var currentCookieHost: String = ""
    @Published private(set) var currentHostCookieCount: Int = 0
    @Published private(set) var currentHostCookieNames: [String] = []
    @Published private(set) var currentViewportContent: String = ""
    @Published private(set) var currentVisualViewportScale: String = ""
    @Published private(set) var currentWindowInnerWidth: String = ""
    @Published private(set) var currentDocumentClientWidth: String = ""
    @Published private(set) var currentConfiguredZoom: String = ""
    @Published private(set) var currentScrollViewZoom: String = ""
    @Published private(set) var lastNavigationState: String = "idle"
    @Published private(set) var lastNavigationError: String = ""
    @Published private(set) var popupLocationHref: String = ""
    @Published private(set) var popupNavigationState: String = "idle"
    @Published private(set) var popupNavigationError: String = ""
    @Published private(set) var lastScrapeState: String = "idle"
    @Published private(set) var lastScrapeError: String = ""
    @Published private(set) var lastScrapeDocumentTitle: String = ""
    @Published private(set) var lastScrapePromptCandidate: String = ""
    @Published private(set) var lastScrapePreview: String = ""
    @Published private(set) var lastScrapeCandidateTrace: String = ""
    @Published private(set) var debugEvents: [SlotDebugEvent] = []
    @Published private(set) var popupWebView: WKWebView?
    @Published private(set) var isDisplayReady: Bool = false
    let webView: WKWebView
    private let sendScript = SharedScriptLoader.loadScript(named: "sendMessage.js")
    private let attachScript = SharedScriptLoader.loadScript(named: "attachFile.js")
    private let scrapeScript = SharedScriptLoader.loadScript(named: "scrapeReply.js")
    private let rawExtractorScript = SharedScriptLoader.loadScript(named: "extractLatestAssistantRaw.js")
    private var loadedHost: String?
    private var loadedNavigationTarget: String?
    private var lastClaudeVerificationRecoveryAt: Date?
    private var lastClaudeBlankRecoveryAt: Date?
    private var lastAuthReturnRecoveryAt: Date?
    private var currentUserAgentPreset: UserAgentPreset = .systemDefault
    private var currentPageZoom: CGFloat = 0.9
    private var displayReadyTask: Task<Void, Never>?
    var onURLChange: ((URL) -> Void)?

    private func makeViewportBootstrapScript() -> WKUserScript {
        let normalizedZoom = min(max(currentPageZoom, 0.7), 1.0)
        let defaultScale = String(format: "%.3f", normalizedZoom)
        let source = """
        (function() {
          try {
            const scale = \(defaultScale);
            const head = document.head || document.getElementsByTagName('head')[0];
            if (!head) return;
            let meta = document.querySelector('meta[name="viewport"]');
            if (!meta) {
              meta = document.createElement('meta');
              meta.setAttribute('name', 'viewport');
              head.appendChild(meta);
            }
            meta.setAttribute('content', 'width=device-width, initial-scale=' + scale + ', viewport-fit=cover');
            let style = document.getElementById('verity-text-size-adjust');
            if (!style) {
              style = document.createElement('style');
              style.id = 'verity-text-size-adjust';
              head.appendChild(style);
            }
            style.textContent = 'html, body { -webkit-text-size-adjust: 100% !important; }';
            document.documentElement.style.setProperty('-webkit-text-size-adjust', '100%');
          } catch (_) {}
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    private func effectiveViewportZoom(for webView: WKWebView) -> CGFloat {
        min(max(currentPageZoom, 0.7), 1.0)
    }

    private func refreshViewportBootstrapScript(for webView: WKWebView) {
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()
        controller.addUserScript(makeViewportBootstrapScript())
    }

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
        self.webView.pageZoom = 1.0
        refreshViewportBootstrapScript(for: self.webView)
    }

    private func setDisplayReady(_ ready: Bool) {
        displayReadyTask?.cancel()
        displayReadyTask = nil
        isDisplayReady = ready
    }

    private var hasPendingNavigation: Bool {
        switch lastNavigationState {
        case "requested", "forced", "starting", "committed", "reload", "back-navigation":
            return true
        default:
            return false
        }
    }

    private func scheduleDisplayReady(after delayNs: UInt64, reason: String) {
        displayReadyTask?.cancel()
        displayReadyTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: delayNs)
            guard let self else { return }
            self.isDisplayReady = true
            self.recordEvent("display-ready \(reason)")
        }
    }

    func load(url: String) {
        guard let targetURL = URL(string: url) else { return }
        let targetHost = normalizedHost(for: targetURL)
        let targetNavigationTarget = normalizedNavigationTarget(for: targetURL)

        // Declarative load (SwiftUI updateUIView re-sync) must not cancel an
        // explicit in-flight navigation: the OLD page's didCommit/didFinish can
        // write its URL back into slots[].url after loadSession already
        // forceLoad-ed the new target, and the resulting stale render would
        // stomp the pending navigation with the previous page (claude home).
        if hasPendingNavigation,
           let pendingNavigationTarget = loadedNavigationTarget,
           pendingNavigationTarget != targetNavigationTarget {
            recordEvent("skip-load pending-target \(targetURL.absoluteString)")
            Self.logger.debug("skip-load pending-target target=\(targetURL.absoluteString, privacy: .public) pending=\(pendingNavigationTarget, privacy: .public)")
            return
        }

        if let currentURL = webView.url {
            let currentNavigationTarget = normalizedNavigationTarget(for: currentURL)
            if currentNavigationTarget == targetNavigationTarget {
                recordEvent("skip-load same-target \(currentURL.absoluteString)")
                loadedHost = targetHost
                loadedNavigationTarget = targetNavigationTarget
                if !hasPendingNavigation {
                    isDisplayReady = true
                }
                Self.logger.debug("skip-load same-target current=\(currentURL.absoluteString, privacy: .public)")
                return
            }
        }

        if loadedNavigationTarget == targetNavigationTarget {
            recordEvent("skip-load warmed-target \(targetURL.absoluteString)")
            if !hasPendingNavigation {
                isDisplayReady = true
            }
            Self.logger.debug("skip-load warmed-target target=\(targetURL.absoluteString, privacy: .public)")
            return
        }

        loadedHost = targetHost
        loadedNavigationTarget = targetNavigationTarget
        setDisplayReady(false)
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
        loadedNavigationTarget = normalizedNavigationTarget(for: targetURL)
        setDisplayReady(false)
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

    func applyPageZoom(_ zoom: CGFloat) {
        let normalizedZoom = min(max(zoom, 0.7), 1.0)
        currentPageZoom = normalizedZoom
        currentConfiguredZoom = String(format: "%.2f", normalizedZoom)
        webView.pageZoom = 1.0
        popupWebView?.pageZoom = 1.0
        refreshViewportBootstrapScript(for: webView)
        if let popupWebView {
            refreshViewportBootstrapScript(for: popupWebView)
        }
        applyViewportScale(to: webView)
        if let popupWebView {
            applyViewportScale(to: popupWebView)
        }
        recordEvent("page-zoom \(String(format: "%.2f", normalizedZoom))")
        scheduleRuntimeSnapshotRefreshAfterZoom()
    }

    private func scheduleRuntimeSnapshotRefreshAfterZoom() {
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 200_000_000)
            guard let self else { return }
            self.refreshRuntimeSnapshot()
            if let popup = self.popupWebView {
                self.refreshPopupRuntimeSnapshot(for: popup)
            }
            self.recordEvent("runtime-snapshot zoom-refresh 200ms")
        }
    }

    private func scheduleViewportScaleRefresh(for webView: WKWebView, reason: String, delaysNs: [UInt64] = [350_000_000, 1_200_000_000]) {
        for delay in delaysNs {
            Task { @MainActor [weak self, weak webView] in
                try? await Task.sleep(nanoseconds: delay)
                guard let self, let webView else { return }
                self.applyViewportScale(to: webView)
                self.recordEvent("page-zoom-refresh \(reason) \(Int(delay / 1_000_000))ms")
            }
        }
    }

    private func applyViewportScale(to webView: WKWebView) {
        let scale = String(format: "%.3f", effectiveViewportZoom(for: webView))
        let script = """
        (function() {
          try {
            const scale = \(scale);
            const head = document.head || document.getElementsByTagName('head')[0];
            if (!head) return 'no-head';
            let meta = document.querySelector('meta[name="viewport"]');
            if (!meta) {
              meta = document.createElement('meta');
              meta.setAttribute('name', 'viewport');
              head.appendChild(meta);
            }
            const desired = 'width=device-width, initial-scale=' + scale + ', viewport-fit=cover';
            if (meta.getAttribute('content') !== desired) {
              meta.setAttribute('content', desired);
            }
            let style = document.getElementById('verity-text-size-adjust');
            if (!style) {
              style = document.createElement('style');
              style.id = 'verity-text-size-adjust';
              head.appendChild(style);
            }
            style.textContent = 'html, body { -webkit-text-size-adjust: 100% !important; }';
            document.documentElement.style.setProperty('-webkit-text-size-adjust', '100%');
            if (document.body) {
              document.body.style.minHeight = '100vh';
            }
            return 'ok';
          } catch (error) {
            return String(error);
          }
        })();
        """
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    func clearDiagnostics() {
        debugEvents = []
        currentLocationHref = ""
        currentUserAgent = ""
        currentCookieHost = ""
        currentHostCookieCount = 0
        currentHostCookieNames = []
        currentViewportContent = ""
        currentVisualViewportScale = ""
        currentWindowInnerWidth = ""
        currentDocumentClientWidth = ""
        currentConfiguredZoom = ""
        currentScrollViewZoom = ""
        lastNavigationState = "idle"
        lastNavigationError = ""
        popupLocationHref = ""
        popupNavigationState = "idle"
        popupNavigationError = ""
        lastScrapeState = "idle"
        lastScrapeError = ""
        lastScrapeDocumentTitle = ""
        lastScrapePromptCandidate = ""
        lastScrapePreview = ""
        lastScrapeCandidateTrace = ""
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

    func collectLatestReply(serviceId: String, sourcePrompt: String) async -> SlotScrapeReply? {
        let sid = serviceId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        // chatgpt included: its copy path succeeds only every other poll (clipboard
        // race), so scrapes alternate copy/dom texts that differ by the "ChatGPT
        // said:" header — the collect stability guard then never converges and every
        // Collect waits out the 30s timeout. DOM is deterministic per poll;
        // header-in-text matches Claude's long-standing captured format.
        let preferDesktopDOMFirst = sid == "gemini" || sid == "grok" || sid == "chatgpt"
        recordEvent("collect-start \(sid) domFirst=\(preferDesktopDOMFirst) promptLen=\(sourcePrompt.count)")

        if preferDesktopDOMFirst {
            let domExtraction = await extractLatestAssistantRawReply(serviceId: sid, sourcePrompt: sourcePrompt)
            recordEvent("collect-domExtract \(sid) rawLen=\(domExtraction?.raw.count ?? 0) frag=\(domExtraction?.fragmentOnly ?? false)")
            let dom = await scrapeLatestReplyFromDesktopDOM(
                extraction: domExtraction,
                serviceId: sid,
                sourcePrompt: sourcePrompt
            )
            recordEvent("collect-domScrape \(sid) textLen=\(dom?.text?.count ?? 0) err=\(dom?.error ?? "none")")
            if dom?.text?.isEmpty == false { return dom }
            let copied = await scrapeLatestReplyFromCopy(serviceId: sid, sourcePrompt: sourcePrompt)
            recordEvent("collect-copy \(sid) textLen=\(copied?.text?.count ?? 0)")
            let collectorTrace = buildCollectorTrace(
                domExtraction: domExtraction,
                domReply: dom,
                copyReply: copied
            )
            return enrichCollectorTrace(copied ?? dom, collectorTrace: collectorTrace)
        }

        let copied = await scrapeLatestReplyFromCopy(serviceId: sid, sourcePrompt: sourcePrompt)
        recordEvent("collect-copy \(sid) textLen=\(copied?.text?.count ?? 0)")
        if copied?.text?.isEmpty == false {
            let collectorTrace = buildCollectorTrace(
                domExtraction: nil,
                domReply: nil,
                copyReply: copied
            )
            return enrichCollectorTrace(copied, collectorTrace: collectorTrace)
        }
        let domExtraction = await extractLatestAssistantRawReply(serviceId: sid, sourcePrompt: sourcePrompt)
        recordEvent("collect-domExtract \(sid) rawLen=\(domExtraction?.raw.count ?? 0) frag=\(domExtraction?.fragmentOnly ?? false)")
        let dom = await scrapeLatestReplyFromDesktopDOM(
            extraction: domExtraction,
            serviceId: sid,
            sourcePrompt: sourcePrompt
        )
        recordEvent("collect-domScrape \(sid) textLen=\(dom?.text?.count ?? 0) err=\(dom?.error ?? "none")")
        let collectorTrace = buildCollectorTrace(
            domExtraction: domExtraction,
            domReply: dom,
            copyReply: copied
        )
        return enrichCollectorTrace(dom ?? copied, collectorTrace: collectorTrace)
    }

    func scrapeLatestReply(serviceId: String, sourcePrompt: String) async -> SlotScrapeReply? {
        await scrapeLatestReply(
            serviceId: serviceId,
            sourcePrompt: sourcePrompt,
            rawReplyOverride: nil,
            stageLabel: "scrape"
        )
    }

    private func scrapeLatestReply(
        serviceId: String,
        sourcePrompt: String,
        rawReplyOverride: String?,
        stageLabel: String
    ) async -> SlotScrapeReply? {
        var payload: [String: Any] = [
            "serviceId": serviceId,
            "sourcePrompt": sourcePrompt,
        ]
        if let rawReplyOverride, !rawReplyOverride.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["rawReplyOverride"] = rawReplyOverride
        }
        let script = SharedScriptBridge.buildInvocation(namespace: scrapeScript, payload: payload)
        guard let raw = try? await webView.evaluateJavaScript(script) as? String else {
            lastScrapeState = "invoke-failed"
            lastScrapeError = "Script invocation failed"
            lastScrapeDocumentTitle = ""
            lastScrapePromptCandidate = ""
            lastScrapePreview = ""
            lastScrapeCandidateTrace = ""
            recordEvent("\(stageLabel)-fail \(serviceId) invoke")
            return nil
        }

        guard let response = decodeJSONResult(raw) else {
            lastScrapeState = "parse-failed"
            lastScrapeError = "Scrape JSON parse failed"
            lastScrapeDocumentTitle = ""
            lastScrapePromptCandidate = ""
            lastScrapePreview = raw.prefix(180).description
            lastScrapeCandidateTrace = ""
            recordEvent("\(stageLabel)-fail \(serviceId) parse")
            return nil
        }

        let documentTitle = (response["document_title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let promptCandidateMap = response["prompt_candidate"] as? [String: Any]
        let promptCandidateText = (promptCandidateMap?["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let text = (response["text"] as? String ?? response["replyText"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let error = (response["error"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let selectedReplyPreview = (response["selected_reply_preview"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let candidateTrace = Self.formatCandidateTrace(response["candidate_trace"])
        let debugTrace = Self.formatDebugTrace(response["debug_trace"])
        let success = response["success"] as? Bool == true && !text.isEmpty

        lastScrapeState = success ? "success" : "failed"
        lastScrapeError = error
        lastScrapeDocumentTitle = documentTitle
        lastScrapePromptCandidate = promptCandidateText
        lastScrapePreview = (success ? text : (selectedReplyPreview.isEmpty ? raw : selectedReplyPreview)).prefix(220).description
        lastScrapeCandidateTrace = [candidateTrace, debugTrace]
            .filter { !$0.isEmpty }
            .joined(separator: "\n---\n")
        let errorLabel = error.isEmpty ? "unknown" : error
        recordEvent(success ? "\(stageLabel)-success \(serviceId) chars=\(text.count)" : "\(stageLabel)-fail \(serviceId) \(errorLabel)")

        return SlotScrapeReply(
            text: success ? text : nil,
            error: error,
            documentTitle: documentTitle,
            promptCandidateText: promptCandidateText,
            debugTrace: debugTrace,
            rawResult: raw,
            method: stageLabel,
            collectorTrace: ""
        )
    }

    private func buildCollectorTrace(
        domExtraction: DesktopDOMExtraction?,
        domReply: SlotScrapeReply?,
        copyReply: SlotScrapeReply?
    ) -> String {
        let domRawLen = domExtraction?.raw.count ?? 0
        let domFrag = domExtraction?.fragmentOnly == true ? "true" : "false"
        let domReason = (domExtraction?.reason ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let domPreview = (domExtraction?.selectedPreview ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\n", with: " ")
        let domTextLen = domReply?.text?.trimmingCharacters(in: .whitespacesAndNewlines).count ?? 0
        let domErr = (domReply?.error ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let copyTextLen = copyReply?.text?.trimmingCharacters(in: .whitespacesAndNewlines).count ?? 0
        let copyErr = (copyReply?.error ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return "collector domRaw=\(domRawLen) domFrag=\(domFrag) domReason=\(domReason.isEmpty ? "none" : domReason) domPreview=\(String(domPreview.prefix(80))) domText=\(domTextLen) domErr=\(domErr.isEmpty ? "none" : domErr) copyText=\(copyTextLen) copyErr=\(copyErr.isEmpty ? "none" : copyErr)"
    }

    private func enrichCollectorTrace(_ reply: SlotScrapeReply?, collectorTrace: String) -> SlotScrapeReply? {
        guard let reply else { return nil }
        let combinedTrace = [collectorTrace, reply.debugTrace]
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .joined(separator: " | ")
        return SlotScrapeReply(
            text: reply.text,
            error: reply.error,
            documentTitle: reply.documentTitle,
            promptCandidateText: reply.promptCandidateText,
            debugTrace: combinedTrace,
            rawResult: reply.rawResult,
            method: reply.method,
            collectorTrace: collectorTrace
        )
    }

    private func normalizedForPromptCompare(_ text: String) -> String {
        text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }

    /// True when the copied text is (almost certainly) an echo of the user's own
    /// prompt rather than the assistant's reply — i.e. the copy-button target
    /// selection grabbed the wrong (user) message. See collect-copy alternating
    /// 756/2547-char bug on ChatGPT iOS (2026-07-06).
    private func looksLikePromptEcho(capturedText: String, sourcePrompt: String) -> Bool {
        let a = normalizedForPromptCompare(capturedText)
        let b = normalizedForPromptCompare(sourcePrompt)
        guard !a.isEmpty, !b.isEmpty else { return false }
        if a == b { return true }
        // Near-exact: one contains the other and their lengths are close
        // (guards against a short reply that happens to quote the prompt).
        let lenDiff = abs(a.count - b.count)
        if lenDiff <= max(20, Int(Double(min(a.count, b.count)) * 0.05)) {
            if a.contains(b) || b.contains(a) { return true }
        }
        return false
    }

    private func scrapeLatestReplyFromCopy(serviceId: String, sourcePrompt: String) async -> SlotScrapeReply? {
        guard let captured = await captureLatestReplyViaCopy(serviceId: serviceId),
              !captured.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return nil
        }

        if looksLikePromptEcho(capturedText: captured, sourcePrompt: sourcePrompt) {
            recordEvent("copy-fail \(serviceId) prompt-echo chars=\(captured.count)")
            return nil
        }

        return await scrapeLatestReply(
            serviceId: serviceId,
            sourcePrompt: sourcePrompt,
            rawReplyOverride: captured,
            stageLabel: "copy"
        )
    }

    private func scrapeLatestReplyFromDesktopDOM(
        extraction: DesktopDOMExtraction?,
        serviceId: String,
        sourcePrompt: String
    ) async -> SlotScrapeReply? {
        guard let extraction,
              !extraction.raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return nil
        }

        return await scrapeLatestReply(
            serviceId: serviceId,
            sourcePrompt: sourcePrompt,
            rawReplyOverride: extraction.raw,
            stageLabel: "dom"
        )
    }

    private func extractLatestAssistantRawReply(serviceId: String, sourcePrompt: String) async -> DesktopDOMExtraction? {
        let payload: [String: Any] = [
            "serviceId": serviceId,
            "sourcePrompt": sourcePrompt,
            "compactDiagnostics": true,
        ]
        let script = SharedScriptBridge.buildInvocation(namespace: rawExtractorScript, payload: payload)
        let evaluated: Any
        do {
            evaluated = try await webView.evaluateJavaScript(script)
        } catch {
            let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
            recordEvent("dom-fail \(serviceId) js-\(message)")
            return DesktopDOMExtraction(
                raw: "",
                fragmentOnly: false,
                reason: "js-\(message)",
                selectedPreview: ""
            )
        }

        guard let raw = evaluated as? String else {
            let typeLabel = String(describing: type(of: evaluated))
            recordEvent("dom-fail \(serviceId) non-string-\(typeLabel)")
            return DesktopDOMExtraction(
                raw: "",
                fragmentOnly: false,
                reason: "non-string-\(typeLabel)",
                selectedPreview: ""
            )
        }

        guard let response = decodeJSONResult(raw) else {
            let preview = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            let compactPreview = String(preview.prefix(80)).replacingOccurrences(of: "\n", with: " ")
            recordEvent("dom-fail \(serviceId) parse-\(compactPreview)")
            return DesktopDOMExtraction(
                raw: "",
                fragmentOnly: false,
                reason: "parse-failed",
                selectedPreview: compactPreview
            )
        }

        if let bridgeError = (response["__verityBridgeError"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !bridgeError.isEmpty {
            let stack = (response["__verityBridgeStack"] as? String ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let compactStack = String(stack.prefix(120)).replacingOccurrences(of: "\n", with: " | ")
            let reason = compactStack.isEmpty ? bridgeError : "\(bridgeError) @ \(compactStack)"
            recordEvent("dom-fail \(serviceId) bridge-\(bridgeError)")
            return DesktopDOMExtraction(
                raw: "",
                fragmentOnly: false,
                reason: reason,
                selectedPreview: ""
            )
        }

        let diagnostics = response["diagnostics"] as? [String: Any]
        if let diagnostics,
           let selected = diagnostics["selected"] as? [String: Any],
           let preview = selected["preview"] as? String,
           !preview.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            lastScrapePreview = preview.prefix(220).description
        }

        let extracted = (response["raw"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let selected = diagnostics?["selected"] as? [String: Any]
        let fragmentOnly = selected?["fragment_only"] as? Bool == true
        let promptEcho = selected?["prompt_echo"] as? Bool == true
        let selectedPreview = (selected?["preview"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let reason = (diagnostics?["no_candidate_reason"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if extracted.isEmpty {
            recordEvent("dom-fail \(serviceId) \(reason.isEmpty ? "empty" : reason)")
            return DesktopDOMExtraction(
                raw: "",
                fragmentOnly: fragmentOnly,
                reason: reason.isEmpty ? "empty" : reason,
                selectedPreview: selectedPreview
            )
        }

        recordEvent("dom-captured \(serviceId) chars=\(extracted.count)\(fragmentOnly ? " fragment" : "")\(promptEcho ? " prompt-echo" : "")")
        return DesktopDOMExtraction(
            raw: extracted,
            fragmentOnly: fragmentOnly,
            reason: reason,
            selectedPreview: selectedPreview
        )
    }

    private func captureLatestReplyViaCopy(serviceId: String) async -> String? {
        let sid = serviceId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let script = """
        (function() {
          try {
            const sid = \(String(reflecting: sid));
            function hasLayout(el) {
              if (!el) return false;
              const r = el.getBoundingClientRect();
              const s = window.getComputedStyle(el);
              return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
            }
            function labelOf(el) {
              return String(
                el?.getAttribute?.('aria-label') ||
                el?.getAttribute?.('title') ||
                el?.getAttribute?.('mattooltip') ||
                el?.textContent ||
                ''
              ).replace(/\\s+/g, ' ').trim();
            }
            function isCopyLike(label, el) {
              const l = String(label || '').toLowerCase();
              if (l && l.includes('copy')) return true;
              try {
                const own = (el?.className || '').toString().toLowerCase();
                if (own.includes('copy')) return true;
                if (el?.querySelector?.('.dl-icon-copy, [class*=\"copy-icon\"], [class*=\"copy-btn\"], [class*=\"copy-button\"]')) return true;
              } catch (_) {}
              return false;
            }
            function inExcludedArea(el) {
              return !!el?.closest?.('textarea, [contenteditable=\"true\"], [role=\"textbox\"], [data-testid*=\"composer\"], [class*=\"composer\"]');
            }
            function inUserMessage(el) {
              return !!el?.closest?.('[data-message-author-role=\"user\"]');
            }
            function messageContainer(el) {
              const specific = el?.closest?.('[data-message-author-role=\"assistant\"], [data-testid*=\"assistant\"], [class*=\"assistant\"][class*=\"message\"], article, [class*=\"response\"], [class*=\"answer\"], [id^=\"response-\"], model-response, response-container, [class*=\"message-bubble\"], [class*=\"prose\"]');
              if (specific) return specific;
              let parent = el?.parentElement;
              for (let i = 0; i < 15 && parent; i += 1) {
                const text = (parent.innerText || parent.textContent || '').replace(/\\s+/g, ' ').trim();
                if (text.length >= 30) return parent;
                parent = parent.parentElement;
              }
              return null;
            }

            window.__verityCopiedText = '';
            try {
              if (navigator.clipboard && navigator.clipboard.writeText && !navigator.clipboard.__verityWrappedWriteText) {
                const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
                const wrapped = function(text) {
                  window.__verityCopiedText = String(text || '');
                  return origWrite(text).catch(() => {});
                };
                wrapped.__verityWrappedWriteText = true;
                navigator.clipboard.writeText = wrapped;
              }
            } catch (_) {}
            try {
              if (navigator.clipboard && navigator.clipboard.write && !navigator.clipboard.__verityWrappedWrite) {
                const origWrite = navigator.clipboard.write.bind(navigator.clipboard);
                const wrapped = async function(items) {
                  try {
                    for (const item of items || []) {
                      if (item.types && item.types.includes('text/plain')) {
                        const blob = await item.getType('text/plain');
                        window.__verityCopiedText = await blob.text();
                        break;
                      }
                      if (item.types && item.types.includes('text/html') && !window.__verityCopiedText) {
                        const blob = await item.getType('text/html');
                        const html = await blob.text();
                        const tmp = document.createElement('div');
                        tmp.innerHTML = html;
                        window.__verityCopiedText = tmp.textContent || tmp.innerText || '';
                      }
                    }
                  } catch (_) {}
                  return origWrite(items).catch(() => {});
                };
                wrapped.__verityWrappedWrite = true;
                navigator.clipboard.write = wrapped;
              }
            } catch (_) {}
            try {
              if (!document.__verityWrappedExecCommand) {
                const origExec = document.execCommand.bind(document);
                document.execCommand = function(cmd) {
                  if (cmd === 'copy') {
                    try { window.__verityCopiedText = window.getSelection().toString(); } catch (_) {}
                  }
                  return origExec.apply(document, arguments);
                };
                document.__verityWrappedExecCommand = true;
              }
            } catch (_) {}

            const msgContainers = document.querySelectorAll('[id^=\"response-\"], model-response, response-container, [data-message-author-role=\"assistant\"], article, [class*=\"response\"]');
            const lastContainer = Array.from(msgContainers).filter(hasLayout).pop();
            if (lastContainer) {
              ['mouseenter', 'mouseover', 'mousemove'].forEach((evt) => {
                try { lastContainer.dispatchEvent(new MouseEvent(evt, { bubbles: true, clientX: 100, clientY: 100 })); } catch (_) {}
              });
            }

            const selectors = [
              '[data-testid=\"copy-turn-action-button\"]',
              'button[aria-label*=\"Copy\" i]',
              'button[title*=\"Copy\" i]',
              '[role=\"button\"][aria-label*=\"Copy\" i]',
              '[data-testid*=\"copy\" i]',
              '[data-test-id*=\"copy\" i]',
              'button[mattooltip*=\"Copy\" i]',
              'copy-button button',
              '.dl-btn:has(.dl-icon-copy)',
              '.ds-icon-button:has(.dl-icon-copy)',
              '[role=\"button\"]:has([class*=\"copy\"])',
              '.ds-markdown-code-copy-button',
              'button[class*=\"copy\"]',
              '[class*=\"message-action\"] button:first-child'
            ];

            const seen = new Set();
            const candidates = [];
            selectors.forEach((sel) => {
              try {
                document.querySelectorAll(sel).forEach((el) => {
                  if (!el || seen.has(el)) return;
                  seen.add(el);
                  const isExactChatGPT = sel === '[data-testid=\"copy-turn-action-button\"]';
                  if (!isExactChatGPT && inExcludedArea(el)) return;
                  if (inUserMessage(el)) return;
                  if (!hasLayout(el)) return;
                  const label = labelOf(el);
                  if (!isCopyLike(label, el)) return;
                  const rect = el.getBoundingClientRect();
                  const msg = messageContainer(el);
                  const msgText = (msg?.innerText || msg?.textContent || '').replace(/\\s+/g, ' ').trim();
                  if (!msgText || msgText.length < 20) return;
                  let score = rect.bottom + Math.min(msgText.length, 5000) * 0.04;
                  if (sid === 'perplexity' && msgText.toLowerCase().includes('ask a follow-up')) score -= 1200;
                  candidates.push({ el, label, score, bottom: rect.bottom });
                });
              } catch (_) {}
            });

            if (candidates.length === 0) {
              return JSON.stringify({ clicked: false, reason: 'no-copy-button' });
            }

            candidates.sort((a, b) => (b.score - a.score) || (b.bottom - a.bottom));
            const target = candidates[0];
            const hoverTarget = target.el.closest('[class*=\"group\"]') || target.el.parentElement || target.el;
            ['mouseenter', 'mouseover', 'mousemove'].forEach((evt) => {
              try { hoverTarget.dispatchEvent(new MouseEvent(evt, { bubbles: true })); } catch (_) {}
              try { target.el.dispatchEvent(new MouseEvent(evt, { bubbles: true })); } catch (_) {}
            });
            try { target.el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
            try { window.focus(); } catch (_) {}
            try { target.el.click(); } catch (_) { return JSON.stringify({ clicked: false, reason: 'click-failed' }); }
            return JSON.stringify({ clicked: true, label: target.label, candidates: candidates.length });
          } catch (e) {
            return JSON.stringify({ clicked: false, reason: e?.message || String(e) });
          }
        })()
        """

        guard let raw = try? await webView.evaluateJavaScript(script) as? String,
              let response = decodeJSONResult(raw)
        else {
            return nil
        }

        guard response["clicked"] as? Bool == true else {
            if let reason = response["reason"] as? String, !reason.isEmpty {
                recordEvent("copy-fail \(sid) \(reason)")
            }
            return nil
        }

        let readScript = """
        (function() {
          try {
            return String(window.__verityCopiedText || '').trim();
          } catch (_) {
            return '';
          }
        })()
        """

        for _ in 0..<20 {
            try? await Task.sleep(nanoseconds: 200_000_000)
            guard let captured = try? await webView.evaluateJavaScript(readScript) as? String else {
                continue
            }

            let normalized = captured.trimmingCharacters(in: .whitespacesAndNewlines)
            if normalized.isEmpty {
                continue
            }

            recordEvent("copy-captured \(sid) chars=\(normalized.count)")
            return normalized
        }

        recordEvent("copy-fail \(sid) empty")
        return nil
    }

    private func pickPreferredReply(
        preferred: SlotScrapeReply?,
        preferredFragmentOnly: Bool,
        fallback: SlotScrapeReply?
    ) -> SlotScrapeReply? {
        let preferredText = preferred?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let fallbackText = fallback?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        if preferredFragmentOnly, !fallbackText.isEmpty {
            return fallback
        }
        if preferredText.isEmpty {
            return fallback ?? preferred
        }
        if fallbackText.isEmpty {
            return preferred ?? fallback
        }
        if fallbackText.count >= preferredText.count + 120 {
            return fallback
        }
        if preferredText.count >= fallbackText.count + 120 {
            return preferred
        }

        return preferred
    }

    func isStillGenerating(serviceId: String) async -> Bool {
        let sid = serviceId
        let script = """
        (function() {
          try {
            const sid = \(String(reflecting: sid));
            const checks = [
              '[aria-label="Stop generating"]',
              '[aria-label="Stop streaming"]',
              '[data-testid="stop-button"]',
              'button[aria-label*="Stop" i]'
            ];
            if (sid === 'claude') checks.push(
              '[aria-label="Stop Response"]',
              'button[aria-label*="Stop response" i]',
              'button[aria-label*="Stop responding" i]',
              'button[title*="Stop" i]',
              '[aria-busy="true"]'
            );
            if (sid === 'gemini') { checks.push('mat-icon[data-mat-icon-name="stop_circle"]', 'button[data-test-id="stop-button"]', '.stop-button'); }
            if (sid === 'deepseek') checks.push('.stop-button');
            if (sid === 'perplexity') checks.push('[aria-label*="stop" i]');
            if (sid === 'grok') checks.push('[aria-label*="Stop" i]');

            function hasLayout(el) {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            }

            const found = checks.some((sel) => {
              try {
                return Array.from(document.querySelectorAll(sel)).some(hasLayout);
              } catch (_) {
                return false;
              }
            });
            return JSON.stringify({ generating: found });
          } catch (_) {
            return JSON.stringify({ generating: false });
          }
        })()
        """

        guard let rawResult = try? await webView.evaluateJavaScript(script) as? String,
              let response = decodeJSONResult(rawResult)
        else {
            return false
        }

        return response["generating"] as? Bool == true
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
        let trimmed = rawResult.trimmingCharacters(in: .whitespacesAndNewlines)

        func parseObject(_ candidate: String) -> [String: Any]? {
            guard let data = candidate.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                return nil
            }
            return object
        }

        if let direct = parseObject(trimmed) {
            return direct
        }

        if let quotedData = trimmed.data(using: .utf8),
           let unboxed = try? JSONDecoder().decode(String.self, from: quotedData),
           let parsed = parseObject(unboxed.trimmingCharacters(in: .whitespacesAndNewlines)) {
            return parsed
        }

        let cleaned = trimmed
            .replacingOccurrences(of: "\\\"", with: "\"")
            .replacingOccurrences(of: "\\\\", with: "\\")
            .trimmingCharacters(in: CharacterSet(charactersIn: "\""))

        return parseObject(cleaned)
    }

    private static func formatCandidateTrace(_ rawTrace: Any?) -> String {
        guard let items = rawTrace as? [[String: Any]], !items.isEmpty else {
            return ""
        }

        return items.map { item in
            let index = item["index"] as? Int ?? 0
            let success = item["success"] as? Bool == true
            let error = (item["error"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let preview = (item["preview"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let promptCandidate = (item["prompt_candidate"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let embeddedPrompt = (item["embedded_prompt"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let embeddedPromptScore = item["embedded_prompt_score"] as? Int ?? 0
            let structure = item["structure"] as? Int ?? 0
            let flatLength = item["flat_length"] as? Int ?? 0
            let containsPeer = item["contains_peer"] as? Bool == true
            let fragmentOnly = item["fragment_only"] as? Bool == true
            let richerParent = item["richer_parent"] as? Bool == true
            let richerChild = item["richer_child"] as? Bool == true

            let status = success ? "success" : "fail"
            var parts = ["#\(index) \(status)"]
            if !error.isEmpty {
                parts.append("error=\(error)")
            }
            parts.append("chars=\(flatLength)")
            parts.append("structure=\(structure)")
            if embeddedPromptScore > 0 {
                parts.append("embeddedScore=\(embeddedPromptScore)")
            }
            if containsPeer { parts.append("containsPeer") }
            if fragmentOnly { parts.append("fragmentOnly") }
            if richerParent { parts.append("richerParent") }
            if richerChild { parts.append("richerChild") }
            if !promptCandidate.isEmpty {
                parts.append("prompt=\(promptCandidate.prefix(120))")
            } else if !embeddedPrompt.isEmpty {
                parts.append("embeddedPrompt=\(embeddedPrompt.prefix(120))")
            }
            if !preview.isEmpty {
                parts.append("preview=\(preview.prefix(160))")
            }
            return parts.joined(separator: " | ")
        }
        .joined(separator: "\n")
    }

    private static func formatDebugTrace(_ rawTrace: Any?) -> String {
        guard let map = rawTrace as? [String: Any], !map.isEmpty else {
            return ""
        }

        let keys = map.keys.sorted()
        return keys.compactMap { key -> String? in
            let value = String(describing: map[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { return nil }
            return "\(key)=\(value)"
        }.joined(separator: " | ")
    }

    private func normalizedHost(for url: URL) -> String {
        let host = (url.host ?? url.absoluteString).lowercased()
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    private func normalizedNavigationTarget(for url: URL) -> String {
        let host = normalizedHost(for: url)
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let segments = url.pathComponents
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty && $0 != "/" }

        func firstAfter(_ label: String) -> String? {
            guard let index = segments.firstIndex(of: label), index + 1 < segments.count else { return nil }
            return segments[index + 1]
        }

        func looksLikeConversationID(_ value: String?) -> Bool {
            let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
            guard normalized.count >= 6 else { return false }
            return normalized.range(of: #"^[a-z0-9][a-z0-9_-]*$"#, options: .regularExpression) != nil
        }

        var serviceID = host
        var conversationKey: String?

        switch host {
        case "chatgpt.com", "chat.openai.com":
            serviceID = "chatgpt"
            conversationKey = firstAfter("c") ?? firstAfter("chat")
            if conversationKey == nil,
               components?.queryItems?.contains(where: { $0.name.lowercased() == "temporary-chat" }) == true {
                conversationKey = "temporary"
            }
        case "claude.ai":
            serviceID = "claude"
            conversationKey = firstAfter("chat")
        case "grok.com":
            serviceID = "grok"
            conversationKey = firstAfter("c") ?? firstAfter("chat")
        case "gemini.google.com":
            serviceID = "gemini"
            conversationKey = firstAfter("app") ?? firstAfter("chat")
        case "www.perplexity.ai", "perplexity.ai":
            serviceID = "perplexity"
            conversationKey = firstAfter("search")
        case "chat.deepseek.com":
            serviceID = "deepseek"
            conversationKey = firstAfter("s") ?? firstAfter("chat")
        default:
            conversationKey = nil
        }

        if conversationKey == nil, looksLikeConversationID(segments.last) {
            conversationKey = segments.last
        }

        if let conversationKey, !conversationKey.isEmpty {
            return "\(serviceID):\(conversationKey)"
        }

        if !segments.isEmpty {
            return "\(serviceID):\(segments.joined(separator: "/"))"
        }

        return serviceID
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
            applyViewportScale(to: webView)
            scheduleViewportScaleRefresh(for: webView, reason: "popup-finish")
            refreshPopupRuntimeSnapshot(for: webView)
            maybeAdoptPopupURL(url)
            return
        }
        loadedHost = normalizedHost(for: url)
        loadedNavigationTarget = normalizedNavigationTarget(for: url)
        lastNavigationState = "finished"
        lastNavigationError = ""
        recordEvent("did-finish \(url.absoluteString)")
        Self.logger.info("did-finish url=\(url.absoluteString, privacy: .public)")
        onURLChange?(url)
        applyViewportScale(to: webView)
        scheduleDisplayReady(after: 450_000_000, reason: "did-finish")
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
        setDisplayReady(false)
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
        popup.pageZoom = 1.0
        popupWebView = popup
        popupNavigationState = "created"
        popupNavigationError = ""
        popupLocationHref = navigationAction.request.url?.absoluteString ?? ""
        refreshViewportBootstrapScript(for: popup)
        applyViewportScale(to: popup)

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
        isDisplayReady = true
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
        isDisplayReady = true
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
            bodyText: String(document && document.body && document.body.innerText || '').slice(0, 4000),
            viewportContent: String((document.querySelector('meta[name="viewport"]') || {}).content || ''),
            visualViewportScale: String(window.visualViewport && typeof window.visualViewport.scale === 'number' ? window.visualViewport.scale : ''),
            innerWidth: String(typeof window.innerWidth === 'number' ? window.innerWidth : ''),
            clientWidth: String(document && document.documentElement && typeof document.documentElement.clientWidth === 'number' ? document.documentElement.clientWidth : '')
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
                self.currentScrollViewZoom = String(format: "%.2f", webView.scrollView.zoomScale)
                await self.refreshCookieSnapshot(for: self.currentLocationHref)
                return
            }

            self.currentLocationHref = (object["href"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (webView.url?.absoluteString ?? "")
            self.currentUserAgent = (object["userAgent"] as? String) ?? "unavailable"
            self.currentViewportContent = (object["viewportContent"] as? String) ?? ""
            self.currentVisualViewportScale = (object["visualViewportScale"] as? String) ?? ""
            self.currentWindowInnerWidth = (object["innerWidth"] as? String) ?? ""
            self.currentDocumentClientWidth = (object["clientWidth"] as? String) ?? ""
            self.currentConfiguredZoom = String(format: "%.2f", self.currentPageZoom)
            self.currentScrollViewZoom = String(format: "%.2f", webView.scrollView.zoomScale)
            if let bodyText = object["bodyText"] as? String {
                self.maybeRecoverClaudeVerificationHang(bodyText: bodyText)
                self.maybeRecoverClaudeBlankScreen(bodyText: bodyText)
            }
            await self.refreshCookieSnapshot(for: self.currentLocationHref)
        }
    }

    func resolveCurrentLocationHrefForSnapshot() async -> String {
        let script = "String(window.location && window.location.href || '')"
        let jsHref = (try? await webView.evaluateJavaScript(script) as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let fallbackHref = (webView.url?.absoluteString ?? currentLocationHref)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let resolved = jsHref?.isEmpty == false ? jsHref! : fallbackHref
        if !resolved.isEmpty {
            currentLocationHref = resolved
            recordEvent("snapshot-href \(resolved)")
        }
        return resolved
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

    private func maybeRecoverClaudeBlankScreen(bodyText: String) {
        let normalizedURL = currentLocationHref.lowercased()
        guard normalizedURL.contains("claude.ai") else { return }
        guard !normalizedURL.contains("claude.ai/login") else { return }
        guard lastNavigationState == "finished" else { return }

        let trimmed = bodyText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count < 8 else { return }

        let now = Date()
        if let lastAttempt = lastClaudeBlankRecoveryAt, now.timeIntervalSince(lastAttempt) < 8 {
            return
        }

        lastClaudeBlankRecoveryAt = now
        recordEvent("claude-blank-recovery scheduled")
        Self.logger.info("claude-blank-recovery scheduled")

        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard self.lastNavigationState == "finished" else { return }
            guard self.currentLocationHref.lowercased().contains("claude.ai"),
                  !self.currentLocationHref.lowercased().contains("claude.ai/login")
            else { return }

            let currentBodyText = (try? await self.webView.evaluateJavaScript("String(document && document.body && document.body.innerText || '')") as? String) ?? ""
            let currentTrimmed = currentBodyText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard currentTrimmed.count < 8 else { return }

            self.recordEvent("claude-blank-recovery reload")
            Self.logger.info("claude-blank-recovery reload")
            self.reloadCurrentPage()
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
