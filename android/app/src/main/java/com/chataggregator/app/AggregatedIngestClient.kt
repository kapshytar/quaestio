package com.chataggregator.app

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.JsonPrimitive
import java.io.File
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.time.Instant

data class AggregatedResponseItem(
    val segmentId: String,
    val provider: String,
    val sourceUrl: String,
    val markdown: String
)

data class AggregatedPayload(
    val schema: String = "aggregated_ingest_v1",
    val sessionId: Int?,
    val title: String,
    val responses: List<AggregatedResponseItem>,
    val projectTagId: String? = null,
    val aggregatedNoteId: String? = null,
    val replaceExisting: Boolean = false,
    val platformCode: String = "AND"
)

data class AggregatedIngestResult(
    val sessionId: Int?,
    val noteId: String?,
    val payloadHash: String,
    val idempotencyKey: String,
    val idempotentReplay: Boolean,
    val rawResponse: String
)

data class MergePayload(
    val schema: String = "merge_ingest_v1",
    val sessionId: Int,
    val aggregatedNoteId: String? = null,
    val title: String? = null,
    val promptText: String? = null,
    val markdown: String,
    val platformCode: String = "AND"
)

data class ClarificationPayload(
    val schema: String = "clarification_ingest_v1",
    val sessionId: Int,
    val title: String? = null,
    val promptText: String? = null,
    val markdown: String,
    val platformCode: String = "AND"
)

object AggregatedIngestClient {
    private const val TAG = "AggregatedIngestClient"
    private const val SOURCE_PLATFORM_CODE = "AND"
    private const val APP_NAME = "chat-aggregator-android"
    private val gson = Gson()
    private val prettyGson = GsonBuilder().setPrettyPrinting().create()

    fun buildPayload(
        sessionId: Int?,
        title: String,
        responses: Map<String, String>,
        scrapeMeta: List<Map<String, Any?>> = emptyList(),
        projectTagId: String? = null,
        aggregatedNoteId: String? = null,
        replaceExisting: Boolean = false
    ): AggregatedPayload {
        val serviceByName = ServiceConfig.SERVICES.values.associateBy { it.name.lowercase() }
        val metaByServiceName = scrapeMeta.mapNotNull { row ->
            val name = (row["service_name"] as? String)?.trim()?.lowercase()
            if (name.isNullOrBlank()) null else name to row
        }.toMap()
        val normalized = responses.entries.map { (serviceName, markdown) ->
            val service = serviceByName[serviceName.lowercase()]
            val meta = metaByServiceName[serviceName.lowercase()]
            val providerId = (meta?.get("service_id") as? String)?.ifBlank { null }
                ?: service?.id
                ?: normalizeSegmentId(serviceName)
            val slotNumber = (meta?.get("slot") as? Number)?.toInt()?.plus(1)
            val segmentId = if (slotNumber != null && slotNumber > 0) {
                "slot-$slotNumber"
            } else {
                providerId
            }
            val sourceUrl = (meta?.get("source_url") as? String)?.ifBlank { null }
                ?: service?.url
                ?: ""
            AggregatedResponseItem(
                segmentId = segmentId,
                provider = providerId,
                sourceUrl = sourceUrl,
                markdown = markdown
            )
        }.sortedBy { it.segmentId }

        return AggregatedPayload(
            sessionId = sessionId,
            title = title.ifBlank { "Gunshi Merge" },
            responses = normalized,
            projectTagId = projectTagId?.trim()?.takeIf { it.isNotBlank() },
            aggregatedNoteId = aggregatedNoteId?.trim()?.takeIf { it.isNotBlank() },
            replaceExisting = replaceExisting
        )
    }

    fun stableJson(payload: AggregatedPayload): String {
        val root = JsonObject()
        root.addProperty("schema", payload.schema)
        if (payload.sessionId == null) {
            root.add("session_id", JsonNull.INSTANCE)
        } else {
            root.addProperty("session_id", payload.sessionId)
        }
        root.addProperty("title", payload.title)
        payload.projectTagId?.takeIf { it.isNotBlank() }?.let { root.addProperty("project_tag_id", it) }
        payload.aggregatedNoteId?.takeIf { it.isNotBlank() }?.let { root.addProperty("aggregated_note_id", it) }
        if (payload.replaceExisting) {
            root.addProperty("replace_existing", true)
        }
        root.addProperty("platform_code", payload.platformCode)

        val responses = JsonArray()
        payload.responses.forEach { item ->
            val row = JsonObject()
            row.addProperty("segment_id", item.segmentId)
            row.addProperty("provider", item.provider)
            row.addProperty("source_url", item.sourceUrl)
            row.addProperty("markdown", item.markdown)
            responses.add(row)
        }
        root.add("responses", responses)
        return gson.toJson(root)
    }

    fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    fun buildIdempotencyKey(kind: String, sessionIdOrTmp: String, sequence: Int, traceId: String): String {
        return "android:$kind:$sessionIdOrTmp:$sequence:$traceId"
    }

    fun sendAggregated(
        context: Context,
        rpcBaseUrl: String,
        apiKey: String,
        payload: AggregatedPayload,
        traceId: String,
        idempotencyKey: String,
        scrapeMeta: JsonElement? = null,
        detailedLogging: Boolean
    ): AggregatedIngestResult {
        val payloadJson = stableJson(payload)
        return callRpc(
            context = context,
            rpcBaseUrl = rpcBaseUrl,
            apiKey = apiKey,
            rpcName = "ingest_aggregated_v1",
            step = "aggregated",
            sessionId = payload.sessionId,
            payloadJson = payloadJson,
            traceId = traceId,
            idempotencyKey = idempotencyKey,
            scrapeMeta = scrapeMeta,
            detailedLogging = detailedLogging
        )
    }

    fun sendMerge(
        context: Context,
        rpcBaseUrl: String,
        apiKey: String,
        payload: MergePayload,
        traceId: String,
        idempotencyKey: String,
        scrapeMeta: JsonElement? = null,
        detailedLogging: Boolean
    ): AggregatedIngestResult {
        val payloadJson = stableJsonMerge(payload)
        return callRpc(
            context = context,
            rpcBaseUrl = rpcBaseUrl,
            apiKey = apiKey,
            rpcName = "ingest_merge_v1",
            step = "merge",
            sessionId = payload.sessionId,
            payloadJson = payloadJson,
            traceId = traceId,
            idempotencyKey = idempotencyKey,
            scrapeMeta = scrapeMeta,
            detailedLogging = detailedLogging
        )
    }

    fun sendClarification(
        context: Context,
        rpcBaseUrl: String,
        apiKey: String,
        payload: ClarificationPayload,
        traceId: String,
        idempotencyKey: String,
        scrapeMeta: JsonElement? = null,
        detailedLogging: Boolean
    ): AggregatedIngestResult {
        val payloadJson = stableJsonClarification(payload)
        return callRpc(
            context = context,
            rpcBaseUrl = rpcBaseUrl,
            apiKey = apiKey,
            rpcName = "ingest_clarification_v1",
            step = "clarification",
            sessionId = payload.sessionId,
            payloadJson = payloadJson,
            traceId = traceId,
            idempotencyKey = idempotencyKey,
            scrapeMeta = scrapeMeta,
            detailedLogging = detailedLogging
        )
    }

    fun toJsonElement(value: Any?): JsonElement = gson.toJsonTree(value)

    private fun stableJsonMerge(payload: MergePayload): String {
        val root = JsonObject()
        root.addProperty("schema", payload.schema)
        root.addProperty("session_id", payload.sessionId)
        root.addProperty("platform_code", payload.platformCode)
        payload.aggregatedNoteId?.takeIf { it.isNotBlank() }?.let { root.addProperty("aggregated_note_id", it) }
        payload.title?.takeIf { it.isNotBlank() }?.let { root.addProperty("title", it) }
        payload.promptText?.takeIf { it.isNotBlank() }?.let { root.addProperty("prompt_text", it) }
        root.addProperty("markdown", payload.markdown)
        return gson.toJson(root)
    }

    private fun stableJsonClarification(payload: ClarificationPayload): String {
        val root = JsonObject()
        root.addProperty("schema", payload.schema)
        root.addProperty("session_id", payload.sessionId)
        root.addProperty("platform_code", payload.platformCode)
        payload.title?.takeIf { it.isNotBlank() }?.let { root.addProperty("title", it) }
        payload.promptText?.takeIf { it.isNotBlank() }?.let { root.addProperty("prompt_text", it) }
        root.addProperty("markdown", payload.markdown)
        return gson.toJson(root)
    }

    private fun callRpc(
        context: Context,
        rpcBaseUrl: String,
        apiKey: String,
        rpcName: String,
        step: String,
        sessionId: Int?,
        payloadJson: String,
        traceId: String,
        idempotencyKey: String,
        scrapeMeta: JsonElement? = null,
        detailedLogging: Boolean
    ): AggregatedIngestResult {
        val payloadHash = sha256(payloadJson)
        val endpoint = normalizeRpcEndpoint(rpcBaseUrl, rpcName)
        val payloadElement = gson.fromJson(payloadJson, JsonElement::class.java)

        val bodyObj = JsonObject()
        bodyObj.add("p_payload", payloadElement)
        bodyObj.addProperty("p_idempotency_key", idempotencyKey)
        bodyObj.addProperty("p_payload_hash", payloadHash)
        val rpcBody = gson.toJson(bodyObj)

        logDebugEvent(
            context = context,
            rpcBaseUrl = rpcBaseUrl,
            apiKey = apiKey,
            event = buildDebugEvent(
                traceId = traceId,
                sessionId = sessionId,
                step = step,
                rpcName = rpcName,
                idempotencyKey = idempotencyKey,
                payload = payloadElement,
                requestBody = bodyObj,
                scrapeMeta = scrapeMeta
            ),
            detailedLogging = detailedLogging
        )

        if (detailedLogging) {
            Log.d(TAG, "rpc=$rpcName endpoint=$endpoint payloadHash=$payloadHash idempotencyKey=$idempotencyKey")
            Log.d(TAG, "rpc body=$rpcBody")
        }

        var lastErr: Exception? = null
        repeat(2) { attempt ->
            try {
                val raw = postJson(
                    endpoint = endpoint,
                    headers = mapOf(
                        "apikey" to apiKey,
                        "Authorization" to "Bearer $apiKey"
                    ),
                    jsonBody = rpcBody,
                    detailedLogging = detailedLogging
                )
                if (detailedLogging) {
                    Log.d(TAG, "rpc response attempt=${attempt + 1} raw=$raw")
                }
                val result = AggregatedIngestResult(
                    sessionId = extractSessionId(raw),
                    noteId = extractNoteId(raw),
                    payloadHash = payloadHash,
                    idempotencyKey = idempotencyKey,
                    idempotentReplay = extractIdempotentReplay(raw),
                    rawResponse = raw
                )
                logDebugEvent(
                    context = context,
                    rpcBaseUrl = rpcBaseUrl,
                    apiKey = apiKey,
                    event = buildDebugEvent(
                        traceId = traceId,
                        sessionId = result.sessionId ?: sessionId,
                        step = "result",
                        rpcName = rpcName,
                        idempotencyKey = idempotencyKey,
                        payload = payloadElement,
                        requestBody = bodyObj,
                        scrapeMeta = scrapeMeta,
                        rpcResult = parseJsonElementOrString(raw)
                    ),
                    detailedLogging = detailedLogging
                )
                return result
            } catch (e: Exception) {
                lastErr = e
                Log.w(TAG, "rpc=$rpcName attempt=${attempt + 1} failed: ${e.message}")
                if (attempt == 0) {
                    logDebugEvent(
                        context = context,
                        rpcBaseUrl = rpcBaseUrl,
                        apiKey = apiKey,
                        event = buildDebugEvent(
                            traceId = traceId,
                            sessionId = sessionId,
                            step = "error",
                            rpcName = rpcName,
                            idempotencyKey = idempotencyKey,
                            payload = payloadElement,
                            requestBody = bodyObj,
                            scrapeMeta = scrapeMeta,
                            errorText = e.message
                        ),
                        detailedLogging = detailedLogging
                    )
                }
                if (attempt == 0) Thread.sleep(900)
            }
        }

        throw lastErr ?: IllegalStateException("RPC failed without specific error")
    }

    private fun normalizeRpcEndpoint(base: String, rpcName: String): String {
        val trimmed = base.trim().trimEnd('/')
        val suffix = "/rest/v1/rpc/$rpcName"
        return if (trimmed.endsWith(suffix)) {
            trimmed
        } else {
            "$trimmed$suffix"
        }
    }

    private fun buildDebugEvent(
        traceId: String,
        sessionId: Int?,
        step: String,
        rpcName: String,
        idempotencyKey: String,
        payload: JsonElement? = null,
        requestBody: JsonElement? = null,
        scrapeMeta: JsonElement? = null,
        rpcResult: JsonElement? = null,
        errorText: String? = null
    ): JsonObject {
        val event = JsonObject()
        event.addProperty("trace_id", traceId)
        event.addProperty("source_platform_code", SOURCE_PLATFORM_CODE)
        event.addProperty("app_name", APP_NAME)
        event.addProperty("app_version", com.chataggregator.app.BuildConfig.DISPLAY_VERSION)
        if (sessionId == null) {
            event.add("session_id", JsonNull.INSTANCE)
        } else {
            event.addProperty("session_id", sessionId)
        }
        event.addProperty("step", step)
        event.addProperty("rpc_name", rpcName)
        event.addProperty("idempotency_key", idempotencyKey)
        if (payload != null) event.add("payload", payload) else event.add("payload", JsonNull.INSTANCE)
        if (requestBody != null) event.add("request_body", requestBody) else event.add("request_body", JsonNull.INSTANCE)
        if (scrapeMeta != null) event.add("scrape_meta", scrapeMeta) else event.add("scrape_meta", JsonNull.INSTANCE)
        if (rpcResult != null) event.add("rpc_result", rpcResult) else event.add("rpc_result", JsonNull.INSTANCE)
        if (errorText.isNullOrBlank()) event.add("error_text", JsonNull.INSTANCE) else event.addProperty("error_text", errorText)
        event.addProperty("logged_at", Instant.now().toString())
        return event
    }

    private fun logDebugEvent(
        context: Context,
        rpcBaseUrl: String,
        apiKey: String,
        event: JsonObject,
        detailedLogging: Boolean
    ) {
        appendLocalDebugArtifact(context, event, detailedLogging)
        try {
            val endpoint = normalizeRpcEndpoint(rpcBaseUrl, "log_ingest_debug_v1")
            val bodyObj = JsonObject().apply { add("p_event", event) }
            val rpcBody = gson.toJson(bodyObj)
            postJson(
                endpoint = endpoint,
                headers = mapOf(
                    "apikey" to apiKey,
                    "Authorization" to "Bearer $apiKey"
                ),
                jsonBody = rpcBody,
                detailedLogging = detailedLogging
            )
        } catch (e: Exception) {
            Log.w(TAG, "debug log RPC failed: ${e.message}")
        }
    }

    private fun appendLocalDebugArtifact(
        context: Context,
        event: JsonObject,
        detailedLogging: Boolean
    ) {
        val traceId = event.get("trace_id")?.asString?.trim().orEmpty()
        if (traceId.isBlank()) return
        try {
            val dir = File(context.filesDir, "debug-runs")
            if (!dir.exists()) dir.mkdirs()
            val file = File(dir, "$traceId.json")
            val root = if (file.exists()) {
                try {
                    JsonParser.parseString(file.readText()).asJsonObject
                } catch (_: Exception) {
                    JsonObject()
                }
            } else {
                JsonObject()
            }
            root.addProperty("trace_id", traceId)
            val events = root.getAsJsonArray("events") ?: JsonArray().also { root.add("events", it) }
            events.add(event.deepCopy())
            file.writeText(prettyGson.toJson(root))
            if (detailedLogging) {
                Log.d(TAG, "debug artifact updated: ${file.absolutePath}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "debug artifact write failed: ${e.message}")
        }
    }

    private fun extractSessionId(raw: String): Int? {
        return try {
            val parsed = gson.fromJson(raw, JsonElement::class.java)
            when {
                parsed == null || parsed.isJsonNull -> null
                parsed.isJsonPrimitive && parsed.asJsonPrimitive.isNumber -> parsed.asInt
                parsed.isJsonObject -> parsed.asJsonObject.get("session_id")?.takeIf { !it.isJsonNull }?.asInt
                parsed.isJsonArray && parsed.asJsonArray.size() > 0 -> {
                    val first = parsed.asJsonArray[0]
                    if (first.isJsonObject) first.asJsonObject.get("session_id")?.takeIf { !it.isJsonNull }?.asInt else null
                }
                else -> null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun extractNoteId(raw: String): String? {
        return try {
            val parsed = gson.fromJson(raw, JsonElement::class.java)
            when {
                parsed == null || parsed.isJsonNull -> null
                parsed.isJsonObject -> parsed.asJsonObject.get("note_id")?.takeIf { !it.isJsonNull }?.asString
                parsed.isJsonArray && parsed.asJsonArray.size() > 0 -> {
                    val first = parsed.asJsonArray[0]
                    if (first.isJsonObject) first.asJsonObject.get("note_id")?.takeIf { !it.isJsonNull }?.asString else null
                }
                else -> null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun extractIdempotentReplay(raw: String): Boolean {
        return try {
            val parsed = gson.fromJson(raw, JsonElement::class.java)
            when {
                parsed == null || parsed.isJsonNull -> false
                parsed.isJsonObject -> parsed.asJsonObject.get("idempotent_replay")?.asBoolean ?: false
                parsed.isJsonArray && parsed.asJsonArray.size() > 0 -> {
                    val first = parsed.asJsonArray[0]
                    if (first.isJsonObject) first.asJsonObject.get("idempotent_replay")?.asBoolean ?: false else false
                }
                else -> false
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun parseJsonElementOrString(raw: String): JsonElement {
        return try {
            JsonParser.parseString(raw)
        } catch (_: Exception) {
            JsonPrimitive(raw)
        }
    }

    private fun normalizeSegmentId(value: String): String {
        val trimmed = value.trim().lowercase()
        return trimmed
            .map { ch -> if (ch.isLetterOrDigit()) ch else '_' }
            .joinToString("")
            .replace(Regex("_+"), "_")
            .trim('_')
            .ifBlank { "unknown" }
    }

    private fun postJson(
        endpoint: String,
        headers: Map<String, String>,
        jsonBody: String,
        detailedLogging: Boolean
    ): String {
        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 20_000
            readTimeout = 60_000
            setRequestProperty("Content-Type", "application/json")
            headers.forEach { (k, v) -> setRequestProperty(k, v) }
        }
        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(jsonBody) }

        val code = conn.responseCode
        val responseText = if (code in 200..299) {
            conn.inputStream.bufferedReader().use { it.readText() }
        } else {
            conn.errorStream?.bufferedReader()?.use { it.readText() } ?: "HTTP $code"
        }
        if (detailedLogging) {
            Log.d(TAG, "rpc httpCode=$code responseChars=${responseText.length}")
        }
        if (code !in 200..299) {
            throw IllegalStateException("RPC error ($code): ${responseText.take(500)}")
        }
        return responseText
    }
}
