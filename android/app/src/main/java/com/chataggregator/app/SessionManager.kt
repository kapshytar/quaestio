package com.chataggregator.app

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.time.OffsetDateTime
import java.util.*

/**
 * Manages aggregator sessions (slot configurations) with persistence.
 * Sessions are saved to SharedPreferences and synced to the Supabase backend.
 */
class SessionManager(context: Context, private val slotManager: SlotManager) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("aggregator_sessions", Context.MODE_PRIVATE)
    private val gson = Gson()

    companion object {
        private const val TAG = "SessionManager"
        const val SESSIONS_KEY = "sessions_list"
        const val MAX_SESSIONS = 1000
    }

    private fun snapshotKey(session: SessionSnapshot): String {
        val sessionPart = session.sessionId?.toString() ?: "id:${session.id}"
        val notePart = session.noteId?.takeIf { it.isNotBlank() } ?: "row:${session.id}"
        return "$sessionPart|$notePart"
    }

    private fun canonicalSessionName(session: SessionSnapshot): String {
        return session.name.trim().lowercase(Locale.ROOT)
    }

    private fun dedupeLatestSnapshots(sessions: List<SessionSnapshot>): List<SessionSnapshot> {
        val latestByKey = linkedMapOf<String, SessionSnapshot>()
        sessions.forEach { session ->
            val key = snapshotKey(session)
            val existing = latestByKey[key]
            if (existing == null || session.timestamp >= existing.timestamp) {
                latestByKey[key] = session
            }
        }
        val normalized = latestByKey.values
            .sortedByDescending { it.timestamp }
            .toMutableList()

        // Backfill cleanup for older Android local cache rows that were saved before noteId
        // existed. If a note-backed row is present for the same logical question, drop the
        // note-less clone.
        val noteBackedKeys = normalized
            .filter { it.sessionId != null && !it.noteId.isNullOrBlank() }
            .map { "${it.sessionId}|${canonicalSessionName(it)}" }
            .toHashSet()

        return normalized
            .filterNot { session ->
                session.sessionId != null &&
                    session.noteId.isNullOrBlank() &&
                    noteBackedKeys.contains("${session.sessionId}|${canonicalSessionName(session)}")
            }
            .sortedByDescending { it.timestamp }
            .take(MAX_SESSIONS)
    }

    private fun getStoredSessions(): List<SessionSnapshot> {
        val json = prefs.getString(SESSIONS_KEY, "[]") ?: "[]"
        return try {
            gson.fromJson(json, JsonArray::class.java)
                .map { gson.fromJson(it, SessionSnapshot::class.java) }
        } catch (e: Exception) {
            emptyList()
        }
    }

    // ── Local persistence ────────────────────────────────────────────────────

    fun saveCurrentSession(
        name: String = "",
        dreamSessionId: Int? = null,
        slotUrls: Map<String, String> = emptyMap(),
        noteId: String? = null
    ): SessionSnapshot {
        val timestamp = System.currentTimeMillis()
        val sessionName = name.ifEmpty {
            SimpleDateFormat("HH:mm dd.MM", Locale.getDefault()).format(Date(timestamp))
        }
        val now = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.getDefault())
            .format(Date(timestamp))

        val existing = dreamSessionId?.let { targetSessionId ->
            getStoredSessions()
                .filter {
                    it.sessionId == targetSessionId &&
                        (it.noteId ?: "") == (noteId ?: "")
                }
                .maxByOrNull { it.timestamp }
        }

        val session = SessionSnapshot(
            id = existing?.id ?: "${timestamp.toString(36)}_${Random().nextInt(1000000).toString(36)}",
            timestamp = timestamp,
            sessionId = dreamSessionId,
            noteId = noteId,
            name = sessionName,
            slotConfig = (0 until SlotManager.NUM_SLOTS).associate { i ->
                "slot-${i + 1}" to slotManager.getServiceId(i)
            },
            slotUrls = slotUrls,
            slotEnabled = (0 until SlotManager.NUM_SLOTS).associate { i ->
                "slot-${i + 1}" to slotManager.isSlotEnabled(i)
            },
            createdAt = existing?.createdAt ?: now,
            updatedAt = now
        )

        addSessionToList(session)
        return session
    }

    fun loadSession(sessionId: String): SessionSnapshot? {
        val session = getAllSessions().find { it.id == sessionId } ?: return null
        for (i in 0 until SlotManager.NUM_SLOTS) {
            val slotKey = "slot-${i + 1}"
            session.slotConfig[slotKey]?.let { slotManager.setServiceId(i, it) }
            session.slotEnabled[slotKey]?.let { slotManager.setSlotEnabled(i, it) }
        }
        return session
    }

    fun getAllSessions(): List<SessionSnapshot> {
        return dedupeLatestSnapshots(getStoredSessions())
    }

    fun deleteSession(sessionId: String) {
        saveSessions(getAllSessions().filter { it.id != sessionId })
    }

    fun replaceSessions(sessions: List<SessionSnapshot>) {
        saveSessions(dedupeLatestSnapshots(sessions))
    }

    private fun addSessionToList(session: SessionSnapshot) {
        val existingSessions = getStoredSessions().filter { existing ->
            if (existing.id == session.id) return@filter false
            if (
                session.sessionId != null &&
                existing.sessionId == session.sessionId &&
                (existing.noteId ?: "") == (session.noteId ?: "")
            ) return@filter false
            true
        }
        saveSessions(dedupeLatestSnapshots(listOf(session) + existingSessions))
    }

    private fun saveSessions(sessions: List<SessionSnapshot>) {
        prefs.edit().putString(SESSIONS_KEY, gson.toJson(sessions)).apply()
    }

    // ── Supabase sync ─────────────────────────────────────────────────────────

    suspend fun syncSessionToDatabase(
        session: SessionSnapshot,
        rpcBaseUrl: String,
        apiKey: String
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = JsonObject().apply {
                addProperty("p_action", "save")
                add("p_record_id", null)
                if (session.sessionId != null) addProperty("p_session_id", session.sessionId) else add("p_session_id", null)
                if (!session.noteId.isNullOrBlank()) addProperty("p_note_id", session.noteId) else add("p_note_id", null)
                addProperty("p_name", session.name)
                add("p_slot_config", gson.toJsonTree(session.slotConfig))
                add("p_slot_urls", gson.toJsonTree(session.slotUrls))
                add("p_slot_enabled", gson.toJsonTree(session.slotEnabled))
                addProperty("p_limit", MAX_SESSIONS)
            }
            val raw = postJson(rpcBaseUrl, apiKey, "aggregator_sessions_bridge_v1", gson.toJson(body))
            val root = gson.fromJson(raw, JsonObject::class.java)
            val data = root?.getAsJsonObject("data")
            val savedId = data
                ?.get("id")
                ?.takeIf { !it.isJsonNull }
                ?.asString
            Log.d(TAG, "syncSessionToDatabase ok id=${session.id}")
            if (!savedId.isNullOrBlank()) {
                Log.d(TAG, "syncSessionToDatabase remote id=$savedId")
            }
            true
        } catch (e: Exception) {
            Log.w(TAG, "syncSessionToDatabase failed: ${e.message}")
            false
        }
    }

    suspend fun loadSessionsFromDatabase(
        rpcBaseUrl: String,
        apiKey: String
    ): List<SessionSnapshot> = withContext(Dispatchers.IO) {
        try {
            val body = JsonObject().apply {
                addProperty("p_action", "list")
                add("p_record_id", null)
                add("p_session_id", null)
                add("p_name", null)
                add("p_slot_config", null)
                add("p_slot_urls", null)
                add("p_slot_enabled", null)
                addProperty("p_limit", MAX_SESSIONS)
            }
            val raw = postJson(rpcBaseUrl, apiKey, "aggregator_sessions_bridge_v1", gson.toJson(body))
            val root = gson.fromJson(raw, JsonObject::class.java)
            val arr = root?.getAsJsonArray("data") ?: JsonArray()
            val snapshots = arr.mapNotNull { el ->
                try {
                    val obj = el.asJsonObject
                    val createdAt = obj.get("created_at")?.asString
                        ?: obj.get("createdAt")?.asString
                        ?: ""
                    val updatedAt = obj.get("updated_at")?.asString
                        ?: obj.get("updatedAt")?.asString
                        ?: ""
                    // Try both snake_case field names
                    val slotConfig = parseStringMap(obj.get("slot_config") ?: obj.get("slotConfig"))
                    val slotUrls = parseStringMap(obj.get("slot_urls") ?: obj.get("slotUrls") ?: obj.get("slots"))
                    val slotEnabled = parseBooleanMap(obj.get("slot_enabled") ?: obj.get("slotEnabled"))
                    
                    val sessionIdElement = obj.get("session_id") ?: obj.get("sessionId")
                    val sessionId = sessionIdElement?.takeIf { !it.isJsonNull }?.let {
                        try { it.asInt } catch (e: Exception) { it.asString.toIntOrNull() }
                    }
                    val noteId = (obj.get("note_id") ?: obj.get("noteId") ?: obj.get("question_note_id") ?: obj.get("questionNoteId"))
                        ?.takeIf { !it.isJsonNull }
                        ?.asString
                        ?.takeIf { it.isNotBlank() }

                    val id = obj.get("id")?.asString ?: return@mapNotNull null
                    Log.i(TAG, "[SESSION-DB] id=$id sid=$sessionId nid=$noteId slotConfig=$slotConfig slotUrls=$slotUrls slotEnabled=$slotEnabled")
                    SessionSnapshot(
                        id = id,
                        timestamp = parseIsoTimestamp(updatedAt).takeIf { it > 0L }
                            ?: parseIsoTimestamp(createdAt).takeIf { it > 0L }
                            ?: System.currentTimeMillis(),
                        sessionId = sessionId,
                        noteId = noteId,
                        name = obj.get("name")?.asString ?: "",
                        slotConfig = slotConfig,
                        slotUrls = slotUrls,
                        slotEnabled = slotEnabled,
                        createdAt = createdAt,
                        updatedAt = updatedAt
                    )
                } catch (e: Exception) {
                    Log.w(TAG, "parse session row failed: ${e.message}")
                    null
                }
            }
            val noteQuery = buildString {
                append("select=id,note_session_id,title,updated_at")
                append("&note_type=eq.1")
                append("&order=updated_at.desc")
                append("&limit=")
                append(MAX_SESSIONS)
                append("&note_session_id=not.is.null")
            }
            val notesRaw = getJson(normalizeRestEndpoint(rpcBaseUrl, "notes?$noteQuery"), apiKey)
            val notesArr = try {
                gson.fromJson(notesRaw, JsonArray::class.java) ?: JsonArray()
            } catch (_: Exception) {
                JsonArray()
            }

            val snapshotByNote = mutableMapOf<String, SessionSnapshot>()
            val latestSnapshotBySession = mutableMapOf<Int, SessionSnapshot>()
            snapshots.forEach { snapshot ->
                snapshot.noteId?.takeIf { it.isNotBlank() }?.let { snapshotByNote[it] = snapshot }
                snapshot.sessionId?.let { sid ->
                    val existing = latestSnapshotBySession[sid]
                    if (existing == null || snapshot.timestamp >= existing.timestamp) {
                        latestSnapshotBySession[sid] = snapshot
                    }
                }
            }

            val noteBackedRows = notesArr.mapNotNull { el ->
                try {
                    val obj = el.asJsonObject
                    val noteId = obj.get("id")?.takeIf { !it.isJsonNull }?.asString ?: return@mapNotNull null
                    val rowSessionId = (obj.get("note_session_id") ?: obj.get("session_id"))
                        ?.takeIf { !it.isJsonNull }
                        ?.let {
                            try { it.asInt } catch (_: Exception) { it.asString.toIntOrNull() }
                        } ?: return@mapNotNull null
                    val title = obj.get("title")?.takeIf { !it.isJsonNull }?.asString?.trim().orEmpty()
                    val updatedAt = obj.get("updated_at")?.takeIf { !it.isJsonNull }?.asString ?: ""
                    val matchingSnapshot = snapshotByNote[noteId] ?: latestSnapshotBySession[rowSessionId]

                    SessionSnapshot(
                        id = matchingSnapshot?.id ?: "note:$noteId",
                        timestamp = parseIsoTimestamp(updatedAt).takeIf { it > 0L }
                            ?: matchingSnapshot?.timestamp
                            ?: System.currentTimeMillis(),
                        sessionId = rowSessionId,
                        noteId = noteId,
                        name = title.ifBlank {
                            matchingSnapshot?.name?.trim().orEmpty().ifBlank { "Session #$rowSessionId" }
                        },
                        slotConfig = matchingSnapshot?.slotConfig ?: emptyMap(),
                        slotUrls = matchingSnapshot?.slotUrls ?: emptyMap(),
                        slotEnabled = matchingSnapshot?.slotEnabled ?: emptyMap(),
                        createdAt = matchingSnapshot?.createdAt ?: "",
                        updatedAt = updatedAt.ifBlank { matchingSnapshot?.updatedAt ?: "" }
                    )
                } catch (e: Exception) {
                    Log.w(TAG, "parse note-backed session row failed: ${e.message}")
                    null
                }
            }

            if (noteBackedRows.isNotEmpty()) {
                return@withContext noteBackedRows
                    .sortedByDescending { it.timestamp }
                    .take(MAX_SESSIONS)
            }

            snapshots
        } catch (e: Exception) {
            Log.w(TAG, "loadSessionsFromDatabase failed: ${e.message}")
            emptyList()
        }
    }

    suspend fun deleteSessionFromDatabase(
        sessionId: String,
        rpcBaseUrl: String,
        apiKey: String
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = JsonObject().apply {
                addProperty("p_action", "delete")
                addProperty("p_record_id", sessionId)
                add("p_session_id", null)
                add("p_name", null)
                add("p_slot_config", null)
                add("p_slot_urls", null)
                add("p_slot_enabled", null)
                addProperty("p_limit", 1)
            }
            postJson(rpcBaseUrl, apiKey, "aggregator_sessions_bridge_v1", gson.toJson(body))
            true
        } catch (e: Exception) {
            Log.w(TAG, "deleteSessionFromDatabase failed: ${e.message}")
            false
        }
    }

    // Normalize any slot key format to "slot-N" (1-based), e.g. "slot-1", "0", "slot_1"
    private fun normalizeSlotKey(key: String): String? {
        return when {
            key.startsWith("slot-") -> key  // already canonical: "slot-1"
            key.all { it.isDigit() } -> "slot-${key.toInt() + 1}"  // 0-based int → 1-based
            else -> null
        }
    }

    private fun parseStringMap(element: JsonElement?): Map<String, String> {
        val res = mutableMapOf<String, String>()
        if (element == null || !element.isJsonObject) return res
        val obj = element.asJsonObject
        obj.keySet().forEach { key ->
            res[key] = obj.get(key).asString
        }
        return res
    }

    private fun parseBooleanMap(element: JsonElement?): Map<String, Boolean> {
        val res = mutableMapOf<String, Boolean>()
        if (element == null || !element.isJsonObject) return res
        val obj = element.asJsonObject
        obj.keySet().forEach { key ->
            res[key] = obj.get(key).asBoolean
        }
        return res
    }

    private fun parseIsoTimestamp(value: String): Long {
        if (value.isBlank()) return 0L
        // Prefer java.time parser: handles timezone offsets and long fractional seconds.
        try {
            return OffsetDateTime.parse(value).toInstant().toEpochMilli()
        } catch (_: Exception) {
            // Fallback to legacy parser list below.
        }
        // Supabase may return timestamps with timezone and fractional seconds:
        // 2026-03-05T04:14:44.259241+00:00
        val patterns = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss'Z'"
        )
        for (pattern in patterns) {
            try {
                val parser = SimpleDateFormat(pattern, Locale.US)
                if (pattern.endsWith("'Z'")) {
                    parser.timeZone = TimeZone.getTimeZone("UTC")
                }
                val parsed = parser.parse(value)?.time ?: 0L
                if (parsed > 0L) return parsed
            } catch (_: Exception) {
                // Try next format.
            }
        }
        return 0L
    }

    private fun postJson(
        rpcBaseUrl: String,
        apiKey: String,
        rpcName: String,
        jsonBody: String
    ): String {
        val endpoint = normalizeRpcEndpoint(rpcBaseUrl, rpcName)
        Log.i(TAG, "[RPC] sending to $rpcName endpoint=$endpoint")

        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 20_000
            readTimeout = 30_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("apikey", apiKey)
            setRequestProperty("Authorization", "Bearer $apiKey")
        }
        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(jsonBody) }

        val code = conn.responseCode
        Log.i(TAG, "[RPC] $rpcName response code=$code")
        val text = if (code in 200..299) {
            conn.inputStream.bufferedReader().use { it.readText() }
        } else {
            conn.errorStream?.bufferedReader()?.use { it.readText() } ?: "HTTP $code"
        }
        if (code !in 200..299) {
            Log.w(TAG, "[RPC] $rpcName error ($code): ${text.take(300)}")
            throw IllegalStateException("RPC $rpcName error ($code): ${text.take(300)}")
        }
        return text
    }

    private fun getJson(endpoint: String, apiKey: String): String {
        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 20_000
            readTimeout = 30_000
            setRequestProperty("apikey", apiKey)
            setRequestProperty("Authorization", "Bearer $apiKey")
            setRequestProperty("Accept", "application/json")
        }
        val code = conn.responseCode
        val text = if (code in 200..299) {
            conn.inputStream.bufferedReader().use { it.readText() }
        } else {
            conn.errorStream?.bufferedReader()?.use { it.readText() } ?: "HTTP $code"
        }
        if (code !in 200..299) {
            throw IllegalStateException("REST error ($code): ${text.take(300)}")
        }
        return text
    }

    private fun normalizeRpcEndpoint(baseInput: String, rpcName: String): String {
        val base = baseInput.trim().trimEnd('/')
        val rpcMarker = "/rest/v1/rpc"
        val rpcBase = when {
            base.endsWith(rpcMarker) -> base
            base.contains("$rpcMarker/") -> base.substringBefore("$rpcMarker/") + rpcMarker
            else -> "$base$rpcMarker"
        }
        return "$rpcBase/$rpcName"
    }

    private fun normalizeRestEndpoint(baseInput: String, path: String): String {
        val base = baseInput.trim().trimEnd('/')
        val rpcMarker = "/rest/v1/rpc"
        val restBase = when {
            base.endsWith(rpcMarker) -> base.removeSuffix(rpcMarker) + "/rest/v1"
            base.contains("$rpcMarker/") -> base.substringBefore("$rpcMarker/") + "/rest/v1"
            base.endsWith("/rest/v1") -> base
            else -> "$base/rest/v1"
        }
        return "$restBase/$path"
    }
}

data class SessionSnapshot(
    val id: String,
    val timestamp: Long,
    val sessionId: Int? = null,
    val noteId: String? = null,
    val name: String = "",
    val slotConfig: Map<String, String> = emptyMap(),
    val slotUrls: Map<String, String> = emptyMap(),
    val slotEnabled: Map<String, Boolean> = emptyMap(),
    val createdAt: String = "",
    val updatedAt: String = ""
)
