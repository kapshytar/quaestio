# Scraper Port Guide — chat-aggregator-android
**Source:** `C:\chat-aggregator\renderer.js`
**Target:** `C:\chat-aggregator-android\app\src\main\java\...`
**Date:** 2026-02-25

Этот документ описывает что нужно перенести из desktop-скрейпера (Electron/JS) в Android (Kotlin), в каком порядке и как именно.

---

## Состояние на сегодня

| Фича | Desktop `renderer.js` | Android `ChatFragment.kt` |
|---|---|---|
| DOM scraping | ✅ полный | ⚠️ упрощённый |
| Provider-specific селекторы | ✅ Gemini, Grok, Perplexity | ⚠️ только Perplexity |
| Nested element pruning | ✅ есть | ❌ нет |
| Clipboard-first extraction | ✅ есть | ❌ нет |
| Reply sanitization | ✅ полная | ❌ нет |
| Generation detection | ✅ polling со stop-button | ❌ только fixed delay |
| CSV → markdown | ✅ `convertCsvTablesToMarkdown` | ❌ нет |
| Space-aligned → markdown | ✅ `convertSpaceAlignedTables` | ❌ нет |

---

## Приоритет 1 — Reply Sanitization (критично)

Android сейчас отправляет сырой `innerText` без очистки. Это приводит к:
- UI-мусору в ответах (кнопки Share/Edit/Retry, метки модели)
- Эхо пользовательского промпта в начале
- Артефактам Grok (`1,1с`, `Расскажи больше`)
- Артефактам Gemini (`Opens in a new window`, `www.ozon.ru`)

### Добавить в `ChatFragment.kt`

Новая функция `sanitizeScrapedReply(serviceId: String, rawText: String, sourcePrompt: String): String`.
Реализовать как Kotlin-версию JS-логики из `renderer.js` строки 866–1025:

```kotlin
fun sanitizeScrapedReply(serviceId: String, rawText: String, sourcePrompt: String = ""): String {
    var text = rawText.trim()
    if (text.isEmpty()) return ""

    // 1. Удалить эхо промпта из начала
    if (sourcePrompt.isNotBlank()) {
        val escaped = Regex.escape(sourcePrompt.trim())
        text = text.replace(Regex("^\\s*$escaped[\\s:—\\-]*\\n?", RegexOption.IGNORE_CASE), "").trim()
        text = text.replace(Regex("^(?:you said|вы сказали)\\s+$escaped[\\s:—\\-]*", RegexOption.IGNORE_CASE), "").trim()
    }

    // 2. Gemini-специфичная очистка
    if (serviceId == "gemini") {
        text = text.replace(Regex("^conversation with gemini\\s*", RegexOption.IGNORE_CASE), "")
        text = text.replace(Regex("\\byou said\\b[\\s\\S]*?\\bgemini said\\b[:\\s]*", RegexOption.IGNORE_CASE), "")
        text = text.replace(Regex("\\bgemini said\\b[:\\s]*", RegexOption.IGNORE_CASE), "")
        text = text.replace(Regex("opens in a new window[^\\n]*", RegexOption.IGNORE_CASE), "")
        text = text.trim()
    }

    // 3. Grok-специфичная очистка
    if (serviceId == "grok" && sourcePrompt.isNotBlank()) {
        val escaped = Regex.escape(sourcePrompt.trim())
        text = text.replace(Regex("^\\s*$escaped\\s*\\n?", RegexOption.IGNORE_CASE), "").trim()
        text = text.replace(Regex("\\n\\d[\\d,.]*\\s*[сs]\\s*$", RegexOption.MULTILINE), "")
        text = text.replace(Regex("\\nбыстро\\s*$", RegexOption.MULTILINE or RegexOption.IGNORE_CASE), "")
        text = text.trim()
    }

    // 4. Построчная фильтрация
    val dropLine = { line: String ->
        val l = line.trim().lowercase()
        l.isEmpty() ||
        l == "source" || l == "share" || l == "edit" || l == "retry" || l == "copy" || l == "regenerate" ||
        l == "open sidebar" || l == "reply..." || l == "temporary chat" || l == "incognito chat" ||
        l == "tools" || l == "fast" || l == "open" ||
        l.startsWith("model:") || l.contains("window.__") ||
        l.contains("переключить боковую панель") ||
        l.contains("can make mistakes") || l.contains("please double-check responses") ||
        l.contains("check important info") || l.contains("see cookie preferences") ||
        l == "opens in a new window" ||
        Regex("^www\\.[^\\s]+$").matches(l) ||
        Regex("^\\d[\\d,.]*\\s*[сs]$").matches(l) ||
        l == "быстро" || l == "подробнее" ||
        l.startsWith("расскажи больше")
    }

    val lines = text.split("\n")
    val cleaned = mutableListOf<String>()
    var pendingBlank = false
    for (rawLine in lines) {
        val line = rawLine.trimEnd()
        val compact = line.trim()
        if (dropLine(compact)) continue
        if (compact.isEmpty()) {
            if (cleaned.isNotEmpty()) pendingBlank = true
            continue
        }
        if (pendingBlank) { cleaned.add(""); pendingBlank = false }
        cleaned.add(line)
    }

    text = cleaned.joinToString("\n").trim()

    // 5. Конвертация таблиц
    text = convertCsvTablesToMarkdown(text)
    text = convertSpaceAlignedTables(text)

    return text
}
```

**Вызов в `collectLatestRepliesFromEnabledSlots`** (строка ~1145):
```kotlin
// Было:
results[serviceName] = text

// Стало:
val cleaned = sanitizeScrapedReply(serviceId, text, lastSentPrompt)
if (cleaned.isNotBlank()) results[serviceName] = cleaned
```

Нужно добавить `lastSentPrompt: String` как поле в `MainActivity`.

---

## Приоритет 2 — Provider-specific DOM Selectors

В `ChatFragment.kt` строка ~277 добавить Gemini и Grok селекторы:

```javascript
// В JavaScript-строке внутри getLatestAssistantReply():

// Было:
if (serviceId === 'perplexity') { selectors.unshift('div[class*="prose"]'); }

// Стало:
if (serviceId === 'perplexity') { selectors.unshift('div[class*="prose"]'); }
if (serviceId === 'gemini')     { selectors.unshift('model-response', 'response-container'); }
if (serviceId === 'grok')       { selectors.unshift('div[id^="response-"]', '[class*="message-bubble"]'); }
```

---

## Приоритет 3 — Nested Element Pruning

Сейчас Android берёт кандидата с наибольшим `bottom`, но если это контейнер страницы — он включает весь текст. Desktop-версия удаляет "вложенные" кандидаты когда родительский элемент содержит тот же контент.

Добавить в JavaScript-строку (после сборки `candidates`):

```javascript
// Удалить вложенные элементы: если родитель содержит кандидата и имеет достаточно текста —
// убрать дочерний из списка
const pruned = candidates.filter((candidate) => {
  return !candidates.some((other) => {
    if (other === candidate) return false;
    if (!other.el.contains(candidate.el)) return false;
    if (other.text.length < 120) return false;
    if (candidate.text.length >= other.text.length * 0.8) return false;
    return Math.abs(other.bottom - candidate.bottom) <= 180;
  });
});
const source = pruned.length > 0 ? pruned : candidates;
```

И изменить финальную сортировку:

```javascript
// Было:
candidates.sort((a, b) => b.bottom - a.bottom);
return JSON.stringify({ success: true, text: candidates[0].text });

// Стало:
const maxBottom = source.reduce((acc, c) => Math.max(acc, c.bottom), -Infinity);
const nearBottom = source.filter(c => c.bottom >= maxBottom - 260);
const pool = nearBottom.length > 0 ? nearBottom : source;
pool.sort((a, b) => b.text.length !== a.text.length ? b.text.length - a.text.length : b.bottom - a.bottom);
return JSON.stringify({ success: true, text: pool[0].text });
```

---

## Приоритет 4 — Generation Detection

Сейчас Android ждёт фиксированный delay. Desktop-версия проверяет наличие stop-кнопки.

Добавить в `ChatFragment.kt` новую функцию `isStillGenerating(callback: (Boolean) -> Unit)`:

```kotlin
fun isStillGenerating(callback: (Boolean) -> Unit) {
    val serviceIdJson = gson.toJson(currentServiceId)
    val script = """
(function() {
  try {
    const sid = $serviceIdJson;
    const checks = ['[aria-label="Stop generating"]', '[aria-label="Stop streaming"]',
                    '[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'];
    if (sid === 'claude')     checks.push('[aria-label="Stop Response"]');
    if (sid === 'gemini')     checks.push('.stop-button', '[aria-label*="остановить" i]');
    if (sid === 'deepseek')   checks.push('[aria-label*="Stop" i]', '.stop-button');
    if (sid === 'perplexity') checks.push('[aria-label*="stop" i]');
    if (sid === 'grok')       checks.push('[aria-label*="Stop" i]');
    function hasLayout(el) {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    const found = checks.some(sel => {
      try { return Array.from(document.querySelectorAll(sel)).some(hasLayout); }
      catch(_) { return false; }
    });
    return JSON.stringify({ generating: found });
  } catch(e) { return JSON.stringify({ generating: false }); }
})();
""".trimIndent()
    binding.webView.evaluateJavascript(script) { result ->
        try {
            val map = gson.fromJson(result?.trim()?.removeSurrounding("\"")
                ?.replace("\\\"", "\""), Map::class.java)
            callback(map["generating"] as? Boolean == true)
        } catch (_: Exception) { callback(false) }
    }
}
```

**Интеграция в `startParallelAggregatedIngest`** — заменить первый `handler.postDelayed` на:

```kotlin
// Вместо фиксированного 1200ms delay — ждать пока все слоты закончат генерацию
fun waitForGeneration(attempt: Int, onDone: () -> Unit) {
    if (attempt > 30) { onDone(); return }  // max 90 секунд
    val fragments = enabledSlotIndices.mapNotNull { getFragment(it) }
    var remaining = fragments.size
    if (remaining == 0) { onDone(); return }
    var anyGenerating = false
    fragments.forEach { frag ->
        frag.isStillGenerating { generating ->
            if (generating) anyGenerating = true
            remaining--
            if (remaining <= 0) {
                if (anyGenerating) {
                    handler.postDelayed({ waitForGeneration(attempt + 1, onDone) }, 3000L)
                } else {
                    handler.postDelayed(onDone, 3000L)  // safety delay
                }
            }
        }
    }
}
waitForGeneration(0) { poll(1, emptyMap()) }
```

---

## Приоритет 5 — Table Format Converters

Портировать в `ChatFragment.kt` (или отдельный `TextUtils.kt`):

### CSV → Markdown

```kotlin
fun parseCsvLine(line: String): List<String> {
    val fields = mutableListOf<String>()
    var cur = StringBuilder()
    var inQ = false
    var i = 0
    while (i < line.length) {
        val ch = line[i]
        when {
            ch == '"' && inQ && i + 1 < line.length && line[i + 1] == '"' -> { cur.append('"'); i++ }
            ch == '"' -> inQ = !inQ
            ch == ',' && !inQ -> { fields.add(cur.toString().trim()); cur = StringBuilder() }
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
    return if (converted.zip(blocks).any { (a, b) -> a != b }) converted.joinToString("\n\n") else text
}
```

### Space-aligned → Markdown

```kotlin
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
        if (tableBuf.size < 2) {
            tableBuf.forEach { output.add(it.joinToString("  ")) }
        } else {
            val sep = "| ${tableBuf[0].joinToString(" | ") { "---" }} |"
            output.add(fmtRow(tableBuf[0], colCount))
            output.add(sep)
            tableBuf.drop(1).forEach { output.add(fmtRow(it, colCount)) }
        }
        tableBuf.clear()
        colCount = 0
    }

    for (rawLine in inputLines) {
        val line = rawLine.trim()
        if (line.isEmpty()) { flushTable(); output.add(""); continue }
        if (line.matches(Regex("^[|#>\\-*`].*"))) { flushTable(); output.add(rawLine); continue }
        if (!line.contains("  ")) { flushTable(); output.add(rawLine); continue }
        val parts = line.split(Regex("\\s{2,}")).map { it.trim() }.filter { it.isNotEmpty() }
        if (parts.size < 2) { flushTable(); output.add(rawLine); continue }
        when {
            tableBuf.isEmpty() -> { colCount = parts.size; tableBuf.add(parts) }
            parts.size in 2..colCount -> tableBuf.add(parts)
            parts.size > colCount -> { flushTable(); colCount = parts.size; tableBuf.add(parts) }
            else -> { flushTable(); output.add(rawLine) }
        }
    }
    flushTable()
    return output.joinToString("\n").trim()
}
```

---

## Что НЕ нужно портировать

| Фича | Причина |
|---|---|
| Clipboard-first extraction | Android WebView не имеет доступа к системному буферу обмена — копировать через JS `navigator.clipboard` нельзя. Единственный вариант — нативный `ClipboardManager`, но copy-кнопки LLM-сервисов не кладут туда ничего автоматически. |
| `execCommand('copy')` interceptor | Работает только в Electron с кастомными webview; стандартный Android WebView не поддерживает перехват. |
| Debug trace JSON files | Уже реализовано в Android через `context.filesDir/debug-runs`. |
| Cookie import | Уже реализовано в `CookieImporter.kt`. |

---

## Порядок внедрения

```
1. [ChatFragment.kt]   Добавить provider-specific селекторы (Gemini, Grok)     — 5 мин
2. [ChatFragment.kt]   Добавить nested element pruning в JS-строку              — 15 мин
3. [TextUtils.kt NEW]  Реализовать sanitizeScrapedReply + table converters      — 1 час
4. [MainActivity.kt]   Вызвать sanitizeScrapedReply в collectLatestReplies      — 15 мин
5. [ChatFragment.kt]   Добавить isStillGenerating()                             — 30 мин
6. [MainActivity.kt]   Заменить fixed delay на waitForGeneration()              — 30 мин
```

После шага 4 уже будет значительное улучшение качества ответов.
Шаги 5–6 нужны для надёжности при длинных ответах.
