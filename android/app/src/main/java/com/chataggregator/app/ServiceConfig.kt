package com.chataggregator.app

data class ServiceSelectors(
    val textarea: List<String> = emptyList(),
    val contenteditable: List<String> = emptyList(),
    val button: List<String> = emptyList()
)

data class AiService(
    val id: String,
    val name: String,
    val url: String,
    val selectors: ServiceSelectors
)

object ServiceConfig {

    val SERVICES: Map<String, AiService> = linkedMapOf(
        "chatgpt" to AiService(
            id = "chatgpt",
            name = "ChatGPT",
            url = "https://chatgpt.com",
            selectors = ServiceSelectors(
                textarea = listOf("textarea[id*=\"prompt\"]"),
                button = listOf("button[data-testid=\"send-button\"]")
            )
        ),
        "claude" to AiService(
            id = "claude",
            name = "Claude",
            url = "https://claude.ai",
            selectors = ServiceSelectors(
                contenteditable = listOf("div[contenteditable=\"true\"][enterkeyhint=\"enter\"]"),
                button = listOf("button[aria-label*=\"Send\"]")
            )
        ),
        "gemini" to AiService(
            id = "gemini",
            name = "Gemini",
            url = "https://gemini.google.com",
            selectors = ServiceSelectors(
                contenteditable = listOf("div.ql-editor[contenteditable=\"true\"]"),
                button = listOf("button[aria-label*=\"Send\"]")
            )
        ),
        "grok" to AiService(
            id = "grok",
            name = "Grok",
            url = "https://grok.com",
            selectors = ServiceSelectors(
                contenteditable = listOf("div[contenteditable=\"true\"]"),
                button = listOf("button[data-testid=\"sendButton\"]")
            )
        ),
        "deepseek" to AiService(
            id = "deepseek",
            name = "DeepSeek",
            url = "https://chat.deepseek.com",
            selectors = ServiceSelectors(
                textarea = listOf(
                    "textarea#chat-input",
                    "textarea[placeholder*=\"Message\"]",
                    "textarea[placeholder*=\"Ask\"]"
                ),
                button = listOf(
                    "button[data-testid=\"send-button\"]",
                    "button[aria-label*=\"Send\"]",
                    "button[class*=\"send\"]",
                    "button[type=\"submit\"]"
                )
            )
        ),
        "perplexity" to AiService(
            id = "perplexity",
            name = "Perplexity",
            url = "https://www.perplexity.ai",
            selectors = ServiceSelectors(
                textarea = listOf(
                    "textarea[placeholder*=\"Ask\"]",
                    "textarea[placeholder*=\"Message\"]",
                    "textarea"
                ),
                contenteditable = listOf(
                    "div[contenteditable=\"true\"][role=\"textbox\"]",
                    "div[contenteditable=\"true\"]",
                    "[role=\"textbox\"][contenteditable=\"true\"]"
                ),
                button = listOf(
                    "button[aria-label*=\"Ask\"]",
                    "button[aria-label*=\"Submit\"]",
                    "button[aria-label*=\"Send\"]",
                    "button[aria-label*=\"query\"]",
                    "button[data-testid*=\"submit\"]",
                    "button[data-testid*=\"send\"]",
                    "button[type=\"submit\"]",
                    "button.bg-super",
                    "button.bg-sideBar"
                )
            )
        )
    )

    val DEFAULT_SLOTS = listOf("chatgpt", "claude", "gemini", "grok")

    val SERVICE_NAMES: List<String>
        get() = SERVICES.values.map { it.name }

    val SERVICE_IDS: List<String>
        get() = SERVICES.keys.toList()

    fun getById(id: String): AiService? = SERVICES[id]

    fun detectServiceByUrl(url: String): String? {
        val u = url.lowercase()
        return when {
            "openai.com" in u || "chatgpt.com" in u -> "chatgpt"
            "claude.ai" in u -> "claude"
            "gemini.google.com" in u || "aistudio.google.com" in u -> "gemini"
            "grok.com" in u || "grok.x.com" in u -> "grok"
            "deepseek.com" in u -> "deepseek"
            "perplexity.ai" in u -> "perplexity"
            else -> null
        }
    }

    /** Known domains for cookie filtering */
    val COOKIE_DOMAINS = listOf(
        "openai.com", "chatgpt.com",
        "claude.ai", "anthropic.com",
        "google.com", "googleapis.com", "gstatic.com",
        "grok.com",
        "deepseek.com",
        "perplexity.ai"
    )
}
