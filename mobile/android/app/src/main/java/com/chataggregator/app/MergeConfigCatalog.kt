package com.chataggregator.app

import android.content.Context
import com.google.gson.Gson

data class MergeProviderDescriptor(
    val id: String,
    val title: String,
    val defaultEndpoint: String,
    val defaultModel: String,
    val family: String,
    val supportsPreinstalledKey: Boolean,
    val supportsCustomEndpoint: Boolean,
    val supportsCustomModel: Boolean,
    val supportsFallbackModels: Boolean,
)

data class MergeAggregationPolicy(
    val maxChecks: Int,
    val waitIntervalMs: Long,
    val settleDelayMs: Long,
    val allowPartialResults: Boolean,
    val minimumRepliesRequired: Int,
)

data class MergeConfigCatalog(
    val defaultProviderId: String,
    val aggregationPolicy: MergeAggregationPolicy,
    val providers: List<MergeProviderDescriptor>,
    val defaultMergeInstructions: String,
    val defaultClarificationInstructions: String,
)

object MergeConfigCatalogLoader {
    private val gson = Gson()
    private var cached: MergeConfigCatalog? = null

    fun load(context: Context): MergeConfigCatalog? {
        cached?.let { return it }
        return try {
            val json = context.assets.open("mergeConfig.json").bufferedReader().use { it.readText() }
            gson.fromJson(json, MergeConfigCatalog::class.java).also { cached = it }
        } catch (_: Exception) {
            null
        }
    }
}
