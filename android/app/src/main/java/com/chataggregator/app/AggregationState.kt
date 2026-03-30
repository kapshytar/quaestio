package com.chataggregator.app

enum class AggregationSlotStatus(val code: String) {
    IDLE("idle"),
    WAITING("waiting"),
    READY("ready"),
    PAUSED("paused"),
    SCRAPING("scraping"),
    COLLECTED("collected"),
    ERROR("error")
}

data class AggregationSlotSnapshot(
    val slotIndex: Int,
    val serviceName: String,
    val status: AggregationSlotStatus
)

object AggregationStatusFormatter {
    fun summarize(items: List<AggregationSlotSnapshot>): String {
        if (items.isEmpty()) return "Slot aggregation idle"
        return items.joinToString(" • ") { "${it.serviceName}: ${it.status.code}" }
    }
}
