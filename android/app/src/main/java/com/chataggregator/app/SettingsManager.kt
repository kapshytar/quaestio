import android.content.Context
import android.util.Log
import java.util.Base64
import com.chataggregator.app.MergeApiClient
import com.chataggregator.app.KeyObfuscation

object SettingsManager {

    private const val PREFS_NAME = "app_settings"
    private const val KEY_DETAILED_LOGGING = "detailed_logging"
    private const val KEY_AUTO_CACHE_CLEANUP = "auto_cache_cleanup"
    private const val KEY_LIFETIME_UNLOCKED = "lifetime_unlocked"
    private const val KEY_UNSTABLE_FEATURES_ENABLED = "unstable_features_enabled"
    private const val KEY_MERGE_ENABLED = "merge_enabled"
    private const val KEY_LAST_USER_PROMPT = "last_user_prompt"
    private const val KEY_MERGE_INSTRUCTIONS = "merge_instructions"
    private const val KEY_CLARIFICATION_INSTRUCTIONS = "clarification_instructions"
    private const val KEY_INCOGNITO_MODE = "incognito_mode"
    private const val KEY_APP_MODE = "app_mode"
    private const val KEY_DREAM_TRACKER_RPC_URL = "dream_tracker_rpc_url"
    private const val KEY_DREAM_TRACKER_API_KEY = "dream_tracker_api_key"
    private const val KEY_DREAM_TRACKER_APP_ID = "dream_tracker_app_id"
    private const val KEY_PARALLEL_INGEST_SESSION_ID = "parallel_ingest_session_id"
    private const val KEY_PARALLEL_INGEST_ACTIVE_NOTE_ID = "parallel_ingest_active_note_id"
    private const val KEY_PARALLEL_INGEST_SOURCE_PROMPT = "parallel_ingest_source_prompt"
    private const val KEY_PARALLEL_INGEST_EXTERNAL_CHAT_ID = "parallel_ingest_external_chat_id"
    private const val KEY_PARALLEL_INGEST_TRACE_ID = "parallel_ingest_trace_id"
    private const val KEY_PARALLEL_INGEST_SEQUENCE = "parallel_ingest_sequence"

    fun isDetailedLoggingEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_DETAILED_LOGGING, false)
    }

    fun setDetailedLoggingEnabled(context: Context, enabled: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_DETAILED_LOGGING, enabled).apply()
    }

    fun isAutoCacheCleanupEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_AUTO_CACHE_CLEANUP, false)
    }

    fun setAutoCacheCleanupEnabled(context: Context, enabled: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_AUTO_CACHE_CLEANUP, enabled).apply()
    }

    fun isLifetimeUnlocked(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_LIFETIME_UNLOCKED, false)
    }

    fun setLifetimeUnlocked(context: Context, unlocked: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_LIFETIME_UNLOCKED, unlocked).apply()
    }

    fun isUnstableFeaturesEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_UNSTABLE_FEATURES_ENABLED, false)
    }

    fun setUnstableFeaturesEnabled(context: Context, enabled: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_UNSTABLE_FEATURES_ENABLED, enabled).apply()
    }

    fun isMergeEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_MERGE_ENABLED, true)
    }

    fun setMergeEnabled(context: Context, enabled: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_MERGE_ENABLED, enabled).apply()
    }

    fun getLastUserPrompt(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val encodedPrompt = prefs.getString(KEY_LAST_USER_PROMPT, "") ?: ""
        return if (encodedPrompt.isNotBlank()) {
            try {
                String(Base64.getDecoder().decode(encodedPrompt), Charsets.UTF_8)
            } catch (e: IllegalArgumentException) {
                // Handle cases where existing preference might not be Base64 encoded
                // or is corrupted. Log error and return empty string to prevent further issues.
                Log.e("SettingsManager", "Error decoding last user prompt: ${e.message}")
                ""
            }
        } else {
            ""
        }
    }

    fun setLastUserPrompt(context: Context, prompt: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val encodedPrompt = Base64.getEncoder().encodeToString(prompt.toByteArray(Charsets.UTF_8))
        prefs.edit().putString(KEY_LAST_USER_PROMPT, encodedPrompt).apply()
    }

    fun getMergeInstructions(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_MERGE_INSTRUCTIONS, getDefaultMergeInstructions())
            ?: getDefaultMergeInstructions()
    }

    fun setMergeInstructions(context: Context, instructions: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_MERGE_INSTRUCTIONS, instructions.trim()).apply()
    }

    fun getClarificationInstructions(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_CLARIFICATION_INSTRUCTIONS, "") ?: ""
    }

    fun setClarificationInstructions(context: Context, instructions: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_CLARIFICATION_INSTRUCTIONS, instructions.trim()).apply()
    }

    fun resetMergeInstructions(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove(KEY_MERGE_INSTRUCTIONS).apply()
    }

    fun getDefaultMergeInstructions(): String {
        return MergeApiClient.defaultMergeInstructions()
    }

    fun isIncognitoModeEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_INCOGNITO_MODE, false)
    }

    fun setIncognitoModeEnabled(context: Context, enabled: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_INCOGNITO_MODE, enabled).apply()
    }

    // App mode chosen on first run (changeable later). "local" = on-device only
    // (sessions, nothing sent to the server); "account" = signed in.
    fun getAppMode(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_APP_MODE, null)
    }

    fun setAppMode(context: Context, value: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_APP_MODE, value).apply()
    }

    fun getDreamTrackerRpcUrl(context: Context): String {
        // Hardcoded mode: always use BuildConfig value.
        val buildConfigUrl = com.chataggregator.app.BuildConfig.DREAM_TRACKER_RPC_URL
        return KeyObfuscation.getSupabaseRpcUrl(buildConfigUrl)
    }

    fun setDreamTrackerRpcUrl(context: Context, value: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_DREAM_TRACKER_RPC_URL, value.trim()).apply()
    }

    fun getDreamTrackerApiKey(context: Context): String {
        // Hardcoded mode: always use BuildConfig value.
        val buildConfigKey = com.chataggregator.app.BuildConfig.DREAM_TRACKER_API_KEY
        return KeyObfuscation.getSupabaseApiKey(buildConfigKey)
    }

    fun setDreamTrackerApiKey(context: Context, value: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_DREAM_TRACKER_API_KEY, value.trim()).apply()
    }

    fun getDreamTrackerAppId(context: Context): String {
        // Hardcoded mode: always use BuildConfig value.
        return com.chataggregator.app.BuildConfig.DREAM_TRACKER_APP_ID
            .trim()
            .ifBlank { "chat-aggregator" }
    }

    fun setDreamTrackerAppId(context: Context, value: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_DREAM_TRACKER_APP_ID, value.trim()).apply()
    }

    fun getParallelIngestSessionId(context: Context): Int? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return if (prefs.contains(KEY_PARALLEL_INGEST_SESSION_ID)) {
            prefs.getInt(KEY_PARALLEL_INGEST_SESSION_ID, 0)
        } else {
            null
        }
    }

    fun setParallelIngestSessionId(context: Context, sessionId: Int) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putInt(KEY_PARALLEL_INGEST_SESSION_ID, sessionId).apply()
    }

    fun clearParallelIngestSessionId(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove(KEY_PARALLEL_INGEST_SESSION_ID).apply()
    }

    fun getParallelIngestActiveNoteId(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_PARALLEL_INGEST_ACTIVE_NOTE_ID, "")?.trim().orEmpty()
    }

    fun setParallelIngestActiveNoteId(context: Context, noteId: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_PARALLEL_INGEST_ACTIVE_NOTE_ID, noteId.trim()).apply()
    }

    fun clearParallelIngestActiveNoteId(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove(KEY_PARALLEL_INGEST_ACTIVE_NOTE_ID).apply()
    }

    fun getParallelIngestSourcePrompt(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_PARALLEL_INGEST_SOURCE_PROMPT, "")?.trim().orEmpty()
    }

    fun setParallelIngestSourcePrompt(context: Context, prompt: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_PARALLEL_INGEST_SOURCE_PROMPT, prompt.trim()).apply()
    }

    fun clearParallelIngestSourcePrompt(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove(KEY_PARALLEL_INGEST_SOURCE_PROMPT).apply()
    }

    // One-shot guard: after sign-in / late-login migration, suppress the
    // slot-fingerprint "restore stored question context" so a brand-new question
    // does not silently resurrect a pre-login session that merely shares the same
    // slot layout. Lifted on explicit session load or when a fresh ingest assigns
    // a new session_id. See AUTH_AND_SESSION_SYNC.md.
    private const val KEY_SUPPRESS_SLOT_RESTORE = "suppress_slot_restore"

    fun setSuppressSlotRestore(context: Context, value: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_SUPPRESS_SLOT_RESTORE, value).apply()
    }

    fun getSuppressSlotRestore(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_SUPPRESS_SLOT_RESTORE, false)
    }

    fun getParallelIngestExternalChatId(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_PARALLEL_INGEST_EXTERNAL_CHAT_ID, "")?.trim().orEmpty()
    }

    fun setParallelIngestExternalChatId(context: Context, value: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_PARALLEL_INGEST_EXTERNAL_CHAT_ID, value.trim()).apply()
    }

    fun getParallelIngestTraceId(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_PARALLEL_INGEST_TRACE_ID, "")?.trim().orEmpty()
    }

    fun setParallelIngestTraceId(context: Context, value: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_PARALLEL_INGEST_TRACE_ID, value.trim()).apply()
    }

    fun nextParallelIngestSequence(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val next = prefs.getInt(KEY_PARALLEL_INGEST_SEQUENCE, 0) + 1
        prefs.edit().putInt(KEY_PARALLEL_INGEST_SEQUENCE, next).apply()
        return next
    }

    fun clearParallelIngestState(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .remove(KEY_PARALLEL_INGEST_SESSION_ID)
            .remove(KEY_PARALLEL_INGEST_ACTIVE_NOTE_ID)
            .remove(KEY_PARALLEL_INGEST_SOURCE_PROMPT)
            .remove(KEY_PARALLEL_INGEST_EXTERNAL_CHAT_ID)
            .remove(KEY_PARALLEL_INGEST_TRACE_ID)
            .remove(KEY_PARALLEL_INGEST_SEQUENCE)
            .apply()
    }
}
