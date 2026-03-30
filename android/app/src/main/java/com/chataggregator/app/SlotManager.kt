package com.chataggregator.app

import android.content.Context
import android.content.SharedPreferences

/**
 * Manages slot-to-service mapping with persistence.
 */
class SlotManager(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("slot_config", Context.MODE_PRIVATE)

    companion object {
        const val NUM_SLOTS = 4
    }

    /**
     * Get the service ID for a slot index (0-based).
     */
    fun getServiceId(slotIndex: Int): String {
        val default = ServiceConfig.DEFAULT_SLOTS.getOrElse(slotIndex) { "chatgpt" }
        return prefs.getString("slot_$slotIndex", default) ?: default
    }

    /**
     * Set the service ID for a slot index.
     */
    fun setServiceId(slotIndex: Int, serviceId: String) {
        prefs.edit().putString("slot_$slotIndex", serviceId).apply()
    }

    /**
     * Get the current service for a slot.
     */
    fun getService(slotIndex: Int): AiService {
        val id = getServiceId(slotIndex)
        return ServiceConfig.getById(id) ?: ServiceConfig.SERVICES.values.first()
    }

    /**
     * Whether a slot is enabled for broadcast.
     */
    fun isSlotEnabled(slotIndex: Int): Boolean {
        return prefs.getBoolean("slot_enabled_$slotIndex", true)
    }

    fun setSlotEnabled(slotIndex: Int, enabled: Boolean) {
        prefs.edit().putBoolean("slot_enabled_$slotIndex", enabled).apply()
    }

    /**
     * Store a custom URL for a slot (when service is "custom").
     */
    fun getCustomUrl(slotIndex: Int): String {
        return prefs.getString("slot_custom_url_$slotIndex", "") ?: ""
    }

    fun setCustomUrl(slotIndex: Int, url: String) {
        prefs.edit().putString("slot_custom_url_$slotIndex", url).apply()
    }
}
