package com.chataggregator.app

import android.content.Context
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.mozilla.javascript.Context as RhinoContext
import org.mozilla.javascript.Function
import org.mozilla.javascript.Scriptable
import org.mozilla.javascript.Undefined

data class MergeParsedChunk(
    val deltaText: String,
    val modelUsed: String?
)

object MergeStreamParser {
    private const val fallbackConfigJson =
        """{"sseDataPrefix":"data:","doneTokens":["[DONE]"],"modelPaths":["model","modelVersion"],"deltaTextPaths":["choices[0].delta.content","choices[0].delta.text","choices[0].text","choices[0].message.content","delta.text","delta.content"],"finalTextPaths":["choices[0].message.content","choices[0].delta.content","choices[0].delta.text","choices[0].text","delta.text","delta.content","content[0].text","candidates[0].content.parts[0].text"]}"""

    private val lock = Any()

    @Volatile
    private var configJson: String = fallbackConfigJson

    @Volatile
    private var scope: Scriptable? = null

    fun configure(context: Context) {
        synchronized(lock) {
            configJson = runCatching {
                context.assets.open("streamParserConfig.json").bufferedReader().use { it.readText() }
            }.getOrDefault(fallbackConfigJson)

            val script = context.assets.open("mergeStreamParser.js").bufferedReader().use { it.readText() }
            val jsContext = RhinoContext.enter().apply {
                optimizationLevel = -1
            }
            try {
                scope = jsContext.initStandardObjects().also {
                    jsContext.evaluateString(it, script, "mergeStreamParser.js", 1, null)
                }
            } finally {
                RhinoContext.exit()
            }
        }
    }

    fun parseSsePayload(rawLine: String): JsonObject? {
        val payload = callStringFunction("parseMergeSsePayload", rawLine, configJson) ?: return null
        return runCatching { JsonParser.parseString(payload).asJsonObject }.getOrNull()
    }

    fun parseChunk(json: JsonObject): MergeParsedChunk {
        val parsedChunkJson = callStringFunction("parseMergeChunk", json.toString(), configJson)
            ?: return MergeParsedChunk(deltaText = "", modelUsed = null)
        val chunkObject = runCatching { JsonParser.parseString(parsedChunkJson).asJsonObject }.getOrNull()
            ?: return MergeParsedChunk(deltaText = "", modelUsed = null)

        return MergeParsedChunk(
            deltaText = chunkObject.get("deltaText")?.takeUnless { it.isJsonNull }?.asString.orEmpty(),
            modelUsed = chunkObject.get("modelUsed")?.takeUnless { it.isJsonNull }?.asString
        )
    }

    fun extractFinalText(json: JsonObject, fallback: String): String {
        return callStringFunction("extractMergeFinalText", json.toString(), fallback, configJson)
            ?.ifBlank { fallback }
            ?: fallback
    }

    private fun callStringFunction(name: String, vararg args: String): String? {
        synchronized(lock) {
            val currentScope = scope ?: return null
            val jsContext = RhinoContext.enter().apply {
                optimizationLevel = -1
            }
            return try {
                val function = currentScope.get(name, currentScope) as? Function ?: return null
                val result = function.call(jsContext, currentScope, currentScope, args)
                when (result) {
                    null, is Undefined -> null
                    else -> RhinoContext.toString(result)
                }
            } finally {
                RhinoContext.exit()
            }
        }
    }
}
