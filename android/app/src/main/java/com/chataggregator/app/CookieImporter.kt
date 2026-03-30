package com.chataggregator.app

import android.webkit.CookieManager
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken

/**
 * Imports cookies from Cookie-Editor JSON format into Android WebView CookieManager.
 * Ported from cookie-import-simple.js.
 */
object CookieImporter {

    private val gson = Gson()

    data class RawCookie(
        val name: String? = null,
        val value: String? = null,
        val domain: String? = null,
        val path: String? = "/",
        val secure: Boolean? = null,
        val httpOnly: Boolean? = null,
        val sameSite: String? = null,
        val expirationDate: Double? = null,
        val expires: Double? = null
    )

    /**
     * Import cookies from JSON string (Cookie-Editor export format).
     * Returns the number of cookies imported.
     */
    fun importFromJson(jsonContent: String): Result<Int> {
        return try {
            if (jsonContent.length > 5 * 1024 * 1024) {
                return Result.failure(Exception("Cookie file too large (max 5MB)"))
            }

            val type = object : TypeToken<List<RawCookie>>() {}.type
            val cookies: List<RawCookie> = gson.fromJson(jsonContent, type)

            val cookieManager = CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)

            var imported = 0
            for (cookie in cookies) {
                if (cookie.name.isNullOrBlank() || cookie.domain.isNullOrBlank()) continue

                // Filter by known domains
                val domainClean = cookie.domain.trimStart('.')
                val isKnown = ServiceConfig.COOKIE_DOMAINS.any { allowed ->
                    domainClean == allowed || domainClean.endsWith(".$allowed")
                }
                if (!isKnown) continue

                val cookieString = buildCookieString(cookie)
                val url = buildUrl(cookie)

                cookieManager.setCookie(url, cookieString)
                imported++
            }

            cookieManager.flush()
            Result.success(imported)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun buildCookieString(cookie: RawCookie): String {
        val sb = StringBuilder()
        sb.append("${cookie.name}=${cookie.value ?: ""}")

        cookie.domain?.let { domain ->
            sb.append("; Domain=$domain")
        }

        sb.append("; Path=${cookie.path ?: "/"}")

        if (cookie.secure == true) {
            sb.append("; Secure")
        }

        if (cookie.httpOnly == true) {
            sb.append("; HttpOnly")
        }

        val sameSite = normalizeSameSite(cookie.sameSite)
        if (sameSite != null) {
            sb.append("; SameSite=$sameSite")
        }

        val expiry = cookie.expirationDate ?: cookie.expires
        if (expiry != null && expiry > 0) {
            // Convert Unix timestamp to HTTP date format
            val expiryMs = (expiry * 1000).toLong()
            val date = java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss z", java.util.Locale.US).apply {
                timeZone = java.util.TimeZone.getTimeZone("GMT")
            }.format(java.util.Date(expiryMs))
            sb.append("; Expires=$date")
        }

        return sb.toString()
    }

    private fun buildUrl(cookie: RawCookie): String {
        val scheme = if (cookie.secure == true) "https" else "https" // always use https
        val domain = cookie.domain?.trimStart('.') ?: ""
        return "$scheme://$domain${cookie.path ?: "/"}"
    }

    private fun normalizeSameSite(value: String?): String? {
        return when (value?.lowercase()) {
            "no_restriction", "none" -> "None"
            "lax" -> "Lax"
            "strict" -> "Strict"
            else -> null
        }
    }
}
