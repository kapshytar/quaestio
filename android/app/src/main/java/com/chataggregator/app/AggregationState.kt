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
        val readyCount = items.count { it.status == AggregationSlotStatus.READY || it.status == AggregationSlotStatus.COLLECTED }
        val waitingCount = items.count { it.status == AggregationSlotStatus.WAITING || it.status == AggregationSlotStatus.PAUSED || it.status == AggregationSlotStatus.SCRAPING }
        val errorCount = items.count { it.status == AggregationSlotStatus.ERROR }

        if (readyCount == items.size) {
            return "All ${items.size} slot(s) ready"
        }

        val pieces = mutableListOf("${readyCount}/${items.size} ready")
        if (waitingCount > 0) {
            pieces += "${waitingCount} waiting"
        }
        if (errorCount > 0) {
            pieces += "${errorCount} empty"
        }
        return pieces.joinToString(" • ")
    }
}
