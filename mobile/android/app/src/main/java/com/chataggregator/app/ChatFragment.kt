package com.chataggregator.app

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import androidx.fragment.app.Fragment
import com.chataggregator.app.databinding.FragmentChatBinding
import com.google.gson.Gson

data class AndroidPromptCandidate(
    val text: String,
    val top: Double? = null,
    val bottom: Double? = null,
    val htmlLength: Int? = null
)

data class AndroidLatestAssistantReply(
    val text: String,
    val documentTitle: String = "",
    val promptCandidate: AndroidPromptCandidate? = null
)

/**
 * Fragment holding a single WebView for one AI service slot.
 */
class ChatFragment : Fragment(), Findable {

    companion object {
        private const val TAG = "ChatFragment"
        private const val ARG_SLOT_INDEX = "slot_index"

        fun newInstance(slotIndex: Int): ChatFragment {
            return ChatFragment().apply {
                arguments = Bundle().apply {
                    putInt(ARG_SLOT_INDEX, slotIndex)
                }
            }
        }
    }

    private var _binding: FragmentChatBinding? = null
    private val binding get() = _binding!!

    var slotIndex: Int = 0
        private set

    private var currentServiceId: String = "chatgpt"
    private var webViewReady = false
    private var sendInProgress = false
    private var pendingAutoAttachUri: Uri? = null
    private var pendingAttachCallback: ((Boolean) -> Unit)? = null
    private var pendingAttachTimeoutRunnable: Runnable? = null
    private var retainedWebView: WebView? = null
    private var savedWebViewState: Bundle? = null
    private val gson = Gson()

    val webView: WebView? get() = retainedWebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        slotIndex = arguments?.getInt(ARG_SLOT_INDEX, 0) ?: 0
        savedWebViewState = savedInstanceState?.getBundle("webview_state")
    }

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentChatBinding.inflate(inflater, container, false)
        return binding.root
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        retainedWebView?.let { attachWebView(it) }
        binding.progressBar.visibility = View.GONE
        // URL loading is deferred â€” MainActivity triggers it via loadService()
        // to prioritize enabled slots first
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun ensureWebView(restoreSavedState: Boolean = true): WebView {
        val webView = retainedWebView ?: createConfiguredWebView(requireContext()).also { created ->
            retainedWebView = created
            if (restoreSavedState && savedWebViewState != null) {
                created.restoreState(savedWebViewState!!)
                savedWebViewState = null
                webViewReady = true
            }
        }
        if (_binding != null) {
            attachWebView(webView)
        }
        return webView
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createConfiguredWebView(context: Context): WebView {
        return WebView(context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            // Hardware acceleration for GPU-composited rendering (critical for S10)
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            setBackgroundColor(context.getColor(R.color.bg_surface))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.cacheMode = if (SettingsManager.isAutoCacheCleanupEnabled(context))
                WebSettings.LOAD_DEFAULT else WebSettings.LOAD_CACHE_ELSE_NETWORK
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.textZoom = 90
            settings.setSupportZoom(true)
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
            settings.setSupportMultipleWindows(false)
            settings.allowFileAccess = false

            val defaultUa = settings.userAgentString
            settings.userAgentString = defaultUa.replace("; wv", "")

            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            CookieManager.getInstance().setAcceptCookie(true)

            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                    _binding?.progressBar?.visibility = View.VISIBLE
                    if (slotIndex == 0) {
                        Log.i(TAG, "[slot-$slotIndex] onPageStarted url=${url.orEmpty()}")
                    }
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    _binding?.progressBar?.visibility = View.GONE
                    webViewReady = true
                    if (slotIndex == 0) {
                        Log.i(TAG, "[slot-$slotIndex] onPageFinished url=${url.orEmpty()}")
                    }
                    url?.let { loadedUrl ->
                        val detected = ServiceConfig.detectServiceByUrl(loadedUrl)
                        if (detected != null && detected != currentServiceId) {
                            currentServiceId = detected
                            (requireActivity() as? MainActivity)?.onServiceDetected(slotIndex, detected)
                        }
                        maybeEnsureNativeIncognito(detected ?: currentServiceId, loadedUrl, "page-finished")
                    }
                }

                override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                    val failingUrl = request?.url?.toString().orEmpty()
                    val shouldLog = slotIndex == 0 || SettingsManager.isDetailedLoggingEnabled(requireContext())
                    if (shouldLog) {
                        Log.e(
                            TAG,
                            "[slot-$slotIndex] WebView error: code=${error?.errorCode} desc=${error?.description} url=$failingUrl"
                        )
                    }
                }

                override fun onReceivedHttpError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    errorResponse: WebResourceResponse?,
                ) {
                    val failingUrl = request?.url?.toString().orEmpty()
                    val shouldLog = slotIndex == 0 || SettingsManager.isDetailedLoggingEnabled(requireContext())
                    if (shouldLog) {
                        Log.w(
                            TAG,
                            "[slot-$slotIndex] HTTP error: status=${errorResponse?.statusCode} reason=${errorResponse?.reasonPhrase} url=$failingUrl"
                        )
                    }
                }

                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val url = request?.url?.toString() ?: return false
                    if (
                        url.startsWith("http://")
                        || url.startsWith("https://")
                        || url.startsWith("about:")
                        || url.startsWith("javascript:")
                        || url.startsWith("data:")
                    ) {
                        return false
                    }
                    return true
                }

                // Fix #1: Recover from renderer crash (black screen after long background)
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    Log.w(TAG, "[slot-$slotIndex] WebView renderer gone, crashed=${detail.didCrash()}, reloading")
                    val url = view.url
                    recreateRetainedWebView(url)
                    return true
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                    if (SettingsManager.isDetailedLoggingEnabled(requireContext())) {
                        Log.d(TAG, "[slot-$slotIndex][JS] ${consoleMessage?.message()}")
                        return true
                    }
                    return false
                }

                override fun onShowFileChooser(webView: WebView?, filePathCallback: ValueCallback<Array<Uri>>?, fileChooserParams: FileChooserParams?): Boolean {
                    val autoUri = pendingAutoAttachUri
                    if (autoUri != null && filePathCallback != null) {
                        retainedWebView?.let { current ->
                            pendingAttachTimeoutRunnable?.let { current.removeCallbacks(it) }
                        }
                        pendingAttachTimeoutRunnable = null
                        pendingAutoAttachUri = null
                        filePathCallback.onReceiveValue(arrayOf(autoUri))
                        pendingAttachCallback?.invoke(true)
                        pendingAttachCallback = null
                        return true
                    }
                    return false
                }
            }
        }
    }

    private fun attachWebView(webView: WebView) {
        val currentParent = webView.parent as? ViewGroup
        if (currentParent != null && currentParent !== binding.webViewContainer) {
            currentParent.removeView(webView)
        }
        if (binding.webViewContainer.indexOfChild(webView) == -1) {
            binding.webViewContainer.removeAllViews()
            binding.webViewContainer.addView(webView)
        }
    }

    private fun recreateRetainedWebView(url: String?, clearState: Boolean = false, clearCache: Boolean = false) {
        val old = retainedWebView
        if (old != null) {
            (old.parent as? ViewGroup)?.removeView(old)
            try {
                if (clearCache) old.clearCache(true)
                old.stopLoading()
                old.destroy()
            } catch (_: Exception) {}
        }
        webViewReady = false
        if (clearState) {
            savedWebViewState = null
        }
        val replacement = createConfiguredWebView(requireContext())
        retainedWebView = replacement
        if (_binding != null) attachWebView(replacement)
        if (!url.isNullOrBlank()) {
            replacement.post { replacement.loadUrl(url) }
        }
    }

    private fun freshLoadUrl(url: String, clearCache: Boolean = false) {
        val webView = ensureWebView(restoreSavedState = false)
        webViewReady = false
        savedWebViewState = null
        try {
            webView.stopLoading()
            if (clearCache) webView.clearCache(true)
            webView.clearHistory()
            webView.clearMatches()
        } catch (_: Exception) {}
        webView.post { webView.loadUrl(url) }
    }

    fun loadService(serviceId: String) {
        val service = ServiceConfig.getById(serviceId)
        if (service != null) {
            val webView = ensureWebView()
            currentServiceId = serviceId
            val isIncognito = SettingsManager.isIncognitoModeEnabled(requireContext())
            val url = IncognitoPolicy.normalizeUrl(serviceId, service.url, isIncognito)

            // Critical Perplexity Reset: clear cache to avoid CORS/QUIC blocks
            if (serviceId == "perplexity") {
                webView.clearCache(true)
            }

            val currentUrl = webView.url?.trim().orEmpty()
            if (webViewReady && currentUrl == url) return
            webView.loadUrl(url)
            Log.d(TAG, "[slot-$slotIndex] Loading ${service.name} (Incognito=$isIncognito): $url")
        }
    }

    fun loadCustomUrl(url: String) {
        val webView = ensureWebView()
        val rawUrl = if (url.startsWith("http://") || url.startsWith("https://")) url else "https://$url"
        val detectedServiceId = ServiceConfig.detectServiceByUrl(rawUrl)
        currentServiceId = detectedServiceId ?: "custom"
        val finalUrl = IncognitoPolicy.normalizeUrl(
            detectedServiceId,
            rawUrl,
            SettingsManager.isIncognitoModeEnabled(requireContext())
        )
        val currentUrl = webView.url?.trim().orEmpty()
        if (webViewReady && currentUrl == finalUrl) return
        webView.loadUrl(finalUrl)
    }

    fun loadSessionUrl(url: String, forceReload: Boolean = false) {
        val webView = ensureWebView(restoreSavedState = !forceReload)
        val rawUrl = if (url.startsWith("http://") || url.startsWith("https://")) url else "https://$url"
        val detectedServiceId = ServiceConfig.detectServiceByUrl(rawUrl)
        if (detectedServiceId != null) currentServiceId = detectedServiceId
        val finalUrl = IncognitoPolicy.normalizeUrl(
            detectedServiceId,
            rawUrl,
            SettingsManager.isIncognitoModeEnabled(requireContext())
        )
        val currentUrl = webView.url?.trim().orEmpty()
        if (forceReload) {
            freshLoadUrl(finalUrl, clearCache = true)
            Log.i(TAG, "[slot-$slotIndex] hard loadSessionUrl=$finalUrl")
            return
        }
        if (webViewReady && currentUrl == finalUrl) return
        webView.loadUrl(finalUrl)
    }

    fun reload() {
        ensureWebView().reload()
    }

    fun hardReload() {
        val currentUrl = retainedWebView?.url?.trim().orEmpty()
        if (currentUrl.isBlank()) {
            ensureWebView().reload()
            return
        }
        freshLoadUrl(currentUrl, clearCache = true)
        Log.i(TAG, "[slot-$slotIndex] hard reload url=$currentUrl")
    }

    private fun maybeEnsureNativeIncognito(serviceId: String?, loadedUrl: String?, reason: String) {
        if (!SettingsManager.isIncognitoModeEnabled(requireContext())) return
        if (!IncognitoPolicy.needsNativeActivation(serviceId, true)) return
        val webView = retainedWebView ?: return
        webView.postDelayed({
            webView.evaluateJavascript(IncognitoPolicy.buildEnsureScript(serviceId)) { result ->
                if (SettingsManager.isDetailedLoggingEnabled(requireContext()) || slotIndex == 0) {
                    Log.d(TAG, "[slot-$slotIndex] Incognito ensure ($reason) service=${serviceId.orEmpty()} url=${loadedUrl.orEmpty()} result=${result.orEmpty()}")
                }
            }
        }, 900L)
    }

    override fun startFind(query: String) {
        if (_binding == null || !webViewReady) return
        if (query.isBlank()) {
            clearFind()
            return
        }
        retainedWebView?.findAllAsync(query)
    }

    override fun findNext() {
        if (_binding == null || !webViewReady) return
        retainedWebView?.findNext(true)
    }

    override fun findPrev() {
        if (_binding == null || !webViewReady) return
        retainedWebView?.findNext(false)
    }

    override fun clearFind() {
        if (_binding == null) return
        retainedWebView?.clearMatches()
    }

    fun sendMessage(message: String, callback: (Boolean) -> Unit) {
        if (!webViewReady) { callback(false); return }
        if (sendInProgress) { callback(false); return }
        sendInProgress = true

        // Fix #2: Resume WebView so JS timers (setTimeout) work on non-visible slots
        retainedWebView?.onResume()

        val service = ServiceConfig.getById(currentServiceId)
        val selectors = service?.selectors ?: ServiceSelectors()
        val script = buildSharedSendScript(message, selectors)
        val detailedLogs = SettingsManager.isDetailedLoggingEnabled(requireContext())
        val finish: (Boolean) -> Unit = { success ->
            sendInProgress = false
            callback(success)
        }

        retainedWebView?.evaluateJavascript(script) { result ->
            try {
                val cleaned = result?.trim()?.removeSurrounding("\"")?.replace("\\\"", "\"")?.replace("\\\\", "\\")
                if (cleaned != null) {
                    val response = gson.fromJson(cleaned, Map::class.java)
                    val success = response["success"] as? Boolean ?: false

                    if (!success) {
                        // Grok: skip retry to avoid duplicate messages
                        if (currentServiceId == "grok") { finish(false); return@evaluateJavascript }
                        // Retry once after 1s for other services
                        retainedWebView?.postDelayed({
                            retainedWebView?.evaluateJavascript(script) { retryResult ->
                                val retryCleaned = retryResult?.trim()?.removeSurrounding("\"")?.replace("\\\"", "\"")?.replace("\\\\", "\\")
                                val retryResponse = try { gson.fromJson(retryCleaned, Map::class.java) } catch (_: Exception) { null }
                                finish(retryResponse?.get("success") as? Boolean ?: false)
                            }
                        }, 1000)
                        return@evaluateJavascript
                    }

                    // Wait to verify field cleared (send worked)
                    val verifyDelay = if (currentServiceId == "perplexity" || currentServiceId == "deepseek") 1000L else 600L

                    retainedWebView?.postDelayed({
                        val checkScript = "(function(){ const el = document.querySelectorAll('textarea, [contenteditable=\"true\"], [role=\"textbox\"]'); let best = null; let bestBottom = -1; for(const e of el){ if(e.getBoundingClientRect().width > 0){ const b = e.getBoundingClientRect().bottom; if(b > bestBottom){ bestBottom = b; best = e; } } } if(!best) return ''; return (best.tagName === 'TEXTAREA' || best.tagName === 'INPUT') ? (best.value || '') : (best.textContent || ''); })()"
                        retainedWebView?.evaluateJavascript(checkScript) { valResult ->
                            val currentText = valResult?.trim()?.removeSurrounding("\"") ?: ""
                            val sent = currentText.length < message.length * 0.2
                            if (detailedLogs) { Log.d(TAG, "[slot-$slotIndex][$currentServiceId] Verify sent=$sent remainingChars=${currentText.length}") }

                            if (!sent && (currentServiceId == "perplexity" || currentServiceId == "deepseek")) {
                                // Final fallback attempt
                                retainedWebView?.evaluateJavascript(script) { finish(true) }
                            } else {
                                finish(true)
                            }
                        }
                    }, verifyDelay)
                } else { finish(false) }
            } catch (e: Exception) { finish(false) }
        }
    }

    @Suppress("UNCHECKED_CAST")
    fun getLatestAssistantReply(lastSentPrompt: String = "", callback: (AndroidLatestAssistantReply?) -> Unit) {
        if (!webViewReady) {
            Log.d(
                TAG,
                "[slot-$slotIndex] getLatestAssistantReply early-null service=$currentServiceId reason=webViewReady:false url=${retainedWebView?.url.orEmpty()}"
            )
            if (retainedWebView == null) {
                callback(null)
                return
            }
        }
        val serviceIdJson = gson.toJson(currentServiceId)
        val promptJson = gson.toJson(lastSentPrompt)
        val script = buildSharedLatestReplyScript(serviceIdJson, promptJson)

        val webView = retainedWebView
        if (webView == null) {
            Log.d(TAG, "[slot-$slotIndex] getLatestAssistantReply early-null service=$currentServiceId reason=webView:null")
            callback(null)
            return
        }

        webView.evaluateJavascript(script) { result ->
            try {
                val cleaned = result?.trim()
                    ?.removeSurrounding("\"")
                    ?.replace("\\\"", "\"")
                    ?.replace("\\\\", "\\")
                    .orEmpty()
                val response = gson.fromJson(cleaned, Map::class.java) ?: emptyMap<String, Any?>()
                if (response["success"] as? Boolean == true) {
                    val text = response["text"]?.toString().orEmpty()
                    val promptCandidateMap = response["prompt_candidate"] as? Map<String, Any?>
                    val promptCandidate = promptCandidateMap?.let { prompt ->
                        AndroidPromptCandidate(
                            text = prompt["text"]?.toString().orEmpty(),
                            top = (prompt["top"] as? Number)?.toDouble(),
                            bottom = (prompt["bottom"] as? Number)?.toDouble(),
                            htmlLength = (prompt["html_length"] as? Number)?.toInt()
                        )
                    }?.takeIf { it.text.isNotBlank() }
                    callback(
                        AndroidLatestAssistantReply(
                            text = text,
                            documentTitle = response["document_title"]?.toString().orEmpty(),
                            promptCandidate = promptCandidate
                        )
                    )
                } else {
                    val reason = response["error"]?.toString().orEmpty()
                    Log.d(TAG, "[slot-$slotIndex] getLatestAssistantReply no-text service=$currentServiceId reason=$reason")
                    callback(null)
                }
            } catch (e: Exception) {
                Log.w(TAG, "[slot-$slotIndex] getLatestAssistantReply parse-failed service=$currentServiceId", e)
                callback(null)
            }
        }
    }

    private fun buildSharedLatestReplyScript(serviceIdJson: String, promptJson: String): String {
        val shared = loadSharedScrapeReplyScript()
        return """
$shared
(function() {
  try {
    const payload = {
      serviceId: $serviceIdJson,
      sourcePrompt: $promptJson,
    };
    return globalThis.VeritySharedScrapeReply.run(payload);
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message || String(e), document_title: document.title || '' });
  }
})();
""".trimIndent()
    }

    private fun loadSharedScrapeReplyScript(): String {
        return requireContext().assets.open("scrapeReply.js").bufferedReader().use { it.readText() }
    }

    // Inject + submit via the shared cross-client script (same source iOS uses), so
    // Android no longer maintains a divergent Kotlin copy of the send/fill logic.
    private fun buildSharedSendScript(message: String, selectors: ServiceSelectors): String {
        val shared = requireContext().assets.open("sendMessage.js").bufferedReader().use { it.readText() }
        val payloadJson = gson.toJson(
            mapOf(
                "message" to message,
                "serviceId" to currentServiceId,
                "selectors" to mapOf(
                    "textarea" to selectors.textarea,
                    "contenteditable" to selectors.contenteditable,
                    "button" to selectors.button
                )
            )
        )
        return """
$shared
(function() {
  try {
    return globalThis.VeritySharedSendMessage.run($payloadJson);
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message || String(e) });
  }
})();
""".trimIndent()
    }

    private fun buildSharedAttachScript(): String {
        val shared = requireContext().assets.open("attachFile.js").bufferedReader().use { it.readText() }
        return """
$shared
(function() {
  try {
    return globalThis.VeritySharedAttachFile.run({});
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message || String(e) });
  }
})();
""".trimIndent()
    }

    fun isStillGenerating(callback: (Boolean) -> Unit) {
        if (!webViewReady) { callback(false); return }
        val serviceIdJson = gson.toJson(currentServiceId)
        val script = """
(function() {
  try {
    const sid = $serviceIdJson;
    const checks = [
      '[aria-label="Stop generating"]',
      '[aria-label="Stop streaming"]',
      '[data-testid="stop-button"]',
      'button[aria-label*="Stop" i]'
    ];
    if (sid === 'claude') checks.push('[aria-label="Stop Response"]');
    if (sid === 'gemini') checks.push('.stop-button');
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
})();
""".trimIndent()

        retainedWebView?.evaluateJavascript(script) { result ->
            try {
                val cleaned = result?.trim()?.removeSurrounding("\"")?.replace("\\\"", "\"")?.replace("\\\\", "\\")
                val response = cleaned?.let { gson.fromJson(it, Map::class.java) }
                callback(response?.get("generating") as? Boolean == true)
            } catch (_: Exception) {
                callback(false)
            }
        }
    }

    fun attachFile(uri: Uri, callback: (Boolean) -> Unit) {
        if (!webViewReady) { callback(false); return }
        retainedWebView?.let { current ->
            pendingAttachTimeoutRunnable?.let { current.removeCallbacks(it) }
        }
        pendingAttachTimeoutRunnable = null
        pendingAttachCallback?.invoke(false)
        pendingAutoAttachUri = uri
        pendingAttachCallback = callback
        triggerAttachScript(uri, allowRetry = true)
    }

    private fun triggerAttachScript(uri: Uri, allowRetry: Boolean) {
        val script = buildSharedAttachScript()
        retainedWebView?.evaluateJavascript(script) { result ->
            try {
                val cleaned = result?.trim()?.removeSurrounding("\"")?.replace("\\\"", "\"")?.replace("\\\\", "\\")
                val response = cleaned?.let { gson.fromJson(it, Map::class.java) }
                if (response?.get("success") as? Boolean == false) {
                    pendingAutoAttachUri = null
                    pendingAttachCallback?.invoke(false)
                    pendingAttachCallback = null
                    return@evaluateJavascript
                }
                val timeoutRunnable = Runnable {
                    if (pendingAttachCallback != null) {
                        if (allowRetry) {
                            pendingAttachTimeoutRunnable = null
                            triggerAttachScript(uri, allowRetry = false)
                        } else {
                            pendingAutoAttachUri = null
                            pendingAttachCallback?.invoke(false)
                            pendingAttachCallback = null
                            pendingAttachTimeoutRunnable = null
                        }
                    }
                }
                pendingAttachTimeoutRunnable = timeoutRunnable
                retainedWebView?.postDelayed(timeoutRunnable, 6000)
            } catch (e: Exception) {
                pendingAutoAttachUri = null
                retainedWebView?.let { current ->
                    pendingAttachTimeoutRunnable?.let { current.removeCallbacks(it) }
                }
                pendingAttachTimeoutRunnable = null
                pendingAttachCallback?.invoke(false)
                pendingAttachCallback = null
            }
        }
    }

    override fun onResume() {
        super.onResume()
        retainedWebView?.onResume()
    }

    override fun onPause() {
        // Fix #3: Flush cookies to disk so login state survives across app sessions
        CookieManager.getInstance().flush()
        retainedWebView?.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        retainedWebView?.let { webView ->
            val state = Bundle()
            webView.saveState(state)
            outState.putBundle("webview_state", state)
        }
    }

    override fun onDestroyView() {
        retainedWebView?.let { webView ->
            (webView.parent as? ViewGroup)?.removeView(webView)
        }
        _binding = null
        super.onDestroyView()
    }

    override fun onDestroy() {
        retainedWebView?.let { webView ->
            try {
                (webView.parent as? ViewGroup)?.removeView(webView)
                webView.stopLoading()
                webView.destroy()
            } catch (_: Exception) {}
        }
        retainedWebView = null
        super.onDestroy()
    }
}
