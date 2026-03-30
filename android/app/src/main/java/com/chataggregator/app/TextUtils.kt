package com.chataggregator.app

private fun normalizeMultilineText(text: String): String {
    return text
        .replace("\r", "")
        .replace("\u00A0", " ")
        .replace(Regex("[ \\t]+\\n"), "\n")
        .replace(Regex("\\n{3,}"), "\n\n")
        .trim()
}

private fun looksLikePipeRow(text: String): Boolean {
    val trimmed = text.trim()
    if (!trimmed.contains("|")) return false
    val cells = trimmed.split("|").map { it.trim() }.filter { it.isNotEmpty() }
    return cells.size >= 2
}

private fun normalizeTableDividerCell(cell: String): String {
    val trimmed = cell.trim()
    if (trimmed.isEmpty()) return cell
    if (!trimmed.all { it == ':' || it == '-' }) return cell
    return when {
        trimmed.startsWith(":") && trimmed.endsWith(":") -> ":---:"
        trimmed.startsWith(":") -> ":---"
        trimmed.endsWith(":") -> "---:"
        else -> "---"
    }
}

private fun looksLikeTableDivider(line: String): Boolean {
    val text = line.trim()
    if (!looksLikePipeRow(text)) return false
    return Regex("^[\\s|:\\-]+$").matches(text)
}

private fun normalizePipeTableMarkdown(text: String): String {
    val lines = text.replace("\r", "").split("\n")
    val out = mutableListOf<String>()
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val next = if (i + 1 < lines.size) lines[i + 1] else ""
        if (looksLikePipeRow(line) && looksLikeTableDivider(next)) {
            if (out.isNotEmpty() && out.last().trim().isNotEmpty()) out.add("")
            out.add(line)
            val headerCells = line
                .trim()
                .removePrefix("|")
                .removeSuffix("|")
                .split("|")
                .map { it.trim() }
                .filter { it.isNotEmpty() }
            out.add("| ${headerCells.joinToString(" | ") { "---" }} |")
            i += 2
            continue
        }
        out.add(line)
        i += 1
    }
    return out.joinToString("\n")
}

private fun repairMarkdownArtifacts(text: String): String {
    val lines = text.replace("\r", "").split("\n")
    val out = mutableListOf<String>()
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trim()
        val next = if (i + 1 < lines.size) lines[i + 1] else ""
        val nextTrimmed = next.trim()

        if (trimmed.equals("Export to Sheets", ignoreCase = true)) {
            i += 1
            continue
        }

        if (trimmed == "-" && nextTrimmed.isNotEmpty() &&
            !Regex("^[-*+]\\s+").containsMatchIn(nextTrimmed) &&
            !Regex("^\\d+[.)]\\s+").containsMatchIn(nextTrimmed)
        ) {
            out.add("- $nextTrimmed")
            i += 2
            continue
        }

        if (Regex("^\\d+[.)]$").matches(trimmed) && nextTrimmed.isNotEmpty() &&
            !Regex("^[-*+]\\s+").containsMatchIn(nextTrimmed) &&
            !Regex("^\\d+[.)]\\s+").containsMatchIn(nextTrimmed)
        ) {
            out.add(trimmed.replace(Regex("\\)$"), ".") + " " + nextTrimmed)
            i += 2
            continue
        }

        if (out.isNotEmpty() && Regex("^\\s*-\\s+").containsMatchIn(trimmed)) {
            val prev = out.last().trim()
            if (Regex("^\\d+\\.\\s+").containsMatchIn(prev)) {
                out.add("  $trimmed")
                i += 1
                continue
            }
        }

        out.add(line)
        i += 1
    }

    return out.joinToString("\n")
        .replace(Regex("([A-Za-z)])\\n(\\d+)\\s+\\|"), "$1^$2 |")
        .replace(Regex("^##\\s+Gemini said\\b[:\\s-]*", RegexOption.MULTILINE), "")
        .replace(Regex("^You said\\s*$", RegexOption.MULTILINE), "")
        .trim()
}

private fun isUnorderedListLine(line: String): Boolean {
    return Regex("^\\s*[-*+]\\s+(?:\\[[ xX]\\]\\s+)?\\S").containsMatchIn(line)
}

private fun isOrderedListLine(line: String): Boolean {
    return Regex("^\\s*\\d+[.)]\\s+\\S").containsMatchIn(line)
}

private fun normalizeListLine(line: String): String {
    var out = line
    out = out.replace(Regex("^\\s*[â€¢â—¦â–ªâ–«â—â—†]\\s+"), "- ")
    out = out.replace(Regex("^\\s*[â€“â€”âˆ’]\\s+"), "- ")
    out = out.replace(Regex("^(\\s*)(\\d+)\\)\\s+"), "$1$2. ")
    return out
}

private fun normalizeListMarkdown(text: String): String {
    val source = text.replace("\r", "").split("\n").map(::normalizeListLine)
    val out = mutableListOf<String>()
    source.forEach { line ->
        val isList = isUnorderedListLine(line) || isOrderedListLine(line)
        if (isList) {
            val prev = out.lastOrNull().orEmpty()
            val prevIsBlank = prev.trim().isEmpty()
            val prevIsList = isUnorderedListLine(prev) || isOrderedListLine(prev)
            if (!prevIsBlank && !prevIsList) out.add("")
        }
        out.add(line)
    }
    return out.joinToString("\n")
}

fun sanitizeScrapedReply(
    serviceId: String,
    rawText: String,
    sourcePrompt: String = ""
): String {
    var text = normalizeMultilineText(rawText)
    if (text.isEmpty()) return ""

    if (sourcePrompt.isNotBlank()) {
        val escaped = Regex.escape(sourcePrompt.trim())
        text = text.replace(
            Regex("^\\s*$escaped[\\s:\"'\\-]*\\n?", RegexOption.IGNORE_CASE),
            ""
        ).trim()
        text = text.replace(
            Regex("^(?:you said|Ð²Ñ‹ ÑÐºÐ°Ð·Ð°Ð»Ð¸)\\s+$escaped[\\s:\"'\\-]*", RegexOption.IGNORE_CASE),
            ""
        ).trim()
        text = text.replace(
            Regex("\\b(?:you said|Ð²Ñ‹ ÑÐºÐ°Ð·Ð°Ð»Ð¸)\\s+$escaped\\b", setOf(RegexOption.IGNORE_CASE)),
            ""
        ).trim()
        text = text.replace(
            Regex("^(?:#{1,6}\\s*)?(?:you said|Ð²Ñ‹ ÑÐºÐ°Ð·Ð°Ð»Ð¸)\\s*:\\s*$escaped[\\s:\"'\\-]*\\n?", RegexOption.IGNORE_CASE),
            ""
        ).trim()
    }

    text = text.replace(
        Regex("^(?:#{1,6}\\s*)?(?:you said|Ð²Ñ‹ ÑÐºÐ°Ð·Ð°Ð»Ð¸)\\s*:\\s*\\n?", RegexOption.IGNORE_CASE),
        ""
    ).trim()

    if (serviceId == "gemini") {
        text = text.replace(Regex("^conversation with gemini\\s*", RegexOption.IGNORE_CASE), "")
        text = text.replace(
            Regex("\\byou said\\b[\\s\\S]*?\\bgemini said\\b[:\\s]*", RegexOption.IGNORE_CASE),
            ""
        )
        text = text.replace(Regex("\\bgemini said\\b[:\\s]*", RegexOption.IGNORE_CASE), "")
        text = text.replace(Regex("opens in a new window[^\\n]*", RegexOption.IGNORE_CASE), "")
        text = text.trim()
    }

    if (serviceId == "grok" && sourcePrompt.isNotBlank()) {
        val escaped = Regex.escape(sourcePrompt.trim())
        text = text.replace(Regex("^\\s*$escaped\\s*\\n?", RegexOption.IGNORE_CASE), "").trim()
        text = text.replace(
            Regex(
                "\\n\\d[\\d,.]*\\s*(?:s|sec|secs|second|seconds)?\\s*$",
                setOf(RegexOption.MULTILINE, RegexOption.IGNORE_CASE)
            ),
            ""
        )
        text = text.replace(
            Regex("\\n(?:thinking|reasoning)\\s*$", setOf(RegexOption.MULTILINE, RegexOption.IGNORE_CASE)),
            ""
        )
        text = text.trim()
    }

    // Grok can append quick-action chips inline (e.g., "1.5s Fast ...") to the assistant text.
    text = text.replace(
        Regex("\\s+\\d+(?:[.,]\\d+)?\\s*s\\s+fast\\b[\\s\\S]*$", RegexOption.IGNORE_CASE),
        ""
    ).trim()

    val dropLine = { line: String ->
        val l = line.trim().lowercase()
        l == "source" || l == "share" || l == "edit" || l == "retry" || l == "copy" || l == "regenerate" ||
            l == "open sidebar" || l == "reply..." || l == "temporary chat" || l == "incognito chat" ||
            l == "tools" || l == "fast" || l == "open" ||
            l.startsWith("model:") || l.contains("window.__") ||
            l.contains("Ð¿ÐµÑ€ÐµÐºÐ»ÑŽÑ‡Ð¸ Ð±Ð¾ÐºÐ¾Ð²ÑƒÑŽ Ð¿Ð°Ð½ÐµÐ»ÑŒ") ||
            l.contains("can make mistakes") || l.contains("please double-check responses") ||
            l.contains("check important info") || l.contains("see cookie preferences") ||
            l == "opens in a new window" ||
            Regex("^www\\.[^\\s]+$").matches(l) ||
            Regex("^\\d[\\d,.]*\\s*(?:s|sec|secs|second|seconds|Ñ)$", RegexOption.IGNORE_CASE).matches(l) ||
            Regex("^\\d+(?:[.,]\\d+)?\\s*s\\s+fast\\b.*$", RegexOption.IGNORE_CASE).matches(l) ||
            l == "Ð±Ñ‹ÑÑ‚Ñ€Ð¾" || l == "Ð¿Ð¾Ð´Ñ€Ð¾Ð±Ð½ÐµÐµ" || l.startsWith("Ñ€Ð°ÑÑÐºÐ°Ð¶Ð¸ Ð±Ð¾Ð»ÑŒÑˆÐµ")
    }

    val lines = text.split("\n")
    val cleaned = mutableListOf<String>()
    var pendingBlank = false
    for (rawLine in lines) {
        val line = rawLine.replace("\t", "  ").replace(Regex("[ \\t]+$"), "")
        val compact = line.replace(Regex("[ \\t]+"), " ").trim()
        if (dropLine(compact)) continue
        if (compact.isEmpty()) {
            if (cleaned.isNotEmpty()) pendingBlank = true
            continue
        }
        if (pendingBlank) {
            cleaned.add("")
            pendingBlank = false
        }
        cleaned.add(line)
    }

    text = cleaned.joinToString("\n").trim()
    text = text
        .replace(Regex("(?:^|\\n)(?:share|edit|retry|copy|regenerate)(?:\\s+(?:share|edit|retry|copy|regenerate))*\\s*$", RegexOption.IGNORE_CASE), "")
        .replace(Regex("(?:^|\\n)(?:reply\\.\\.\\.|open sidebar)\\s*$", setOf(RegexOption.IGNORE_CASE)), "")
        .trim()
    text = text.replace(Regex("^source\\s*\\n+", RegexOption.IGNORE_CASE), "")
    text = normalizeListMarkdown(text)
    text = normalizePipeTableMarkdown(text)
    text = repairMarkdownArtifacts(text)
    if (serviceId == "deepseek" || serviceId == "grok" || serviceId == "gemini") {
        text = convertCsvTablesToMarkdown(text)
        text = convertSpaceAlignedTables(text)
    }
    return normalizeMultilineText(text)
}

fun parseCsvLine(line: String): List<String> {
    val fields = mutableListOf<String>()
    var cur = StringBuilder()
    var inQuotes = false
    var i = 0
    while (i < line.length) {
        val ch = line[i]
        when {
            ch == '"' && inQuotes && i + 1 < line.length && line[i + 1] == '"' -> {
                cur.append('"')
                i++
            }
            ch == '"' -> inQuotes = !inQuotes
            ch == ',' && !inQuotes -> {
                fields.add(cur.toString().trim())
                cur = StringBuilder()
            }
            else -> cur.append(ch)
        }
        i++
    }
    fields.add(cur.toString().trim())
    return fields
}

fun csvBlockToMarkdown(text: String): String? {
    val lines = text.trim().split("\n").map { it.trim() }.filter { it.isNotEmpty() }
    if (lines.size < 2) return null
    if (lines.any { it.startsWith("|") || it.matches(Regex("^[#>\\-*`].*")) }) return null
    if (!lines.all { it.contains(",") }) return null

    val rows = lines.map { parseCsvLine(it) }
    val expectedCols = rows[0].size
    if (expectedCols < 2) return null
    if (!rows.all { it.size == expectedCols || it.size == expectedCols - 1 }) return null

    fun esc(s: String) = s.replace("|", "\\|")
    fun fmtRow(r: List<String>) = "| ${r.joinToString(" | ") { esc(it) }} |"
    val sep = "| ${rows[0].joinToString(" | ") { "---" }} |"

    return buildString {
        appendLine(fmtRow(rows[0]))
        appendLine(sep)
        rows.drop(1).forEach { appendLine(fmtRow(it)) }
    }.trim()
}

fun convertCsvTablesToMarkdown(text: String): String {
    val full = csvBlockToMarkdown(text)
    if (full != null) return full

    val blocks = text.split(Regex("\\n{2,}"))
    val converted = blocks.map { csvBlockToMarkdown(it) ?: it }
    return if (converted.zip(blocks).any { (a, b) -> a != b }) {
        converted.joinToString("\n\n")
    } else {
        text
    }
}

fun convertSpaceAlignedTables(text: String): String {
    fun esc(s: String) = s.replace("|", "\\|")
    fun fmtRow(parts: List<String>, cols: Int): String {
        val padded = parts.toMutableList()
        while (padded.size < cols) padded.add("")
        return "| ${padded.joinToString(" | ") { esc(it) }} |"
    }

    val inputLines = text.split("\n")
    val output = mutableListOf<String>()
    val tableBuf = mutableListOf<List<String>>()
    var colCount = 0

    fun flushTable() {
        if (tableBuf.isEmpty()) return
        if (tableBuf.size < 2) {
            tableBuf.forEach { output.add(it.joinToString("  ")) }
        } else {
            output.add(fmtRow(tableBuf[0], colCount))
            output.add("| ${tableBuf[0].joinToString(" | ") { "---" }} |")
            tableBuf.drop(1).forEach { output.add(fmtRow(it, colCount)) }
        }
        tableBuf.clear()
        colCount = 0
    }

    for (rawLine in inputLines) {
        val line = rawLine.trim()
        if (line.isEmpty()) {
            flushTable()
            output.add("")
            continue
        }
        if (line.matches(Regex("^[|#>\\-*`].*"))) {
            flushTable()
            output.add(rawLine)
            continue
        }
        if (!line.contains("  ")) {
            flushTable()
            output.add(rawLine)
            continue
        }

        val parts = line.split(Regex("\\s{2,}")).map { it.trim() }.filter { it.isNotEmpty() }
        if (parts.size < 2) {
            flushTable()
            output.add(rawLine)
            continue
        }

        when {
            tableBuf.isEmpty() -> {
                colCount = parts.size
                tableBuf.add(parts)
            }
            parts.size in 2..colCount -> tableBuf.add(parts)
            parts.size > colCount -> {
                flushTable()
                colCount = parts.size
                tableBuf.add(parts)
            }
            else -> {
                flushTable()
                output.add(rawLine)
            }
        }
    }
    flushTable()
    return output.joinToString("\n").trim()
}

fun normalizeMergeMarkdownForIngest(fullResponse: String): String {
    return fullResponse
        .replace(
            Regex("\\r?\\n\\r?\\n---\\r?\\nMerge provider:[\\s\\S]*$", RegexOption.IGNORE_CASE),
            ""
        )
        .trim()
}

fun buildClarificationIngestMarkdown(
    userMessage: String,
    assistantResponse: String
): String {
    val user = userMessage.trim()
    val assistant = normalizeMergeMarkdownForIngest(assistantResponse)
    if (user.isBlank()) return assistant
    return buildString {
        appendLine("## User")
        appendLine()
        appendLine(user)
        appendLine()
        appendLine("## Assistant")
        appendLine()
        append(assistant)
    }.trim()
}
