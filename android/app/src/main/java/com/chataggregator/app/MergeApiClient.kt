package com.chataggregator.app

import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

enum class MergeProvider(
    val id: String,
    val title: String,
    val defaultEndpoint: String,
    val defaultModel: String
) {
    CHATGPT("chatgpt_api", "ChatGPT API", "https://api.openai.com/v1/chat/completions", "gpt-4o-mini"),
    DEEPSEEK("deepseek_api", "DeepSeek API", "https://api.deepseek.com/v1/chat/completions", "deepseek-chat"),
    GEMINI("gemini_api", "Gemini API", "https://generativelanguage.googleapis.com/v1beta", "gemini-2.0-flash"),
    PERPLEXITY("perplexity_api", "Perplexity API", "https://api.perplexity.ai/chat/completions", "sonar"),
    CLAUDE("claude_api", "Claude API", "https://api.anthropic.com/v1/messages", "claude-3-5-sonnet-latest"),
    OPENROUTER("openrouter_api", "OpenRouter API", "https://openrouter.ai/api/v1/chat/completions", "openai/gpt-4o-mini"),
    HUGGINGFACE("huggingface_api", "Hugging Face API", "https://router.huggingface.co/v1/chat/completions", ""),
    CUSTOM("custom_api", "Custom OpenAI-Compatible", "", "")
}

data class MergeRequestConfig(
    val provider: MergeProvider,
    val apiKey: String,
    val customEndpoint: String = "",
    val customModel: String = "",
    val fallbackModelsRaw: String = "",
    val sourcePrompt: String = "",
    val mergeInstructions: String = "",
    val clarificationInstructions: String = "",
    val detailedLogging: Boolean = false,
    val clarificationText: String = "",
    val previousSummary: String = "",
    val isClarificationMerge: Boolean = false,
    val originalResponses: Map<String, String> = emptyMap()
)

object MergeApiClient {
    private const val TAG = "MergeApiClient"
    @Volatile
    private var streamingConfigured = false

    private data class OpenAiAttemptResult(
        val text: String,
        val modelUsed: String,
        val attemptedModels: List<String> = listOf(modelUsed)
    )

    private data class MergeProviderResult(
        val text: String,
        val providerId: String,
        val modelUsed: String,
        val attemptedModels: List<String> = listOf(modelUsed)
    )

    private val DEFAULT_MERGE_INSTRUCTIONS = """
You are a neutral synthesis editor.
Write strictly in clean Markdown, with calm concise wording.

Formatting rules (mandatory):
- Keep structure exactly:
  - `## Consensus`
  - `## Disagreements` (include only if real disagreements exist)
  - `## Practical Answer`
- Use bullet lists with one idea per bullet.
- Do NOT use horizontal rules (`---`), “Download”, or code fences unless user explicitly asked for code.
- For tables, output valid GitHub Markdown tables only:
  - header row
  - separator row with exactly one `---` per column
  - consistent column count in all rows
""".trimIndent()

    private val DEFAULT_CLARIFICATION_INSTRUCTIONS =
        "You are a helpful assistant continuing a conversation. Respond naturally and helpfully."

    private val gson = Gson()

    fun configureSharedStreaming(context: android.content.Context) {
        if (streamingConfigured) return
        MergeStreamParser.configure(context.applicationContext)
        streamingConfigured = true
    }

    fun defaultMergeInstructions(): String = DEFAULT_MERGE_INSTRUCTIONS
    fun defaultClarificationInstructions(): String = DEFAULT_CLARIFICATION_INSTRUCTIONS

    fun merge(config: MergeRequestConfig, responses: Map<String, String>): Result<String> {
        return merge(config, responses, onPartial = null)
    }

    fun merge(
        config: MergeRequestConfig,
        responses: Map<String, String>,
        onPartial: ((String) -> Unit)? = null
    ): Result<String> {
        if (responses.isEmpty() && config.previousSummary.isBlank()) {
            return Result.failure(IllegalStateException("No source responses or previous summary"))
        }

        val endpoint = config.customEndpoint.ifBlank { config.provider.defaultEndpoint }
        val model = config.customModel.ifBlank { config.provider.defaultModel }

        val systemPrompt: String
        val chatHistory: List<Map<String, String>>?
        val prompt: String

        if (config.isClarificationMerge) {
            systemPrompt = config.clarificationInstructions.ifBlank { DEFAULT_CLARIFICATION_INSTRUCTIONS }
            chatHistory = buildClarificationHistory(
                historyStr = config.previousSummary,
                originalResponses = config.originalResponses,
                sourcePrompt = config.sourcePrompt
            )
            prompt = config.clarificationText
        } else {
            systemPrompt = "Synthesize multi-model output."
            chatHistory = null
            prompt = buildMergePrompt(config, responses)
        }

        if (config.detailedLogging) {
            Log.d(TAG, "merge provider=${config.provider.id} isClarification=${config.isClarificationMerge} " +
                    "sources=${responses.size} promptChars=${prompt.length} historyMsgs=${chatHistory?.size ?: 0}")
        }

        return try {
            val providerResult = when (config.provider) {
                MergeProvider.CLAUDE -> callClaude(
                    endpoint = endpoint, apiKey = config.apiKey, model = model,
                    prompt = prompt, systemPrompt = systemPrompt, chatHistory = chatHistory,
                    detailedLogging = config.detailedLogging
                ).toProviderResult(config.provider.id)

                MergeProvider.GEMINI -> callGemini(
                    endpoint = endpoint, apiKey = config.apiKey, model = model,
                    prompt = prompt, systemPrompt = systemPrompt, chatHistory = chatHistory,
                    detailedLogging = config.detailedLogging
                ).toProviderResult(config.provider.id)

                MergeProvider.OPENROUTER -> callOpenAiWithFallbacks(
                    endpoint = endpoint, apiKey = config.apiKey,
                    primaryModel = model.ifBlank { "openai/gpt-4o-mini" },
                    fallbackModelsRaw = config.fallbackModelsRaw,
                    prompt = prompt, systemPrompt = systemPrompt, chatHistory = chatHistory,
                    detailedLogging = config.detailedLogging,
                    extraHeaders = mapOf(
                        "HTTP-Referer" to "https://github.com/kvitaliq-maker/chat-aggregator-android",
                        "X-Title" to "Gunshi"
                    ),
                    providerTag = "openrouter",
                    onPartial = onPartial
                ).toProviderResult(config.provider.id)

                MergeProvider.HUGGINGFACE -> {
                    if (model.isBlank()) throw IllegalArgumentException("Hugging Face model ID is required")
                    callOpenAiWithFallbacks(
                        endpoint = endpoint, apiKey = config.apiKey, primaryModel = model,
                        fallbackModelsRaw = config.fallbackModelsRaw,
                        prompt = prompt, systemPrompt = systemPrompt, chatHistory = chatHistory,
                        detailedLogging = config.detailedLogging, providerTag = "huggingface",
                        onPartial = onPartial
                    ).toProviderResult(config.provider.id)
                }

                MergeProvider.CUSTOM -> callOpenAiWithFallbacks(
                    endpoint = endpoint, apiKey = config.apiKey,
                    primaryModel = model.ifBlank { "gpt-4o-mini" },
                    fallbackModelsRaw = config.fallbackModelsRaw,
                    prompt = prompt, systemPrompt = systemPrompt, chatHistory = chatHistory,
                    detailedLogging = config.detailedLogging, providerTag = "custom",
                    onPartial = onPartial
                ).toProviderResult(config.provider.id)

                else -> callOpenAiWithFallbacks(
                    endpoint = endpoint, apiKey = config.apiKey, primaryModel = model,
                    fallbackModelsRaw = config.fallbackModelsRaw,
                    prompt = prompt, systemPrompt = systemPrompt, chatHistory = chatHistory,
                    detailedLogging = config.detailedLogging, providerTag = config.provider.id,
                    onPartial = onPartial
                ).toProviderResult(config.provider.id)
            }

            val text = appendModelMetadata(providerResult)
            if (config.detailedLogging) {
                Log.d(TAG, "merge success provider=${config.provider.id} resultChars=${text.length}")
            }
            Result.success(text)
        } catch (e: Exception) {
            if (config.detailedLogging) {
                Log.e(TAG, "merge failed provider=${config.provider.id}: ${e.message}")
            }
            Result.failure(e)
        }
    }

    // Build proper chat history for clarification: originalResponses as context + conversation turns
    private fun buildClarificationHistory(
        historyStr: String,
        originalResponses: Map<String, String>,
        sourcePrompt: String
    ): List<Map<String, String>> {
        val historyMsgs = parseHistoryToMessages(historyStr)
        val messages = mutableListOf<Map<String, String>>()

        // user turn: original question + scraped LLM responses as context
        val responsesBlock = if (originalResponses.isNotEmpty()) {
            originalResponses.entries.joinToString("\n\n") { (model, text) ->
                "### $model\n${text.take(4000)}"
            }
        } else null

        if (responsesBlock != null) {
            val prefix = if (sourcePrompt.isNotBlank())
                "The user's original question was: \"$sourcePrompt\"\n\nHere are the AI model responses to that question:\n\n"
            else
                "Here are the original AI model responses to synthesize:\n\n"
            messages.add(mapOf("role" to "user", "content" to
                "$prefix$responsesBlock\n\n(Your first task, shown below, was to synthesize these responses — identifying consensus and disagreements, and presenting a unified answer.)"))
        } else if (sourcePrompt.isNotBlank()) {
            messages.add(mapOf("role" to "user", "content" to
                "The user's original question was: \"$sourcePrompt\"\n\n(Your first task, shown below, was to synthesize all AI responses to that question — identifying consensus and disagreements, and presenting a unified answer.)"))
        }

        // First assistant turn is the synthesis result — merge it as assistant reply to context
        val firstAssistant = historyMsgs.firstOrNull()?.takeIf { it["role"] == "assistant" }
        if (firstAssistant != null) {
            messages.add(firstAssistant)
            // Append the rest of the conversation (User/Assistant turns after the first synthesis)
            messages.addAll(historyMsgs.drop(1))
        } else {
            messages.addAll(historyMsgs)
        }

        return messages
    }

    // Parse "Assistant: ...\n\nUser: ..." history string into [{role, content}] list
    // Drops the last entry if it's a User turn (it will be sent as the current prompt)
    private fun parseHistoryToMessages(historyStr: String): List<Map<String, String>> {
        if (historyStr.isBlank()) return emptyList()
        val messages = mutableListOf<Map<String, String>>()
        val parts = historyStr.split(Regex("\n\n(?=User:|Assistant:)"))
        for (part in parts) {
            when {
                part.startsWith("User:") ->
                    messages.add(mapOf("role" to "user", "content" to part.removePrefix("User:").trim()))
                part.startsWith("Assistant:") ->
                    messages.add(mapOf("role" to "assistant", "content" to part.removePrefix("Assistant:").trim()))
            }
        }
        // Drop last user turn — will be sent as the current prompt
        if (messages.lastOrNull()?.get("role") == "user") messages.removeAt(messages.lastIndex)
        return messages
    }

    private fun buildMergePrompt(config: MergeRequestConfig, responses: Map<String, String>): String {
        val languageRule = if (config.sourcePrompt.isNotBlank()) {
            "Write output in the same language as this original user question: \"${config.sourcePrompt}\"."
        } else {
            "Write output in the dominant language used in the source responses."
        }
        val instructions = config.mergeInstructions.ifBlank { DEFAULT_MERGE_INSTRUCTIONS }
        return buildString {
            appendLine(instructions)
            appendLine(languageRule)
            appendLine()
            appendLine("Responses:")
            responses.forEach { (model, text) ->
                appendLine("### $model")
                appendLine(text.take(6000))
                appendLine()
            }
        }
    }

    private fun callOpenAi(
        endpoint: String,
        apiKey: String,
        model: String,
        prompt: String,
        systemPrompt: String,
        chatHistory: List<Map<String, String>>? = null,
        detailedLogging: Boolean,
        extraHeaders: Map<String, String> = emptyMap(),
        onPartial: ((String) -> Unit)? = null
    ): OpenAiAttemptResult {
        if (endpoint.isBlank()) throw IllegalArgumentException("Custom endpoint is empty")
        val messages = mutableListOf<Map<String, String>>()
        messages.add(mapOf("role" to "system", "content" to systemPrompt))
        chatHistory?.let { messages.addAll(it) }
        messages.add(mapOf("role" to "user", "content" to prompt))

        val payload = mapOf(
            "model" to model,
            "messages" to messages,
            "temperature" to 0.2,
            "stream" to true
        )
        val body = postJsonStreamAware(
            endpoint = endpoint,
            headers = mapOf("Authorization" to "Bearer $apiKey") + extraHeaders,
            jsonBody = gson.toJson(payload),
            detailedLogging = detailedLogging,
            onPartial = onPartial
        )
        val text = body.text.trim().ifBlank { throw IllegalStateException("Empty response from provider") }
        val modelUsed = body.modelUsed?.ifBlank { null } ?: model
        return OpenAiAttemptResult(text = text, modelUsed = modelUsed, attemptedModels = listOf(modelUsed))
    }

    private fun callOpenAiWithFallbacks(
        endpoint: String,
        apiKey: String,
        primaryModel: String,
        fallbackModelsRaw: String,
        prompt: String,
        systemPrompt: String,
        chatHistory: List<Map<String, String>>? = null,
        detailedLogging: Boolean,
        extraHeaders: Map<String, String> = emptyMap(),
        providerTag: String,
        onPartial: ((String) -> Unit)? = null
    ): OpenAiAttemptResult {
        val models = buildModelFallbackChain(primaryModel, fallbackModelsRaw)
        var lastError: Exception? = null
        val attempted = mutableListOf<String>()
        for ((idx, model) in models.withIndex()) {
            attempted += model
            try {
                if (detailedLogging) Log.d(TAG, "fallback attempt provider=$providerTag idx=$idx model=$model")
                val result = callOpenAi(
                    endpoint = endpoint, apiKey = apiKey, model = model,
                    prompt = prompt, systemPrompt = systemPrompt, chatHistory = chatHistory,
                    detailedLogging = detailedLogging, extraHeaders = extraHeaders,
                    onPartial = onPartial
                )
                return result.copy(attemptedModels = attempted.toList())
            } catch (e: Exception) {
                lastError = e
                val canRetry = isRateLimitedError(e)
                if (detailedLogging) Log.w(TAG, "fallback failed provider=$providerTag idx=$idx model=$model retry=$canRetry err=${e.message}")
                if (!canRetry || idx == models.lastIndex) throw e
            }
        }
        throw lastError ?: IllegalStateException("All fallback models failed")
    }

    private fun callClaude(
        endpoint: String,
        apiKey: String,
        model: String,
        prompt: String,
        systemPrompt: String,
        chatHistory: List<Map<String, String>>? = null,
        detailedLogging: Boolean
    ): OpenAiAttemptResult {
        val requestedModel = model.ifBlank { "claude-3-5-sonnet-latest" }
        val messages = mutableListOf<Map<String, String>>()
        chatHistory?.let { messages.addAll(it) }
        messages.add(mapOf("role" to "user", "content" to prompt))

        val payload = mapOf(
            "model" to requestedModel,
            "max_tokens" to 1200,
            "system" to systemPrompt,
            "messages" to messages
        )
        val body = postJson(
            endpoint = endpoint,
            headers = mapOf("x-api-key" to apiKey, "anthropic-version" to "2023-06-01"),
            jsonBody = gson.toJson(payload),
            detailedLogging = detailedLogging
        )
        val json = JsonParser.parseString(body).asJsonObject
        val content = json.getAsJsonArray("content")
        if (content == null || content.size() == 0) throw IllegalStateException("Empty Claude response")
        val text = content[0].asJsonObject.get("text")?.asString?.trim().orEmpty()
            .ifBlank { throw IllegalStateException("Empty Claude response text") }
        val modelUsed = json.get("model")?.asString?.trim().orEmpty().ifBlank { requestedModel }
        return OpenAiAttemptResult(text = text, modelUsed = modelUsed, attemptedModels = listOf(modelUsed))
    }

    private fun callGemini(
        endpoint: String,
        apiKey: String,
        model: String,
        prompt: String,
        systemPrompt: String,
        chatHistory: List<Map<String, String>>? = null,
        detailedLogging: Boolean
    ): OpenAiAttemptResult {
        val requestedModel = model.ifBlank { "gemini-2.0-flash" }
        val baseUrl = endpoint.ifBlank { "https://generativelanguage.googleapis.com/v1beta" }
        val fullEndpoint = "${baseUrl.trimEnd('/')}/models/$requestedModel:generateContent?key=$apiKey"

        // Gemini uses 'user'/'model' roles (not 'assistant')
        val contents = mutableListOf<Map<String, Any>>()
        chatHistory?.forEach { msg ->
            contents.add(mapOf(
                "role" to if (msg["role"] == "assistant") "model" else "user",
                "parts" to listOf(mapOf("text" to (msg["content"] ?: "")))
            ))
        }
        contents.add(mapOf("role" to "user", "parts" to listOf(mapOf("text" to prompt))))

        val payload = mapOf(
            "system_instruction" to mapOf("parts" to listOf(mapOf("text" to systemPrompt))),
            "contents" to contents,
            "generationConfig" to mapOf("temperature" to 0.2)
        )
        val body = postJson(
            endpoint = fullEndpoint,
            headers = emptyMap(),
            jsonBody = gson.toJson(payload),
            detailedLogging = detailedLogging
        )
        val json = JsonParser.parseString(body).asJsonObject
        val candidates = json.getAsJsonArray("candidates")
        if (candidates == null || candidates.size() == 0) throw IllegalStateException("Empty Gemini response")
        val text = candidates[0].asJsonObject
            .getAsJsonObject("content")
            .getAsJsonArray("parts")
            .firstOrNull()?.asJsonObject?.get("text")?.asString?.trim()
            .orEmpty()
            .ifBlank { throw IllegalStateException("Empty Gemini response text") }
        val modelUsed = json.get("modelVersion")?.asString?.trim().orEmpty().ifBlank { requestedModel }
        return OpenAiAttemptResult(text = text, modelUsed = modelUsed, attemptedModels = listOf(modelUsed))
    }

    private fun buildModelFallbackChain(primary: String, raw: String): List<String> {
        val fromRaw = raw.split('\n', ',', ';').map { it.trim() }.filter { it.isNotBlank() }
        return (listOf(primary.trim()) + fromRaw).map { it.trim() }.filter { it.isNotBlank() }.distinct()
    }

    private fun isRateLimitedError(e: Exception): Boolean {
        val msg = (e.message ?: "").lowercase()
        return "429" in msg || "rate limit" in msg || "rate-limited" in msg || "too many requests" in msg
    }

    private fun OpenAiAttemptResult.toProviderResult(providerId: String) =
        MergeProviderResult(text = text, providerId = providerId, modelUsed = modelUsed, attemptedModels = attemptedModels)

    private fun appendModelMetadata(result: MergeProviderResult): String {
        val attempted = result.attemptedModels.distinct()
        val fallbackUsed = attempted.size > 1
        return buildString {
            append(result.text.trimEnd())
            append("\n\n---\n")
            append("Merge provider: `${result.providerId}`\n")
            append("LLM used: `${result.modelUsed}`\n")
            append("Fallback used: `${if (fallbackUsed) "yes" else "no"}`\n")
            append("Attempted models: `${attempted.joinToString(" -> ")}`")
        }
    }

    private data class StreamAwareResponse(
        val text: String,
        val modelUsed: String? = null
    )

    private fun postJsonStreamAware(
        endpoint: String,
        headers: Map<String, String>,
        jsonBody: String,
        detailedLogging: Boolean,
        onPartial: ((String) -> Unit)? = null
    ): StreamAwareResponse {
        if (detailedLogging) Log.d(TAG, "POST(stream) ${endpoint.take(80)}... bodyChars=${jsonBody.length}")
        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 20_000
            readTimeout = 120_000
            setRequestProperty("Content-Type", "application/json")
            headers.forEach { (k, v) -> setRequestProperty(k, v) }
        }
        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(jsonBody) }
        val code = conn.responseCode
        if (detailedLogging) Log.d(TAG, "HTTP response code=$code endpoint=${endpoint.take(80)}...")
        if (code !in 200..299) {
            val err = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: "HTTP $code"
            throw IllegalStateException("Provider error ($code): ${err.take(300)}")
        }

        return parseStreamOrJsonResponse(conn, detailedLogging, onPartial)
    }

    private fun parseStreamOrJsonResponse(
        conn: HttpURLConnection,
        detailedLogging: Boolean,
        onPartial: ((String) -> Unit)? = null
    ): StreamAwareResponse {
        val textBuilder = StringBuilder()
        val rawBodyBuilder = StringBuilder()
        var modelUsed: String? = null
        var sawSseData = false
        conn.inputStream.bufferedReader().useLines { lines ->
            lines.forEach { raw ->
                val line = raw.trim()
                if (line.startsWith("data:")) {
                    sawSseData = true
                    val json = MergeStreamParser.parseSsePayload(line)
                    if (json != null) {
                        val chunk = MergeStreamParser.parseChunk(json)
                        if (modelUsed.isNullOrBlank()) {
                            modelUsed = chunk.modelUsed?.trim().orEmpty().ifBlank { null }
                        }
                        if (chunk.deltaText.isNotEmpty()) {
                            textBuilder.append(chunk.deltaText)
                            onPartial?.invoke(textBuilder.toString())
                        }
                    } else if (detailedLogging) {
                        Log.w(TAG, "SSE parse skip: ${line.take(120)}")
                    }
                } else if (!sawSseData) {
                    rawBodyBuilder.append(raw)
                    if (raw.isNotEmpty()) {
                        rawBodyBuilder.append('\n')
                    }
                }
            }
        }

        if (sawSseData) {
            return StreamAwareResponse(text = textBuilder.toString(), modelUsed = modelUsed)
        }

        val rawBody = rawBodyBuilder.toString().trim()
        if (rawBody.isBlank()) {
            return StreamAwareResponse(text = "", modelUsed = modelUsed)
        }
        return try {
            val json = JsonParser.parseString(rawBody).asJsonObject
            val chunk = MergeStreamParser.parseChunk(json)
            val text = MergeStreamParser.extractFinalText(json, rawBody)
            val parsedModel = chunk.modelUsed?.trim().orEmpty().ifBlank { modelUsed }
            StreamAwareResponse(text = text, modelUsed = parsedModel)
        } catch (e: Exception) {
            if (detailedLogging) Log.w(TAG, "Non-SSE parse fallback failed: ${e.message}")
            StreamAwareResponse(text = rawBody, modelUsed = modelUsed)
        }
    }

    private fun postJson(endpoint: String, headers: Map<String, String>, jsonBody: String, detailedLogging: Boolean): String {
        if (detailedLogging) Log.d(TAG, "POST ${endpoint.take(80)}... bodyChars=${jsonBody.length}")
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
        if (detailedLogging) Log.d(TAG, "HTTP response code=$code endpoint=${endpoint.take(80)}...")
        val responseText = if (code in 200..299) {
            conn.inputStream.bufferedReader().use { it.readText() }
        } else {
            conn.errorStream?.bufferedReader()?.use { it.readText() } ?: "HTTP $code"
        }
        if (code !in 200..299) throw IllegalStateException("Provider error ($code): ${responseText.take(300)}")
        return responseText
    }
}
