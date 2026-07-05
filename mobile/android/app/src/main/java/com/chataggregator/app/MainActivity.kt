package com.chataggregator.app

import android.Manifest
import android.animation.ValueAnimator
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Shader
import android.graphics.BitmapFactory
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.Layout
import android.text.StaticLayout
import android.text.TextWatcher
import android.text.InputType
import android.util.Log
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import android.webkit.CookieManager
import android.widget.ArrayAdapter
import android.widget.AbsListView
import android.widget.CheckBox
import android.widget.CompoundButton
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.PopupWindow
import android.widget.ScrollView
import android.widget.TextView
import android.view.ViewGroup
import java.util.Locale
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.core.content.ContextCompat
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import com.google.android.material.chip.Chip
import com.google.android.material.tabs.TabLayout
import com.google.android.material.tabs.TabLayoutMediator
import com.chataggregator.app.databinding.ActivityMainBinding
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import java.net.URLEncoder
import java.net.URL
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity(), PlayBillingManager.Listener {

    companion object {
        private const val TAG = "MainActivity"
        private const val MERGE_TAB_INDEX = SlotManager.NUM_SLOTS
        private const val STARTUP_SLOT_LOADING_DELAY_MS = 180L
        private const val SEND_STAGGER_MS = 150L
        private const val SEND_DEBOUNCE_MS = 500L
        private const val WEBVIEW_CACHE_MAX_BYTES = 100L * 1024L * 1024L // 100 MB
        private const val REMOTE_LIST_CACHE_TTL_MS = 24L * 60L * 60L * 1000L
        private const val REMOTE_LIST_PREFS = "remote_list_cache"
        private const val PROJECT_TREE_CACHE_PREF = "project_tree_v2"
        private const val PROJECT_TREE_LOADED_AT_PREF = "project_tree_loaded_at"
        private const val SESSIONS_LOADED_AT_PREF = "sessions_loaded_at"
        private const val CHEAT_UNLOCK_SHA256 = "1bda832333f390e87d3683d9a73f8613fd92cf062790cfe7349efd41e9b89594"
        private const val CHEAT_DEBUG_SHA256 = "51c55c26253022764f0fb1780249cdd4a4fa809e679c79e6b550af4ee571318f"
        private const val PENDING_APPROVAL_MESSAGE =
            "Your access request is pending approval. Request access at veritydb.vercel.app — " +
                "until approved, the app keeps working in local mode."
    }

    private data class ProjectTreeNode(
        val id: String,
        val pathKey: String = "",
        val name: String,
        val slotUrls: Map<String, String> = emptyMap(),
        val children: List<ProjectTreeNode>,
    )

    private lateinit var binding: ActivityMainBinding
    lateinit var slotManager: SlotManager
        private set

    private lateinit var pagerAdapter: ChatPagerAdapter
    private lateinit var checkboxes: List<CompoundButton>
    private lateinit var billingManager: PlayBillingManager
    private var lastSendAtMs: Long = 0L
    private var isFindBarVisible = false
    private var ingestPollGeneration: Long = 0L
    @Volatile private var autoAggregationPaused: Boolean = false
    @Volatile private var pendingAggregationPrompt: String? = null
    @Volatile private var pendingAggregationExpectedSlots: Int = 0
    private val sessionManager by lazy { SessionManager(this, slotManager) }
    private val pendingSessionUrls = mutableMapOf<Int, String>()
    @Volatile private var lastScrapeMeta: List<Map<String, Any?>> = emptyList()
    private var activeProjectId: String? = null
    private var activeProjectPathKey: String? = null
    private var isProjectPanelVisible = false
    private lateinit var projectPanelView: View
    private lateinit var projectPanelScrimView: View
    private lateinit var projectListContainerView: LinearLayout
    private var projectTreeNodes: List<ProjectTreeNode> = emptyList()
    private var projectTreeLoadedAtMs: Long = 0L
    private var sessionsLoadedAtMs: Long = 0L
    @Volatile private var projectRefreshInFlight: Boolean = false
    @Volatile private var sessionsRefreshInFlight: Boolean = false
    private val expandedProjectNodeIds = mutableSetOf<String>()
    private var blurDialogCount = 0
    private var pendingProjectSelectionArmed: Boolean = false
    private var pendingProjectSelectionNode: ProjectTreeNode? = null
    @Volatile private var lastProjectFetchError: String? = null
    @Volatile private var projectSlotUrlLoadGeneration: Long = 0L
    @Volatile private var activeProjectSlotUrls: Map<String, String> = emptyMap()
    private val serviceIconCache = ConcurrentHashMap<String, BitmapDrawable>()

    private val micPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            Log.d(TAG, "Microphone permission granted")
        } else {
            Log.w(TAG, "Microphone permission denied")
        }
    }

    private val cookieFilePicker = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            result.data?.data?.let { uri -> importCookiesFromUri(uri) }
        }
    }

    private val attachFilePicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) {
            try {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (_: SecurityException) {}
            attachFileToAllEnabledSlots(uri)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.viewPager.post {
            binding.topBarBg.bringToFront()
            binding.projectTabContainer.bringToFront()
            binding.tabLayout.bringToFront()
            binding.tabSeparator.bringToFront()
            binding.btnSettings.bringToFront()
            binding.findBarContainer.bringToFront()
            binding.bottomPanel.bringToFront()
        }
        if (savedInstanceState == null) {
            SettingsManager.clearParallelIngestState(this)
        }
        if (SettingsManager.isAutoCacheCleanupEnabled(this)) {
            cleanupWebViewCacheIfNeeded()
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
        }

        slotManager = SlotManager(this)
        billingManager = PlayBillingManager(this, this)
        Log.i(
            TAG,
            "Startup flags detailedLogs=${SettingsManager.isDetailedLoggingEnabled(this)} unstableFeatures=${SettingsManager.isUnstableFeaturesEnabled(this)} lifetimeUnlocked=${SettingsManager.isLifetimeUnlocked(this)} mergeEnabled=${SettingsManager.isMergeEnabled(this)}"
        )

        requestMicPermissionIfNeeded()
        setupViewPager()
        setupCheckboxes()
        setupMessageInput()
        setupFindInPage()
        setupSettingsMenu()
        setupTabContextMenu()
        setupProjectSelector()
        applyUnstableFeatureVisibility()
        scheduleDeferredStartupWork()
        maybeShowOnboarding()
    }

    /** First run: ask Local vs Sign In before any backend work. */
    private fun maybeShowOnboarding() {
        if (SettingsManager.getAppMode(this) != null) return
        if (AuthStore.status(applicationContext).signedIn) {
            SettingsManager.setAppMode(this, "account")
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Welcome to Quaestio")
            .setMessage(
                "Choose how to use the app. You can change this later in Settings → Account.\n\n" +
                    "Local keeps everything on this device — sessions only, nothing is sent to the server. " +
                    "Sign in to attribute and sync your notes and sessions to your account.\n\n" +
                    "No account yet? Accounts are invite-only for now — request access at " +
                    "veritydb.vercel.app. Until your request is approved, the app works fully in local mode."
            )
            .setCancelable(false)
            .setPositiveButton("Sign In") { _, _ ->
                SettingsManager.setAppMode(this, "account")
                showAccountDialog()
            }
            .setNegativeButton("Use Locally") { _, _ ->
                SettingsManager.setAppMode(this, "local")
            }
            .show()
    }

    override fun onResume() {
        super.onResume()
        billingManager.start()
        updateSessionIndicator()
    }

    private fun requestMicPermissionIfNeeded() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    private fun scheduleDeferredStartupWork() {
        binding.root.post {
            updateSessionIndicator()
            binding.root.postDelayed(
                { scheduleSlotLoading() },
                STARTUP_SLOT_LOADING_DELAY_MS
            )
        }
    }

    private fun setupViewPager() {
        pagerAdapter = ChatPagerAdapter(this, SlotManager.NUM_SLOTS, hasMergeTab = true)
        binding.viewPager.apply {
            adapter = pagerAdapter
            offscreenPageLimit = SlotManager.NUM_SLOTS
            isUserInputEnabled = false
            registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
                override fun onPageSelected(position: Int) {
                    updateBottomActionForTab(position)
                    if (isFindBarVisible) {
                        val query = binding.findInput.text?.toString().orEmpty()
                        getFindableForPosition(position)?.startFind(query)
                    }
                }
            })
        }
        reduceViewPagerSwipeSensitivity(3)
        setupEdgeSwipeNavigation()

        TabLayoutMediator(binding.tabLayout, binding.viewPager) { tab, position ->
            if (position == MERGE_TAB_INDEX) {
                tab.text = getString(R.string.merge_tab_title)
            } else {
                val service = slotManager.getService(position)
                tab.text = service.name
            }
        }.attach()
        binding.tabLayout.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            applyTabWidthsWithCompactMerge()
            positionMergeSeparator()
        }
        applyTabWidthsWithCompactMerge()
        positionMergeSeparator()
        updateBottomActionForTab(binding.viewPager.currentItem)
    }

    private fun setupEdgeSwipeNavigation() {
        val minDistancePx = dp(28).toFloat()
        val minVelocityPx = 500f

        val edgeGestureListener = object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent): Boolean = true

            override fun onFling(
                e1: MotionEvent?,
                e2: MotionEvent,
                velocityX: Float,
                velocityY: Float,
            ): Boolean {
                val start = e1 ?: return false
                val dx = e2.x - start.x
                val dy = e2.y - start.y
                if (kotlin.math.abs(dx) < minDistancePx) return false
                if (kotlin.math.abs(velocityX) < minVelocityPx) return false
                if (kotlin.math.abs(dx) <= kotlin.math.abs(dy)) return false

                val current = binding.viewPager.currentItem
                if (dx < 0) {
                    val next = (current + 1).coerceAtMost(pagerAdapter.itemCount - 1)
                    if (next != current) {
                        binding.viewPager.setCurrentItem(next, true)
                        return true
                    }
                } else {
                    val prev = (current - 1).coerceAtLeast(0)
                    if (prev != current) {
                        binding.viewPager.setCurrentItem(prev, true)
                        return true
                    }
                }
                return false
            }
        }

        val detectorLeft = GestureDetector(this, edgeGestureListener)
        val detectorRight = GestureDetector(this, edgeGestureListener)

        binding.edgeSwipeLeft.setOnTouchListener { _, event ->
            detectorLeft.onTouchEvent(event)
        }
        binding.edgeSwipeRight.setOnTouchListener { _, event ->
            detectorRight.onTouchEvent(event)
        }
    }

    private fun positionMergeSeparator() {
        binding.tabLayout.post {
            val strip = binding.tabLayout.getChildAt(0) as? ViewGroup ?: return@post
            if (MERGE_TAB_INDEX <= 0 || MERGE_TAB_INDEX >= strip.childCount) return@post
            val mergeTabView = strip.getChildAt(MERGE_TAB_INDEX) ?: return@post
            val params = binding.tabSeparator.layoutParams as? ConstraintLayout.LayoutParams ?: return@post
            val targetStart = mergeTabView.left.coerceAtLeast(0)
            if (params.marginStart != targetStart) {
                params.marginStart = targetStart
                binding.tabSeparator.layoutParams = params
            }
            binding.tabSeparator.bringToFront()
        }
    }

    private fun applyTabWidthsWithCompactMerge() {
        val strip = binding.tabLayout.getChildAt(0) as? LinearLayout ?: return
        if (strip.childCount == 0) return
        for (index in 0 until strip.childCount) {
            val tabView = strip.getChildAt(index)
            val params = tabView.layoutParams as? LinearLayout.LayoutParams ?: continue
            if (index < MERGE_TAB_INDEX) {
                val changed = params.width != 0 || params.weight != 1f
                if (changed) {
                    params.width = 0
                    params.weight = 1f
                    tabView.layoutParams = params
                }
                continue
            }
            if (index == MERGE_TAB_INDEX) {
                val changed = params.width != LinearLayout.LayoutParams.WRAP_CONTENT || params.weight != 0f
                if (changed) {
                    params.width = LinearLayout.LayoutParams.WRAP_CONTENT
                    params.weight = 0f
                    tabView.layoutParams = params
                }
            }
        }
    }

    private fun scheduleSlotLoading(forceReload: Boolean = false) {
        val viewPager = binding.viewPager
        viewPager.post {
            val handler = Handler(Looper.getMainLooper())
            val currentTab = viewPager.currentItem
            val enabledSlots = (0 until SlotManager.NUM_SLOTS)
                .filter { slotManager.isSlotEnabled(it) }

            // Give it another 300ms to be absolutely sure fragments are attached
            handler.postDelayed({
                if (forceReload) {
                    Log.i(TAG, "[SESSION] scheduleSlotLoading forceReload=true currentTab=$currentTab")
                    val orderedSlots = buildList {
                        if (currentTab in 0 until SlotManager.NUM_SLOTS) {
                            add(currentTab)
                        }
                        enabledSlots
                            .filter { it != currentTab }
                            .forEach { add(it) }
                    }.distinct()
                    orderedSlots.forEachIndexed { index, slot ->
                        val delay = if (index == 0) 0L else index * 400L
                        handler.postDelayed({
                            loadSlotWithSessionOverride(slot, handler, forceReload = true)
                        }, delay)
                    }
                    return@postDelayed
                }

                val enabled = enabledSlots.filter { it != currentTab }

                // 1) Highest priority: currently visible tab
                if (currentTab < SlotManager.NUM_SLOTS) {
                    loadSlotWithSessionOverride(currentTab, handler)
                }

                // 2) Other enabled slots
                enabled.forEachIndexed { i, slot ->
                    handler.postDelayed({
                        loadSlotWithSessionOverride(slot, handler)
                    }, 400L + i * 250L)
                }
            }, 300L)
        }
    }

    private fun loadSlotWithSessionOverride(slotIndex: Int, handler: Handler, attempt: Int = 0, forceReload: Boolean = false) {
        val fragment = pagerAdapter.getFragment(slotIndex)
        if (fragment == null) {
            if (attempt < 8) {
                handler.postDelayed({ loadSlotWithSessionOverride(slotIndex, handler, attempt + 1, forceReload) }, 250L)
            } else if (SettingsManager.isDetailedLoggingEnabled(this)) {
                Log.w(TAG, "loadSlotWithSessionOverride slot=$slotIndex fragment unavailable")
            }
            return
        }

        val sessionUrl = synchronized(pendingSessionUrls) { pendingSessionUrls.remove(slotIndex) }
        if (!sessionUrl.isNullOrBlank()) {
            Log.i(TAG, "[SESSION] slot=$slotIndex → loadSessionUrl=$sessionUrl")
            fragment.loadSessionUrl(sessionUrl, forceReload = forceReload)
            return
        }

        val serviceId = slotManager.getService(slotIndex).id
        Log.i(TAG, "[SESSION] slot=$slotIndex → loadService=$serviceId (no pending url)")
        if (forceReload) {
            fragment.reload()
        } else {
            fragment.loadService(serviceId)
        }
    }

    private fun reduceViewPagerSwipeSensitivity(multiplier: Int) {
        try {
            val rv = binding.viewPager.getChildAt(0) as? RecyclerView ?: return
            val touchSlopField = RecyclerView::class.java.getDeclaredField("mTouchSlop")
            touchSlopField.isAccessible = true
            val currentSlop = touchSlopField.get(rv) as? Int ?: return
            touchSlopField.set(rv, currentSlop * multiplier.coerceAtLeast(1))
            Log.d(TAG, "ViewPager swipe sensitivity reduced x$multiplier")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to adjust ViewPager swipe sensitivity: ${e.message}")
        }
    }

    private fun setupCheckboxes() {
        checkboxes = listOf(
            binding.cbSlot0,
            binding.cbSlot1,
            binding.cbSlot2,
            binding.cbSlot3
        )

        checkboxes.forEachIndexed { index, cb ->
            val service = slotManager.getService(index)
            val chip = cb as? Chip ?: return@forEachIndexed
            chip.text = ""
            chip.contentDescription = service.name
            chip.setChipIconVisible(true)
            chip.chipIconSize = dp(16).toFloat()
            chip.chipStartPadding = dp(8).toFloat()
            chip.chipEndPadding = dp(8).toFloat()
            chip.iconStartPadding = 0f
            chip.iconEndPadding = 0f
            cb.isChecked = slotManager.isSlotEnabled(index)
            applyServiceIconToChip(chip, service.id, slotManager.isSlotEnabled(index))
            cb.setOnCheckedChangeListener { _, isChecked ->
                slotManager.setSlotEnabled(index, isChecked)
                applyServiceIconToChip(chip, slotManager.getService(index).id, isChecked)
            }
        }
    }

    private fun applyServiceIconToChip(chip: com.google.android.material.chip.Chip, serviceId: String, enabled: Boolean) {
        val cached = serviceIconCache[serviceId]
        if (cached != null) {
            chip.chipIcon = cached.constantState?.newDrawable(resources)?.mutate()?.apply {
                alpha = if (enabled) 255 else 160
            }
            return
        }

        chip.chipIcon = null
        val faviconUrl = serviceFaviconUrl(serviceId) ?: return
        thread {
            try {
                val connection = URL(faviconUrl).openConnection()
                connection.connectTimeout = 5000
                connection.readTimeout = 5000
                connection.getInputStream().use { stream ->
                    val bitmap = BitmapFactory.decodeStream(stream) ?: return@use
                    val drawable = BitmapDrawable(resources, bitmap).apply {
                        setBounds(0, 0, dp(16), dp(16))
                    }
                    serviceIconCache[serviceId] = drawable
                    runOnUiThread {
                        val stillSameService = checkboxes.indexOf(chip).takeIf { it >= 0 }?.let { slotManager.getService(it).id } == serviceId
                        if (stillSameService) {
                            chip.chipIcon = drawable.constantState?.newDrawable(resources)?.mutate()?.apply {
                                alpha = if (enabled) 255 else 160
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                // Keep the chip empty if favicon fetch fails.
            }
        }
    }

    private fun serviceFaviconUrl(serviceId: String): String? {
        val domain = when (serviceId.trim().lowercase(Locale.ROOT)) {
            "chatgpt" -> "https://chatgpt.com"
            "claude" -> "https://claude.ai"
            "gemini" -> "https://gemini.google.com"
            "grok" -> "https://grok.com"
            "deepseek" -> "https://chat.deepseek.com"
            "perplexity" -> "https://www.perplexity.ai"
            else -> return null
        }
        return "https://www.google.com/s2/favicons?sz=64&domain_url=$domain"
    }

    private fun setupMessageInput() {
        binding.btnAttach.setOnClickListener {
            openAttachFilePicker()
        }

        binding.btnSend.setOnClickListener {
            if (shouldRunMergeFromBottom()) {
                val mergeFragment = findMergeFragment()
                if (mergeFragment != null) {
                    mergeFragment.runMergeFromBottom()
                } else {
                    Toast.makeText(this, R.string.merge_not_ready, Toast.LENGTH_SHORT).show()
                }
            } else {
                sendToAll()
            }
        }

        binding.messageInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEND) {
                if (shouldRunMergeFromBottom()) {
                    val mergeFragment = findMergeFragment()
                    if (mergeFragment != null) {
                        mergeFragment.runMergeFromBottom()
                    } else {
                        Toast.makeText(this, R.string.merge_not_ready, Toast.LENGTH_SHORT).show()
                    }
                } else {
                    sendToAll()
                }
                true
            } else {
                false
            }
        }

        binding.messageInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                updateBottomActionForTab(binding.viewPager.currentItem)
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })
    }

    private fun setupFindInPage() {
        binding.btnFindNext.setOnClickListener {
            getCurrentFindable()?.findNext()
        }
        binding.btnFindPrev.setOnClickListener {
            getCurrentFindable()?.findPrev()
        }
        binding.btnFindClose.setOnClickListener {
            hideFindBar()
        }
        binding.findInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                getCurrentFindable()?.startFind(s?.toString().orEmpty())
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })
        binding.findInput.setOnEditorActionListener { _, actionId, event ->
            val isSearchAction = actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH ||
                actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE ||
                event?.keyCode == android.view.KeyEvent.KEYCODE_ENTER
            if (isSearchAction) {
                getCurrentFindable()?.findNext()
                true
            } else {
                false
            }
        }
    }

    private fun showFindBar() {
        if (!isFindBarVisible) {
            isFindBarVisible = true
            binding.findBarContainer.visibility = View.VISIBLE
        }
        binding.findInput.requestFocus()
        val imm = getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
        imm.showSoftInput(binding.findInput, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
        val query = binding.findInput.text?.toString().orEmpty()
        getCurrentFindable()?.startFind(query)
    }

    private fun hideFindBar() {
        if (!isFindBarVisible) return
        clearFindAcrossTabs()
        isFindBarVisible = false
        binding.findInput.setText("")
        binding.findBarContainer.visibility = View.GONE
        val imm = getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
        imm.hideSoftInputFromWindow(binding.findInput.windowToken, 0)
    }

    private fun clearFindAcrossTabs() {
        for (slot in 0 until SlotManager.NUM_SLOTS) {
            getFindableForPosition(slot)?.clearFind()
        }
        getFindableForPosition(MERGE_TAB_INDEX)?.clearFind()
    }

    private fun getCurrentFindable(): Findable? = getFindableForPosition(binding.viewPager.currentItem)

    private fun getFindableForPosition(position: Int): Findable? {
        val fromAdapter: Fragment? = if (position == MERGE_TAB_INDEX) {
            pagerAdapter.getMergeFragment()
        } else {
            pagerAdapter.getFragment(position)
        }
        val byTag = supportFragmentManager.findFragmentByTag("f$position")
            ?: supportFragmentManager.findFragmentByTag("f${position.toLong()}")
        return (fromAdapter ?: byTag) as? Findable
    }

    private fun setupTabContextMenu() {
        binding.tabLayout.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab?) {
                setupTabLongClicks()
                if (tab?.position == MERGE_TAB_INDEX) updateMergeTabAppearance(tab, true)
            }
            override fun onTabUnselected(tab: TabLayout.Tab?) {
                if (tab?.position == MERGE_TAB_INDEX) updateMergeTabAppearance(tab, false)
            }
            override fun onTabReselected(tab: TabLayout.Tab?) {}
        })

        binding.tabLayout.post {
            setupTabLongClicks()
            positionMergeSeparator()
            val mergeTab = binding.tabLayout.getTabAt(MERGE_TAB_INDEX)
            updateMergeTabAppearance(mergeTab, binding.tabLayout.selectedTabPosition == MERGE_TAB_INDEX)
        }
    }

    private fun setupProjectSelector() {
        activeProjectId = null
        activeProjectPathKey = null
        updateProjectSelectorAppearance()
        projectPanelView = findViewById(R.id.projectPanel)
        projectPanelScrimView = findViewById(R.id.projectPanelScrim)
        projectListContainerView = findViewById(R.id.projectListContainer)

        binding.projectTabContainer.setOnClickListener(null)
        binding.projectChevron.setOnClickListener(null)
        binding.chipProjects.setOnClickListener { showProjectDialog() }
        binding.chipSessions.setOnClickListener { showSessionsDialog() }
        projectPanelScrimView.setOnClickListener { hideProjectPanel() }
        projectPanelView.setOnClickListener { /* consume */ }
        projectPanelView.visibility = View.GONE
        projectPanelScrimView.visibility = View.GONE
        updateContextChips()
    }

    private fun isFreshRemoteListCache(loadedAtMs: Long): Boolean {
        return loadedAtMs > 0L && System.currentTimeMillis() - loadedAtMs < REMOTE_LIST_CACHE_TTL_MS
    }

    private fun remoteListPrefs() = getSharedPreferences(REMOTE_LIST_PREFS, Context.MODE_PRIVATE)

    private fun loadPersistedProjectTree(): List<ProjectTreeNode> {
        val raw = remoteListPrefs().getString(PROJECT_TREE_CACHE_PREF, null) ?: return emptyList()
        return runCatching {
            Gson().fromJson(raw, Array<ProjectTreeNode>::class.java)?.toList().orEmpty()
        }.getOrDefault(emptyList())
    }

    private fun persistProjectTree(nodes: List<ProjectTreeNode>) {
        remoteListPrefs()
            .edit()
            .putString(PROJECT_TREE_CACHE_PREF, Gson().toJson(nodes))
            .putLong(PROJECT_TREE_LOADED_AT_PREF, System.currentTimeMillis())
            .apply()
    }

    private fun persistedProjectTreeLoadedAtMs(): Long {
        return remoteListPrefs().getLong(PROJECT_TREE_LOADED_AT_PREF, 0L)
    }

    private fun persistedSessionsLoadedAtMs(): Long {
        return remoteListPrefs().getLong(SESSIONS_LOADED_AT_PREF, 0L)
    }

    private fun persistSessionsLoadedAt() {
        remoteListPrefs()
            .edit()
            .putLong(SESSIONS_LOADED_AT_PREF, System.currentTimeMillis())
            .apply()
    }

    private fun releaseProjectRefreshLock() {
        Handler(Looper.getMainLooper()).postDelayed({
            projectRefreshInFlight = false
        }, 3000L)
    }

    private fun releaseSessionsRefreshLock() {
        Handler(Looper.getMainLooper()).postDelayed({
            sessionsRefreshInFlight = false
        }, 3000L)
    }

    private fun loadProjectTreeCached(forceRefresh: Boolean = false): List<ProjectTreeNode> {
        if (!forceRefresh && projectTreeNodes.isNotEmpty() && isFreshRemoteListCache(projectTreeLoadedAtMs)) {
            return projectTreeNodes
        }
        if (!forceRefresh && isFreshRemoteListCache(persistedProjectTreeLoadedAtMs())) {
            val persisted = loadPersistedProjectTree()
            if (persisted.isNotEmpty()) {
                projectTreeNodes = persisted
                projectTreeLoadedAtMs = persistedProjectTreeLoadedAtMs()
                return persisted
            }
        }
        return loadProjectTreeFromApi().also {
            projectTreeNodes = it
            projectTreeLoadedAtMs = System.currentTimeMillis()
            persistProjectTree(it)
        }
    }

    private fun showProjectDialog(forceRefresh: Boolean = false) {
        if (forceRefresh) {
            if (projectRefreshInFlight) return
            projectRefreshInFlight = true
        }
        setContextChipLoading(binding.chipProjects, true, "Loading…")
        thread {
            try {
                val projectTree = loadProjectTreeCached(forceRefresh)
                runOnUiThread {
                    setContextChipLoading(binding.chipProjects, false)
                    ensureExpandedProjectNodes(projectTree)
                    showProjectDialogWithData(projectTree)
                }
            } catch (e: Exception) {
                runOnUiThread {
                    setContextChipLoading(binding.chipProjects, false)
                    Toast.makeText(this, friendlyBackendError(e.message), Toast.LENGTH_LONG).show()
                }
            } finally {
                if (forceRefresh) releaseProjectRefreshLock()
            }
        }
    }

    private fun setContextChipLoading(chip: com.google.android.material.chip.Chip, loading: Boolean, loadingLabel: String? = null) {
        chip.isEnabled = !loading
        chip.alpha = if (loading) 0.72f else 1f
        if (loading) {
            chip.tag = chip.text?.toString()
            chip.text = loadingLabel ?: "Loading…"
        } else {
            chip.text = when (chip.id) {
                R.id.chipProjects -> resolveActiveProjectDisplayName()
                R.id.chipSessions -> SettingsManager.getParallelIngestSessionId(this)?.let { "S$it" } ?: "Sessions"
                else -> (chip.tag as? String).orEmpty()
            }
            chip.tag = null
        }
    }

    private fun styleDialogWindow(dialog: AlertDialog) {
        dialog.window?.let { w ->
            // Transparent window: the blurred+dimmed activity behind (below) keeps
            // the title/button zones readable without an extra card frame.
            w.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            // Real background blur: cross-window blur is unsupported on this
            // hardware class (e.g. S10+), so blur the ACTIVITY root view with a
            // view-level RenderEffect while the dialog is up, and lift it when
            // the dialog's decor detaches (survives any setOnDismissListener
            // the caller installs afterwards).
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                val activityRoot = binding.root
                blurDialogCount += 1
                activityRoot.setRenderEffect(
                    android.graphics.RenderEffect.createBlurEffect(
                        24f, 24f, android.graphics.Shader.TileMode.CLAMP
                    )
                )
                w.decorView.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
                    override fun onViewAttachedToWindow(v: View) = Unit
                    override fun onViewDetachedFromWindow(v: View) {
                        // Refcounted: overlapping styled dialogs share the activity-root
                        // blur; only the LAST one to close lifts it.
                        blurDialogCount = (blurDialogCount - 1).coerceAtLeast(0)
                        if (blurDialogCount == 0) activityRoot.setRenderEffect(null)
                    }
                })
            }
            w.addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            w.setDimAmount(0.45f)
        }
    }

    private fun showProjectDialogWithData(projects: List<ProjectTreeNode>) {
        var dialog: AlertDialog? = null
        val contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(10), dp(20), 0)
        }

        val scrollView = ScrollView(this).apply {
            isFillViewport = true
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(18).toFloat()
                setColor(ContextCompat.getColor(this@MainActivity, R.color.bg_surface))
            }
            clipToOutline = true
        }

        val listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(6), 0, dp(6))
        }

        val refreshRow = TextView(this).apply {
            text = "↻"
            gravity = android.view.Gravity.CENTER
            textSize = 20f
            setTextColor(ContextCompat.getColor(this@MainActivity, R.color.action_primary))
            setPadding(0, dp(8), 0, dp(10))
            contentDescription = "Refresh projects"
            setOnClickListener {
                dialog?.dismiss()
                showProjectDialog(forceRefresh = true)
            }
        }
        listContainer.addView(refreshRow)

        addProjectDialogRow(listContainer, "No Project", activeProjectId == null, depth = 0, hasChildren = false) {
            setActiveProject(projectId = null)
            dialog?.dismiss()
        }

        projects.forEach { node ->
            renderProjectDialogNode(listContainer, node, depth = 0) {
                dialog?.dismiss()
            }
        }

        scrollView.addView(listContainer)
        container.addView(scrollView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        contentLayout.addView(container)

        dialog = AlertDialog.Builder(this, R.style.ServiceDialogTheme)
            .setTitle("Projects")
            .setView(contentLayout)
            .setNegativeButton(android.R.string.cancel, null)
            .show()
        styleDialogWindow(dialog)
        dialog.setOnDismissListener {
            setContextChipLoading(binding.chipProjects, false)
        }
    }

    private fun renderProjectDialogNode(container: LinearLayout, node: ProjectTreeNode, depth: Int, onComplete: () -> Unit) {
        val hasChildren = node.children.isNotEmpty()
        val selected = activeProjectId == node.id && (activeProjectPathKey == null || activeProjectPathKey == node.pathKey)

        addProjectDialogRow(container, node.name, selected, depth, hasChildren) {
            setActiveProject(node)
            onComplete()
        }

        if (hasChildren) {
            node.children.forEach { child ->
                renderProjectDialogNode(container, child, depth + 1, onComplete)
            }
        }
    }

    private fun addProjectDialogRow(
        container: LinearLayout,
        title: String,
        selected: Boolean,
        depth: Int,
        hasChildren: Boolean,
        onSelect: () -> Unit
    ) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(dp(14 + depth * 14), dp(12), dp(14), dp(12))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                setColor(if (selected) Color.parseColor("#143B82F6") else Color.TRANSPARENT)
            }
        }

        val toggle = TextView(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(16), ViewGroup.LayoutParams.WRAP_CONTENT)
            gravity = android.view.Gravity.CENTER
            text = if (hasChildren) "▾" else ""
            setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_secondary))
            textSize = 12f
        }

        val label = TextView(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            text = title
            setTextColor(ContextCompat.getColor(this@MainActivity, if (selected) R.color.action_primary else R.color.text_primary))
            textSize = 14f
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }

        row.addView(toggle)
        row.addView(label)
        row.setOnClickListener { onSelect() }
        container.addView(row)
        container.addView(View(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)).apply {
                marginStart = dp(14)
                marginEnd = dp(14)
            }
            setBackgroundColor(Color.parseColor("#14" + Integer.toHexString(ContextCompat.getColor(this@MainActivity, R.color.text_secondary)).takeLast(6)))
        })
    }

    private fun showProjectPanel() {
        if (isProjectPanelVisible) return
        isProjectPanelVisible = true
        updateProjectSelectorAppearance()
        projectPanelView.visibility = View.VISIBLE
        projectPanelScrimView.visibility = View.VISIBLE
        projectPanelScrimView.alpha = 0f
        projectPanelScrimView.animate()
            .alpha(1f)
            .setDuration(180)
            .start()

        projectPanelView.post {
            val width = if (projectPanelView.width > 0) {
                projectPanelView.width.toFloat()
            } else {
                280f * resources.displayMetrics.density
            }
            projectPanelView.translationX = -width
            projectPanelView.animate()
                .translationX(0f)
                .setDuration(220)
                .setInterpolator(AccelerateDecelerateInterpolator())
                .start()
        }

        thread {
            try {
                val projectTree = loadProjectTreeCached()
                runOnUiThread {
                    if (!isProjectPanelVisible) return@runOnUiThread
                    if (projectTree.isNotEmpty()) {
                        ensureExpandedProjectNodes(projectTree)
                        renderProjectPanel(projectTree)
                        updateContextChips()
                    } else {
                        val err = lastProjectFetchError
                        if (!err.isNullOrBlank()) {
                            Toast.makeText(this@MainActivity, err, Toast.LENGTH_LONG).show()
                        } else {
                            Toast.makeText(this@MainActivity, "No projects found", Toast.LENGTH_SHORT).show()
                        }
                        projectTreeNodes = emptyList()
                        renderProjectPanel(emptyList())
                        updateContextChips()
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, friendlyBackendError(e.message), Toast.LENGTH_LONG).show()
                    projectTreeNodes = emptyList()
                    renderProjectPanel(emptyList())
                    updateContextChips()
                }
            }
        }
    }

    private fun hideProjectPanel() {
        if (!isProjectPanelVisible && projectPanelView.visibility != View.VISIBLE) return
        isProjectPanelVisible = false
        updateProjectSelectorAppearance()
        val panelWidth = if (projectPanelView.width > 0) {
            projectPanelView.width.toFloat()
        } else {
            280f * resources.displayMetrics.density
        }
        projectPanelView.animate()
            .translationX(-panelWidth)
            .setDuration(180)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .withEndAction {
                if (!isProjectPanelVisible) {
                    projectPanelView.visibility = View.GONE
                    applyPendingProjectSelectionIfNeeded()
                }
            }
            .start()
        projectPanelScrimView.animate()
            .alpha(0f)
            .setDuration(180)
            .withEndAction {
                if (!isProjectPanelVisible) projectPanelScrimView.visibility = View.GONE
            }
            .start()
    }

    private fun queueProjectSelectionAndClose(projectId: String?) {
        pendingProjectSelectionArmed = false
        pendingProjectSelectionNode = null
        setActiveProject(projectId)
        hideProjectPanel()
    }

    private fun queueProjectSelectionAndClose(node: ProjectTreeNode?) {
        pendingProjectSelectionArmed = false
        pendingProjectSelectionNode = null
        setActiveProject(node)
        hideProjectPanel()
    }

    private fun applyPendingProjectSelectionIfNeeded() {
        if (!pendingProjectSelectionArmed) return
        pendingProjectSelectionArmed = false
        val projectNode = pendingProjectSelectionNode
        pendingProjectSelectionNode = null
        setActiveProject(projectNode)
    }

    private fun renderProjectPanel(projects: List<ProjectTreeNode>) {
        val container = projectListContainerView
        container.removeAllViews()

        val noProjectView = TextView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            setPadding(dp(14), dp(10), dp(14), dp(10))
            textSize = 14f
            text = "No Project"
            setTextColor(
                ContextCompat.getColor(
                    this@MainActivity,
                    if (activeProjectId == null) R.color.action_primary else R.color.text_primary
                )
            )
            if (activeProjectId == null) {
                setBackgroundColor(Color.parseColor("#1A3B82F6"))
            } else {
                setBackgroundColor(Color.TRANSPARENT)
            }
            setOnClickListener {
                queueProjectSelectionAndClose(projectId = null)
            }
        }
        container.addView(noProjectView)

        if (projects.isEmpty()) return
        projects.forEach { node ->
            renderProjectTreeNode(container, node, depth = 0)
        }
    }

    private fun renderProjectTreeNode(container: LinearLayout, node: ProjectTreeNode, depth: Int) {
        val hasChildren = node.children.isNotEmpty()
        val nodeKey = node.pathKey.ifBlank { node.id }
        val isExpanded = expandedProjectNodeIds.contains(nodeKey)
        val selected = activeProjectId == node.id && (activeProjectPathKey == null || activeProjectPathKey == nodeKey)

        val row = LinearLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(dp(8 + depth * 14), dp(8), dp(10), dp(8))
            if (selected) {
                setBackgroundColor(Color.parseColor("#1A3B82F6"))
            } else {
                setBackgroundColor(Color.TRANSPARENT)
            }
        }

        val toggle = TextView(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(14), ViewGroup.LayoutParams.WRAP_CONTENT)
            textSize = 12f
            gravity = android.view.Gravity.CENTER
            text = when {
                !hasChildren -> ""
                isExpanded -> "▾"
                else -> "▸"
            }
            setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_secondary))
            if (hasChildren) {
                setOnClickListener {
                    if (expandedProjectNodeIds.contains(nodeKey)) expandedProjectNodeIds.remove(nodeKey)
                    else expandedProjectNodeIds.add(nodeKey)
                    renderProjectPanel(projectTreeNodes)
                }
            }
        }
        row.addView(toggle)

        val title = TextView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                0,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                1f,
            )
            text = node.name
            textSize = 14f
            setTextColor(
                ContextCompat.getColor(
                    this@MainActivity,
                    if (selected) R.color.action_primary else R.color.text_primary,
                )
            )
        }
        row.addView(title)

        row.setOnClickListener {
            queueProjectSelectionAndClose(node)
        }
        container.addView(row)

        if (hasChildren && isExpanded) {
            node.children.forEach { child ->
                renderProjectTreeNode(container, child, depth + 1)
            }
        }
    }

    private fun ensureExpandedProjectNodes(nodes: List<ProjectTreeNode>) {
        if (expandedProjectNodeIds.isNotEmpty()) return
        fun walk(list: List<ProjectTreeNode>) {
            list.forEach { node ->
                if (node.children.isNotEmpty()) {
                    expandedProjectNodeIds.add(node.pathKey.ifBlank { node.id })
                    walk(node.children)
                }
            }
        }
        walk(nodes)
    }

    /** Sessions-dialog project filter popover (docs/PROJECT_SESSION_FILTER.md).
     *  Compact PopupWindow anchored to the filter button: search field on top,
     *  "All projects" + "No project" rows, then either the collapsible project
     *  tree (empty query, filter-local expand state, default all collapsed —
     *  reuses the renderProjectTreeNode row look) or a flat depth-indented
     *  name-match list (non-empty query). Row tap reports the chosen filter id
     *  (null = All, "__none__" = No project, else project id) and dismisses. */
    private fun showProjectFilterPopup(
        anchor: View,
        currentFilterId: String?,
        onSelect: (String?) -> Unit
    ) {
        val filterExpandedIds = mutableSetOf<String>()

        val rowsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        val rowsScroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(300)
            )
            addView(rowsContainer)
        }

        lateinit var popup: PopupWindow
        lateinit var renderRows: (String) -> Unit

        fun simpleRow(label: String, filterId: String?, depth: Int = 0): TextView {
            return TextView(this).apply {
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
                setPadding(dp(14 + depth * 14), dp(10), dp(14), dp(10))
                text = label
                textSize = 14f
                setTextColor(
                    ContextCompat.getColor(
                        this@MainActivity,
                        if (filterId == currentFilterId) R.color.action_primary else R.color.text_primary
                    )
                )
                setOnClickListener {
                    popup.dismiss()
                    onSelect(filterId)
                }
            }
        }

        // Same row pattern as renderProjectTreeNode (chevron + indent), but
        // with filter-local expand state and a filter-select tap action.
        fun addTreeRow(node: ProjectTreeNode, depth: Int) {
            val hasChildren = node.children.isNotEmpty()
            val nodeKey = node.pathKey.ifBlank { node.id }
            val isExpanded = filterExpandedIds.contains(nodeKey)

            val row = LinearLayout(this).apply {
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                setPadding(dp(8 + depth * 14), dp(8), dp(10), dp(8))
            }
            val toggle = TextView(this).apply {
                layoutParams = LinearLayout.LayoutParams(dp(14), ViewGroup.LayoutParams.WRAP_CONTENT)
                textSize = 12f
                gravity = android.view.Gravity.CENTER
                text = when {
                    !hasChildren -> ""
                    isExpanded -> "▾"
                    else -> "▸"
                }
                setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_secondary))
                if (hasChildren) {
                    setOnClickListener {
                        if (filterExpandedIds.contains(nodeKey)) filterExpandedIds.remove(nodeKey)
                        else filterExpandedIds.add(nodeKey)
                        renderRows("")
                    }
                }
            }
            row.addView(toggle)
            row.addView(TextView(this).apply {
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                text = node.name
                textSize = 14f
                setTextColor(
                    ContextCompat.getColor(
                        this@MainActivity,
                        if (node.id == currentFilterId) R.color.action_primary else R.color.text_primary
                    )
                )
            })
            row.setOnClickListener {
                popup.dismiss()
                onSelect(node.id)
            }
            rowsContainer.addView(row)

            if (hasChildren && isExpanded) {
                node.children.forEach { child -> addTreeRow(child, depth + 1) }
            }
        }

        fun flattenMatches(nodes: List<ProjectTreeNode>, query: String, depth: Int): List<Pair<ProjectTreeNode, Int>> {
            return nodes.flatMap { node ->
                val self = if (node.name.lowercase(Locale.ROOT).contains(query)) listOf(node to depth) else emptyList()
                self + flattenMatches(node.children, query, depth + 1)
            }
        }

        renderRows = { query ->
            rowsContainer.removeAllViews()
            rowsContainer.addView(simpleRow("All projects", null))
            rowsContainer.addView(simpleRow("No project", "__none__"))
            val normalized = query.trim().lowercase(Locale.ROOT)
            if (normalized.isBlank()) {
                projectTreeNodes.forEach { node -> addTreeRow(node, depth = 0) }
            } else {
                flattenMatches(projectTreeNodes, normalized, depth = 0).forEach { (node, depth) ->
                    rowsContainer.addView(simpleRow(node.name, node.id, depth))
                }
            }
        }

        val searchField = EditText(this).apply {
            hint = "Filter projects…"
            setSingleLine(true)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#888888"))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(10).toFloat()
                setColor(Color.parseColor("#2B2B2B"))
                setStroke(dp(1), Color.parseColor("#474747"))
            }
            setPadding(dp(12), dp(8), dp(12), dp(8))
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    renderRows(s?.toString().orEmpty())
                }
                override fun afterTextChanged(s: Editable?) = Unit
            })
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = AppCompatResources.getDrawable(this@MainActivity, R.drawable.bg_dialog_surface)
            clipToOutline = true
            setPadding(dp(10), dp(10), dp(10), dp(10))
            addView(searchField, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ))
            addView(rowsScroll, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(6)
            })
        }

        renderRows("")

        popup = PopupWindow(
            content,
            dp(280),
            ViewGroup.LayoutParams.WRAP_CONTENT,
            true
        ).apply {
            isOutsideTouchable = true
            elevation = dp(8).toFloat()
        }
        popup.showAsDropDown(anchor, 0, dp(4))
    }

    private fun loadProjectTreeFromApi(): List<ProjectTreeNode> {
        val rpcUrl = SettingsManager.getDreamTrackerRpcUrl(this)
        val apiKey = normalizeSupabaseApiKey(SettingsManager.getDreamTrackerApiKey(this))
        lastProjectFetchError = null

        if (rpcUrl.isBlank() || apiKey.isBlank()) {
            Log.w(TAG, "Dream Tracker API not configured")
            lastProjectFetchError = "Dream Tracker API key is missing"
            return emptyList()
        }

        val restBaseUrl = normalizeRestEndpoint(rpcUrl)
        val tagsUrl = "$restBaseUrl/tags?select=id,name,slot_urls&order=name.asc"
        val tagParentsUrl = "$restBaseUrl/tag_parents?select=tag_id,parent_id"

        val tags = fetchJsonArray(tagsUrl, apiKey, shouldSetError = true) ?: return emptyList()
        val tagParents = fetchJsonArray(tagParentsUrl, apiKey, allow404 = true) ?: JsonArray()

        val namesById = linkedMapOf<String, String>()
        val slotUrlsById = mutableMapOf<String, Map<String, String>>()
        for (element in tags) {
            val obj = element.asJsonObject
            val id = obj.get("id")?.asString?.trim().orEmpty()
            val name = obj.get("name")?.asString?.trim().orEmpty()
            if (id.isBlank() || name.isBlank()) continue
            namesById[id] = name
            slotUrlsById[id] = parseProjectSlotUrls(obj.get("slot_urls"))
        }
        if (namesById.isEmpty()) return emptyList()

        val parentIdsByChild = mutableMapOf<String, MutableSet<String>>()
        for (element in tagParents) {
            val obj = element.asJsonObject
            val childId = (
                obj.get("tag_id")?.asString
                    ?: obj.get("tagId")?.asString
                )?.trim().orEmpty()
            if (childId.isBlank() || !namesById.containsKey(childId)) continue

            val parentId = (
                obj.get("parent_id")?.asString
                    ?: obj.get("parentId")?.asString
                )?.trim().orEmpty()

            if (parentId.isBlank() || !namesById.containsKey(parentId) || parentId == childId) continue
            parentIdsByChild.getOrPut(childId) { linkedSetOf() }.add(parentId)
        }

        for (id in namesById.keys) {
            parentIdsByChild.putIfAbsent(id, linkedSetOf())
        }

        val childrenByParent = mutableMapOf<String?, MutableList<String>>()
        for ((childId, parentIds) in parentIdsByChild) {
            if (parentIds.isEmpty()) {
                childrenByParent.getOrPut(null) { mutableListOf() }.add(childId)
                continue
            }
            for (parentId in parentIds) {
                childrenByParent.getOrPut(parentId) { mutableListOf() }.add(childId)
            }
        }
        for (childIds in childrenByParent.values) {
            val sortedDistinct = childIds
                .distinct()
                .sortedBy { id -> namesById[id]?.lowercase().orEmpty() }
            childIds.clear()
            childIds.addAll(sortedDistinct)
        }

        fun buildNode(
            nodeId: String,
            path: Set<String>,
            ancestorSlotUrls: Map<String, String>,
            pathKey: String,
        ): ProjectTreeNode {
            val nextPath = path + nodeId
            val inheritedSlotUrls = ancestorSlotUrls + slotUrlsById[nodeId].orEmpty()
            val childNodes = (childrenByParent[nodeId] ?: emptyList())
                .filter { childId -> !nextPath.contains(childId) }
                .map { childId -> buildNode(childId, nextPath, inheritedSlotUrls, "$pathKey>$childId") }
            return ProjectTreeNode(
                id = nodeId,
                pathKey = pathKey,
                name = namesById[nodeId].orEmpty(),
                slotUrls = inheritedSlotUrls,
                children = childNodes,
            )
        }

        val rootIds = (childrenByParent[null] ?: emptyList()).toMutableList()
        if (rootIds.isEmpty()) {
            rootIds.addAll(namesById.keys.sortedBy { id -> namesById[id]?.lowercase().orEmpty() })
        }

        return rootIds
            .distinct()
            .map { rootId -> buildNode(rootId, emptySet(), emptyMap(), rootId) }
    }

    private fun fetchJsonArray(
        endpointUrl: String,
        apiKey: String,
        allow404: Boolean = false,
        shouldSetError: Boolean = false,
    ): JsonArray? {
        // Gate: signed out = no remote reads (local-only mode).
        val authBearer = AuthStore.gateBearer(AuthStore.accessToken(applicationContext)) ?: return null
        val url = java.net.URL(endpointUrl)
        val connection = url.openConnection() as java.net.HttpURLConnection
        connection.requestMethod = "GET"
        connection.setRequestProperty("apikey", apiKey)
        connection.setRequestProperty("Authorization", "Bearer $authBearer")
        connection.setRequestProperty("Accept", "application/json")
        connection.connectTimeout = 5000
        connection.readTimeout = 5000

        val statusCode = connection.responseCode
        if (statusCode !in 200..299) {
            if (allow404 && statusCode == 404) {
                connection.disconnect()
                return JsonArray()
            }
            val error = connection.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
            Log.w(TAG, "Project API error: $statusCode url=$endpointUrl err=${error.take(200)}")
            connection.disconnect()
            if (shouldSetError) {
                if (statusCode == 401) {
                    lastProjectFetchError = "Invalid Dream Tracker API key"
                } else if (lastProjectFetchError.isNullOrBlank()) {
                    lastProjectFetchError = "Project API error: HTTP $statusCode"
                }
            }
            return null
        }

        val response = connection.inputStream.bufferedReader().readText()
        connection.disconnect()
        return Gson().fromJson(response, JsonArray::class.java)
    }

    private fun normalizeRestEndpoint(baseInput: String): String {
        val base = baseInput.trim().trimEnd('/')
        val rpcMarker = "/rest/v1/rpc"
        val restMarker = "/rest/v1"
        return when {
            base.endsWith(rpcMarker) -> base.removeSuffix("/rpc")
            base.contains("$rpcMarker/") -> base.substringBefore("$rpcMarker/") + restMarker
            base.endsWith(restMarker) -> base
            base.contains("$restMarker/") -> base.substringBefore("$restMarker/") + restMarker
            else -> "$base$restMarker"
        }
    }

    private fun normalizeSupabaseApiKey(value: String): String {
        val trimmed = value.trim()
        if (trimmed.startsWith("Bearer ", ignoreCase = true)) {
            return trimmed.substringAfter("Bearer ").trim()
        }
        return trimmed
    }

    private fun updateProjectSelectorAppearance() {
        val color = if (activeProjectId != null || isProjectPanelVisible) {
            ContextCompat.getColor(this, R.color.action_primary)
        } else {
            ContextCompat.getColor(this, R.color.text_secondary)
        }
        binding.projectChevron.imageTintList = android.content.res.ColorStateList.valueOf(color)
        binding.projectChevron.animate()
            .rotation(if (isProjectPanelVisible) 90f else 0f)
            .setDuration(160)
            .start()
        updateContextChips()
    }

    fun setActiveProject(projectId: String?) {
        val normalizedProjectId = projectId?.trim()?.takeIf { it.isNotBlank() }
        val node = normalizedProjectId?.let { findProjectNode(projectTreeNodes, it, null) }
        setActiveProject(node ?: normalizedProjectId?.let {
            ProjectTreeNode(id = it, pathKey = it, name = it, children = emptyList())
        })
    }

    private fun setActiveProject(projectNode: ProjectTreeNode?) {
        val normalizedProjectId = projectNode?.id?.trim()?.takeIf { it.isNotBlank() }
        val normalizedPathKey = projectNode?.pathKey?.trim()?.takeIf { it.isNotBlank() } ?: normalizedProjectId
        if (activeProjectId == normalizedProjectId && activeProjectPathKey == normalizedPathKey) return

        activeProjectId = normalizedProjectId
        activeProjectPathKey = normalizedPathKey
        SettingsManager.clearParallelIngestState(this)
        updateProjectSelectorAppearance()
        updateSessionIndicator()

        val loadGen = ++projectSlotUrlLoadGeneration
        if (normalizedProjectId.isNullOrBlank()) {
            activeProjectPathKey = null
            activeProjectSlotUrls = emptyMap()
            stageSessionUrlsForLoading(emptyMap())
            scheduleSlotLoading(forceReload = true)
            Toast.makeText(this, "Project cleared; session reset", Toast.LENGTH_SHORT).show()
            return
        }

        thread {
            val serviceUrls = if (projectNode.slotUrls.isNotEmpty()) {
                projectNode.slotUrls
            } else {
                loadProjectSlotUrlsByService(normalizedProjectId)
            }
            if (projectSlotUrlLoadGeneration != loadGen || activeProjectId != normalizedProjectId || activeProjectPathKey != normalizedPathKey) {
                return@thread
            }
            activeProjectSlotUrls = serviceUrls

            val slotOverrides = mutableMapOf<String, String>()
            for (slotIndex in 0 until SlotManager.NUM_SLOTS) {
                val serviceId = slotManager.getServiceId(slotIndex)
                val url = buildProjectUrlLookupKeys(slotIndex, serviceId)
                    .asSequence()
                    .mapNotNull { key -> serviceUrls[key]?.trim() }
                    .firstOrNull { it.isNotBlank() }
                    .orEmpty()
                if (url.isNotBlank()) {
                    slotOverrides["slot-${slotIndex + 1}"] = url
                }
            }

            runOnUiThread {
                if (projectSlotUrlLoadGeneration != loadGen || activeProjectId != normalizedProjectId || activeProjectPathKey != normalizedPathKey) {
                    return@runOnUiThread
                }
                stageSessionUrlsForLoading(slotOverrides)
                scheduleSlotLoading(forceReload = true)
                Toast.makeText(this, "Project changed; session reset", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun loadProjectSlotUrlsByService(projectId: String): Map<String, String> {
        return try {
            val rpcUrl = SettingsManager.getDreamTrackerRpcUrl(this)
            val apiKey = normalizeSupabaseApiKey(SettingsManager.getDreamTrackerApiKey(this))
            if (rpcUrl.isBlank() || apiKey.isBlank()) return emptyMap()
            // Gate: signed out = no remote reads (local-only mode).
            val authBearer = AuthStore.gateBearer(AuthStore.accessToken(applicationContext)) ?: return emptyMap()

            val restBaseUrl = normalizeRestEndpoint(rpcUrl)
            val encodedProjectId = URLEncoder.encode(projectId, "UTF-8")
            val endpoint = "$restBaseUrl/tags?select=id,slot_urls&id=eq.$encodedProjectId&limit=1"
            val connection = (java.net.URL(endpoint).openConnection() as java.net.HttpURLConnection).apply {
                requestMethod = "GET"
                setRequestProperty("apikey", apiKey)
                setRequestProperty("Authorization", "Bearer $authBearer")
                setRequestProperty("Accept", "application/json")
                connectTimeout = 6000
                readTimeout = 6000
            }

            val code = connection.responseCode
            if (code !in 200..299) {
                val err = connection.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                Log.w(TAG, "Project slot_urls API error: $code id=$projectId err=${err.take(200)}")
                connection.disconnect()
                return emptyMap()
            }

            val body = connection.inputStream.bufferedReader().use { it.readText() }
            connection.disconnect()
            val arr = Gson().fromJson(body, JsonArray::class.java) ?: return emptyMap()
            val row = arr.firstOrNull()?.asJsonObject ?: return emptyMap()
            val slotObj = row.getAsJsonObject("slot_urls") ?: return emptyMap()

            val result = mutableMapOf<String, String>()
            for ((key, value) in slotObj.entrySet()) {
                val url = parseProjectSlotUrl(value)
                if (url.isNotBlank()) {
                    val normalizedKey = key.trim()
                    result[normalizedKey] = url
                    result[normalizedKey.lowercase()] = url
                }
            }
            result
        } catch (e: Exception) {
            Log.w(TAG, "Failed to load project slot_urls id=$projectId: ${e.message}")
            emptyMap()
        }
    }

    private fun parseProjectSlotUrls(slotElement: JsonElement?): Map<String, String> {
        if (slotElement == null || slotElement.isJsonNull || !slotElement.isJsonObject) return emptyMap()
        val result = mutableMapOf<String, String>()
        for ((key, value) in slotElement.asJsonObject.entrySet()) {
            val url = parseProjectSlotUrl(value)
            if (url.isNotBlank()) {
                val normalizedKey = key.trim()
                result[normalizedKey] = url
                result[normalizedKey.lowercase()] = url
            }
        }
        return result
    }

    private fun parseProjectSlotUrl(value: JsonElement?): String {
        if (value == null || value.isJsonNull) return ""
        if (value.isJsonPrimitive) return value.asString.trim()
        if (value.isJsonObject) {
            val obj = value.asJsonObject
            val direct = obj.get("url")?.takeIf { it.isJsonPrimitive }?.asString?.trim().orEmpty()
            if (direct.isNotBlank()) return direct
            val valueField = obj.get("value")?.takeIf { it.isJsonPrimitive }?.asString?.trim().orEmpty()
            if (valueField.isNotBlank()) return valueField
        }
        return ""
    }

    private fun buildProjectUrlLookupKeys(slotIndex: Int, serviceId: String): List<String> {
        val normalizedServiceId = serviceId.trim().lowercase()
        val slotKey = "slot-${slotIndex + 1}"
        return listOf(
            slotKey,
            normalizedServiceId,
        ).distinct()
    }

    private fun resolveActiveProjectUrlForSlot(slotIndex: Int, serviceId: String): String {
        if (activeProjectId.isNullOrBlank()) return ""
        val projectUrls = activeProjectSlotUrls
        if (projectUrls.isEmpty()) return ""
        return buildProjectUrlLookupKeys(slotIndex, serviceId)
            .asSequence()
            .mapNotNull { key -> projectUrls[key]?.trim() }
            .firstOrNull { it.isNotBlank() }
            .orEmpty()
    }

    private fun updateMergeTabAppearance(tab: TabLayout.Tab?, isSelected: Boolean) {
        if (tab == null) return
        val textView = findTextViewInTab(tab.view) ?: return
        if (isSelected) {
            // Soft highlight without neon shadow layer
            textView.setTextColor(ContextCompat.getColor(this, R.color.tab_selected_text))
            textView.setShadowLayer(0f, 0f, 0f, Color.TRANSPARENT)
        } else {
            // Normal unselected text color
            textView.setTextColor(ContextCompat.getColor(this, R.color.text_secondary))
            textView.setShadowLayer(0f, 0f, 0f, Color.TRANSPARENT)
        }
    }

    private fun setupTabLongClicks() {
        for (i in 0 until binding.tabLayout.tabCount) {
            binding.tabLayout.getTabAt(i)?.view?.setOnLongClickListener { view ->
                if (i == MERGE_TAB_INDEX) {
                    showMergeTabMenu(view)
                    return@setOnLongClickListener true
                }
                if (i >= SlotManager.NUM_SLOTS) return@setOnLongClickListener false
                showTabContextMenu(view, i)
                true
            }
        }
    }

    private fun showMergeTabMenu(anchor: View) {
        val popup = android.widget.PopupMenu(this, anchor)
        popup.menuInflater.inflate(R.menu.merge_tab_menu, popup.menu)
        val mergeFragment = findMergeFragment()
        val isVisible = mergeFragment?.isConfigEditorVisible() == true
        popup.menu.findItem(R.id.action_toggle_merge_provider)?.title = getString(
            if (isVisible) R.string.merge_hide_provider_model else R.string.merge_edit_provider_model
        )
        popup.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                R.id.action_edit_merge_instructions -> {
                    showMergeInstructionsDialog()
                    true
                }
                R.id.action_edit_clarification_instructions -> {
                    showClarificationInstructionsDialog()
                    true
                }
                R.id.action_toggle_merge_provider -> {
                    val fragment = findMergeFragment()
                    if (fragment?.isConfigEditorVisible() == true) {
                        fragment.hideConfigEditor()
                        Toast.makeText(this, R.string.merge_editor_hidden, Toast.LENGTH_SHORT).show()
                    } else {
                        fragment?.revealConfigEditor()
                        Toast.makeText(this, R.string.merge_editor_shown, Toast.LENGTH_SHORT).show()
                    }
                    true
                }
                else -> false
            }
        }
        popup.show()
    }

    private fun showMergeInstructionsDialog() {
        val current = SettingsManager.getMergeInstructions(this)
        val defaults = SettingsManager.getDefaultMergeInstructions()

        val input = EditText(this).apply {
            setText(current)
            minLines = 8
            maxLines = 16
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            setHorizontallyScrolling(false)
        }
        val restoreDefaults = CheckBox(this).apply {
            text = getString(R.string.merge_restore_defaults)
        }
        var draftedText = current
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val padding = dp(16)
            setPadding(padding, padding, padding, padding)
            addView(
                input,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
            )
            addView(
                restoreDefaults,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = dp(10) }
            )
        }

        restoreDefaults.setOnCheckedChangeListener { _, checked ->
            if (checked) {
                draftedText = input.text?.toString().orEmpty()
                input.setText(defaults)
                input.isEnabled = false
            } else {
                input.isEnabled = true
                input.setText(draftedText)
                input.setSelection(input.text?.length ?: 0)
            }
        }

        val dialog = AlertDialog.Builder(this, R.style.ServiceDialogTheme)
            .setTitle(R.string.merge_instructions_title)
            .setView(container)
            .setPositiveButton(R.string.merge_set_button, null)
            .setNegativeButton(android.R.string.cancel, null)
            .create()

        dialog.setOnShowListener {
            val positive = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
            positive?.setTextColor(ContextCompat.getColor(this, android.R.color.white))
            positive?.backgroundTintList =
                ColorStateList.valueOf(ContextCompat.getColor(this, R.color.action_set))
            positive?.setOnClickListener {
                if (restoreDefaults.isChecked) {
                    SettingsManager.resetMergeInstructions(this)
                    Toast.makeText(this, R.string.merge_instructions_restored, Toast.LENGTH_SHORT).show()
                    dialog.dismiss()
                    return@setOnClickListener
                }

                val updated = input.text?.toString()?.trim().orEmpty()
                if (updated.isBlank()) {
                    Toast.makeText(this, R.string.merge_instructions_empty_error, Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                SettingsManager.setMergeInstructions(this, updated)
                Toast.makeText(this, R.string.merge_instructions_saved, Toast.LENGTH_SHORT).show()
                dialog.dismiss()
            }
        }

        dialog.show()
    }

    private fun showClarificationInstructionsDialog() {
        val current = SettingsManager.getClarificationInstructions(this)
        val defaults = MergeApiClient.defaultClarificationInstructions()

        val input = EditText(this).apply {
            setText(current.ifBlank { defaults })
            minLines = 5
            maxLines = 12
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            setHorizontallyScrolling(false)
        }
        val restoreDefaults = CheckBox(this).apply {
            text = getString(R.string.merge_restore_defaults)
        }
        var draftedText = current
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val padding = dp(16)
            setPadding(padding, padding, padding, padding)
            addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            addView(restoreDefaults, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .apply { topMargin = dp(10) })
        }

        restoreDefaults.setOnCheckedChangeListener { _, checked ->
            if (checked) {
                draftedText = input.text?.toString().orEmpty()
                input.setText(defaults)
                input.isEnabled = false
            } else {
                input.isEnabled = true
                input.setText(draftedText)
                input.setSelection(input.text?.length ?: 0)
            }
        }

        val dialog = AlertDialog.Builder(this, R.style.ServiceDialogTheme)
            .setTitle(R.string.clarification_instructions_title)
            .setView(container)
            .setPositiveButton(R.string.merge_set_button, null)
            .setNegativeButton(android.R.string.cancel, null)
            .create()

        dialog.setOnShowListener {
            val positive = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
            positive?.setTextColor(ContextCompat.getColor(this, android.R.color.white))
            positive?.backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this, R.color.action_set))
            positive?.setOnClickListener {
                if (restoreDefaults.isChecked) {
                    SettingsManager.setClarificationInstructions(this, "")
                    Toast.makeText(this, R.string.clarification_instructions_restored, Toast.LENGTH_SHORT).show()
                    dialog.dismiss()
                    return@setOnClickListener
                }
                val updated = input.text?.toString()?.trim().orEmpty()
                SettingsManager.setClarificationInstructions(this, updated)
                Toast.makeText(this, R.string.clarification_instructions_saved, Toast.LENGTH_SHORT).show()
                dialog.dismiss()
            }
        }
        dialog.show()
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    private fun showTabContextMenu(anchor: View, slotIndex: Int) {
        val popup = android.widget.PopupMenu(this, anchor)
        popup.menuInflater.inflate(R.menu.tab_context_menu, popup.menu)
        popup.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                R.id.action_change_service -> {
                    showServicePicker(slotIndex)
                    true
                }
                R.id.action_reload -> {
                    getFragment(slotIndex)?.reload()
                    true
                }
                R.id.action_hard_reload -> {
                    getFragment(slotIndex)?.hardReload()
                    true
                }
                R.id.action_import_cookies -> {
                    openCookieFilePicker()
                    true
                }
                else -> false
            }
        }
        popup.show()
    }

    private fun showServicePicker(slotIndex: Int) {
        val serviceIds = ServiceConfig.SERVICE_IDS + "custom"
        val serviceNames = ServiceConfig.SERVICE_NAMES + getString(R.string.custom_url)
        val currentId = slotManager.getServiceId(slotIndex)
        val currentIndex = serviceIds.indexOf(currentId).coerceAtLeast(0)

        AlertDialog.Builder(this, R.style.ServiceDialogTheme)
            .setTitle(getString(R.string.select_service))
            .setSingleChoiceItems(serviceNames.toTypedArray(), currentIndex) { dialog, which ->
                dialog.dismiss()
                val selectedId = serviceIds[which]

                if (selectedId == "custom") {
                    showCustomUrlDialog(slotIndex)
                } else {
                    changeSlotService(slotIndex, selectedId)
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun showCustomUrlDialog(slotIndex: Int) {
        val currentEffectiveUrl = resolveCurrentSlotUrl(slotIndex)
        val initialUrl = slotManager.getCustomUrl(slotIndex).ifBlank { currentEffectiveUrl }

        val input = EditText(this).apply {
            hint = getString(R.string.enter_url)
            setText(initialUrl)
            setSingleLine()
        }

        AlertDialog.Builder(this, R.style.ServiceDialogTheme)
            .setTitle(getString(R.string.custom_url))
            .setView(input)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                val url = input.text.toString().trim()
                if (url.isNotEmpty()) {
                    slotManager.setServiceId(slotIndex, "custom")
                    slotManager.setCustomUrl(slotIndex, url)
                    updateTabLabel(slotIndex, "Custom")
                    updateCheckboxLabel(slotIndex, "Custom")
                    getFragment(slotIndex)?.loadCustomUrl(url)
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun resolveCurrentSlotUrl(slotIndex: Int): String {
        if (slotIndex !in 0 until SlotManager.NUM_SLOTS) return ""

        val liveUrl = getFragment(slotIndex)?.webView?.url?.trim().orEmpty()
        if (liveUrl.startsWith("http://") || liveUrl.startsWith("https://")) {
            return liveUrl
        }

        val pendingUrl = synchronized(pendingSessionUrls) { pendingSessionUrls[slotIndex] }
            ?.trim()
            .orEmpty()
        if (pendingUrl.startsWith("http://") || pendingUrl.startsWith("https://")) {
            return pendingUrl
        }
        if (pendingUrl.isNotBlank()) {
            return "https://$pendingUrl"
        }

        val serviceId = slotManager.getServiceId(slotIndex)
        return when (serviceId) {
            "custom" -> slotManager.getCustomUrl(slotIndex).trim()
            else -> slotManager.getService(slotIndex).url.trim()
        }
    }

    private fun changeSlotService(slotIndex: Int, serviceId: String) {
        slotManager.setServiceId(slotIndex, serviceId)
        val service = ServiceConfig.getById(serviceId) ?: return

        updateTabLabel(slotIndex, service.name)
        updateCheckboxLabel(slotIndex, service.name)

        val projectUrlOverride = resolveActiveProjectUrlForSlot(slotIndex, serviceId)
        if (projectUrlOverride.isNotBlank()) {
            synchronized(pendingSessionUrls) {
                pendingSessionUrls[slotIndex] = projectUrlOverride
            }
            binding.viewPager.post {
                loadSlotWithSessionOverride(slotIndex, Handler(Looper.getMainLooper()))
            }
            Log.i(TAG, "[SESSION] slot=$slotIndex service=$serviceId -> project url override")
        } else {
            getFragment(slotIndex)?.loadService(serviceId)
        }

        Log.d(TAG, "Slot $slotIndex changed to ${service.name}")
    }

    fun onServiceDetected(slotIndex: Int, serviceId: String) {
        runOnUiThread {
            val service = ServiceConfig.getById(serviceId) ?: return@runOnUiThread
            slotManager.setServiceId(slotIndex, serviceId)
            updateTabLabel(slotIndex, service.name)
            updateCheckboxLabel(slotIndex, service.name)
        }
    }

    private fun updateTabLabel(slotIndex: Int, name: String) {
        binding.tabLayout.getTabAt(slotIndex)?.text = name
    }

    private fun updateCheckboxLabel(slotIndex: Int, name: String) {
        if (slotIndex < checkboxes.size) {
            checkboxes[slotIndex].text = ""
            checkboxes[slotIndex].contentDescription = name
        }
    }

    private fun sendToAll() {
        val now = System.currentTimeMillis()
        if (now - lastSendAtMs < SEND_DEBOUNCE_MS) return
        lastSendAtMs = now

        val text = binding.messageInput.text.toString().trim()
        if (text.isEmpty()) return
        if (pendingAggregationPrompt?.trim() == text && pendingAggregationExpectedSlots > 0 && !autoAggregationPaused) {
            Toast.makeText(this, "Previous send is still aggregating", Toast.LENGTH_SHORT).show()
            return
        }

        if (isCheat(text, CHEAT_DEBUG_SHA256)) {
            val next = !SettingsManager.isUnstableFeaturesEnabled(this)
            SettingsManager.setUnstableFeaturesEnabled(this, next)
            applyUnstableFeatureVisibility()
            binding.messageInput.text.clear()
            Toast.makeText(this, if (next) R.string.debug_mode_enabled else R.string.debug_mode_disabled, Toast.LENGTH_SHORT).show()
            return
        }

        // For testing: disable subscription requirement - allow all users to access merge
        val hasAccess = true  // billingManager.isSubscribed || SettingsManager.isLifetimeUnlocked(this)
        /*
        if (!hasAccess) {
            if (isCheat(text, CHEAT_UNLOCK_SHA256)) {
                SettingsManager.setLifetimeUnlocked(this, true)
                binding.messageInput.text.clear()
                Toast.makeText(this, R.string.cheat_unlocked, Toast.LENGTH_SHORT).show()
                return
            }
            Toast.makeText(this, R.string.subscription_required, Toast.LENGTH_SHORT).show()
            billingManager.launchSubscriptionPurchase(this)
            return
        }
        */

        val enabledSlots = (0 until SlotManager.NUM_SLOTS).filter { slotManager.isSlotEnabled(it) }
        if (enabledSlots.isEmpty()) {
            Toast.makeText(this, R.string.no_slots_enabled, Toast.LENGTH_SHORT).show()
            return
        }

        val hadCurrentQuestionContext =
            getCurrentQuestionSessionId() != null && getCurrentQuestionAggregatedNoteId() != null
        val contextMatchesCurrentSlots = hasCurrentQuestionContextForCurrentSlots()
        val loadedQuestionPrompt = SettingsManager.getParallelIngestSourcePrompt(this).trim()
        val sameQuestionAsLoaded = promptsReferToSameQuestion(text, loadedQuestionPrompt)

        SettingsManager.setLastUserPrompt(this, text)
        // The question-context reset (clearing the parallel-ingest session id so a
        // new question starts a new note) only applies to the signed-in ingest
        // path. Offline there are no notes, so this would fire on every send
        // (hadCurrentQuestionContext is always false), wiping the local session id
        // and making saveLocalSession allocate a fresh S9000xx each time. Keep the
        // local session stable across consecutive offline questions (one session
        // per layout, matching desktop); the user starts a new one via the
        // sessions UI / clear-active action.
        if (AuthStore.status(this).signedIn) {
            when {
                !hadCurrentQuestionContext || !contextMatchesCurrentSlots -> {
                    SettingsManager.clearParallelIngestState(this)
                    SettingsManager.setParallelIngestSourcePrompt(this, text)
                }
                !sameQuestionAsLoaded -> {
                    SettingsManager.clearParallelIngestActiveNoteId(this)
                    SettingsManager.setParallelIngestSourcePrompt(this, text)
                }
                else -> {
                    SettingsManager.setParallelIngestSourcePrompt(this, text)
                }
            }
        } else {
            SettingsManager.setParallelIngestSourcePrompt(this, text)
        }
        if (SettingsManager.isDetailedLoggingEnabled(this)) {
            val bytes = text.toByteArray(Charsets.UTF_8)
            val hexString = bytes.joinToString(separator = " ") { byte -> "%02x".format(byte) }
            Log.d(TAG, "sendToAll: text saved as UTF-8 bytes: $hexString")
        }

        binding.messageInput.text.clear()

        val imm = getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
        imm.hideSoftInputFromWindow(binding.messageInput.windowToken, 0)

        var remaining = enabledSlots.size
        var anySuccess = false

        enabledSlots.forEachIndexed { index, slotIndex ->
            binding.viewPager.postDelayed({
                val fragment = getFragment(slotIndex)
                if (fragment == null) {
                    remaining--
                    if (remaining <= 0) {
                        val msg = if (anySuccess) R.string.sent else R.string.send_failed
                        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
                        if (anySuccess) {
                            startParallelAggregatedIngest(text, enabledSlots.size)
                        }
                    }
                    return@postDelayed
                }

                fragment.sendMessage(text) { success ->
                    runOnUiThread {
                        if (success) anySuccess = true
                        remaining--
                        if (remaining <= 0) {
                            val msg = if (anySuccess) R.string.sent else R.string.send_failed
                            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
                            if (anySuccess) {
                                startParallelAggregatedIngest(text, enabledSlots.size)
                            }
                        }
                    }
                }
            }, index * SEND_STAGGER_MS)
        }

        // Nudge Merge tab with shimmer after 3s
        if (SettingsManager.isMergeEnabled(this)) {
            Handler(Looper.getMainLooper()).postDelayed({ nudgeMergeTab() }, 3000)
        }
    }

    /** Local-only session save: persists the current slot layout (config/URLs/
     *  enabled + name + a local session number) on-device. No backend call.
     *  Reuses the current local session number when continuing the same context,
     *  else allocates a new one. Mirrors the iOS `saveLocalSession`. */
    private fun saveLocalSession(prompt: String) {
        // Only reuse a session id that is itself local (>= 900000). A leftover
        // real backend id (e.g. from a prior signed-in session) must NOT be
        // reused — that would collide with a real DB session and hide the row
        // from late-login migration. Allocate a fresh local number instead.
        val existing = SettingsManager.getParallelIngestSessionId(this)
        val localId = if (existing != null && existing >= 900_000) {
            existing
        } else {
            sessionManager.nextLocalSessionNumber().also {
                SettingsManager.setParallelIngestSessionId(this, it)
            }
        }
        val slotUrls = collectCurrentSlotUrls()
        sessionManager.saveCurrentSession(
            name = prompt.take(500).ifBlank { "Session" },
            dreamSessionId = localId,
            slotUrls = slotUrls,
            noteId = null,
            projectTagId = activeProjectId
        )
        updateSessionIndicator()
        Toast.makeText(this, "Saved locally (S$localId)", Toast.LENGTH_SHORT).show()
    }

    private fun startParallelAggregatedIngest(prompt: String, expectedSlots: Int) {
        val rpcUrl = SettingsManager.getDreamTrackerRpcUrl(this)
        val apiKey = SettingsManager.getDreamTrackerApiKey(this)
        val detailed = SettingsManager.isDetailedLoggingEnabled(this)
        if (rpcUrl.isBlank() || apiKey.isBlank()) {
            if (detailed) Log.d(TAG, "parallel ingest skipped: missing rpc url/api key")
            return
        }
        if (expectedSlots <= 0) return
        // Local-only gate: signed out → save the slot layout locally and skip
        // the backend ingest entirely (no anonymous writes). status() is a
        // local check (no network), safe on the UI thread.
        if (!AuthStore.status(applicationContext).signedIn) {
            saveLocalSession(prompt)
            return
        }
        pendingAggregationPrompt = prompt
        pendingAggregationExpectedSlots = expectedSlots
        autoAggregationPaused = false

        ingestPollGeneration += 1
        val generation = ingestPollGeneration
        val handler = Handler(Looper.getMainLooper())
        val maxAttempts = 20
        val intervalMs = 3000L
        val enabledSlotIndices = (0 until SlotManager.NUM_SLOTS).filter { slotManager.isSlotEnabled(it) }

        fun poll(attempt: Int, bestResponses: Map<String, String>) {
            if (generation != ingestPollGeneration) return
            if (autoAggregationPaused) {
                if (detailed) Log.d(TAG, "parallel ingest poll paused generation=$generation")
                return
            }
            collectLatestRepliesFromEnabledSlots(prompt) { responses ->
                if (generation != ingestPollGeneration) return@collectLatestRepliesFromEnabledSlots
                if (autoAggregationPaused) return@collectLatestRepliesFromEnabledSlots

                val currentBest =
                    if (responses.size >= bestResponses.size) responses else bestResponses
                val completed = currentBest.size >= expectedSlots || attempt >= maxAttempts

                if (detailed) {
                    Log.d(
                        TAG,
                        "parallel ingest poll attempt=$attempt collected=${currentBest.size}/$expectedSlots completed=$completed"
                    )
                }

                if (!completed) {
                    handler.postDelayed({ poll(attempt + 1, currentBest) }, intervalMs)
                    return@collectLatestRepliesFromEnabledSlots
                }

                if (currentBest.isEmpty()) {
                    if (detailed) Log.d(TAG, "parallel ingest done: no responses collected")
                    clearPendingAutoAggregation()
                    return@collectLatestRepliesFromEnabledSlots
                }

                if (currentBest.size < expectedSlots) {
                    if (detailed) {
                        val enabledServices = enabledSlotIndices.map { slotManager.getService(it).name }
                        val missing = enabledServices.filterNot { currentBest.containsKey(it) }
                        Log.w(
                            TAG,
                            "parallel ingest aborted: collected=${currentBest.size}/$expectedSlots missing=${missing.joinToString()}"
                        )
                    }
                    clearPendingAutoAggregation()
                    return@collectLatestRepliesFromEnabledSlots
                }

                thread {
                    ingestCollectedResponses(prompt, currentBest)
                    clearPendingAutoAggregation()
                }
            }
        }

        fun waitForGeneration(attempt: Int, onDone: () -> Unit) {
            if (generation != ingestPollGeneration) return
            if (autoAggregationPaused) {
                if (detailed) Log.d(TAG, "waitForGeneration paused generation=$generation")
                return
            }
            if (attempt > 30) {
                onDone()
                return
            }

            val fragments = enabledSlotIndices.mapNotNull { getFragment(it) }
            var remaining = fragments.size
            if (remaining == 0) {
                onDone()
                return
            }

            var anyGenerating = false
            fragments.forEach { fragment ->
                fragment.isStillGenerating { generating ->
                    if (generation != ingestPollGeneration) return@isStillGenerating
                    if (generating) anyGenerating = true
                    remaining--
                    if (remaining <= 0) {
                        if (anyGenerating) {
                            if (detailed) {
                                Log.d(TAG, "waitForGeneration attempt=$attempt status=generating")
                            }
                            handler.postDelayed({ waitForGeneration(attempt + 1, onDone) }, 3000L)
                        } else {
                            handler.postDelayed(onDone, 3000L)
                        }
                    }
                }
            }
        }

        waitForGeneration(0) { poll(1, emptyMap()) }
    }

    private fun getCurrentQuestionAggregatedNoteId(): String? {
        val direct = SettingsManager.getParallelIngestActiveNoteId(this).trim().ifBlank { null }
        if (!direct.isNullOrBlank()) return direct
        return restoreStoredQuestionContextForCurrentSlots()?.noteId?.takeIf { it.isNotBlank() }
    }

    private fun getCurrentQuestionSessionId(): Int? {
        val activeRootId = getCurrentQuestionAggregatedNoteId() ?: return null
        val sessionId = SettingsManager.getParallelIngestSessionId(this)
        if (activeRootId.isNotBlank() && sessionId != null) return sessionId
        val restored = restoreStoredQuestionContextForCurrentSlots()
        return if (activeRootId.isNotBlank()) restored?.sessionId else null
    }

    private fun rememberResolvedSourcePrompt(prompt: String): String {
        val normalized = prompt.trim()
        if (normalized.isBlank()) return ""
        // Canonical question-identity semantics live in
        // Verity/docs/domains/SESSION_AND_INGEST_RULES.md.
        // Keep Android aligned with iOS there instead of drifting here.
        SettingsManager.setParallelIngestSourcePrompt(this, normalized)
        return normalized
    }

    // ingest-parity: STRIP_PROMPT_REPLY_WRAPPER
    // Removes mobile DOM "You said .. <Provider> responded/said .." wrapper from a
    // raw prompt candidate so the response body cannot bleed into an aggregated
    // note title. Mirrors iOS's normalizeCollectedPromptCandidate (kept in sync
    // via tools/ingest-parity-check.sh).
    private fun normalizeCollectedPromptCandidate(value: String): String {
        return value
            .replace(
                Regex(
                    "^\\s*(?:you said|you asked|user(?: asked| said)?|вы сказали|ты спросил[аи]?|ты сказал[аи]?)\\s*[:\\-]?\\s*",
                    RegexOption.IGNORE_CASE
                ),
                ""
            )
            .replace(
                Regex(
                    "\\s*##\\s*(?:chatgpt|gemini|claude|grok|perplexity)\\s+(?:said|responded|replied|answered)\\b[\\s\\S]*$",
                    RegexOption.IGNORE_CASE
                ),
                ""
            )
            .replace(
                Regex(
                    "\\s*(?:\\([^)]{0,60}\\)\\s*)?(?:\\d{1,2}:\\d{2}(?:\\s*[AP]M)?\\s*)?(?:\\d+\\s*/\\s*\\d+\\s*)?(?:chatgpt|gemini|claude|grok|perplexity)\\s+(?:said|responded|replied|answered|ответил[аи]?|написал[аи]?)\\b[\\s\\S]*$",
                    RegexOption.IGNORE_CASE
                ),
                ""
            )
            .replace(Regex("^[#>*\\s\"'`]+"), "")
            .replace(Regex("[\\s\"'`]+$"), "")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    private fun normalizePromptForComparison(value: String): String {
        return value.lowercase(Locale.ROOT)
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    private fun promptsReferToSameQuestion(currentPrompt: String, storedPrompt: String): Boolean {
        val current = normalizePromptForComparison(currentPrompt)
        val stored = normalizePromptForComparison(storedPrompt)
        return current.isNotBlank() && stored.isNotBlank() && current == stored
    }

    private fun resolveSourcePromptFromCollectedScrape(
        scrapeMeta: List<Map<String, Any?>>,
        allowDirectFallback: Boolean = true,
        persist: Boolean = true
    ): String {
        // This recovery order is product semantics, not Android-only glue.
        // Update the meta-doc first: Verity/docs/domains/SESSION_AND_INGEST_RULES.md.
        val direct = if (allowDirectFallback) {
            SettingsManager.getParallelIngestSourcePrompt(this).trim()
        } else {
            ""
        }
        if (direct.isNotBlank()) return direct

        data class PromptEntry(
            val prompt: String,
            val score: Double,
            val bottom: Double
        )

        data class AggregatedPromptEntry(
            val prompt: String,
            var score: Double,
            var count: Int,
            var maxBottom: Double
        )

        val promptEntries = scrapeMeta.mapNotNull { item ->
            val diagnostics = item["dom_diagnostics"] as? Map<*, *> ?: return@mapNotNull null
            val promptCandidate = diagnostics["prompt_candidate"] as? Map<*, *> ?: return@mapNotNull null
            val rawPrompt = promptCandidate["text"]?.toString().orEmpty().trim()
            val prompt = normalizeCollectedPromptCandidate(rawPrompt)
            if (prompt.isBlank()) return@mapNotNull null

            val preview = ((diagnostics["selected"] as? Map<*, *>)?.get("preview")?.toString().orEmpty())
            val normalizedPreview = preview.replace(Regex("\\s+"), " ").trim().lowercase(Locale.ROOT)
            val normalizedPrompt = prompt.lowercase(Locale.ROOT)
            var score = 100.0
            if (normalizedPreview.isNotBlank() && normalizedPreview.contains(normalizedPrompt)) score += 80.0
            if (Regex("^\\s*(?:you said|you asked|вы сказали)", RegexOption.IGNORE_CASE).containsMatchIn(rawPrompt)) {
                score += 30.0
            }
            if (prompt.length >= 20) score += 20.0
            if (prompt.length <= 8) score -= 40.0
            score += minOf(prompt.length, 120) / 10.0
            val bottom = (promptCandidate["bottom"] as? Number)?.toDouble() ?: Double.NEGATIVE_INFINITY
            PromptEntry(prompt = prompt, score = score, bottom = bottom)
        }

        val aggregatedPromptEntries = linkedMapOf<String, AggregatedPromptEntry>()
        promptEntries.forEach { entry ->
            val key = entry.prompt.lowercase(Locale.ROOT)
            val current = aggregatedPromptEntries[key]
            if (current == null) {
                aggregatedPromptEntries[key] = AggregatedPromptEntry(
                    prompt = entry.prompt,
                    score = entry.score,
                    count = 1,
                    maxBottom = entry.bottom
                )
            } else {
                current.score += entry.score
                current.count += 1
                current.maxBottom = maxOf(current.maxBottom, entry.bottom)
            }
        }

        val latestBottom = aggregatedPromptEntries.values.fold(Double.NEGATIVE_INFINITY) { best, entry ->
            maxOf(best, entry.maxBottom)
        }
        val recentPromptEntries = if (latestBottom.isFinite()) {
            aggregatedPromptEntries.values.filter { it.maxBottom >= latestBottom - 320.0 }
        } else {
            aggregatedPromptEntries.values.toList()
        }.sortedWith(
            compareByDescending<AggregatedPromptEntry> { it.maxBottom }
                .thenByDescending { it.score }
                .thenByDescending { it.count }
                .thenByDescending { it.prompt.length }
        )

        val prompt = recentPromptEntries.firstOrNull()?.prompt.orEmpty()
        if (prompt.isNotBlank()) {
            return if (persist) rememberResolvedSourcePrompt(prompt) else prompt
        }

        val fallbackTitle = scrapeMeta.mapNotNull { item ->
            val diagnostics = item["dom_diagnostics"] as? Map<*, *> ?: return@mapNotNull null
            diagnostics["document_title"]?.toString()
                ?.trim()
                ?.replace(
                    Regex("\\s*[-|]\\s*(ChatGPT|Gemini|Claude|Grok|Perplexity).*$", RegexOption.IGNORE_CASE),
                    ""
                )
                ?.replace(
                    Regex("\\s*[·•]\\s*(ChatGPT|Gemini|Claude|Grok|Perplexity).*$", RegexOption.IGNORE_CASE),
                    ""
                )
                ?.trim()
                ?.takeIf { it.length >= 6 }
        }.sortedByDescending { it.length }
            .firstOrNull()
            .orEmpty()

        if (fallbackTitle.isNotBlank()) {
            return if (persist) rememberResolvedSourcePrompt(fallbackTitle) else fallbackTitle
        }

        return ""
    }

    private fun restoreStoredQuestionContextForCurrentSlots(): SessionSnapshot? {
        // After sign-in / migration, do not resurrect a pre-login session by slot
        // layout alone — the next question must start fresh.
        if (SettingsManager.getSuppressSlotRestore(this)) return null
        val enabledSlotKeys = (0 until SlotManager.NUM_SLOTS)
            .filter { slotManager.isSlotEnabled(it) }
            .map { "slot-${it + 1}" }
            .toSet()
        if (enabledSlotKeys.isEmpty()) return null

        val currentSlotUrls = collectCurrentSlotUrls()
        val currentFingerprint = buildSessionFingerprint(currentSlotUrls, enabledSlotKeys)
        if (currentFingerprint.isBlank()) return null
        // Only resurrect a prior session when the CURRENT slots point at a real,
        // identifiable conversation (e.g. chatgpt.com/c/<id>). A Temporary Chat or
        // a fresh home page has no conversation id, so extractConversationKey
        // falls back to a generic origin (or "temporary") that collides with any
        // old session that also reduced to the same origin — which is exactly how
        // a brand-new question got glued onto stale session 158. Desktop avoids
        // this because it keys context by the exact real-conversation fingerprint
        // string; mirror that here: no real conversation id ⇒ start fresh.
        if (!fingerprintHasRealConversation(currentSlotUrls, enabledSlotKeys)) return null
        val currentSourcePrompt = SettingsManager.getParallelIngestSourcePrompt(this).trim()

        val matching = sessionManager.getAllSessions()
            .firstOrNull { snapshot ->
                snapshot.sessionId != null &&
                    !snapshot.noteId.isNullOrBlank() &&
                    buildSessionFingerprint(snapshot.slotUrls, enabledSlotKeys) == currentFingerprint &&
                    (
                        currentSourcePrompt.isBlank() ||
                            promptsReferToSameQuestion(currentSourcePrompt, snapshot.name)
                    )
            } ?: return null

        matching.sessionId?.let { SettingsManager.setParallelIngestSessionId(this, it) }
        matching.noteId?.takeIf { it.isNotBlank() }?.let {
            SettingsManager.setParallelIngestActiveNoteId(this, it)
        }
        matching.name.takeIf { it.isNotBlank() }?.let {
            SettingsManager.setParallelIngestSourcePrompt(this, it)
        }
        return matching
    }

    private fun hasCurrentQuestionContextForCurrentSlots(): Boolean {
        val activeSessionId = SettingsManager.getParallelIngestSessionId(this) ?: return false
        val activeNoteId = SettingsManager.getParallelIngestActiveNoteId(this).trim()
        if (activeNoteId.isBlank()) return false

        val enabledSlotKeys = (0 until SlotManager.NUM_SLOTS)
            .filter { slotManager.isSlotEnabled(it) }
            .map { "slot-${it + 1}" }
            .toSet()
        if (enabledSlotKeys.isEmpty()) return false

        // Returns the conversation key and whether the slot's URL is a real,
        // loaded conversation (not home/landing/blank). Real-ness uses the shared
        // `conversationKeyTailIsReal` so this matcher and
        // `fingerprintHasRealConversation` cannot drift apart. Mirrors iOS keyInfo().
        fun keyInfo(slotKey: String, urls: Map<String, String>): Pair<String, Boolean> {
            val slotIndex = slotKey.removePrefix("slot-").toIntOrNull()?.minus(1) ?: return "" to false
            val rawUrl = urls[slotKey]?.trim().orEmpty()
            val serviceId = ServiceConfig.detectServiceByUrl(rawUrl)
                ?: slotManager.getServiceId(slotIndex)
                ?: "unknown"
            val key = extractConversationKey(serviceId, rawUrl)
            return key to (rawUrl.isNotBlank() && conversationKeyTailIsReal(key))
        }

        val currentSlotUrls = collectCurrentSlotUrls()

        return sessionManager.getAllSessions().any { snapshot ->
            if (snapshot.sessionId != activeSessionId ||
                snapshot.noteId?.trim().orEmpty() != activeNoteId
            ) return@any false

            var agreements = 0
            for (slotKey in enabledSlotKeys) {
                val (curKey, curIsReal) = keyInfo(slotKey, currentSlotUrls)
                val (snapKey, snapIsReal) = keyInfo(slotKey, snapshot.slotUrls)
                if (!curIsReal || !snapIsReal) continue
                if (curKey == snapKey) agreements++ else return@any false
            }
            // Require a loaded slot to agree. A new chat (slots still on home /
            // a different real conversation) yields no agreement → not a match →
            // a new session is correctly minted (preserves the guard against
            // attaching a new question to a stale session).
            agreements >= 1
        }
    }

    /**
     * True when at least one enabled slot points at a *real, identifiable*
     * conversation (a chat id), as opposed to a Temporary Chat, a home/landing
     * page, or a blank slot whose `extractConversationKey` degrades to a generic
     * origin. Used to gate slot-fingerprint session restore so a new question on
     * generic pages never resurrects an unrelated old session (e.g. 158).
     */
    private fun fingerprintHasRealConversation(slotUrls: Map<String, String>, slotKeys: Set<String>): Boolean {
        return slotKeys.any { slotKey ->
            val rawUrl = slotUrls[slotKey]?.trim().orEmpty()
            if (rawUrl.isBlank()) return@any false
            val slotIndex = slotKey.removePrefix("slot-").toIntOrNull()?.minus(1) ?: return@any false
            val serviceId = ServiceConfig.detectServiceByUrl(rawUrl)
                ?: slotManager.getServiceId(slotIndex)
                ?: "unknown"
            conversationKeyTailIsReal(extractConversationKey(serviceId, rawUrl))
        }
    }

    // True when a conversation key's tail is an actual chat id (a single
    // [a-z0-9_-] token of length >= 6), not a service home page (host has a dot),
    // a multi-segment path (has a slash), an origin fallback (has "://"), a
    // Temporary Chat, or a blank slot. extractConversationKey can fall back to a
    // host/origin for a home page; that must NOT count as a real conversation, or
    // a slot still loading the home page would look like a real-but-different
    // conversation and wrongly clear the session. IGNORE_CASE because Android
    // does not lowercase the extracted id (iOS does). Single source of truth
    // shared by the session matcher and fingerprintHasRealConversation. Mirrors iOS.
    private val realConversationTailRegex = Regex("^[a-z0-9][a-z0-9_-]{5,}$", RegexOption.IGNORE_CASE)
    private fun conversationKeyTailIsReal(key: String): Boolean {
        val tail = key.substringAfter(":", "")
        if (tail.isBlank() || tail == "temporary" || tail == "no-url") return false
        return realConversationTailRegex.matches(tail)
    }

    private fun buildSessionFingerprint(slotUrls: Map<String, String>, slotKeys: Set<String>): String {
        val parts = slotKeys
            .sorted()
            .mapNotNull { slotKey ->
                val rawUrl = slotUrls[slotKey]?.trim().orEmpty()
                if (rawUrl.isBlank()) return@mapNotNull null
                val slotIndex = slotKey.removePrefix("slot-").toIntOrNull()?.minus(1) ?: return@mapNotNull null
                val serviceId = ServiceConfig.detectServiceByUrl(rawUrl)
                    ?: slotManager.getServiceId(slotIndex)
                    ?: "unknown"
                "$slotKey:${extractConversationKey(serviceId, rawUrl)}"
            }
        if (parts.isEmpty()) return ""
        return parts.joinToString("|")
    }

    private fun extractConversationKey(serviceId: String?, rawUrl: String?): String {
        val sid = serviceId?.trim()?.lowercase() ?: "unknown"
        val fallback = "$sid:no-url"
        val url = rawUrl?.trim().orEmpty()
        if (url.isBlank()) return fallback

        return try {
            val parsed = Uri.parse(url)
            val origin = buildString {
                append(parsed.scheme?.lowercase() ?: "https")
                append("://")
                append(parsed.host?.lowercase() ?: "")
            }
            val segments = parsed.pathSegments.orEmpty()
                .map { it.trim() }
                .filter { it.isNotBlank() }

            fun firstAfter(label: String): String? {
                val idx = segments.indexOfFirst { it.equals(label, ignoreCase = true) }
                return if (idx >= 0 && idx + 1 < segments.size) segments[idx + 1] else null
            }

            fun looksLikeId(value: String?): Boolean {
                val normalized = value?.trim().orEmpty()
                return normalized.length >= 6 && normalized.matches(Regex("^[a-z0-9][a-z0-9_-]*$", RegexOption.IGNORE_CASE))
            }

            var chatId: String? = null
            when (sid) {
                "chatgpt" -> {
                    chatId = firstAfter("c") ?: firstAfter("chat")
                    if (chatId.isNullOrBlank() && parsed.getQueryParameter("temporary-chat") != null) {
                        chatId = "temporary"
                    }
                }
                "claude" -> chatId = firstAfter("chat")
                "deepseek" -> chatId = firstAfter("s") ?: firstAfter("chat")
                "perplexity" -> chatId = firstAfter("search")
                "grok" -> chatId = firstAfter("c") ?: firstAfter("chat")
                "gemini" -> chatId = firstAfter("chat")
            }

            if (chatId.isNullOrBlank()) {
                val tail = segments.lastOrNull()
                if (looksLikeId(tail)) chatId = tail
            }

            if (!chatId.isNullOrBlank()) {
                "$sid:$chatId"
            } else {
                val path = (parsed.path ?: "/").trimEnd('/').lowercase().ifBlank { "/" }
                "$sid:$origin$path"
            }
        } catch (_: Exception) {
            "$sid:${url.lowercase()}"
        }
    }

    private fun ingestCollectedResponses(
        prompt: String,
        responses: Map<String, String>,
        replaceExisting: Boolean = false,
        aggregatedNoteId: String? = null
    ): AggregatedIngestResult? {
        val detailed = SettingsManager.isDetailedLoggingEnabled(this)
        try {
            val existingSessionId = SettingsManager.getParallelIngestSessionId(this)
                ?: getCurrentQuestionSessionId()
            val externalChatId = SettingsManager.getParallelIngestExternalChatId(this)
                .ifBlank {
                    UUID.randomUUID().toString().also {
                        SettingsManager.setParallelIngestExternalChatId(this, it)
                    }
                }
            val traceId = SettingsManager.getParallelIngestTraceId(this)
                .ifBlank {
                    UUID.randomUUID().toString().also { SettingsManager.setParallelIngestTraceId(this, it) }
                }
            val sequence = SettingsManager.nextParallelIngestSequence(this)
            val sessionOrTmp = existingSessionId?.toString() ?: externalChatId
            val idempotencyKey = AggregatedIngestClient.buildIdempotencyKey(
                kind = "aggregated",
                sessionIdOrTmp = sessionOrTmp,
                sequence = sequence,
                traceId = traceId
            )

            val payload = AggregatedIngestClient.buildPayload(
                sessionId = existingSessionId,
                title = prompt.ifBlank { "Gunshi Merge" },
                responses = responses,
                scrapeMeta = lastScrapeMeta,
                projectTagId = activeProjectId,
                aggregatedNoteId = aggregatedNoteId,
                replaceExisting = replaceExisting
            )

            val result = AggregatedIngestClient.sendAggregated(
                context = this,
                rpcBaseUrl = SettingsManager.getDreamTrackerRpcUrl(this),
                apiKey = SettingsManager.getDreamTrackerApiKey(this),
                payload = payload,
                traceId = traceId,
                idempotencyKey = idempotencyKey,
                scrapeMeta = AggregatedIngestClient.toJsonElement(lastScrapeMeta),
                detailedLogging = detailed
            )

            result.noteId?.takeIf { it.isNotBlank() }?.let {
                SettingsManager.setParallelIngestActiveNoteId(this, it)
            }

            if (result.sessionId != null) {
                val hadSession = SettingsManager.getParallelIngestSessionId(this) != null
                SettingsManager.setParallelIngestSessionId(this, result.sessionId)
                // A fresh ingest established the active session; normal
                // slot-fingerprint continuation is safe again.
                SettingsManager.setSuppressSlotRestore(this, false)

                val rpcUrl = SettingsManager.getDreamTrackerRpcUrl(this)
                val apiKey = SettingsManager.getDreamTrackerApiKey(this)
                val slotUrls = runBlocking {
                    withContext(Dispatchers.Main) {
                        collectCurrentSlotUrls()
                    }
                }
                val snapshot = sessionManager.saveCurrentSession(
                    name = prompt.take(500).ifBlank { "Session" },
                    dreamSessionId = result.sessionId,
                    slotUrls = slotUrls,
                    noteId = result.noteId,
                    projectTagId = activeProjectId
                )
                if (rpcUrl.isNotBlank() && apiKey.isNotBlank()) {
                    thread {
                        val syncOk = runBlocking {
                            sessionManager.syncSessionToDatabase(snapshot, rpcUrl, apiKey)
                        }
                        if (!syncOk) {
                            Log.w(TAG, "session sync pending for local snapshot id=${snapshot.id} sessionId=${snapshot.sessionId}")
                        }
                    }
                }

                runOnUiThread {
                    updateSessionIndicator()
                    if (!hadSession) {
                        Toast.makeText(this, "Session linked: ${result.sessionId}", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            rememberResolvedSourcePrompt(prompt)
            Log.i(
                TAG,
                "parallel ingest ok sessionId=${result.sessionId} noteId=${result.noteId} replaceExisting=$replaceExisting payloadHash=${result.payloadHash} idem=${result.idempotencyKey}"
            )
            return result
        } catch (e: Exception) {
            Log.w(TAG, "parallel ingest failed: ${e.message}")
        }
        return null
    }

    private fun clearPendingAutoAggregation() {
        pendingAggregationPrompt = null
        pendingAggregationExpectedSlots = 0
        autoAggregationPaused = false
    }

    fun hasPendingAutoAggregation(): Boolean =
        !pendingAggregationPrompt.isNullOrBlank() && pendingAggregationExpectedSlots > 0

    fun isAutoAggregationPaused(): Boolean = autoAggregationPaused

    fun pauseAutoAggregation() {
        autoAggregationPaused = true
        ingestPollGeneration += 1
    }

    fun resumeAutoAggregation() {
        val prompt = pendingAggregationPrompt?.trim().orEmpty()
        val expectedSlots = pendingAggregationExpectedSlots
        if (prompt.isBlank() || expectedSlots <= 0) return
        startParallelAggregatedIngest(prompt, expectedSlots)
    }

    fun collectNowAggregation(onDone: ((Boolean, String?) -> Unit)? = null) {
        val enabledSlots = (0 until SlotManager.NUM_SLOTS).filter { slotManager.isSlotEnabled(it) }
        if (enabledSlots.isEmpty()) {
            onDone?.invoke(false, "No enabled slots")
            return
        }

        if (
            SettingsManager.getParallelIngestSessionId(this) != null &&
            SettingsManager.getParallelIngestActiveNoteId(this).isNotBlank() &&
            !hasCurrentQuestionContextForCurrentSlots()
        ) {
            val preservedPrompt = SettingsManager.getParallelIngestSourcePrompt(this)
                .ifBlank { SettingsManager.getLastUserPrompt(this) }
            SettingsManager.clearParallelIngestState(this)
            if (preservedPrompt.isNotBlank()) {
                SettingsManager.setParallelIngestSourcePrompt(this, preservedPrompt)
            }
        }
        val restoredContext = restoreStoredQuestionContextForCurrentSlots()
        val existingAggregatedNoteId = getCurrentQuestionAggregatedNoteId()
        val existingSessionId = getCurrentQuestionSessionId()
        val hasLoadedQuestionContext = existingAggregatedNoteId != null && existingSessionId != null
        val pendingPrompt = pendingAggregationPrompt?.trim().orEmpty()
        val loadedQuestionPrompt = if (hasLoadedQuestionContext) {
            SettingsManager.getParallelIngestSourcePrompt(this).trim()
                .ifBlank { restoredContext?.name?.trim().orEmpty() }
        } else {
            ""
        }
        // Prompt recovery follows the same priority order as desktop:
        // freshly sent text -> recovered DOM prompt -> loaded/root prompt -> last user prompt.
        val scrapeSeedPrompt = pendingPrompt
            .ifBlank { loadedQuestionPrompt }
            .ifBlank { SettingsManager.getLastUserPrompt(this).trim() }
        val expectedServices = enabledSlots.map { slotManager.getService(it).name }.toSet()

        collectLatestRepliesFromEnabledSlots(scrapeSeedPrompt) { responses ->
            if (responses.isEmpty()) {
                runOnUiThread { onDone?.invoke(false, "No replies were collected") }
                return@collectLatestRepliesFromEnabledSlots
            }

            if (responses.size < expectedServices.size && SettingsManager.isDetailedLoggingEnabled(this)) {
                val missing = expectedServices.filterNot { responses.containsKey(it) }
                Log.w(
                    TAG,
                    "collectNowAggregation proceeding with partial set: collected=${responses.size}/${expectedServices.size} missing=${missing.joinToString()}"
                )
            }

            val scrapedPrompt = resolveSourcePromptFromCollectedScrape(
                scrapeMeta = lastScrapeMeta,
                allowDirectFallback = false,
                persist = false
            )
            val sourcePrompt = pendingPrompt
                .ifBlank { scrapedPrompt }
                .ifBlank { loadedQuestionPrompt }
                .ifBlank { SettingsManager.getLastUserPrompt(this).trim() }
            if (sourcePrompt.isNotBlank()) {
                rememberResolvedSourcePrompt(sourcePrompt)
            }
            // Android must mirror desktop semantics here: a session can contain several
            // sequential questions, so we only overwrite when the recovered prompt still
            // matches the currently loaded root note.
            val sameQuestionAsCurrentRoot = hasLoadedQuestionContext &&
                promptsReferToSameQuestion(sourcePrompt, loadedQuestionPrompt)
            val replaceExisting = existingAggregatedNoteId != null && sameQuestionAsCurrentRoot
            val targetAggregatedNoteId = if (replaceExisting) existingAggregatedNoteId else null
            if (replaceExisting && responses.size < expectedServices.size) {
                val missing = expectedServices.filterNot { responses.containsKey(it) }
                if (SettingsManager.isDetailedLoggingEnabled(this)) {
                    Log.w(
                        TAG,
                        "collectNowAggregation aborted partial overwrite: collected=${responses.size}/${expectedServices.size} missing=${missing.joinToString()} noteId=$existingAggregatedNoteId"
                    )
                }
                runOnUiThread {
                    onDone?.invoke(false, "Partial collect blocked; missing ${missing.joinToString()}")
                }
                return@collectLatestRepliesFromEnabledSlots
            }

            if (
                SettingsManager.isDetailedLoggingEnabled(this) &&
                existingAggregatedNoteId != null &&
                loadedQuestionPrompt.isNotBlank() &&
                sourcePrompt.isNotBlank() &&
                !sameQuestionAsCurrentRoot
            ) {
                Log.i(
                    TAG,
                    "collectNowAggregation detected a new question; creating a new root instead of overwriting current noteId=$existingAggregatedNoteId currentPrompt=${loadedQuestionPrompt.take(120)} collectedPrompt=${sourcePrompt.take(120)}"
                )
            }

            thread {
                val result = ingestCollectedResponses(
                    prompt = sourcePrompt,
                    responses = responses,
                    replaceExisting = replaceExisting,
                    aggregatedNoteId = targetAggregatedNoteId
                )
                if (result != null) {
                    clearPendingAutoAggregation()
                }
                runOnUiThread {
                    onDone?.invoke(
                        result != null,
                        if (result != null) null else "Server ingest failed"
                    )
                }
            }
        }
    }

    private fun updateContextChips() {
        binding.chipProjects.text = resolveActiveProjectDisplayName()
        val hasProject = !activeProjectId.isNullOrBlank()
        binding.chipProjects.isChecked = hasProject
        binding.chipProjects.chipIcon = null

        val sessionId = SettingsManager.getParallelIngestSessionId(this)
        binding.chipSessions.text = sessionId?.let { "S$it" } ?: "Sessions"
        binding.chipSessions.isChecked = sessionId != null
        binding.chipSessions.chipIcon = null
    }

    private fun resolveActiveProjectDisplayName(): String {
        val projectId = activeProjectId?.trim().orEmpty()
        if (projectId.isBlank()) return "Projects"
        return findProjectName(projectTreeNodes, projectId) ?: "Projects"
    }

    private fun findProjectName(nodes: List<ProjectTreeNode>, projectId: String): String? {
        nodes.forEach { node ->
            if (node.id == projectId && (activeProjectPathKey == null || activeProjectPathKey == node.pathKey)) return node.name
            val nested = findProjectName(node.children, projectId)
            if (nested != null) return nested
        }
        return null
    }

    private fun findProjectNode(nodes: List<ProjectTreeNode>, projectId: String, pathKey: String?): ProjectTreeNode? {
        nodes.forEach { node ->
            if (node.id == projectId && (pathKey == null || pathKey == node.pathKey)) return node
            val nested = findProjectNode(node.children, projectId, pathKey)
            if (nested != null) return nested
        }
        return null
    }

    /** Canonical DAG-descendant walk — port of dream-tracker's
     *  collectDescendantTagIds (docs/PROJECT_SESSION_FILTER.md). Builds a
     *  parentId->childIds map by walking the whole forest once, then does an
     *  iterative, global-deduped ArrayDeque walk from projectId. Cycle-safe. */
    private fun collectProjectAndDescendantIds(nodes: List<ProjectTreeNode>, projectId: String): Set<String> {
        val childrenByParent = mutableMapOf<String, MutableList<String>>()
        fun indexEdges(list: List<ProjectTreeNode>) {
            list.forEach { node ->
                if (node.children.isNotEmpty()) {
                    childrenByParent.getOrPut(node.id) { mutableListOf() }.addAll(node.children.map { it.id })
                }
                indexEdges(node.children)
            }
        }
        indexEdges(nodes)

        val ids = mutableSetOf(projectId)
        val queue = ArrayDeque<String>().apply { add(projectId) }
        while (queue.isNotEmpty()) {
            val cur = queue.removeFirst()
            childrenByParent[cur]?.forEach { child ->
                if (ids.add(child)) queue.add(child)
            }
        }
        return ids
    }

    private fun findTextViewInTab(view: View): TextView? {
        if (view is TextView) return view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                findTextViewInTab(view.getChildAt(i))?.let { return it }
            }
        }
        return null
    }

    private fun nudgeMergeTab() {
        val tab = binding.tabLayout.getTabAt(MERGE_TAB_INDEX) ?: return
        val textView = findTextViewInTab(tab.view) ?: return
        val textWidth = textView.paint.measureText(textView.text.toString())
        if (textWidth <= 0) return

        val baseColor = textView.currentTextColor
        val shimmerColor = Color.WHITE
        val shader = LinearGradient(0f, 0f, textWidth * 0.5f, 0f,
            intArrayOf(baseColor, shimmerColor, baseColor), floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP)
        val matrix = Matrix()
        ValueAnimator.ofFloat(-textWidth, textWidth * 2).apply {
            duration = 2000
            repeatCount = 4
            interpolator = AccelerateDecelerateInterpolator()
            addUpdateListener { animator ->
                matrix.setTranslate(animator.animatedValue as Float, 0f)
                shader.setLocalMatrix(matrix)
                textView.paint.shader = shader
                textView.invalidate()
            }
            addListener(object : android.animation.Animator.AnimatorListener {
                override fun onAnimationEnd(p0: android.animation.Animator) {
                    textView.paint.shader = null
                    textView.invalidate()
                }
                override fun onAnimationStart(p0: android.animation.Animator) {}
                override fun onAnimationCancel(p0: android.animation.Animator) {}
                override fun onAnimationRepeat(p0: android.animation.Animator) {}
            })
            start()
        }
    }

    private val activeShimmers = mutableListOf<ShimmerDrawable>()

    fun startMergeShimmer() {
        runOnUiThread {
            stopMergeShimmer() // Clear existing ones if any
            checkboxes.forEachIndexed { index, cb ->
                if (slotManager.isSlotEnabled(index)) {
                    val shimmer = ShimmerDrawable()
                    shimmer.cornerRadius = 16f * resources.displayMetrics.density
                    cb.overlay.add(shimmer)
                    shimmer.setBounds(0, 0, cb.width, cb.height)
                    shimmer.startAnimation()
                    activeShimmers.add(shimmer)
                }
            }
            nudgeMergeTab()
        }
    }

    fun stopMergeShimmer() {
        runOnUiThread { 
            activeShimmers.forEach { it.stopAnimation() }
            activeShimmers.clear()
            checkboxes.forEach { it.overlay.clear() } 
        }
    }

    private fun setupSettingsMenu() {
        binding.btnSettings.setOnClickListener { anchor ->
            val popup = android.widget.PopupMenu(this, anchor)
            popup.menuInflater.inflate(R.menu.settings_menu, popup.menu)

            val debugEnabled = SettingsManager.isUnstableFeaturesEnabled(this)
            val detailedEnabled = SettingsManager.isDetailedLoggingEnabled(this)
            val autoCacheCleanupEnabled = SettingsManager.isAutoCacheCleanupEnabled(this)
            val incognitoEnabled = SettingsManager.isIncognitoModeEnabled(this)

            popup.menu.findItem(R.id.action_debug_mode)?.apply {
                isVisible = debugEnabled
                isChecked = debugEnabled
            }
            popup.menu.findItem(R.id.action_detailed_logging)?.apply {
                isVisible = debugEnabled
                isChecked = detailedEnabled
            }
            popup.menu.findItem(R.id.action_incognito_mode)?.apply {
                isVisible = debugEnabled
                isChecked = incognitoEnabled
            }
            popup.menu.findItem(R.id.action_manage_subscription)?.apply {
                isVisible = debugEnabled
            }
            popup.menu.findItem(R.id.action_sessions)?.apply {
                isVisible = debugEnabled
            }

            popup.menu.findItem(R.id.action_auto_cache_cleanup)?.isChecked = autoCacheCleanupEnabled

            popup.setOnMenuItemClickListener { item ->
                when (item.itemId) {
                    R.id.action_debug_mode -> {
                        SettingsManager.setUnstableFeaturesEnabled(this, false)
                        applyUnstableFeatureVisibility()
                        Toast.makeText(this, R.string.debug_mode_disabled, Toast.LENGTH_SHORT).show()
                        true
                    }
                    R.id.action_detailed_logging -> {
                        val next = !item.isChecked
                        item.isChecked = next
                        SettingsManager.setDetailedLoggingEnabled(this, next)
                        Toast.makeText(this, R.string.settings_saved, Toast.LENGTH_SHORT).show()
                        true
                    }
                    R.id.action_auto_cache_cleanup -> {
                        val next = !item.isChecked
                        item.isChecked = next
                        SettingsManager.setAutoCacheCleanupEnabled(this, next)
                        Toast.makeText(this, R.string.settings_saved, Toast.LENGTH_SHORT).show()
                        true
                    }
                    R.id.action_incognito_mode -> {
                        val next = !item.isChecked
                        item.isChecked = next
                        SettingsManager.setIncognitoModeEnabled(this, next)
                        Toast.makeText(this, R.string.settings_saved, Toast.LENGTH_SHORT).show()
                        reloadAllSlots()
                        true
                    }
                    R.id.action_account -> {
                        showAccountDialog()
                        true
                    }
                    R.id.action_manage_subscription -> {
                        billingManager.launchSubscriptionPurchase(this)
                        true
                    }
                    R.id.action_find_in_page -> {
                        showFindBar()
                        true
                    }
                    R.id.action_sessions -> {
                        showSessionsDialog()
                        true
                    }
                    R.id.action_about -> {
                        showAboutDialog()
                        true
                    }
                    R.id.action_changelog -> {
                        showChangelogDialog()
                        true
                    }
                    else -> false
                }
            }
            popup.show()
        }
    }

    /**
     * Shown when a Supabase call found the account session expired (refresh
     * token rejected). The session has already been cleared by AuthStore, so
     * refresh the indicator and offer a one-tap path back to sign-in instead of
     * leaving the user with stale local sessions and a UI that still implies
     * "signed in".
     */
    private fun promptSessionExpired() {
        updateSessionIndicator()
        AlertDialog.Builder(this)
            .setTitle("Session expired")
            .setMessage("Your account session expired. Sign in again to see and sync your cloud sessions.")
            .setPositiveButton("Sign In") { _, _ -> showAccountDialog() }
            .setNegativeButton("Later", null)
            .show()
    }

    private fun showAccountDialog() {
        val status = AuthStore.status(this)
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(12), dp(20), dp(4))
        }

        if (status.signedIn) {
            container.addView(TextView(this).apply {
                text = "Signed in as ${status.email ?: "—"}\n\nYour notes and sessions are attributed to this account."
                setTextColor(Color.parseColor("#E8E8E8"))
                textSize = 14f
            })
            AlertDialog.Builder(this)
                .setTitle(getString(R.string.settings_account))
                .setView(container)
                .setNegativeButton("Sign Out") { _, _ -> performSignOut() }
                .setPositiveButton("Close", null)
                .show()
            return
        }

        val emailField = EditText(this).apply {
            hint = "Email"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        }
        val passwordField = EditText(this).apply {
            hint = "Password"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        container.addView(emailField)
        container.addView(passwordField)
        container.addView(TextView(this).apply {
            text = "Signed out keeps the legacy local/anon behaviour. Sign in to attribute your notes and sessions to your account."
            setTextColor(Color.parseColor("#9AA0A6"))
            textSize = 12f
            setPadding(0, dp(8), 0, 0)
        })

        val dialog = AlertDialog.Builder(this)
            .setTitle(getString(R.string.settings_account))
            .setView(container)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Sign In", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val email = emailField.text.toString().trim()
                val password = passwordField.text.toString()
                if (email.isEmpty() || password.isEmpty()) {
                    Toast.makeText(this, "Enter email and password", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                performSignIn(email, password, dialog)
            }
        }
        dialog.show()
    }

    private fun performSignIn(email: String, password: String, dialog: AlertDialog) {
        Toast.makeText(this, "Signing in…", Toast.LENGTH_SHORT).show()
        Thread {
            val result = AuthStore.signIn(applicationContext, email, password)
            // Invite-only accounts: check profiles.approved while still on the
            // background thread. null = unknown (network/parse error) — treat
            // as approved so a blip never locks a legit user out of sync.
            val approved = if (result.isSuccess) AuthStore.fetchApproved(applicationContext) else null
            runOnUiThread {
                result
                    .onSuccess {
                        Toast.makeText(this, "Signed in as ${it.email ?: "account"}", Toast.LENGTH_SHORT).show()
                        dialog.dismiss()
                        // Start the account with a clean slate: drop any pre-login
                        // question context and suppress slot-fingerprint restore so
                        // the next question opens a fresh session instead of
                        // resurrecting an old one that shares the slot layout.
                        SettingsManager.clearParallelIngestState(this)
                        SettingsManager.setSuppressSlotRestore(this, true)
                        updateSessionIndicator()
                        if (approved == false) {
                            // Stay signed in, but no migration offer — backend
                            // RPCs would reject with account_pending_approval.
                            showPendingApprovalDialog()
                        } else {
                            maybeOfferLocalSessionMigration()
                        }
                    }
                    .onFailure {
                        Toast.makeText(this, it.message ?: "Sign-in failed", Toast.LENGTH_LONG).show()
                    }
            }
        }.start()
    }

    /** Invite-only gate: signed in but profiles.approved is false. */
    private fun showPendingApprovalDialog() {
        AlertDialog.Builder(this)
            .setTitle("Pending approval")
            .setMessage(PENDING_APPROVAL_MESSAGE)
            .setPositiveButton("OK", null)
            .show()
    }

    /**
     * Maps raw backend errors to user-friendly text where we know the cause.
     * Backend RPCs raise 'account_pending_approval' for unapproved accounts.
     */
    private fun friendlyBackendError(message: String?): String =
        if (message?.contains("account_pending_approval") == true) PENDING_APPROVAL_MESSAGE
        else "Failed: ${message ?: "unknown error"}"

    /**
     * Late-login migration: after sign-in, offer to upload local-only sessions
     * (session_id >= 900000) to the account. Saving while signed in carries the
     * JWT, so the backend set_owner_from_note trigger stamps owner_id = auth.uid().
     * Purely client-side; see shared/contracts/AUTH_AND_SESSION_SYNC.md.
     */
    private fun maybeOfferLocalSessionMigration() {
        val locals = sessionManager.getAllSessions().filter { (it.sessionId ?: 0) >= 900_000 }
        if (locals.isEmpty()) return
        AlertDialog.Builder(this)
            .setTitle("Upload local sessions?")
            .setMessage(
                "You have ${locals.size} session(s) saved while signed out. " +
                    "Upload them to your account so they sync across your devices?"
            )
            .setPositiveButton("Upload") { _, _ -> migrateLocalSessions(locals) }
            .setNegativeButton("Not now", null)
            .show()
    }

    private fun migrateLocalSessions(locals: List<SessionSnapshot>) {
        val rpcUrl = SettingsManager.getDreamTrackerRpcUrl(this)
        val apiKey = SettingsManager.getDreamTrackerApiKey(this)
        if (rpcUrl.isBlank() || apiKey.isBlank()) return
        thread {
            val migratedIds = mutableSetOf<String>()
            for (session in locals) {
                val ok = runBlocking { sessionManager.migrateLocalSession(session, rpcUrl, apiKey) }
                if (ok) migratedIds.add(session.id)
            }
            if (migratedIds.isNotEmpty()) {
                val remaining = sessionManager.getAllSessions().filter { it.id !in migratedIds }
                sessionManager.replaceSessions(remaining)
            }
            runOnUiThread {
                val msg = if (migratedIds.size == locals.size) {
                    "Uploaded ${migratedIds.size} local session(s) to your account."
                } else {
                    "Uploaded ${migratedIds.size} of ${locals.size} local session(s); the rest stayed local."
                }
                Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun performSignOut() {
        Thread {
            AuthStore.signOut(applicationContext)
            runOnUiThread { Toast.makeText(this, "Signed out", Toast.LENGTH_SHORT).show() }
        }.start()
    }

    private fun showAboutDialog() {
        val body = buildString {
            appendLine("${getString(R.string.about_version_label)}: ${BuildConfig.DISPLAY_VERSION}")
            appendLine("${getString(R.string.about_base_version_label)}: ${BuildConfig.BASE_SEMVER}")
            appendLine("${getString(R.string.about_git_label)}: #${BuildConfig.GIT_COMMIT_COUNT} · ${BuildConfig.GIT_SHORT_SHA}")
        }.trim()

        AlertDialog.Builder(this)
            .setTitle(getString(R.string.about_dialog_title))
            .setMessage(body)
            .setPositiveButton(getString(R.string.about_close), null)
            .show()
    }

    private fun showChangelogDialog() {
        val changelogText = loadLatestChangelogText()
        val textView = TextView(this).apply {
            text = changelogText
            setTextColor(Color.parseColor("#E8E8E8"))
            textSize = 13f
            setLineSpacing(0f, 1.18f)
            setPadding(dp(16), dp(12), dp(16), dp(12))
        }
        val scrollView = ScrollView(this).apply {
            addView(
                textView,
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            )
        }

        AlertDialog.Builder(this)
            .setTitle(getString(R.string.changelog_dialog_title))
            .setView(scrollView)
            .setPositiveButton(getString(R.string.about_close), null)
            .show()
    }

    private fun loadLatestChangelogText(): String {
        return try {
            resources.openRawResource(R.raw.changelog_latest)
                .bufferedReader()
                .use { it.readText().trim() }
                .ifBlank { "No changelog entries found." }
        } catch (_: Exception) {
            "No changelog entries found."
        }
    }

    private fun showSessionsDialog(forceRefresh: Boolean = false) {
        if (forceRefresh) {
            if (sessionsRefreshInFlight) return
            sessionsRefreshInFlight = true
        }
        if (projectTreeNodes.isEmpty()) {
            val persisted = loadPersistedProjectTree()
            if (persisted.isNotEmpty()) {
                projectTreeNodes = persisted
                projectTreeLoadedAtMs = persistedProjectTreeLoadedAtMs()
            }
        }
        setContextChipLoading(binding.chipSessions, true, "Loading…")
        val rpcUrl = SettingsManager.getDreamTrackerRpcUrl(this)
        val apiKey = SettingsManager.getDreamTrackerApiKey(this)
        Log.i(TAG, "[SESSION] showSessionsDialog rpcUrl=${rpcUrl.isNotBlank()} apiKey=${apiKey.isNotBlank()}")
        val localSessions = sessionManager.getAllSessions()
        val cachedSessionsLoadedAtMs = maxOf(sessionsLoadedAtMs, persistedSessionsLoadedAtMs())
        if (!forceRefresh && localSessions.isNotEmpty() && isFreshRemoteListCache(cachedSessionsLoadedAtMs)) {
            setContextChipLoading(binding.chipSessions, false)
            showSessionsDialogWithData(localSessions)
            return
        }
        if (rpcUrl.isNotBlank() && apiKey.isNotBlank()) {
            thread {
                try {
                    Log.i(TAG, "[SESSION] showSessionsDialog background thread started")
                    val remoteSessions = runBlocking {
                        Log.i(TAG, "[SESSION] calling loadSessionsFromDatabase...")
                        sessionManager.loadSessionsFromDatabase(rpcUrl, apiKey)
                    }
                    Log.i(TAG, "[SESSION] remoteSessions count=${remoteSessions.size}")
                    // If the load failed because the account session silently
                    // expired (refresh token rejected), tell the user instead of
                    // quietly showing stale local sessions as if signed in.
                    if (AuthStore.consumeSessionExpired(this)) {
                        runOnUiThread { promptSessionExpired() }
                    }
                    val sessions = if (remoteSessions.isNotEmpty()) {
                        // Cloud is the source of truth for cloud sessions, but it
                        // never contains local-only sessions (session_id >= 900000,
                        // saved while signed out and not yet migrated). A plain
                        // replace wiped those from the list. Preserve any local-only
                        // session the cloud doesn't already represent.
                        val remoteSessionIds = remoteSessions.mapNotNull { it.sessionId }.toSet()
                        val localOnly = localSessions.filter {
                            (it.sessionId ?: 0) >= 900_000 && (it.sessionId ?: 0) !in remoteSessionIds
                        }
                        val combined = remoteSessions + localOnly
                        sessionManager.replaceSessions(combined)
                        combined
                    } else {
                        val mergedSessions = mergeSessions(remoteSessions, localSessions)
                        if (mergedSessions.isNotEmpty()) {
                            sessionManager.replaceSessions(mergedSessions)
                        }
                        if (mergedSessions.isNotEmpty()) mergedSessions else localSessions
                    }
                    runOnUiThread {
                        sessionsLoadedAtMs = System.currentTimeMillis()
                        persistSessionsLoadedAt()
                        setContextChipLoading(binding.chipSessions, false)
                        Log.i(TAG, "[SESSION] showing dialog with ${sessions.size} sessions")
                        showSessionsDialogWithData(sessions)
                    }
                } catch (e: Exception) {
                    runOnUiThread {
                        setContextChipLoading(binding.chipSessions, false)
                        Toast.makeText(this@MainActivity, friendlyBackendError(e.message), Toast.LENGTH_LONG).show()
                    }
                } finally {
                    if (forceRefresh) releaseSessionsRefreshLock()
                }
            }
            return
        }
        Log.i(TAG, "[SESSION] rpcUrl/apiKey missing, showing local sessions only")
        setContextChipLoading(binding.chipSessions, false)
        showSessionsDialogWithData(sessionManager.getAllSessions())
        if (forceRefresh) releaseSessionsRefreshLock()
    }

    private fun showSessionsDialogWithData(sessions: List<SessionSnapshot>) {
        if (sessions.isEmpty()) {
            Toast.makeText(this, R.string.sessions_empty, Toast.LENGTH_SHORT).show()
            return
        }

        val formatter = java.text.SimpleDateFormat("d MMM, HH:mm", java.util.Locale("ru", "RU"))
        val defaultNamePattern = Regex("^\\d{2}:\\d{2}\\s\\d{2}\\.\\d{2}$")
        val mutableSessions = sessions
            .sortedWith(
                compareByDescending<SessionSnapshot> { it.timestamp }
                    .thenByDescending { it.sessionId ?: -1 }
                    .thenByDescending { it.id }
            )
            .toMutableList()
        val filteredSessions = mutableSessions.toMutableList()
        val expandedSessionIds = mutableSetOf<String>()
        val sessionsAdapter = object : ArrayAdapter<SessionSnapshot>(
            this,
            android.R.layout.simple_list_item_2,
            android.R.id.text1,
            filteredSessions
        ) {
            override fun getView(position: Int, convertView: View?, parent: android.view.ViewGroup): View {
                val session = getItem(position) ?: return convertView ?: View(context)
                val root = (convertView as? LinearLayout) ?: LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(16), dp(12), dp(16), dp(12))
                    layoutParams = AbsListView.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    )

                    addView(TextView(context).apply {
                        tag = "title"
                        setTextColor(Color.WHITE)
                        textSize = 15f
                        setTypeface(null, android.graphics.Typeface.NORMAL)
                    })
                    addView(TextView(context).apply {
                        tag = "chevron"
                        setTextColor(Color.parseColor("#8FB1FF"))
                        textSize = 13f
                        visibility = View.GONE
                        minHeight = dp(32)
                        setPadding(dp(2), dp(8), dp(2), dp(2))
                    })
                    addView(TextView(context).apply {
                        tag = "subtitle"
                        setTextColor(ContextCompat.getColor(context, android.R.color.darker_gray))
                        textSize = 12f
                        setPadding(0, dp(6), 0, 0)
                    })
                }
                val title = root.findViewWithTag<TextView>("title")
                val chevron = root.findViewWithTag<TextView>("chevron")
                val subtitle = root.findViewWithTag<TextView>("subtitle")
                val sid = session.sessionId?.let { "S$it" } ?: "S-"
                val displayName = session.name
                    .trim()
                    .takeIf { it.isNotBlank() && !defaultNamePattern.matches(it) }
                    ?: "Session"
                val expanded = expandedSessionIds.contains(session.id)
                val fullTitle = "$sid  $displayName"
                val availableWidth = (
                    (parent.width.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels) -
                        root.paddingLeft -
                        root.paddingRight -
                        dp(32)
                    ).coerceAtLeast(dp(120))
                val measuredLineCount = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                    StaticLayout.Builder.obtain(fullTitle, 0, fullTitle.length, title.paint, availableWidth)
                        .setAlignment(Layout.Alignment.ALIGN_NORMAL)
                        .setIncludePad(false)
                        .build()
                        .lineCount
                } else {
                    @Suppress("DEPRECATION")
                    StaticLayout(
                        fullTitle,
                        title.paint,
                        availableWidth,
                        Layout.Alignment.ALIGN_NORMAL,
                        1.0f,
                        0f,
                        false
                    ).lineCount
                }
                val showChevron = measuredLineCount > 3
                title.text = fullTitle
                title.setTypeface(null, android.graphics.Typeface.NORMAL)
                title.textSize = 15f
                title.setTextColor(ContextCompat.getColor(context, android.R.color.white))
                title.maxLines = if (expanded) Int.MAX_VALUE else 3
                title.ellipsize = android.text.TextUtils.TruncateAt.END
                subtitle.text = formatter.format(java.util.Date(session.timestamp))
                subtitle.setTextColor(ContextCompat.getColor(context, android.R.color.darker_gray))
                subtitle.textSize = 12f
                if (showChevron) {
                    chevron.visibility = View.VISIBLE
                    chevron.text = if (expanded) "\u25B4 Hide" else "\u25BE More"
                    chevron.setOnClickListener {
                        if (expandedSessionIds.contains(session.id)) {
                            expandedSessionIds.remove(session.id)
                        } else {
                            expandedSessionIds.add(session.id)
                        }
                        notifyDataSetChanged()
                    }
                } else {
                    chevron.visibility = View.GONE
                    chevron.setOnClickListener(null)
                }
                return root
            }
        }

        val searchInput = EditText(this).apply {
            hint = "Search by session id or title"
            setSingleLine(true)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#888888"))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(10).toFloat()
                setColor(Color.parseColor("#2B2B2B"))
                setStroke(dp(1), Color.parseColor("#474747"))
            }
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        // Stale selected id (project deleted from the tree) falls back to All —
        // checked lazily in applySessionFilter via findProjectNode.
        var selectedProjectFilterId: String? = null
        val filterButton = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_sort_by_size)
            contentDescription = "Filter by project"
            background = ColorDrawable(Color.TRANSPARENT)
            setPadding(dp(8), dp(8), dp(8), dp(8))
        }
        val searchRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val listView = ListView(this).apply {
            adapter = sessionsAdapter
            divider = ColorDrawable(Color.parseColor("#1A737373"))
            dividerHeight = dp(1)
            setSelector(ColorDrawable(Color.parseColor("#103B82F6")))
            setPadding(0, dp(4), 0, dp(4))
            clipToPadding = false
        }
        val contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), 0)
        }
        var dialog: AlertDialog? = null
        val surface = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = AppCompatResources.getDrawable(this@MainActivity, R.drawable.bg_dialog_surface)
            clipToOutline = true
            setPadding(dp(14), dp(14), dp(14), dp(10))
        }
        surface.addView(TextView(this).apply {
            text = "↻"
            gravity = android.view.Gravity.CENTER
            textSize = 20f
            setTextColor(ContextCompat.getColor(this@MainActivity, R.color.action_primary))
            setPadding(0, 0, 0, dp(10))
            contentDescription = "Refresh sessions"
            setOnClickListener {
                dialog?.dismiss()
                showSessionsDialog(forceRefresh = true)
            }
        }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        searchRow.addView(searchInput, LinearLayout.LayoutParams(
            0,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            1f
        ))
        searchRow.addView(filterButton, LinearLayout.LayoutParams(
            dp(40),
            dp(40)
        ).apply {
            leftMargin = dp(6)
        })
        surface.addView(searchRow, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        surface.addView(listView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ).apply {
            topMargin = dp(10)
        })
        contentLayout.addView(surface, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        fun updateFilterButtonTint() {
            val active = selectedProjectFilterId != null
            filterButton.setColorFilter(
                ContextCompat.getColor(
                    this@MainActivity,
                    if (active) R.color.action_primary else R.color.text_secondary
                )
            )
        }
        val applySessionFilter = { query: String ->
            // Stale selected id (project deleted from the tree) falls back to
            // All — spec rule 6.
            val projectFilterId = selectedProjectFilterId?.takeIf {
                it == "__none__" || findProjectNode(projectTreeNodes, it, null) != null
            }
            if (projectFilterId != selectedProjectFilterId) {
                selectedProjectFilterId = projectFilterId
                updateFilterButtonTint()
            }
            val normalized = query.trim().lowercase(Locale.ROOT)
            // Computed ONCE per filter run, not per session (O(sessions*tree) otherwise).
            val allowedProjectIds = projectFilterId
                ?.takeIf { it != "__none__" }
                ?.let { collectProjectAndDescendantIds(projectTreeNodes, it) }
            val next = mutableSessions.filter { session ->
                val matchesText = if (normalized.isBlank()) {
                    true
                } else {
                    val sessionId = (session.sessionId?.toString() ?: "").lowercase(Locale.ROOT)
                    val name = session.name.trim().lowercase(Locale.ROOT)
                    sessionId.contains(normalized) || name.contains(normalized)
                }
                val matchesProject = when (projectFilterId) {
                    null -> true
                    "__none__" -> session.projectTagId.isNullOrBlank()
                    else -> session.projectTagId != null && allowedProjectIds?.contains(session.projectTagId) == true
                }
                matchesText && matchesProject
            }
            filteredSessions.clear()
            filteredSessions.addAll(next)
            sessionsAdapter.notifyDataSetChanged()
        }
        searchInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                applySessionFilter(s?.toString().orEmpty())
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })
        updateFilterButtonTint()
        filterButton.setOnClickListener { anchor ->
            showProjectFilterPopup(anchor, selectedProjectFilterId) { newFilterId ->
                selectedProjectFilterId = newFilterId
                updateFilterButtonTint()
                applySessionFilter(searchInput.text?.toString().orEmpty())
            }
        }

        dialog = AlertDialog.Builder(this, R.style.ServiceDialogTheme)
            .setTitle(R.string.sessions_title)
            .setView(contentLayout)
            .setNeutralButton(R.string.sessions_clear_active) { _, _ ->
                SettingsManager.clearParallelIngestSessionId(this)
                SettingsManager.clearParallelIngestActiveNoteId(this)
                updateSessionIndicator()
                Toast.makeText(this, R.string.sessions_cleared, Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
        dialog?.let { styleDialogWindow(it) }
        dialog?.setOnDismissListener {
            setContextChipLoading(binding.chipSessions, false)
        }

        listView.setOnItemClickListener { _, _, position, _ ->
            val session = filteredSessions.getOrNull(position) ?: return@setOnItemClickListener
            val loaded = sessionManager.loadSession(session.id)
            Log.i(TAG, "[SESSION] loadSession id=${session.id} result=${if (loaded != null) "ok" else "null"}")
            if (loaded != null) {
                // Explicit load = the user chose this session; normal continuation
                // (incl. slot-fingerprint restore) is intended again.
                SettingsManager.setSuppressSlotRestore(this, false)
                loaded.sessionId?.let {
                    SettingsManager.setParallelIngestSessionId(this, it)
                } ?: SettingsManager.clearParallelIngestSessionId(this)
                loaded.noteId?.takeIf { it.isNotBlank() }?.let {
                    SettingsManager.setParallelIngestActiveNoteId(this, it)
                } ?: SettingsManager.clearParallelIngestActiveNoteId(this)
                clearPendingAutoAggregation()
                Log.i(
                    TAG,
                    "[SESSION] applying sid=${loaded.sessionId} noteId=${loaded.noteId} slotConfig=${loaded.slotConfig} slotEnabled=${loaded.slotEnabled} slotUrls=${loaded.slotUrls}"
                )
                applyLoadedSessionUiState(loaded)
                stageSessionUrlsForLoading(loaded.slotUrls)
                Log.i(TAG, "[SESSION] pendingUrls after stage: ${synchronized(pendingSessionUrls) { pendingSessionUrls.toMap() }}")
                scheduleSlotLoading(forceReload = true)
                // Restore the session's project identity (if any) WITHOUT going
                // through setActiveProject(): that setter re-applies the project's
                // own slot URLs and would clobber the session URLs staged above.
                val sessionProjectId = loaded.projectTagId?.trim()?.takeIf { it.isNotBlank() }
                if (sessionProjectId != null && sessionProjectId != activeProjectId) {
                    activeProjectId = sessionProjectId
                    activeProjectPathKey =
                        findProjectNode(projectTreeNodes, sessionProjectId, null)?.pathKey
                            ?: sessionProjectId
                    activeProjectSlotUrls = emptyMap()
                    projectSlotUrlLoadGeneration++ // cancel any in-flight project URL load
                    updateProjectSelectorAppearance()
                    Log.i(TAG, "[SESSION] restored project=$sessionProjectId")
                }
                updateSessionIndicator()
                dialog?.dismiss()
            }
        }

        listView.setOnItemLongClickListener { _, _, position, _ ->
            val session = filteredSessions.getOrNull(position) ?: return@setOnItemLongClickListener true
            AlertDialog.Builder(this, R.style.ServiceDialogTheme)
                .setTitle(R.string.sessions_delete)
                .setMessage("Delete session \"${session.name}\"?")
                .setPositiveButton(R.string.sessions_delete) { _, _ ->
                    sessionManager.deleteSession(session.id)
                    val rpcUrl = SettingsManager.getDreamTrackerRpcUrl(this)
                    val apiKey = SettingsManager.getDreamTrackerApiKey(this)
                    if (rpcUrl.isNotBlank() && apiKey.isNotBlank()) {
                        thread {
                            runBlocking {
                                sessionManager.deleteSessionFromDatabase(
                                    session.id, session.sessionId, session.noteId, rpcUrl, apiKey
                                )
                            }
                        }
                    }
                    mutableSessions.removeAll { it.id == session.id }
                    filteredSessions.removeAll { it.id == session.id }
                    sessionsAdapter.notifyDataSetChanged()
                    Toast.makeText(this, "Deleted: ${session.name}", Toast.LENGTH_SHORT).show()
                    if (filteredSessions.isEmpty() && mutableSessions.isEmpty()) {
                        dialog?.dismiss()
                    }
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
            true
        }
    }

    private fun collectCurrentSlotUrls(): Map<String, String> {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            return runBlocking {
                withContext(Dispatchers.Main) {
                    collectCurrentSlotUrlsInternal()
                }
            }
        }
        return collectCurrentSlotUrlsInternal()
    }

    private fun collectCurrentSlotUrlsInternal(): Map<String, String> {
        val urls = mutableMapOf<String, String>()
        for (slotIndex in 0 until SlotManager.NUM_SLOTS) {
            val fragment = getFragment(slotIndex)
            val liveUrl = fragment?.webView?.url?.trim().orEmpty()
            val serviceId = slotManager.getServiceId(slotIndex)
            val fallbackUrl = when (serviceId) {
                "custom" -> slotManager.getCustomUrl(slotIndex)
                else -> slotManager.getService(slotIndex).url
            }.trim()
            val resolved = if (liveUrl.startsWith("http://") || liveUrl.startsWith("https://")) {
                liveUrl
            } else {
                fallbackUrl
            }
            if (resolved.isNotBlank()) {
                urls["slot-${slotIndex + 1}"] = resolved
            }
        }
        return urls
    }

    private fun stageSessionUrlsForLoading(slotUrls: Map<String, String>) {
        val staged = mutableMapOf<Int, String>()
        slotUrls.forEach { (slotKey, rawUrl) ->
            val slotIndex = slotKey.removePrefix("slot-").toIntOrNull()?.minus(1) ?: return@forEach
            val url = rawUrl.trim()
            if (slotIndex !in 0 until SlotManager.NUM_SLOTS || url.isBlank()) return@forEach
            staged[slotIndex] = url
        }
        synchronized(pendingSessionUrls) {
            pendingSessionUrls.clear()
            pendingSessionUrls.putAll(staged)
        }
        if (SettingsManager.isDetailedLoggingEnabled(this)) {
            Log.d(TAG, "stageSessionUrlsForLoading slots=${staged.keys.sorted()}")
        }
    }

    private fun applyLoadedSessionUiState(session: SessionSnapshot) {
        for (slotIndex in 0 until SlotManager.NUM_SLOTS) {
            val service = slotManager.getService(slotIndex)
            updateTabLabel(slotIndex, service.name)
            updateCheckboxLabel(slotIndex, service.name)

            val slotKey = "slot-${slotIndex + 1}"
            val targetEnabled = session.slotEnabled[slotKey] ?: slotManager.isSlotEnabled(slotIndex)
            val checkbox = checkboxes.getOrNull(slotIndex) ?: continue
            if (checkbox.isChecked != targetEnabled) {
                checkbox.isChecked = targetEnabled
            }
        }
    }

    private fun mergeSessions(
        remoteSessions: List<SessionSnapshot>,
        localSessions: List<SessionSnapshot>
    ): List<SessionSnapshot> {
        if (remoteSessions.isEmpty() && localSessions.isEmpty()) return emptyList()
        val byKey = linkedMapOf<String, SessionSnapshot>()
        remoteSessions.sortedByDescending { it.timestamp }.forEach { session ->
            byKey[sessionMergeKey(session)] = session
        }
        localSessions.sortedByDescending { it.timestamp }.forEach { session ->
            val key = sessionMergeKey(session)
            val overlapsRemote = remoteSessions.any { existing -> sameSessionEntry(existing, session) }
            if (!byKey.containsKey(key) && !overlapsRemote) {
                byKey[key] = session
            }
        }
        return byKey.values
            .sortedByDescending { it.timestamp }
            .take(SessionManager.MAX_SESSIONS)
    }

    private fun sameSessionEntry(left: SessionSnapshot, right: SessionSnapshot): Boolean {
        val leftNoteId = left.noteId?.takeIf { it.isNotBlank() }
        val rightNoteId = right.noteId?.takeIf { it.isNotBlank() }
        if (leftNoteId != null && rightNoteId != null) return leftNoteId == rightNoteId

        val leftSessionId = left.sessionId
        val rightSessionId = right.sessionId
        if (leftSessionId == null || rightSessionId == null || leftSessionId != rightSessionId) {
            return false
        }

        val leftName = left.name.trim().lowercase(Locale.ROOT)
        val rightName = right.name.trim().lowercase(Locale.ROOT)
        return leftName.isNotBlank() && leftName == rightName
    }

    private fun sessionMergeKey(session: SessionSnapshot): String {
        val sessionPart = session.sessionId?.toString() ?: "id:${session.id}"
        val notePart = session.noteId?.takeIf { it.isNotBlank() } ?: "row:${session.id}"
        return "$sessionPart|$notePart"
    }

    private fun cleanupWebViewCacheIfNeeded() {
        try {
            val appRoot = filesDir.parentFile ?: return
            val cacheDirs = listOf(
                File(appRoot, "app_webview/Default/Cache"),
                File(appRoot, "app_webview/Default/Code Cache")
            )

            val total = cacheDirs.sumOf { dirSizeBytes(it) }
            if (total <= WEBVIEW_CACHE_MAX_BYTES) return

            cacheDirs.forEach { dir ->
                if (dir.exists()) dir.deleteRecursively()
            }
            Log.w(TAG, "WebView cache cleared (${total / (1024 * 1024)} MB)")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to cleanup WebView cache: ${e.message}")
        }
    }

    private fun dirSizeBytes(dir: File): Long {
        if (!dir.exists()) return 0L
        return try {
            dir.walkTopDown()
                .filter { it.isFile }
                .sumOf { it.length() }
        } catch (_: Exception) {
            0L
        }
    }

    private fun openCookieFilePicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
        }
        cookieFilePicker.launch(intent)
    }

    private fun openAttachFilePicker() {
        if (!SettingsManager.isUnstableFeaturesEnabled(this)) {
            Toast.makeText(this, R.string.feature_hidden_debug_mode, Toast.LENGTH_SHORT).show()
            return
        }
        val enabledSlots = (0 until SlotManager.NUM_SLOTS).filter { slotManager.isSlotEnabled(it) }
        if (enabledSlots.isEmpty()) {
            Toast.makeText(this, R.string.no_slots_enabled_for_attach, Toast.LENGTH_SHORT).show()
            return
        }
        attachFilePicker.launch(arrayOf("*/*"))
    }

    private fun attachFileToAllEnabledSlots(uri: Uri) {
        val enabledSlots = (0 until SlotManager.NUM_SLOTS).filter { slotManager.isSlotEnabled(it) }
        if (enabledSlots.isEmpty()) {
            Toast.makeText(this, R.string.no_slots_enabled_for_attach, Toast.LENGTH_SHORT).show()
            return
        }

        var remaining = enabledSlots.size
        var anySuccess = false

        for (slotIndex in enabledSlots) {
            val fragment = getFragment(slotIndex)
            if (fragment == null) {
                remaining--
                continue
            }

            fragment.attachFile(uri) { success ->
                runOnUiThread {
                    if (success) anySuccess = true
                    remaining--
                    if (remaining <= 0) {
                        val msg = if (anySuccess) R.string.attached else R.string.attach_failed
                        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    private fun importCookiesFromUri(uri: Uri) {
        try {
            val inputStream = contentResolver.openInputStream(uri) ?: return
            val json = inputStream.bufferedReader().use { it.readText() }
            inputStream.close()

            val result = CookieImporter.importFromJson(json)
            result.onSuccess { count ->
                Toast.makeText(this, getString(R.string.cookies_imported, count), Toast.LENGTH_SHORT).show()
                binding.viewPager.postDelayed({
                    reloadAllSlots()
                }, 2000)
            }
            result.onFailure { e ->
                Toast.makeText(this, "${getString(R.string.cookies_import_failed)}: ${e.message}", Toast.LENGTH_LONG).show()
            }
        } catch (e: Exception) {
            Toast.makeText(this, "${getString(R.string.cookies_import_failed)}: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun reloadAllSlots() {
        for (i in 0 until SlotManager.NUM_SLOTS) {
            getFragment(i)?.reload()
        }
    }

    private fun getFragment(slotIndex: Int): ChatFragment? {
        return supportFragmentManager.findFragmentByTag("f$slotIndex") as? ChatFragment
            ?: pagerAdapter.getFragment(slotIndex)
    }

    fun collectLatestRepliesFromEnabledSlots(
        lastSentPrompt: String = "",
        onDone: (Map<String, String>) -> Unit
    ) {
        val enabledSlots = (0 until SlotManager.NUM_SLOTS).filter { slotManager.isSlotEnabled(it) }
        val detailed = SettingsManager.isDetailedLoggingEnabled(this)
        if (detailed) {
            Log.d(TAG, "collectLatestRepliesFromEnabledSlots enabledSlots=$enabledSlots")
        }
        if (enabledSlots.isEmpty()) {
            onDone(emptyMap())
            return
        }

        val results = linkedMapOf<String, String>()
        val scrapeMeta = mutableListOf<Map<String, Any?>>()
        var remaining = enabledSlots.size

        enabledSlots.forEach { slotIndex ->
            val fragment = getFragment(slotIndex)
            val service = slotManager.getService(slotIndex)
            val serviceName = service.name
            val serviceId = service.id
            if (fragment == null) {
                if (detailed) {
                    Log.d(TAG, "collectLatestReplies slot=$slotIndex service=$serviceName fragment=null")
                }
                remaining--
                if (remaining <= 0) onDone(results)
                return@forEach
            }
            fragment.getLatestAssistantReply(lastSentPrompt) { scrape ->
                val text = scrape?.text
                if (!text.isNullOrBlank()) {
                    val cleaned = sanitizeScrapedReply(serviceId, text, lastSentPrompt)
                    if (
                        cleaned.isBlank() ||
                        !isQualityScrapedReply(
                            serviceId = serviceId,
                            text = cleaned,
                            sourcePrompt = lastSentPrompt
                        )
                    ) {
                        if (detailed) {
                            Log.d(
                                TAG,
                                "collectLatestReplies slot=$slotIndex service=$serviceName dropped-by-quality rawChars=${text.length} cleanChars=${cleaned.length}"
                            )
                        }
                        remaining--
                        if (remaining <= 0) {
                            lastScrapeMeta = scrapeMeta.toList()
                            if (detailed) {
                                Log.d(TAG, "collectLatestReplies done collected=${results.keys.joinToString()}")
                            }
                            runOnUiThread { onDone(results) }
                        }
                        return@getLatestAssistantReply
                    }

                    synchronized(results) {
                        val sourceUrl = fragment.webView?.url?.takeIf {
                            it.startsWith("http://") || it.startsWith("https://")
                        } ?: service.url
                        val promptCandidate = scrape?.promptCandidate
                            ?.takeIf { it.text.isNotBlank() }
                            ?.let { candidate ->
                                mapOf(
                                    "text" to candidate.text,
                                    "top" to candidate.top,
                                    "bottom" to candidate.bottom,
                                    "html_length" to candidate.htmlLength
                                )
                            }
                        results[serviceName] = cleaned
                        val preview = if (cleaned.length > 160) "${cleaned.take(160)}..." else cleaned
                        scrapeMeta.add(
                            mapOf(
                                "slot" to slotIndex,
                                "service_id" to serviceId,
                                "service_name" to serviceName,
                                "source_url" to sourceUrl,
                                "raw_chars" to text.length,
                                "clean_chars" to cleaned.length,
                                "dropped_chars" to (text.length - cleaned.length).coerceAtLeast(0),
                                "clean_preview" to preview,
                                "dom_diagnostics" to mapOf(
                                    "document_title" to (scrape?.documentTitle ?: ""),
                                    "prompt_candidate" to promptCandidate,
                                    "selected" to mapOf(
                                        "preview" to preview
                                    )
                                )
                            )
                        )
                    }
                    if (detailed) {
                        Log.d(
                            TAG,
                            "collectLatestReplies slot=$slotIndex service=$serviceName rawChars=${text.length} cleanChars=${cleaned.length}"
                        )
                    }
                } else if (detailed) {
                    Log.d(TAG, "collectLatestReplies slot=$slotIndex service=$serviceName no-text")
                }
                remaining--
                if (remaining <= 0) {
                    lastScrapeMeta = scrapeMeta.toList()
                    if (detailed) {
                        Log.d(TAG, "collectLatestReplies done collected=${results.keys.joinToString()}")
                    }
                    runOnUiThread { onDone(results) }
                }
            }
        }
    }

    fun getAggregationSlotStatuses(onDone: (List<AggregationSlotSnapshot>) -> Unit) {
        val enabledSlots = (0 until SlotManager.NUM_SLOTS).filter { slotManager.isSlotEnabled(it) }
        if (enabledSlots.isEmpty()) {
            runOnUiThread { onDone(emptyList()) }
            return
        }

        val snapshots = mutableListOf<AggregationSlotSnapshot>()
        var remaining = enabledSlots.size
        enabledSlots.forEach { slotIndex ->
            val fragment = getFragment(slotIndex)
            val serviceName = slotManager.getService(slotIndex).name
            if (fragment == null) {
                snapshots.add(
                    AggregationSlotSnapshot(
                        slotIndex = slotIndex,
                        serviceName = serviceName,
                        status = AggregationSlotStatus.ERROR
                    )
                )
                remaining--
                if (remaining <= 0) {
                    runOnUiThread { onDone(snapshots.sortedBy { it.slotIndex }) }
                }
                return@forEach
            }

            fragment.isStillGenerating { generating ->
                val status = if (generating) {
                    AggregationSlotStatus.WAITING
                } else {
                    AggregationSlotStatus.READY
                }
                synchronized(snapshots) {
                    snapshots.add(
                        AggregationSlotSnapshot(
                            slotIndex = slotIndex,
                            serviceName = serviceName,
                            status = status
                        )
                    )
                }
                remaining--
                if (remaining <= 0) {
                    runOnUiThread { onDone(snapshots.sortedBy { it.slotIndex }) }
                }
            }
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (isFindBarVisible) {
            hideFindBar()
            return
        }
        val currentSlot = binding.viewPager.currentItem
        val fragment = getFragment(currentSlot)
        val webView = fragment?.webView

        if (webView != null && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        billingManager.destroy()
        super.onDestroy()
    }

    override fun onSubscriptionStateChanged(active: Boolean) {
        runOnUiThread {
            if (active) {
                Toast.makeText(this, R.string.subscription_active, Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onBillingMessage(messageResId: Int) {
        runOnUiThread {
            Toast.makeText(this, messageResId, Toast.LENGTH_SHORT).show()
        }
    }

    private fun isCheat(value: String, expectedHash: String): Boolean {
        val normalized = value.trim()
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(normalized.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return digest == expectedHash
    }

    private fun applyUnstableFeatureVisibility() {
        val enabled = SettingsManager.isUnstableFeaturesEnabled(this)
        binding.btnAttach.visibility = if (enabled) View.VISIBLE else View.GONE
    }

    private fun updateSessionIndicator() {
        val sessionId = SettingsManager.getParallelIngestSessionId(this)
        val hasSession = sessionId != null
        binding.sessionStateDot.visibility = View.VISIBLE
        binding.tvSessionId.visibility = View.GONE
        val color = if (hasSession) {
            Color.parseColor("#4CAF50")
        } else {
            Color.parseColor("#E53935")
        }
        binding.sessionStateDot.backgroundTintList = ColorStateList.valueOf(color)
        binding.sessionStateDot.alpha = 1f
        binding.sessionStateDot.contentDescription = if (hasSession) {
            "Session active"
        } else {
            "No active session"
        }
        binding.chipSessions.contentDescription = if (hasSession) {
            "Active session S$sessionId"
        } else {
            "No active session"
        }
        updateContextChips()
    }

    private fun updateBottomActionForTab(position: Int) {
        val isMergeTab = position == MERGE_TAB_INDEX
        val hasText = binding.messageInput.text?.toString()?.trim()?.isNotEmpty() == true
        val useMergeAction = isMergeTab && !hasText
        
        android.transition.TransitionManager.beginDelayedTransition(binding.bottomPanel)

        // Swap icon instead of text for a cleaner, modern look
        val iconRes = if (useMergeAction) R.drawable.ic_action_merge else R.drawable.ic_action_send
        binding.btnSend.setIconResource(iconRes)
        
        val colorRes = if (useMergeAction) R.color.merge_toggle_on else R.color.action_primary
        val color = ContextCompat.getColor(this, colorRes)
        binding.btnSend.backgroundTintList = ColorStateList.valueOf(color)

        // Keep top bar surface consistent so scrollable tab remainder does not show dark blocks.
        binding.tabLayout.setBackgroundResource(R.color.bg_surface)
        binding.btnSettings.setBackgroundResource(R.color.bg_surface)
    }

    private fun findMergeFragment(): MergeFragment? {
        pagerAdapter.getMergeFragment()?.let { return it }
        val tag = "f${MERGE_TAB_INDEX.toLong()}"
        return supportFragmentManager.findFragmentByTag(tag) as? MergeFragment
    }

    private fun shouldRunMergeFromBottom(): Boolean {
        if (binding.viewPager.currentItem != MERGE_TAB_INDEX) return false
        val hasText = binding.messageInput.text?.toString()?.trim()?.isNotEmpty() == true
        return !hasText
    }

    fun sendMergeNoteToDreamTracker(
        promptText: String,
        markdown: String,
        sourceResponses: Map<String, String> = emptyMap()
    ) {
        val rpcUrl = SettingsManager.getDreamTrackerRpcUrl(this)
        val apiKey = SettingsManager.getDreamTrackerApiKey(this)
        val detailed = SettingsManager.isDetailedLoggingEnabled(this)
        if (rpcUrl.isBlank() || apiKey.isBlank()) return

        thread {
            try {
                val normalizedMarkdown = normalizeMergeMarkdownForIngest(markdown)
                var sessionId = SettingsManager.getParallelIngestSessionId(this)
                    ?: getCurrentQuestionSessionId()
                var aggregatedNoteId = getCurrentQuestionAggregatedNoteId()
                // ingest-parity: BOOTSTRAP_BEFORE_MERGE
                // Merge must not attach to a stale aggregated root from a previous
                // question in the same logical session. Bootstrap a fresh root when
                // either (a) no session/root exists yet, or (b) the loaded root's
                // prompt no longer matches the current question. Without this guard
                // a fresh user prompt sent into an existing session ends up with the
                // merge child wired to the OLD question root (observed in S180).
                val loadedRootPrompt = SettingsManager.getParallelIngestSourcePrompt(this).trim()
                val promptMatchesLoadedRoot = loadedRootPrompt.isNotBlank()
                    && promptsReferToSameQuestion(promptText, loadedRootPrompt)
                val needsBootstrap = (sessionId == null || aggregatedNoteId == null || !promptMatchesLoadedRoot)
                if (needsBootstrap && sourceResponses.isNotEmpty()) {
                    if (detailed) {
                        Log.d(
                            TAG,
                            "merge ingest bootstrap: session=$sessionId root=$aggregatedNoteId match=$promptMatchesLoadedRoot prompt=${promptText.take(120)} responses=${sourceResponses.size}"
                        )
                    }
                    val bootstrapResult = ingestCollectedResponses(
                        prompt = promptText,
                        responses = sourceResponses,
                        replaceExisting = false,
                        aggregatedNoteId = null
                    )
                    sessionId = bootstrapResult?.sessionId ?: getCurrentQuestionSessionId()
                    aggregatedNoteId = bootstrapResult?.noteId ?: getCurrentQuestionAggregatedNoteId()
                }
                if (sessionId == null) {
                    if (detailed) {
                        Log.w(TAG, "merge ingest skipped: no current question session/root")
                    }
                    return@thread
                }
                val traceId = SettingsManager.getParallelIngestTraceId(this)
                    .ifBlank {
                        UUID.randomUUID().toString().also { SettingsManager.setParallelIngestTraceId(this, it) }
                    }
                val sequence = SettingsManager.nextParallelIngestSequence(this)
                val idempotencyKey = AggregatedIngestClient.buildIdempotencyKey(
                    kind = "merge",
                    sessionIdOrTmp = sessionId.toString(),
                    sequence = sequence,
                    traceId = traceId
                )
                if (detailed) {
                    Log.d(TAG, "merge ingest send prompt=${promptText.take(120)} sessionId=$sessionId markdownChars=${normalizedMarkdown.length} idem=$idempotencyKey")
                }
                val payload = MergePayload(
                    sessionId = sessionId,
                    aggregatedNoteId = aggregatedNoteId,
                    promptText = promptText.ifBlank { "" },
                    markdown = normalizedMarkdown
                )
                val result = AggregatedIngestClient.sendMerge(
                    context = this,
                    rpcBaseUrl = rpcUrl,
                    apiKey = apiKey,
                    payload = payload,
                    traceId = traceId,
                    idempotencyKey = idempotencyKey,
                    scrapeMeta = AggregatedIngestClient.toJsonElement(lastScrapeMeta),
                    detailedLogging = detailed
                )
                if (detailed) {
                    Log.d(TAG, "merge ingest ok noteId=${result.noteId} sessionId=${result.sessionId} replay=${result.idempotentReplay}")
                }
            } catch (e: Exception) {
                Log.w(TAG, "merge ingest failed: ${e.message}")
            }
        }
    }

    fun sendClarificationNoteToDreamTracker(promptText: String, markdown: String) {
        val sessionId = SettingsManager.getParallelIngestSessionId(this) ?: return
        val rpcUrl = SettingsManager.getDreamTrackerRpcUrl(this)
        val apiKey = SettingsManager.getDreamTrackerApiKey(this)
        val detailed = SettingsManager.isDetailedLoggingEnabled(this)
        if (rpcUrl.isBlank() || apiKey.isBlank()) return

        thread {
            try {
                val normalizedMarkdown = normalizeMergeMarkdownForIngest(markdown)
                val traceId = SettingsManager.getParallelIngestTraceId(this)
                    .ifBlank {
                        UUID.randomUUID().toString().also { SettingsManager.setParallelIngestTraceId(this, it) }
                    }
                val sequence = SettingsManager.nextParallelIngestSequence(this)
                val idempotencyKey = AggregatedIngestClient.buildIdempotencyKey(
                    kind = "clarification",
                    sessionIdOrTmp = sessionId.toString(),
                    sequence = sequence,
                    traceId = traceId
                )
                if (detailed) {
                    Log.d(TAG, "clarification ingest send prompt=${promptText.take(120)} sessionId=$sessionId markdownChars=${normalizedMarkdown.length} idem=$idempotencyKey")
                }
                val payload = ClarificationPayload(
                    sessionId = sessionId,
                    promptText = promptText.ifBlank { "" },
                    markdown = normalizedMarkdown
                )
                val result = AggregatedIngestClient.sendClarification(
                    context = this,
                    rpcBaseUrl = rpcUrl,
                    apiKey = apiKey,
                    payload = payload,
                    traceId = traceId,
                    idempotencyKey = idempotencyKey,
                    scrapeMeta = AggregatedIngestClient.toJsonElement(lastScrapeMeta),
                    detailedLogging = detailed
                )
                if (detailed) {
                    Log.d(TAG, "clarification ingest ok noteId=${result.noteId} sessionId=${result.sessionId} replay=${result.idempotentReplay}")
                }
            } catch (e: Exception) {
                Log.w(TAG, "clarification ingest failed: ${e.message}")
            }
        }
    }

}
