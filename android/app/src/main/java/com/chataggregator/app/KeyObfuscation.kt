package com.chataggregator.app

import java.util.Base64

/**
 * Obfuscation utility for embedding and protecting API keys.
 * Keys are Base64 encoded at build time and decoded at runtime.
 * This provides protection against casual key extraction from APK inspection.
 *
 * WARNING: This is basic obfuscation, not cryptographic encryption.
 * For production use, consider using Android Keystore or encrypted SharedPreferences.
 */
object KeyObfuscation {

    // DeepSeek testing key (Base64 encoded)
    // Encoded from: ***REMOVED***
    private const val DEEPSEEK_EMBEDDED_KEY = "***REMOVED***"

    // Supabase API credentials (Base64 encoded)
    // Encoded from: https://bjqkvlsneujrcfpvcvzf.supabase.co
    private const val SUPABASE_RPC_URL = "aHR0cHM6Ly9ianFrdmxzbmV1anJjZnB2Y3Z6Zi5zdXBhYmFzZS5jbw=="

    // Supabase JWT Service Role Key (Base64 encoded) - for testing only
    // Encoded from: ***REMOVED-OLD-JWT***
    private const val SUPABASE_API_KEY = "ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW1KcWNXdDJiSE51WlhWcWNtTm1jSFpqZG5wbUlpd2ljbTlzWlNJNkluTmxjblpwWTJWZmNtOXNaU0lzSW1saGRDSTZNVGMzTVRjM09UY3lNeXdpWlhod0lqb3lNRGczTXpVMU56SXpmUS5OSlFWNFY4eVpfcURhUEtsYkRrYnctaVJiWWw4ZVBVa3AxS3BxRVUxSEJv"

    /**
     * Decode and return the embedded DeepSeek API key for testing.
     * Used only when user selects "Use Preinstalled Key" option.
     */
    fun getDeepSeekPreinstalledKey(): String {
        return try {
            val decoded = Base64.getDecoder().decode(DEEPSEEK_EMBEDDED_KEY)
            String(decoded, Charsets.UTF_8)
        } catch (e: Exception) {
            ""
        }
    }

    /**
     * Decode and return the Supabase RPC URL.
     * Handles both Base64-encoded and plaintext values.
     * - If envValue is provided, use it as-is (plaintext from environment variable)
     * - Otherwise, decode the embedded Base64-encoded value
     */
    fun getSupabaseRpcUrl(encodedOrPlainValue: String?): String {
        if (!encodedOrPlainValue.isNullOrBlank()) {
            val trimmed = encodedOrPlainValue.trim()

            // If it looks like a URL (starts with http), return as-is (plaintext from env var)
            if (trimmed.startsWith("http")) {
                return trimmed
            }

            // Otherwise, try to decode as Base64
            return try {
                val decoded = Base64.getDecoder().decode(trimmed)
                String(decoded, Charsets.UTF_8)
            } catch (e: Exception) {
                // If decoding fails, return the original value
                trimmed
            }
        }

        // Fallback: use embedded Base64-encoded value
        return try {
            val decoded = Base64.getDecoder().decode(SUPABASE_RPC_URL)
            String(decoded, Charsets.UTF_8)
        } catch (e: Exception) {
            ""
        }
    }

    /**
     * Decode and return the Supabase API key.
     * Handles both Base64-encoded and plaintext values.
     * - If envValue is provided, use it as-is (plaintext from environment variable)
     * - Otherwise, decode the embedded Base64-encoded value
     * This is the service_role JWT - must be protected!
     */
    fun getSupabaseApiKey(encodedOrPlainValue: String?): String {
        if (!encodedOrPlainValue.isNullOrBlank()) {
            val trimmed = encodedOrPlainValue.trim()

            // If it looks like a JWT (contains dots), return as-is (plaintext from env var)
            if (trimmed.contains(".")) {
                return trimmed.removePrefix("Bearer ").removePrefix("bearer ").trim()
            }

            // Otherwise, try to decode as Base64
            return try {
                val decoded = Base64.getDecoder().decode(trimmed)
                String(decoded, Charsets.UTF_8)
            } catch (e: Exception) {
                // If decoding fails, return the original value
                trimmed.removePrefix("Bearer ").removePrefix("bearer ").trim()
            }
        }

        // Fallback: use embedded Base64-encoded value
        return try {
            val decoded = Base64.getDecoder().decode(SUPABASE_API_KEY)
            String(decoded, Charsets.UTF_8).removePrefix("Bearer ").removePrefix("bearer ").trim()
        } catch (e: Exception) {
            ""
        }
    }

    /**
     * Check if the provided string matches the preinstalled DeepSeek key.
     */
    fun isPreinstalledKey(key: String): Boolean {
        return key == getDeepSeekPreinstalledKey()
    }
}
