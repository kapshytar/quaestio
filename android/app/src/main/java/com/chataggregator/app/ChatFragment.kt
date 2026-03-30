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
            setBackgroundColor(context.getColor(R.color.bg_surface))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.cacheMode = if (SettingsManager.isAutoCacheCleanupEnabled(context))
                WebSettings.LOAD_DEFAULT else WebSettings.LOAD_CACHE_ELSE_NETWORK
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
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
        val script = MessageInjector.buildSendScript(message, selectors, currentServiceId)
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
        val script = buildAndroidLatestReplyScript(serviceIdJson, promptJson)

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

    private fun buildAndroidLatestReplyScript(serviceIdJson: String, promptJson: String): String = """
(function() {
  try {
    const serviceId = $serviceIdJson;
    const sourcePrompt = $promptJson;
    function visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    }
    function normalizeText(t) {
      return String(t || '')
        .replace(/\r/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
    function normalizeInlineText(t) {
      return String(t || '')
        .replace(/\r/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim();
    }
    function normalizeMathText(value) {
      return String(value || '')
        .replace(/\\text\{([^}]*)\}/g, '$1')
        .replace(/\\circ/g, '°')
        .replace(/\\pm/g, '±')
        .replace(/\s+/g, ' ')
        .trim();
    }
    function tableToMarkdown(tableEl) {
      const rows = Array.from(tableEl.querySelectorAll('tr'))
        .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((cell) => normalizeInlineText(extractInlineText(cell))))
        .filter((row) => row.some((cell) => cell.length > 0));
      if (rows.length < 2) return '';
      const colCount = rows.reduce((acc, row) => Math.max(acc, row.length), 0);
      if (colCount < 2) return '';

      const esc = (value) => String(value || '').replace(/\|/g, '\\|');
      const pad = (row) => {
        const out = row.slice(0, colCount);
        while (out.length < colCount) out.push('');
        return out;
      };

      const header = pad(rows[0]);
      const body = rows.slice(1).map(pad);
      const sep = Array(colCount).fill('---');

      const lines = [];
      lines.push('| ' + header.map(esc).join(' | ') + ' |');
      lines.push('| ' + sep.join(' | ') + ' |');
      body.forEach((row) => lines.push('| ' + row.map(esc).join(' | ') + ' |'));
      return lines.join('\n');
    }
    function extractStructuredText(rootEl) {
      if (!rootEl) return '';
      const parts = [];
      const blockTags = new Set([
        'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
        'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN', 'NAV',
        'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'UL'
      ]);

      function pushNewline() {
        const last = parts.length > 0 ? parts[parts.length - 1] : '';
        if (!String(last).endsWith('\n')) parts.push('\n');
      }

      function shouldSkipElement(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        const tag = (el.tagName || '').toUpperCase();
        if (['BUTTON', 'SVG', 'PATH', 'STYLE', 'SCRIPT', 'NOSCRIPT', 'MAT-ICON'].includes(tag)) return true;
        if (el.getAttribute('aria-hidden') === 'true') return true;
        const className = String(el.className || '');
        return /table-footer|action-button|copy-button|buttons-container|response-container-header|response-container-footer/i.test(className)
          || !!el.closest('.table-footer, [hide-from-message-actions]');
      }

      function extractInlineText(node) {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const el = node;
        if (shouldSkipElement(el)) return '';
        if (el.classList?.contains('math-inline') || el.classList?.contains('katex') || (el.tagName || '').toUpperCase() === 'MATH') {
          const math = el.getAttribute('data-math')
            || el.querySelector?.('annotation[encoding="application/x-tex"]')?.textContent
            || el.querySelector?.('annotation')?.textContent;
          if (math) return normalizeMathText(math);
        }
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'BR') return '\n';
        if (tag === 'STRONG' || tag === 'B') return '**' + Array.from(el.childNodes || []).map(extractInlineText).join('') + '**';
        if (tag === 'EM' || tag === 'I') return '*' + Array.from(el.childNodes || []).map(extractInlineText).join('') + '*';
        if (tag === 'CODE' && !el.closest('pre')) return '`' + Array.from(el.childNodes || []).map(extractInlineText).join('') + '`';
        if (tag === 'P') return Array.from(el.childNodes || []).map(extractInlineText).join('');
        return Array.from(el.childNodes || []).map(extractInlineText).join('');
      }

      function walk(node) {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
          parts.push(node.textContent || '');
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node;
        if (shouldSkipElement(el)) return;
        if (el !== rootEl && !visible(el)) return;

        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'BR') {
          parts.push('\n');
          return;
        }
        if (tag === 'TABLE') {
          const md = tableToMarkdown(el);
          if (md) {
            pushNewline();
            parts.push(md);
            parts.push('\n');
            return;
          }
        }
        if (tag === 'STRONG' || tag === 'B') { parts.push('**'); Array.from(el.childNodes || []).forEach(walk); parts.push('**'); return; }
        if (tag === 'EM' || tag === 'I') { parts.push('*'); Array.from(el.childNodes || []).forEach(walk); parts.push('*'); return; }
        if (tag === 'CODE' && !el.closest('pre')) { parts.push('`'); Array.from(el.childNodes || []).forEach(walk); parts.push('`'); return; }
        if (tag === 'PRE') {
          pushNewline();
          const codeEl = el.querySelector('code');
          const lang = (codeEl?.className || '').match(/language-(\w+)/)?.[1] || '';
          parts.push('```' + lang + '\n');
          Array.from((codeEl || el).childNodes || []).forEach(walk);
          if (!String(parts[parts.length - 1]).endsWith('\n')) parts.push('\n');
          parts.push('```');
          pushNewline();
          return;
        }
        const headingMatch = tag.match(/^H([1-6])$/);
        if (headingMatch) {
          pushNewline();
          parts.push('#'.repeat(parseInt(headingMatch[1], 10)) + ' ');
          Array.from(el.childNodes || []).forEach(walk);
          pushNewline();
          return;
        }
        if (tag === 'LI') {
          pushNewline();
          let depth = 0;
          let parent = el.parentElement;
          while (parent) {
            const parentTag = (parent.tagName || '').toUpperCase();
            if (parentTag === 'UL' || parentTag === 'OL') depth += 1;
            if (parent === rootEl) break;
            parent = parent.parentElement;
          }
          const indent = '  '.repeat(Math.max(0, depth - 1));
          const parentTag = (el.parentElement?.tagName || '').toUpperCase();
          parts.push(indent);
          if (parentTag === 'OL') {
            const idx = Array.from(el.parentElement.children).indexOf(el) + 1;
            parts.push(idx + '. ');
          } else {
            parts.push('- ');
          }
          const nestedLists = [];
          const inlineSegments = [];
          Array.from(el.childNodes || []).forEach((child) => {
            if (child?.nodeType === Node.ELEMENT_NODE) {
              const childTag = (child.tagName || '').toUpperCase();
              if (childTag === 'UL' || childTag === 'OL') {
                nestedLists.push(child);
                return;
              }
            }
            const segment = extractInlineText(child);
            if (segment) inlineSegments.push(segment);
          });
          parts.push(inlineSegments.join('').trim());
          pushNewline();
          nestedLists.forEach((child) => walk(child));
          return;
        }

        const isBlock = blockTags.has(tag);
        if (isBlock) pushNewline();
        Array.from(el.childNodes || []).forEach(walk);
        if (isBlock) pushNewline();
      }

      walk(rootEl);
      const structured = normalizeText(parts.join(''));
      if (structured) return structured;
      return normalizeText(rootEl.innerText || rootEl.textContent);
    }
    function flatText(t) {
      return normalizeInlineText(t).replace(/\s+/g, ' ').trim();
    }
    function promptText(t) {
      return flatText(t).toLowerCase();
    }
    function isComposerElement(el) {
      if (!el) return false;
      return !!el.closest('textarea, [contenteditable="true"], [role="textbox"], [data-testid*="composer"]');
    }
    function isMetadataLikeText(text) {
      const t = (text || '').toLowerCase();
      if (!t) return true;
      return (
        t === 'share' ||
        t === 'edit' ||
        t === 'retry' ||
        t === 'copy' ||
        t === 'regenerate' ||
        t.startsWith('model:') ||
        t.includes('window.__')
      );
    }
    function countMatches(text, regex) {
      const match = String(text || '').match(regex);
      return match ? match.length : 0;
    }
    function computeStructureMetrics(raw) {
      const text = String(raw || '');
      const lines = text.split('\n');
      return {
        headingCount: countMatches(text, /^#{1,6}\s+/gm),
        unorderedCount: countMatches(text, /^\s*[-*+]\s+\S/gm),
        orderedCount: countMatches(text, /^\s*\d+[.)]\s+\S/gm),
        tableLineCount: countMatches(text, /^\|.*\|$/gm),
        codeFenceCount: countMatches(text, /^```/gm),
        blankLineCount: countMatches(text, /^\s*$/gm),
        lineCount: lines.filter((line) => line.trim().length > 0).length
      };
    }
    function structureScore(metrics) {
      return (
        metrics.headingCount * 30 +
        metrics.unorderedCount * 12 +
        metrics.orderedCount * 12 +
        metrics.tableLineCount * 8 +
        metrics.codeFenceCount * 16 +
        metrics.blankLineCount * 2 +
        metrics.lineCount
      );
    }
    function isFragmentOnly(metrics, flatLength) {
      const hasSingleTable = metrics.tableLineCount >= 2 && metrics.lineCount <= metrics.tableLineCount + 1;
      const hasSingleList = (metrics.unorderedCount + metrics.orderedCount) > 0 && metrics.lineCount <= (metrics.unorderedCount + metrics.orderedCount) + 1;
      const hasSingleCode = metrics.codeFenceCount >= 2 && metrics.lineCount <= 4;
      return flatLength < 1200 && (hasSingleTable || hasSingleList || hasSingleCode);
    }
    function findPromptAnchor() {
      const target = promptText(sourcePrompt);
      if (!target) return null;
      const selectors = [
        '[data-message-author-role="user"]',
        '[data-testid*="user"]',
        '[class*="user"]',
        'article',
        'div'
      ];
      const seen = new Set();
      let best = null;
      function scorePrompt(raw) {
        const text = promptText(raw);
        if (!text) return 0;
        if (text === target) return 1000 + text.length;
        if (text.includes(target)) return 800 + target.length;
        if (target.includes(text) && text.length >= Math.min(80, target.length)) return 600 + text.length;
        return 0;
      }
      selectors.forEach((sel) => {
        try {
          document.querySelectorAll(sel).forEach((el) => {
            if (seen.has(el)) return;
            seen.add(el);
            if (!visible(el)) return;
            if (isComposerElement(el)) return;
            const raw = extractStructuredText(el);
            const score = scorePrompt(raw);
            if (!score) return;
            const rect = el.getBoundingClientRect();
            const candidate = { el, score, top: rect.top, bottom: rect.bottom };
            if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.bottom > best.bottom)) {
              best = candidate;
            }
          });
        } catch (_) {}
      });
      return best;
    }
    function findChatGptReplyAfterPrompt() {
      const promptAnchor = findPromptAnchor();
      if (!promptAnchor) return null;
      const target = promptText(sourcePrompt);
      const selectors = [
        '[data-message-author-role="assistant"]',
        '[data-testid*="assistant"]',
        '[class*="assistant"]'
      ];
      const seen = new Set();
      const candidates = [];
      selectors.forEach((sel) => {
        try {
          document.querySelectorAll(sel).forEach((el) => {
            if (seen.has(el)) return;
            seen.add(el);
            if (!visible(el)) return;
            if (isComposerElement(el)) return;
            const relation = promptAnchor.el.compareDocumentPosition(el);
            if (!(relation & Node.DOCUMENT_POSITION_FOLLOWING)) return;
            const raw = extractStructuredText(el);
            const flat = flatText(raw);
            const lower = promptText(raw);
            if (flat.length < 20) return;
            if (!lower || lower === target || lower.includes(target)) return;
            const rect = el.getBoundingClientRect();
            const metrics = computeStructureMetrics(raw);
            candidates.push({ raw, flat, top: rect.top, bottom: rect.bottom, structure: structureScore(metrics) });
          });
        } catch (_) {}
      });
      if (candidates.length === 0) return null;
      candidates.sort((a, b) => {
        if (a.top !== b.top) return a.top - b.top;
        if (b.structure !== a.structure) return b.structure - a.structure;
        return b.flat.length - a.flat.length;
      });
      return candidates[0];
    }
    function findPromptCandidateForReply(selectedEl) {
      if (!selectedEl) return null;
      const selectors = [
        '[data-message-author-role="user"]',
        '[data-testid*="user"]',
        '[class*="user"]',
        'article',
        'div'
      ];
      const seen = new Set();
      const candidates = [];
      selectors.forEach((sel) => {
        try {
          document.querySelectorAll(sel).forEach((el) => {
            if (seen.has(el)) return;
            seen.add(el);
            if (!visible(el)) return;
            if (isComposerElement(el)) return;
            if (el === selectedEl) return;
            const relation = el.compareDocumentPosition(selectedEl);
            if (!(relation & Node.DOCUMENT_POSITION_FOLLOWING)) return;
            const raw = extractStructuredText(el);
            const flat = flatText(raw);
            if (flat.length < 6 || isMetadataLikeText(flat)) return;
            const rect = el.getBoundingClientRect();
            candidates.push({ el, raw, flat, top: rect.top, bottom: rect.bottom });
          });
        } catch (_) {}
      });
      if (candidates.length === 0) return null;
      const latestBottom = candidates.reduce((best, candidate) => Math.max(best, candidate.bottom), Number.NEGATIVE_INFINITY);
      const recent = candidates.filter((candidate) => candidate.bottom >= latestBottom - 320);
      const pool = recent.length > 0 ? recent : candidates;
      pool.sort((a, b) => {
        if (b.bottom !== a.bottom) return b.bottom - a.bottom;
        if (b.top !== a.top) return b.top - a.top;
        return b.flat.length - a.flat.length;
      });
      return pool[0];
    }
    function summarizePromptCandidate(candidate) {
      if (!candidate || !candidate.raw) return null;
      return {
        text: candidate.raw,
        top: Math.round(candidate.top || 0),
        bottom: Math.round(candidate.bottom || 0),
        html_length: (candidate.el?.outerHTML || '').length
      };
    }
    function buildSuccess(candidate) {
      const promptCandidate = findPromptCandidateForReply(candidate?.el);
      return JSON.stringify({
        success: true,
        text: candidate?.raw || '',
        document_title: document.title || '',
        prompt_candidate: summarizePromptCandidate(promptCandidate)
      });
    }
    const selectors = [
      '[data-testid*="conversation-turn"]',
      '[data-testid*="message-content"]',
      '[data-message-author-role="assistant"]',
      '[data-testid*="assistant"]',
      '[class*="assistant"]',
      '[class*="response"]',
      '[class*="answer"]',
      '[class*="message"]'
    ];
    if (serviceId === 'perplexity') selectors.unshift('div[class*="prose"]');
    if (serviceId === 'gemini') selectors.unshift('model-response', 'response-container');
    if (serviceId === 'grok') selectors.unshift('div[id^="response-"]', '[class*="message-bubble"]');

    const candidates = [];
    selectors.forEach((sel) => {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (!visible(el)) return;
          if (isComposerElement(el)) return;
          const raw = extractStructuredText(el);
          const flat = flatText(raw);
          if (flat.length < 20 || isMetadataLikeText(flat)) return;
          const rect = el.getBoundingClientRect();
          const metrics = computeStructureMetrics(raw);
          candidates.push({ el, raw, flat, bottom: rect.bottom, top: rect.top, metrics, structure: structureScore(metrics) });
        });
      } catch (_) {}
    });

    if (candidates.length === 0) {
      Array.from(document.querySelectorAll('article, div')).filter(visible).forEach((el) => {
        if (isComposerElement(el)) return;
        const raw = extractStructuredText(el);
        const flat = flatText(raw);
        if (flat.length < 20 || isMetadataLikeText(flat)) return;
        const rect = el.getBoundingClientRect();
        const metrics = computeStructureMetrics(raw);
        candidates.push({ el, raw, flat, bottom: rect.bottom, top: rect.top, metrics, structure: structureScore(metrics) });
      });
    }

      if (candidates.length === 0) return JSON.stringify({ success: false, error: 'No reply found', document_title: document.title || '' });

    if (serviceId === 'chatgpt') {
      const exactReply = findChatGptReplyAfterPrompt();
      if (exactReply) {
        return buildSuccess(exactReply);
      }
      const promptAnchor = findPromptAnchor();
      if (promptAnchor) {
        const following = candidates.filter((candidate) => {
          const relation = promptAnchor.el.compareDocumentPosition(candidate.el);
          return !!(relation & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        if (following.length > 0) {
          const firstTop = following.reduce((acc, c) => Math.min(acc, c.top), Infinity);
          const scoped = following.filter((candidate) => candidate.top <= firstTop + 320);
          const promptPool = scoped.length > 0 ? scoped : following;
          promptPool.sort((a, b) => {
            if (a.top !== b.top) return a.top - b.top;
            if (a.bottom !== b.bottom) return a.bottom - b.bottom;
            return b.flat.length - a.flat.length;
          });
          return buildSuccess(promptPool[0]);
        }
      }
    }

    const pruned = candidates.filter((candidate) => {
      return !candidates.some((other) => {
        if (other === candidate) return false;
        if (!other.el.contains(candidate.el)) return false;
        if (other.flat.length < 120) return false;
        if (candidate.flat.length >= other.flat.length * 0.8) return false;
        return Math.abs(other.bottom - candidate.bottom) <= 180;
      });
    });
    const source = pruned.length > 0 ? pruned : candidates;
    const maxBottom = source.reduce((acc, c) => Math.max(acc, c.bottom), -Infinity);
    const nearBottom = source.filter((c) => c.bottom >= maxBottom - 260);
    const pool = nearBottom.length > 0 ? nearBottom : source;

    const isGeminiOrGrok = serviceId === 'gemini' || serviceId === 'grok';
    if (isGeminiOrGrok) {
      const wrapped = pool.map((candidate) => {
        const childPeers = pool.filter((other) => {
          if (other === candidate) return false;
          if (!candidate.el.contains(other.el)) return false;
          if (other.flat.length < 40) return false;
          return Math.abs(other.bottom - candidate.bottom) <= 260;
        });
        const containsPeer = childPeers.length > 0;
        const fragmentOnly = isFragmentOnly(candidate.metrics, candidate.flat.length);
        const hasRicherChild = childPeers.some((other) => other.structure >= candidate.structure + 20);
        const richerParent = pool.find((other) => {
          if (other === candidate) return false;
          if (!other.el.contains(candidate.el)) return false;
          if (other.flat.length < candidate.flat.length * 1.35) return false;
          return other.structure >= candidate.structure;
        });
        return { candidate, containsPeer, fragmentOnly, hasRicherChild, richerParent };
      });
      wrapped.sort((a, b) => {
        if (a.fragmentOnly !== b.fragmentOnly) return a.fragmentOnly ? 1 : -1;
        if (!!a.richerParent !== !!b.richerParent) return a.richerParent ? 1 : -1;
        if (a.hasRicherChild !== b.hasRicherChild) return a.hasRicherChild ? 1 : -1;
        if (b.candidate.structure !== a.candidate.structure) return b.candidate.structure - a.candidate.structure;
        if (b.candidate.flat.length !== a.candidate.flat.length) return b.candidate.flat.length - a.candidate.flat.length;
        if (b.candidate.bottom !== a.candidate.bottom) return b.candidate.bottom - a.candidate.bottom;
        if (b.candidate.top !== a.candidate.top) return b.candidate.top - a.candidate.top;
        if (a.containsPeer !== b.containsPeer) return a.containsPeer ? 1 : -1;
        return 0;
      });
      return buildSuccess(wrapped[0].candidate);
    }

    pool.sort((a, b) => {
      if (b.flat.length !== a.flat.length) return b.flat.length - a.flat.length;
      return b.bottom - a.bottom;
    });
    return buildSuccess(pool[0]);
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message || String(e), document_title: document.title || '' });
  }
})();
""".trimIndent()

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
        val script = MessageInjector.buildAttachFileScript()
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

