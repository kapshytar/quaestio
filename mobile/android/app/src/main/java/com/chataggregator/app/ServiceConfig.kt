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
                    "textarea[placeholder*=\"Ask\"]",
                    "textarea"
                ),
                contenteditable = listOf(
                    "div[contenteditable=\"true\"][role=\"textbox\"]",
                    "div[contenteditable=\"true\"]"
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
        ),
        "qwen" to AiService(
            id = "qwen",
            name = "Qwen",
            url = "https://chat.qwen.ai",
            selectors = ServiceSelectors(
                textarea = listOf("textarea.message-input-textarea"),
                button = listOf("button.send-button[aria-label=\"Send\"]")
            )
        ),
        "glm" to AiService(
            id = "glm",
            name = "GLM",
            url = "https://chat.z.ai",
            selectors = ServiceSelectors(
                textarea = listOf("textarea#chat-input"),
                button = listOf("button#send-message-button")
            )
        ),
        "kimi" to AiService(
            id = "kimi",
            name = "Kimi",
            url = "https://www.kimi.ai/en/",
            selectors = ServiceSelectors(
                contenteditable = listOf("div.chat-input-editor[contenteditable=\"true\"][role=\"textbox\"]"),
                button = listOf(".send-button-container:not(.disabled)")
            )
        ),
        "minimax" to AiService(
            id = "minimax",
            name = "MiniMax",
            url = "https://agent.minimax.io/",
            selectors = ServiceSelectors(
                contenteditable = listOf("div.tiptap.ProseMirror.rich-text-editor[contenteditable=\"true\"]"),
                button = listOf("button[aria-label=\"Send message\"]")
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
            "chat.qwen.ai" in u -> "qwen"
            "chat.z.ai" in u -> "glm"
            "kimi.ai" in u || "kimi.com" in u -> "kimi"
            "minimax.io" in u -> "minimax"
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
        "perplexity.ai",
        "qwen.ai",
        "z.ai",
        "kimi.ai", "kimi.com",
        "minimax.io"
    )
}
