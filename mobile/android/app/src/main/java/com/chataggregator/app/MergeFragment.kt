package com.chataggregator.app

import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.SpannableStringBuilder
import android.text.style.BackgroundColorSpan
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import com.chataggregator.app.databinding.FragmentMergeBinding
import io.noties.markwon.Markwon
import io.noties.markwon.ext.tables.TablePlugin
import kotlin.concurrent.thread
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MergeFragment : Fragment(), Findable {
    companion object {
        private const val TAG = "MergeFragment"
        private const val MERGE_PREFS = "merge_config"
    }

    private var _binding: FragmentMergeBinding? = null
    private val binding get() = _binding!!
    private lateinit var markwon: Markwon
    private val mergeCatalog by lazy(LazyThreadSafetyMode.NONE) { MergeConfigCatalogLoader.load(requireContext()) }
    private val fallbackAggregationPolicy = MergeAggregationPolicy(
        maxChecks = 12,
        waitIntervalMs = 2500L,
        settleDelayMs = 1500L,
        allowPartialResults = true,
        minimumRepliesRequired = 1
    )

    private val providers = MergeProvider.entries.toList()
    private var ignoreSpinnerEvents = false
    private var isConfigExpanded = true
    private var mergeInProgress = false
    private var aggregationPaused = false
    private var pendingAggregation = false
    private var aggregationWaitAttempt = 0
    private val aggregationHandler = Handler(Looper.getMainLooper())
    private var currentFindQuery = ""
    private var findMatchRanges: List<IntRange> = emptyList()
    private var activeFindIndex = -1
    private val mergeDebugLines = ArrayDeque<String>()
    private var lastLoggedStatusText = ""

    // Accumulates full chat history for context
    private var mergeHistory: String = ""

    // Saved original scraped responses — passed to clarification for context
    private var lastOriginalResponses: Map<String, String> = emptyMap()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentMergeBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        MergeApiClient.configureSharedStreaming(requireContext())
        markwon = Markwon.builder(requireContext())
            .usePlugin(TablePlugin.create(requireContext()))
            .build()
        setupProviderSpinner()
        restoreSelectedProvider()
        applyProviderUi(selectedProvider())
        loadFieldsForProvider(selectedProvider())
        isConfigExpanded = loadConfigExpandedState()
        applyConfigVisibility()
        applyMergeEnabledState()
        maybeShowMergeSetupHint(force = true)

        // Setup API Key Source selection (preinstalled vs custom)
        setupApiKeySourceSelection()

        binding.btnSendClarification.setOnClickListener {
            runClarificationMerge()
        }

        binding.btnHideConfig.setOnClickListener {
            hideConfigEditor()
        }
        binding.btnRefreshAggregation.setOnClickListener {
            refreshAggregationStatuses()
        }
        binding.btnPauseAggregation.setOnClickListener {
            toggleAggregationPause()
        }
        binding.btnCollectNow.setOnClickListener {
            collectNowAggregationManually()
        }
        binding.btnClearDebugLog.setOnClickListener {
            clearVisibleDebugLog()
        }
        updateDebugLogVisibility()
        updateAggregationControls()
    }

    override fun onResume() {
        super.onResume()
        applyMergeEnabledState()
        maybeShowMergeSetupHint()
        updateDebugLogVisibility()
        updateAggregationControls()
        val activity = activity as? MainActivity
        if (activity?.hasPendingAutoAggregation() == true) {
            refreshAggregationStatuses(silent = true)
        }
    }

    private fun setupProviderSpinner() {
        val titles = providers.map { it.title }
        val adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_item, titles).apply {
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }
        binding.providerSpinner.adapter = adapter
        binding.providerSpinner.setSelection(0)
        binding.providerSpinner.setOnItemSelectedListener(object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (ignoreSpinnerEvents) return
                saveCurrentFields()
                val provider = providers[position]
                applyProviderUi(provider)
                saveSelectedProvider(provider)
                loadFieldsForProvider(provider)
                // Re-setup API key source selection for the new provider
                setupApiKeySourceSelection()
            }
            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
        })
    }

    private fun selectedProvider(): MergeProvider {
        val idx = binding.providerSpinner.selectedItemPosition.coerceAtLeast(0)
        return providers.getOrElse(idx) { MergeProvider.CHATGPT }
    }

    private fun catalogProvider(provider: MergeProvider): MergeProviderDescriptor? {
        return mergeCatalog?.providers?.firstOrNull { it.id == provider.id }
    }

    private fun aggregationPolicy(): MergeAggregationPolicy {
        return mergeCatalog?.aggregationPolicy ?: fallbackAggregationPolicy
    }

    private fun runClarificationMerge() {
        if (mergeInProgress) return
        val text = binding.clarificationInput.text.toString().trim()
        if (text.isBlank()) return

        binding.clarificationInputContainer.visibility = View.GONE
        binding.clarificationInput.setText("") 

        // 1. Add current user question to history
        if (mergeHistory.isNotEmpty()) {
            mergeHistory += "\n\nUser: $text"
        }

        runMerge(
            isClarificationRequest = true,
            previousSummary = mergeHistory,
            clarificationText = text
        )
    }

    fun runMerge(
        isClarificationRequest: Boolean = false,
        previousSummary: String = "",
        clarificationText: String = ""
    ) {
        if (mergeInProgress) return
        val activity = requireActivity() as? MainActivity ?: return
        if (!SettingsManager.isMergeEnabled(requireContext())) {
            setMergeStatusText(getString(R.string.merge_disabled_message))
            return
        }
        if (!isClarificationRequest && !hasAnyConfiguredApiKey()) {
            setMergeStatusText(getString(R.string.merge_setup_needed))
            return
        }
        val provider = selectedProvider()

        // Get API key - either from input field or use preinstalled key
        val apiKey = if (provider == MergeProvider.DEEPSEEK && isPreinstalledKeySelected()) {
            val key = KeyObfuscation.getDeepSeekPreinstalledKey()
            Log.d(TAG, "[Merge] Using preinstalled DeepSeek key, length=${key.length}, starts_with_sk=${key.startsWith("sk-")}")
            key
        } else {
            val key = binding.apiKeyInput.text.toString().trim()
            Log.d(TAG, "[Merge] Using custom/input key, length=${key.length}, provider=${provider.id}")
            key
        }

        val endpoint = binding.customEndpointInput.text.toString().trim()
        val model = binding.customModelInput.text.toString().trim()
        Log.d(TAG, "[Merge] Setup: provider=${provider.id}, apiKey_len=${apiKey.length}, endpoint=${endpoint.take(50)}, model=$model")
        appendVisibleDebug("Run merge requested: provider=${provider.id} clarification=$isClarificationRequest")
        val setupError = validateMergeSetup(provider, apiKey, endpoint, model)
        if (setupError != null) {
            revealConfigEditor()
            appendVisibleDebug("Merge setup invalid: ${getString(setupError)}")
            setMergeStatusText(getString(R.string.merge_setup_needed))
            Toast.makeText(requireContext(), setupError, Toast.LENGTH_SHORT).show()
            return
        }

        saveFields(provider, apiKey, endpoint, model, binding.fallbackModelsInput.text.toString())
        
        isConfigExpanded = false
        saveConfigExpandedState(false)
        applyConfigVisibility()

        setMergeStatusText(getString(R.string.merge_collecting))
        mergeInProgress = true
        
        // ONLY shimmer slot chips if we are actually collecting from WebViews
        if (!isClarificationRequest) {
            activity.startMergeShimmer()
            mergeHistory = "" // Reset history for new main merge
            lastOriginalResponses = emptyMap()
            beginAggregationWait()
            return
        }

        if (isClarificationRequest) {
            handleMergeResponses(emptyMap(), true, previousSummary, clarificationText, false)
        }
    }

    private fun handleMergeResponses(
        responses: Map<String, String>,
        isClarificationRequest: Boolean,
        previousSummary: String,
        clarificationText: String,
        detailed: Boolean
    ) {
        val activity = requireActivity() as? MainActivity ?: return
        if (!isClarificationRequest && responses.isEmpty()) {
            appendVisibleDebug("Merge aborted: no source data")
            mergeInProgress = false
            activity.stopMergeShimmer()
            setMergeStatusText(getString(R.string.merge_no_source_data))
            return
        }

        appendVisibleDebug("Merge API call started with ${responses.size} source response(s)")
        setMergeStatusText(getString(R.string.merge_running))
        // Resolve API key the same way runMerge() does — preinstalled or from input field
        val resolvedApiKey = if (selectedProvider() == MergeProvider.DEEPSEEK && isPreinstalledKeySelected()) {
            KeyObfuscation.getDeepSeekPreinstalledKey()
        } else {
            binding.apiKeyInput.text.toString().trim()
        }
        Log.d(TAG, "[Merge] handleMergeResponses resolvedApiKey len=${resolvedApiKey.length}, starts_sk=${resolvedApiKey.startsWith("sk-")}")
        val config = MergeRequestConfig(
            provider = selectedProvider(),
            apiKey = resolvedApiKey,
            customEndpoint = binding.customEndpointInput.text.toString().trim(),
            customModel = binding.customModelInput.text.toString().trim(),
            fallbackModelsRaw = binding.fallbackModelsInput.text.toString(),
            sourcePrompt = SettingsManager.getLastUserPrompt(requireContext()),
            mergeInstructions = SettingsManager.getMergeInstructions(requireContext()),
            clarificationInstructions = SettingsManager.getClarificationInstructions(requireContext()),
            detailedLogging = SettingsManager.isDetailedLoggingEnabled(requireContext()),
            clarificationText = clarificationText,
            previousSummary = previousSummary,
            isClarificationMerge = isClarificationRequest,
            originalResponses = lastOriginalResponses
        )

        thread {
            val result = MergeApiClient.merge(config, responses) { partial ->
                activity.runOnUiThread {
                    if (!isAdded || _binding == null) return@runOnUiThread
                    // Render raw partial text while streaming for responsive UI updates.
                    binding.mergeResult.text = partial
                    reapplyFindIfActive()
                }
            }
            activity.runOnUiThread {
                mergeInProgress = false
                activity.stopMergeShimmer()
                
                result.fold(
                    onSuccess = { fullResponse ->
                        appendVisibleDebug("Merge API success (${fullResponse.length} chars)")
                        val cleanResponse = normalizeMergeMarkdownForIngest(fullResponse)

                        val promptTitle = SettingsManager.getLastUserPrompt(requireContext())
                        if (isClarificationRequest) {
                            val clarificationIngestMarkdown = buildClarificationIngestMarkdown(
                                userMessage = clarificationText,
                                assistantResponse = cleanResponse
                            )
                            activity.sendClarificationNoteToDreamTracker(
                                promptText = clarificationText,
                                markdown = clarificationIngestMarkdown
                            )
                        } else {
                            activity.sendMergeNoteToDreamTracker(
                                promptText = promptTitle,
                                markdown = cleanResponse,
                                sourceResponses = lastOriginalResponses
                            )
                        }
                        
                        if (mergeHistory.isEmpty()) {
                            mergeHistory = "Assistant: $cleanResponse"
                        } else {
                            mergeHistory += "\n\nAssistant: $cleanResponse"
                        }
                        
                        markwon.setMarkdown(binding.mergeResult, fullResponse)
                        reapplyFindIfActive()
                        binding.clarificationInputContainer.visibility = View.VISIBLE
                    },
                    onFailure = { error ->
                        appendVisibleDebug("Merge API failure: ${error.message.orEmpty()}")
                        setMergeStatusText(getString(R.string.merge_failed_fmt, error.message))
                        binding.clarificationInputContainer.visibility = View.GONE
                    }
                )
            }
        }
    }

    fun runMergeFromBottom() = runMerge()

    private fun prefsKey(p: MergeProvider, s: String): String = "merge_${p.id}_$s"

    private fun saveSelectedProvider(p: MergeProvider) {
        requireContext().getSharedPreferences(MERGE_PREFS, 0).edit().putString("selected_provider", p.id).apply()
    }

    private fun saveFields(p: MergeProvider, k: String, e: String, m: String, f: String) {
        requireContext().getSharedPreferences(MERGE_PREFS, 0).edit()
            .putString(prefsKey(p, "api_key"), k)
            .putString(prefsKey(p, "custom_endpoint"), e)
            .putString(prefsKey(p, "custom_model"), m)
            .putString(prefsKey(p, "fallback_models"), f)
            .apply()
    }

    private fun restoreSelectedProvider() {
        val prefs = requireContext().getSharedPreferences(MERGE_PREFS, 0)
        val id = prefs.getString("selected_provider", null)
        if (id == null) {
            val defaultProviderId = mergeCatalog?.defaultProviderId ?: MergeProvider.DEEPSEEK.id
            val defaultIdx = providers.indexOfFirst { it.id == defaultProviderId }
            if (defaultIdx >= 0) {
                ignoreSpinnerEvents = true
                binding.providerSpinner.setSelection(defaultIdx)
                ignoreSpinnerEvents = false
                saveSelectedProvider(providers[defaultIdx])
            }
            return
        }
        val idx = providers.indexOfFirst { it.id == id }
        if (idx >= 0) { ignoreSpinnerEvents = true; binding.providerSpinner.setSelection(idx); ignoreSpinnerEvents = false }
    }

    private fun saveCurrentFields() {
        val id = requireContext().getSharedPreferences(MERGE_PREFS, 0).getString("selected_provider", null) ?: return
        val p = providers.firstOrNull { it.id == id } ?: return

        // Get API key - either from input field or use preinstalled key
        val apiKey = if (p == MergeProvider.DEEPSEEK && isPreinstalledKeySelected()) {
            KeyObfuscation.getDeepSeekPreinstalledKey()
        } else {
            binding.apiKeyInput.text.toString()
        }

        saveFields(p, apiKey, binding.customEndpointInput.text.toString(),
                   binding.customModelInput.text.toString(), binding.fallbackModelsInput.text.toString())
    }

    private fun loadFieldsForProvider(p: MergeProvider) {
        val prefs = requireContext().getSharedPreferences(MERGE_PREFS, 0)
        val descriptor = catalogProvider(p)

        // For DeepSeek, check if using preinstalled key
        val apiKey = if ((descriptor?.supportsPreinstalledKey == true) && isPreinstalledKeySelected()) {
            KeyObfuscation.getDeepSeekPreinstalledKey()
        } else {
            prefs.getString(prefsKey(p, "api_key"), "") ?: ""
        }

        binding.apiKeyInput.setText(apiKey)
        binding.customEndpointInput.setText(
            prefs.getString(prefsKey(p, "custom_endpoint"), descriptor?.defaultEndpoint ?: p.defaultEndpoint)
                ?: (descriptor?.defaultEndpoint ?: p.defaultEndpoint)
        )
        binding.customModelInput.setText(
            prefs.getString(prefsKey(p, "custom_model"), descriptor?.defaultModel ?: p.defaultModel)
                ?: (descriptor?.defaultModel ?: p.defaultModel)
        )
        binding.fallbackModelsInput.setText(prefs.getString(prefsKey(p, "fallback_models"), "") ?: "")
    }

    private fun applyProviderUi(p: MergeProvider) {
        val descriptor = catalogProvider(p)
        val showFallback = descriptor?.supportsFallbackModels == true
        val showEndpoint = descriptor?.supportsCustomEndpoint == true
        val showModel = descriptor?.supportsCustomModel == true
        binding.fallbackModelsInput.visibility = if (showFallback) View.VISIBLE else View.GONE
        binding.customEndpointInput.visibility = if (showEndpoint) View.VISIBLE else View.GONE
        binding.customModelInput.visibility = if (showModel) View.VISIBLE else View.GONE

        // Only DeepSeek supports the preinstalled/custom key switch.
        // All other providers must keep a visible API key field.
        val supportsPreinstalledKey = descriptor?.supportsPreinstalledKey == true
        binding.apiKeySourceGroup.visibility = if (supportsPreinstalledKey) View.VISIBLE else View.GONE
        binding.apiKeyInput.visibility = when {
            !supportsPreinstalledKey -> View.VISIBLE
            isCustomKeySelected() -> View.VISIBLE
            else -> View.GONE
        }
    }

    private fun setupApiKeySourceSelection() {
        val provider = selectedProvider()
        val descriptor = catalogProvider(provider)
        binding.apiKeySourceGroup.setOnCheckedChangeListener(null)
        if (descriptor?.supportsPreinstalledKey != true) {
            binding.apiKeySourceGroup.visibility = View.GONE
            binding.apiKeyInput.visibility = View.VISIBLE
            return
        }

        // Load saved key source preference
        val isPreinstalled = isPreinstalledKeySelected()
        Log.d(TAG, "[KeySource] setupApiKeySourceSelection - isPreinstalled=$isPreinstalled, provider=${provider.id}")

        if (isPreinstalled) {
            binding.rbPreinstalledKey.isChecked = true
            binding.apiKeyInput.visibility = View.GONE
            binding.apiKeyInput.setText("")
            Log.d(TAG, "[KeySource] Using preinstalled key")
        } else {
            binding.rbCustomKey.isChecked = true
            binding.apiKeyInput.visibility = View.VISIBLE
            Log.d(TAG, "[KeySource] Using custom key input")
        }

        // Setup radio button listeners
        binding.apiKeySourceGroup.setOnCheckedChangeListener { _, checkedId ->
            when (checkedId) {
                R.id.rbPreinstalledKey -> {
                    binding.apiKeyInput.visibility = View.GONE
                    binding.apiKeyInput.setText("")
                    savePreinstalledKeySelection(true)
                    Log.d(TAG, "[KeySource] Switched to preinstalled key")
                }
                R.id.rbCustomKey -> {
                    binding.apiKeyInput.visibility = View.VISIBLE
                    savePreinstalledKeySelection(false)
                    Log.d(TAG, "[KeySource] Switched to custom key")
                }
            }
        }
    }

    private fun isPreinstalledKeySelected(): Boolean {
        // A provider without catalog support has no preinstalled key, no matter
        // what the stored preference says (it defaults to true from the era when
        // a DeepSeek key shipped in the binary) — otherwise the empty embedded
        // key would silently win over the user's own key in the input field.
        if (catalogProvider(selectedProvider())?.supportsPreinstalledKey != true) return false
        val prefs = requireContext().getSharedPreferences(MERGE_PREFS, 0)
        return prefs.getBoolean("use_preinstalled_key", true)
    }

    private fun isCustomKeySelected(): Boolean {
        return !isPreinstalledKeySelected()
    }

    private fun savePreinstalledKeySelection(usePreinstalled: Boolean) {
        requireContext().getSharedPreferences(MERGE_PREFS, 0).edit()
            .putBoolean("use_preinstalled_key", usePreinstalled)
            .apply()
    }

    private fun applyConfigVisibility() {
        binding.configContainer.visibility = if (isConfigExpanded) View.VISIBLE else View.GONE
        binding.configCollapsedHint.visibility = if (isConfigExpanded) View.GONE else View.VISIBLE
    }

    private fun loadConfigExpandedState(): Boolean {
        val prefs = requireContext().getSharedPreferences(MERGE_PREFS, 0)
        return prefs.getBoolean("config_expanded", true)
    }

    private fun hasAnyConfiguredApiKey(): Boolean {
        val prefs = requireContext().getSharedPreferences(MERGE_PREFS, 0)
        return providers.any { provider ->
            if (catalogProvider(provider)?.supportsPreinstalledKey == true) {
                val usePreinstalled = prefs.getBoolean("use_preinstalled_key", true)
                if (usePreinstalled) {
                    return@any true
                }
            }
            val key = prefs.getString(prefsKey(provider, "api_key"), "")?.trim().orEmpty()
            key.isNotBlank()
        }
    }

    private fun maybeShowMergeSetupHint(force: Boolean = false) {
        if (!SettingsManager.isMergeEnabled(requireContext())) return
        if (hasAnyConfiguredApiKey()) return
        val current = binding.mergeResult.text.toString()
        val canReplaceCurrent =
            current == getString(R.string.merge_idle_text) ||
            current == getString(R.string.merge_disabled_message)
        if (force || canReplaceCurrent) {
            setMergeStatusText(getString(R.string.merge_setup_needed))
        }
    }

    private fun saveConfigExpandedState(expanded: Boolean) {
        requireContext().getSharedPreferences(MERGE_PREFS, 0).edit().putBoolean("config_expanded", expanded).apply()
    }

    fun revealConfigEditor() { isConfigExpanded = true; saveConfigExpandedState(true); if (_binding != null) applyConfigVisibility() }
    fun hideConfigEditor() { isConfigExpanded = false; saveConfigExpandedState(false); if (_binding != null) applyConfigVisibility() }
    fun isConfigEditorVisible(): Boolean = isConfigExpanded

    private fun updateAggregationControls() {
        val activity = activity as? MainActivity
        val hasPendingAggregation = activity?.hasPendingAutoAggregation() == true
        val paused = activity?.isAutoAggregationPaused() == true
        val hasEnabledSlots = (activity?.slotManager?.let { manager ->
            (0 until SlotManager.NUM_SLOTS).any { manager.isSlotEnabled(it) }
        }) == true
        binding.btnPauseAggregation.isEnabled = hasPendingAggregation
        binding.btnCollectNow.isEnabled = hasEnabledSlots
        binding.btnPauseAggregation.text = if (paused) {
            "Resume aggregation"
        } else {
            "Pause aggregation"
        }
    }

    private fun setAggregationSummary(text: String) {
        binding.aggregationStatusSummary.text = text
    }

    private fun updateDebugLogVisibility() {
        if (_binding == null) return
        val enabled = SettingsManager.isUnstableFeaturesEnabled(requireContext())
        binding.debugLogContainer.visibility = if (enabled) View.VISIBLE else View.GONE
        if (enabled && binding.debugLogText.text.isNullOrBlank()) {
            binding.debugLogText.text = "No activity yet..."
        }
    }

    private fun clearVisibleDebugLog() {
        mergeDebugLines.clear()
        lastLoggedStatusText = ""
        if (_binding != null) {
            binding.debugLogText.text = "No activity yet..."
        }
    }

    private fun appendVisibleDebug(message: String) {
        Log.d(TAG, "[VisibleDebug] $message")
        if (_binding == null || !SettingsManager.isUnstableFeaturesEnabled(requireContext())) return
        val stamp = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
        mergeDebugLines.addLast("[$stamp] $message")
        while (mergeDebugLines.size > 80) {
            mergeDebugLines.removeFirst()
        }
        binding.debugLogText.text = mergeDebugLines.joinToString("\n")
    }

    private fun renderAggregationStatuses(items: List<AggregationSlotSnapshot>) {
        setAggregationSummary(AggregationStatusFormatter.summarize(items))
    }

    private fun refreshAggregationStatuses(silent: Boolean = false, onDone: ((List<AggregationSlotSnapshot>) -> Unit)? = null) {
        val activity = requireActivity() as? MainActivity ?: return
        activity.getAggregationSlotStatuses { items ->
            val paused = aggregationPaused || activity.isAutoAggregationPaused()
            val rendered = if (paused) {
                items.map { item ->
                    if (item.status == AggregationSlotStatus.WAITING) {
                        item.copy(status = AggregationSlotStatus.PAUSED)
                    } else {
                        item
                    }
                }
            } else {
                items
            }
            renderAggregationStatuses(rendered)
            if (!silent) {
                val readyCount = items.count { it.status == AggregationSlotStatus.READY }
                setMergeStatusText("Aggregation status: $readyCount/${items.size} ready")
            }
            onDone?.invoke(items)
        }
    }

    private fun beginAggregationWait() {
        pendingAggregation = true
        aggregationPaused = false
        aggregationWaitAttempt = 0
        appendVisibleDebug("Aggregation wait started")
        updateAggregationControls()
        waitForAggregationReadyOrPause()
    }

    private fun toggleAggregationPause() {
        val activity = requireActivity() as? MainActivity ?: return
        if (!activity.hasPendingAutoAggregation()) return
        if (activity.isAutoAggregationPaused()) {
            activity.resumeAutoAggregation()
            appendVisibleDebug("Aggregation resumed")
            setMergeStatusText("Resuming aggregation wait...")
        } else {
            activity.pauseAutoAggregation()
            appendVisibleDebug("Aggregation paused")
            refreshAggregationStatuses(silent = true)
            setMergeStatusText("Aggregation paused. Fix slots and press Resume or Collect now.")
        }
        updateAggregationControls()
    }

    private fun collectNowAggregationManually() {
        val activity = requireActivity() as? MainActivity ?: return
        appendVisibleDebug("Collect now requested")
        setMergeStatusText("Collecting latest replies and re-ingesting...")
        activity.collectNowAggregation { success, reason ->
            refreshAggregationStatuses(silent = true)
            appendVisibleDebug(
                if (success) "Collect now finished: aggregation updated"
                else "Collect now failed: ${reason ?: "no replies or ingest error"}"
            )
            setMergeStatusText(
                if (success) "Aggregation updated from current slot replies."
                else (reason ?: "Aggregation collect failed or no replies were available.")
            )
            updateAggregationControls()
        }
    }

    private fun waitForAggregationReadyOrPause() {
        if (!pendingAggregation) return
        if (aggregationPaused) {
            appendVisibleDebug("Aggregation wait blocked: paused")
            setMergeStatusText("Aggregation paused. Fix slots and press Resume or Collect now.")
            return
        }

        refreshAggregationStatuses(silent = true) { items ->
            if (!pendingAggregation) return@refreshAggregationStatuses
            val readyCount = items.count { it.status == AggregationSlotStatus.READY }
            val policy = aggregationPolicy()
            appendVisibleDebug("Aggregation check ${aggregationWaitAttempt + 1}: $readyCount/${items.size} ready")
            if (readyCount >= items.size && items.isNotEmpty()) {
                appendVisibleDebug("All slots ready, collecting after settle delay")
                setMergeStatusText("All ${items.size} slot(s) ready. Collecting now...")
                aggregationHandler.postDelayed({ collectNowForPendingMerge(manual = false) }, policy.settleDelayMs)
                return@refreshAggregationStatuses
            }

            aggregationWaitAttempt += 1
            if (aggregationWaitAttempt >= policy.maxChecks) {
                if (policy.allowPartialResults && readyCount >= policy.minimumRepliesRequired) {
                    appendVisibleDebug("Aggregation timeout reached with partial data; collecting now")
                    setMergeStatusText("Collected $readyCount/${items.size} source reply(s). Running merge...")
                    collectNowForPendingMerge(manual = false)
                    return@refreshAggregationStatuses
                }
                appendVisibleDebug("Aggregation still waiting after $aggregationWaitAttempt checks")
                setMergeStatusText("Aggregation still waiting. Use Collect now or Pause aggregation.")
                return@refreshAggregationStatuses
            }

            setMergeStatusText("Waiting for replies: $readyCount/${items.size} ready")
            aggregationHandler.postDelayed({ waitForAggregationReadyOrPause() }, policy.waitIntervalMs)
        }
    }

    private fun finishAggregationState() {
        pendingAggregation = false
        aggregationPaused = false
        aggregationWaitAttempt = 0
        aggregationHandler.removeCallbacksAndMessages(null)
        appendVisibleDebug("Aggregation state cleared")
        updateAggregationControls()
    }

    private fun collectNowForPendingMerge(manual: Boolean) {
        val activity = requireActivity() as? MainActivity ?: return
        if (activity.hasPendingAutoAggregation() && manual) {
            appendVisibleDebug("Collecting slot replies for aggregation refresh")
            setMergeStatusText("Collecting current slot replies...")
            activity.collectNowAggregation { success, reason ->
                refreshAggregationStatuses(silent = true)
                appendVisibleDebug(
                    if (success) "Aggregation collection completed"
                    else "Aggregation collection failed: ${reason ?: "unknown reason"}"
                )
                setMergeStatusText(
                    if (success) "Aggregation updated from current slot replies."
                    else (reason ?: "Aggregation collect failed or no replies were available.")
                )
                updateAggregationControls()
            }
            return
        }
        if (!pendingAggregation) return
        appendVisibleDebug(if (manual) "Collecting current slot replies for merge" else "Collecting current slot replies for merge")
        setMergeStatusText(if (manual) "Collecting current slot replies..." else "Collecting replies...")
        activity.collectLatestRepliesFromEnabledSlots { responses ->
            lastOriginalResponses = responses
            val snapshots = (0 until SlotManager.NUM_SLOTS)
                .filter { activity.slotManager.isSlotEnabled(it) }
                .map { slotIndex ->
                    val serviceName = activity.slotManager.getService(slotIndex).name
                    val hasResponse = responses.containsKey(serviceName)
                    AggregationSlotSnapshot(
                        slotIndex = slotIndex,
                        serviceName = serviceName,
                        status = if (hasResponse) AggregationSlotStatus.COLLECTED else AggregationSlotStatus.ERROR
                    )
                }
            renderAggregationStatuses(snapshots)
            finishAggregationState()
            appendVisibleDebug("Collected ${responses.size} response(s) for merge")
            handleMergeResponses(responses, false, "", "", false)
        }
    }

    private fun applyMergeEnabledState() {
        val enabled = SettingsManager.isMergeEnabled(requireContext())
        if (!enabled) setMergeStatusText(getString(R.string.merge_disabled_message))
        else if (binding.mergeResult.text.toString() == getString(R.string.merge_disabled_message)) setMergeStatusText(getString(R.string.merge_idle_text))
    }

    private fun validateMergeSetup(
        provider: MergeProvider,
        apiKey: String,
        endpoint: String,
        model: String
    ): Int? {
        val descriptor = catalogProvider(provider)
        if (apiKey.isBlank()) return R.string.merge_api_key_required
        if (descriptor?.supportsCustomEndpoint == true && endpoint.isBlank()) return R.string.merge_endpoint_required
        if (descriptor?.supportsCustomModel == true && descriptor.defaultModel.isBlank() && model.isBlank()) return R.string.merge_model_required
        return null
    }

    override fun startFind(query: String) {
        if (_binding == null) return
        currentFindQuery = query
        if (query.isBlank()) {
            clearFind()
            return
        }
        recomputeAndRenderFind(resetActive = true)
    }

    override fun findNext() {
        if (_binding == null || currentFindQuery.isBlank()) return
        if (findMatchRanges.isEmpty()) {
            recomputeAndRenderFind(resetActive = true)
            return
        }
        activeFindIndex = (activeFindIndex + 1).mod(findMatchRanges.size)
        renderFindSpans()
        scrollToActiveFindMatch()
    }

    override fun findPrev() {
        if (_binding == null || currentFindQuery.isBlank()) return
        if (findMatchRanges.isEmpty()) {
            recomputeAndRenderFind(resetActive = true)
            return
        }
        activeFindIndex = (activeFindIndex - 1).let { if (it < 0) findMatchRanges.size - 1 else it }
        renderFindSpans()
        scrollToActiveFindMatch()
    }

    override fun clearFind() {
        if (_binding == null) return
        currentFindQuery = ""
        findMatchRanges = emptyList()
        activeFindIndex = -1
        clearFindSpans()
    }

    private fun reapplyFindIfActive() {
        if (currentFindQuery.isBlank()) {
            clearFindSpans()
            return
        }
        recomputeAndRenderFind(resetActive = true)
    }

    private fun recomputeAndRenderFind(resetActive: Boolean) {
        val raw = binding.mergeResult.text?.toString().orEmpty()
        if (raw.isEmpty()) {
            clearFind()
            return
        }
        val needle = currentFindQuery
        if (needle.isBlank()) {
            clearFind()
            return
        }

        val haystackLower = raw.lowercase()
        val needleLower = needle.lowercase()
        val matches = mutableListOf<IntRange>()
        var from = 0
        while (from <= haystackLower.length - needleLower.length) {
            val idx = haystackLower.indexOf(needleLower, from)
            if (idx < 0) break
            matches += idx until (idx + needle.length)
            from = idx + needle.length
        }
        findMatchRanges = matches
        if (findMatchRanges.isEmpty()) {
            activeFindIndex = -1
            clearFindSpans()
            return
        }
        if (resetActive || activeFindIndex !in findMatchRanges.indices) {
            activeFindIndex = 0
        }
        renderFindSpans()
        scrollToActiveFindMatch()
    }

    private fun renderFindSpans() {
        val currentText = SpannableStringBuilder(binding.mergeResult.text ?: "")
        val existing = currentText.getSpans(0, currentText.length, FindHighlightSpan::class.java)
        existing.forEach { currentText.removeSpan(it) }

        val allColor = Color.parseColor("#FFF59D")
        val activeColor = Color.parseColor("#FFB74D")
        findMatchRanges.forEachIndexed { index, range ->
            val color = if (index == activeFindIndex) activeColor else allColor
            currentText.setSpan(
                FindHighlightSpan(color),
                range.first,
                range.last + 1,
                android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
            )
        }
        binding.mergeResult.setText(currentText, TextView.BufferType.SPANNABLE)
    }

    private fun clearFindSpans() {
        val currentText = SpannableStringBuilder(binding.mergeResult.text ?: "")
        val existing = currentText.getSpans(0, currentText.length, FindHighlightSpan::class.java)
        if (existing.isEmpty()) return
        existing.forEach { currentText.removeSpan(it) }
        binding.mergeResult.setText(currentText, TextView.BufferType.SPANNABLE)
    }

    private fun scrollToActiveFindMatch() {
        if (activeFindIndex !in findMatchRanges.indices) return
        val matchStart = findMatchRanges[activeFindIndex].first
        binding.mergeResult.post {
            val layout = binding.mergeResult.layout ?: return@post
            val line = layout.getLineForOffset(matchStart)
            val lineTop = layout.getLineTop(line)
            val y = (binding.mergeResult.top + lineTop - dp(20)).coerceAtLeast(0)
            binding.mergeScrollView.smoothScrollTo(0, y)
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun setMergeStatusText(text: String) {
        binding.mergeResult.text = text
        reapplyFindIfActive()
        if (text != lastLoggedStatusText) {
            appendVisibleDebug("Status: $text")
            lastLoggedStatusText = text
        }
    }

    private class FindHighlightSpan(color: Int) : BackgroundColorSpan(color)

    override fun onDestroyView() {
        aggregationHandler.removeCallbacksAndMessages(null)
        _binding = null
        super.onDestroyView()
    }
}
