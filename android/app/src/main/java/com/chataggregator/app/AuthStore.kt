package com.chataggregator.app

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

// Supabase Auth for the Android client.
//
// Multi-user: when signed in we send the user's access token as the
// `Authorization: Bearer` on every Supabase REST/RPC call (the `apikey` header
// stays the publishable/anon key), so the backend's owner_id triggers stamp
// rows to this user. Signed out, callers fall back to the publishable key and
// the app behaves as the legacy anon client.
//
// Tokens persist in EncryptedSharedPreferences so the session survives restarts
// without a plaintext refresh token on disk. Mirrors the iOS `AuthStore` and the
// shared contract `shared/contracts/AUTH_AND_SESSION_SYNC.md`.
object AuthStore {
    private const val TAG = "AuthStore"
    private const val PREFS_FILE = "verity_auth_session"
    private const val KEY_SESSION = "session_json"
    // Set when a refresh is *definitively* rejected by GoTrue (400/401 →
    // refresh token revoked/expired). The UI consumes this to tell the user the
    // session expired and prompt re-sign-in, instead of silently degrading to
    // local-only and showing stale local sessions as if still signed in.
    private const val KEY_SESSION_EXPIRED = "session_expired"
    // Refresh a little before the token actually expires to avoid edge races.
    private const val REFRESH_SKEW_SECONDS = 60L

    data class Status(val signedIn: Boolean, val email: String?, val userId: String?)

    private data class Session(
        val accessToken: String,
        val refreshToken: String?,
        val expiresAt: Long,
        val email: String?,
        val userId: String?
    )

    private val gson = Gson()
    private val lock = Any()

    @Volatile private var prefs: SharedPreferences? = null
    @Volatile private var cached: Session? = null
    @Volatile private var loaded = false

    // MARK: - Config (embedded Frankfurt publishable key + URL)

    private fun supabaseUrl(): String =
        KeyObfuscation.getSupabaseRpcUrl(BuildConfig.DREAM_TRACKER_RPC_URL).trimEnd('/')

    private fun apiKey(): String =
        KeyObfuscation.getSupabaseApiKey(BuildConfig.DREAM_TRACKER_API_KEY)

    // MARK: - Public API

    /**
     * The user's valid access token (refreshed if near expiry), or `null` when
     * not signed in. This is the **gate** for every Supabase call: `null` means
     * local-only mode — the caller must NOT touch the backend (no anonymous
     * publishable-key fallback). Blocking — call off the main thread (the
     * Supabase RPC/REST call sites already run on background threads).
     */
    fun accessToken(context: Context): String? {
        synchronized(lock) {
            loadIfNeeded(context)
            val session = cached ?: return null
            if (session.accessToken.isBlank()) return null
            val now = System.currentTimeMillis() / 1000
            if (session.expiresAt - now <= REFRESH_SKEW_SECONDS) {
                if (!refresh(context)) return null
            }
            return cached?.accessToken?.takeIf { it.isNotBlank() }
        }
    }

    /**
     * Pure, side-effect-free gate rule (unit-tested in `AuthGateTest`): a blank
     * or absent token means local-only — return `null` so the caller skips the
     * backend rather than falling back to the publishable key.
     */
    @JvmStatic
    fun gateBearer(accessToken: String?): String? =
        accessToken?.trim()?.takeIf { it.isNotBlank() }

    fun status(context: Context): Status {
        synchronized(lock) {
            loadIfNeeded(context)
            val session = cached
            return Status(
                signedIn = !session?.accessToken.isNullOrBlank(),
                email = session?.email,
                userId = session?.userId
            )
        }
    }

    fun signIn(context: Context, email: String, password: String): Result<Status> {
        val url = supabaseUrl()
        val key = apiKey()
        if (url.isBlank() || key.isBlank()) {
            return Result.failure(IllegalStateException("Supabase is not configured."))
        }
        return try {
            val body = JsonObject().apply {
                addProperty("email", email.trim())
                addProperty("password", password)
            }
            val (code, text) = post(
                "$url/auth/v1/token?grant_type=password",
                mapOf("apikey" to key),
                gson.toJson(body)
            )
            val json = parse(text)
            synchronized(lock) {
                if (code in 200..299 && setSession(context, json)) {
                    Result.success(statusLocked())
                } else {
                    Result.failure(Exception(message(json) ?: "Sign-in failed ($code)."))
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun signOut(context: Context) {
        synchronized(lock) {
            loadIfNeeded(context)
            val token = cached?.accessToken
            val url = supabaseUrl()
            val key = apiKey()
            if (!token.isNullOrBlank() && url.isNotBlank()) {
                // Best-effort server-side revoke; the local clear is what matters.
                try {
                    post(
                        "$url/auth/v1/logout",
                        mapOf("apikey" to key, "Authorization" to "Bearer $token"),
                        "{}"
                    )
                } catch (_: Exception) {
                }
            }
            clear(context)
        }
    }

    // MARK: - Refresh (caller holds lock)

    private fun refresh(context: Context): Boolean {
        val refreshToken = cached?.refreshToken
        if (refreshToken.isNullOrBlank()) return false
        val url = supabaseUrl()
        val key = apiKey()
        return try {
            val body = JsonObject().apply { addProperty("refresh_token", refreshToken) }
            val (code, text) = post(
                "$url/auth/v1/token?grant_type=refresh_token",
                mapOf("apikey" to key),
                gson.toJson(body)
            )
            when {
                code in 200..299 && setSession(context, parse(text)) -> true
                // Definitive auth rejection: the refresh token itself is
                // invalid/revoked/expired (GoTrue returns 400 invalid_grant or
                // 401). Nothing local can recover it — clear the session and
                // flag it so the UI prompts a fresh sign-in.
                code == 400 || code == 401 -> {
                    Log.w(TAG, "refresh rejected ($code): ${text.take(200)} — clearing session")
                    clear(context)
                    setSessionExpired(context)
                    false
                }
                // Transient failure (5xx / unexpected / unparseable 2xx): keep
                // the session so a later call can retry. Do NOT nuke a valid
                // session over a server blip.
                else -> {
                    Log.w(TAG, "refresh transient failure ($code): ${text.take(200)} — keeping session")
                    false
                }
            }
        } catch (e: Exception) {
            // Network error: keep the session, just fall back to local-only for
            // this call; a later call retries once connectivity returns.
            Log.w(TAG, "refresh error: ${e.message} — keeping session")
            false
        }
    }

    /**
     * True exactly once after a refresh was *definitively* rejected (token
     * revoked/expired). Consuming clears the flag so the prompt shows once per
     * expiry. The UI uses this to surface "session expired — sign in again"
     * rather than silently showing stale local sessions while in account mode.
     */
    fun consumeSessionExpired(context: Context): Boolean {
        synchronized(lock) {
            val p = prefs(context)
            if (!p.getBoolean(KEY_SESSION_EXPIRED, false)) return false
            try { p.edit().remove(KEY_SESSION_EXPIRED).apply() } catch (_: Exception) {}
            return true
        }
    }

    private fun setSessionExpired(context: Context) {
        try { prefs(context).edit().putBoolean(KEY_SESSION_EXPIRED, true).apply() } catch (_: Exception) {}
    }

    // MARK: - Session decoding / persistence (caller holds lock)

    private fun setSession(context: Context, json: JsonObject?): Boolean {
        val accessToken = json?.get("access_token")?.takeIf { !it.isJsonNull }?.asString
        if (accessToken.isNullOrBlank()) return false
        val now = System.currentTimeMillis() / 1000
        val expiresAt = when {
            json.has("expires_at") && !json.get("expires_at").isJsonNull ->
                json.get("expires_at").asLong
            json.has("expires_in") && !json.get("expires_in").isJsonNull ->
                now + json.get("expires_in").asLong
            else -> now + 3600
        }
        val user = json.getAsJsonObject("user")
        val session = Session(
            accessToken = accessToken,
            refreshToken = json.get("refresh_token")?.takeIf { !it.isJsonNull }?.asString
                ?: cached?.refreshToken,
            expiresAt = expiresAt,
            email = user?.get("email")?.takeIf { !it.isJsonNull }?.asString ?: cached?.email,
            userId = user?.get("id")?.takeIf { !it.isJsonNull }?.asString ?: cached?.userId
        )
        cached = session
        loaded = true
        try {
            // A fresh token means we are not in an expired state — drop any
            // pending expiry flag so a successful re-sign-in/refresh is silent.
            prefs(context).edit()
                .putString(KEY_SESSION, gson.toJson(session))
                .remove(KEY_SESSION_EXPIRED)
                .apply()
        } catch (e: Exception) {
            Log.w(TAG, "persist failed: ${e.message}")
        }
        return true
    }

    private fun clear(context: Context) {
        cached = null
        loaded = true
        try {
            // Explicit sign-out / clear drops the expiry flag too; refresh()
            // re-sets it *after* calling clear() when the rejection was a real
            // token expiry, so a deliberate sign-out never shows the prompt.
            prefs(context).edit()
                .remove(KEY_SESSION)
                .remove(KEY_SESSION_EXPIRED)
                .apply()
        } catch (e: Exception) {
            Log.w(TAG, "clear failed: ${e.message}")
        }
    }

    private fun loadIfNeeded(context: Context) {
        if (loaded) return
        loaded = true
        cached = try {
            val raw = prefs(context).getString(KEY_SESSION, null)
            if (raw.isNullOrBlank()) null else gson.fromJson(raw, Session::class.java)
        } catch (e: Exception) {
            Log.w(TAG, "load failed: ${e.message}")
            null
        }
    }

    private fun statusLocked(): Status {
        val session = cached
        return Status(
            signedIn = !session?.accessToken.isNullOrBlank(),
            email = session?.email,
            userId = session?.userId
        )
    }

    private fun message(json: JsonObject?): String? {
        if (json == null) return null
        return listOf("error_description", "msg", "error")
            .firstNotNullOfOrNull { json.get(it)?.takeIf { e -> !e.isJsonNull }?.asString }
    }

    private fun parse(text: String): JsonObject? = try {
        JsonParser.parseString(text).asJsonObject
    } catch (_: Exception) {
        null
    }

    // MARK: - Storage

    private fun prefs(context: Context): SharedPreferences {
        prefs?.let { return it }
        val appContext = context.applicationContext
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        val created = EncryptedSharedPreferences.create(
            appContext,
            PREFS_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
        prefs = created
        return created
    }

    // MARK: - HTTP

    private fun post(endpoint: String, headers: Map<String, String>, jsonBody: String): Pair<Int, String> {
        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 20_000
            readTimeout = 30_000
            setRequestProperty("Content-Type", "application/json")
            headers.forEach { (k, v) -> setRequestProperty(k, v) }
        }
        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(jsonBody) }
        val code = conn.responseCode
        val text = if (code in 200..299) {
            conn.inputStream.bufferedReader().use { it.readText() }
        } else {
            conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
        }
        return code to text
    }
}

/** Thrown by Supabase write paths when not signed in, so the orchestrator can
 *  treat the attempt as local-only instead of writing anonymously. */
class NotSignedInException : Exception("Not signed in — local-only mode")
