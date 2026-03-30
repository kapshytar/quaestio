import Foundation

struct MergeRunConfig {
    let provider: MergeProviderDescriptor
    let apiKey: String
    let customEndpoint: String
    let customModel: String
    let fallbackModelsRaw: String
    let sourcePrompt: String
    let mergeInstructions: String
}

enum MergeApiClient {
    struct MergeResult {
        let text: String
        let providerId: String
        let modelUsed: String
        let attemptedModels: [String]
    }

    static func merge(config: MergeRunConfig, responses: [String: String]) async throws -> MergeResult {
        if responses.isEmpty {
            throw NSError(domain: "MergeApiClient", code: 1, userInfo: [NSLocalizedDescriptionKey: "No source responses"])
        }

        switch config.provider.family {
        case "claude":
            return try await callClaude(config: config, responses: responses)
        case "gemini":
            return try await callGemini(config: config, responses: responses)
        default:
            return try await callOpenAICompatible(config: config, responses: responses)
        }
    }

    private static func buildMergePrompt(config: MergeRunConfig, responses: [String: String]) -> String {
        let languageRule: String
        if config.sourcePrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            languageRule = "Write output in the dominant language used in the source responses."
        } else {
            languageRule = "Write output in the same language as this original user question: \"\(config.sourcePrompt)\"."
        }

        var result = ""
        result.appendLine(config.mergeInstructions)
        result.appendLine(languageRule)
        result.appendLine("")
        result.appendLine("Responses:")
        for (model, text) in responses {
            result.appendLine("### \(model)")
            result.appendLine(String(text.prefix(6000)))
            result.appendLine("")
        }
        return result
    }

    private static func callOpenAICompatible(config: MergeRunConfig, responses: [String: String]) async throws -> MergeResult {
        let endpoint = config.customEndpoint.isEmpty ? config.provider.defaultEndpoint : config.customEndpoint
        let models = buildModelFallbackChain(
            primary: config.customModel.isEmpty ? config.provider.defaultModel : config.customModel,
            raw: config.fallbackModelsRaw
        )
        let prompt = buildMergePrompt(config: config, responses: responses)

        var attempted: [String] = []
        var lastError: Error?
        for model in models {
            attempted.append(model)
            do {
                return try await callOpenAIOnce(
                    endpoint: endpoint,
                    apiKey: config.apiKey,
                    model: model,
                    prompt: prompt,
                    providerId: config.provider.id,
                    extraHeaders: config.provider.id == "openrouter_api" ? [
                        "HTTP-Referer": "https://github.com/kvitaliq-maker/chat-aggregator-mobile",
                        "X-Title": "VerityMobile"
                    ] : [:],
                    attemptedModels: attempted
                )
            } catch {
                lastError = error
                if !isRateLimited(error: error) || model == models.last {
                    throw error
                }
            }
        }

        throw lastError ?? NSError(domain: "MergeApiClient", code: 2, userInfo: [NSLocalizedDescriptionKey: "All fallback models failed"])
    }

    private static func callOpenAIOnce(
        endpoint: String,
        apiKey: String,
        model: String,
        prompt: String,
        providerId: String,
        extraHeaders: [String: String],
        attemptedModels: [String]
    ) async throws -> MergeResult {
        let payload: [String: Any] = [
            "model": model,
            "messages": [
                ["role": "system", "content": "Synthesize multi-model output."],
                ["role": "user", "content": prompt]
            ],
            "temperature": 0.2,
            "stream": false
        ]
        let json = try await postJSON(
            endpoint: endpoint,
            headers: ["Authorization": "Bearer \(apiKey)"].merging(extraHeaders, uniquingKeysWith: { _, rhs in rhs }),
            body: payload
        )
        let content = (((json["choices"] as? [[String: Any]])?.first)?["message"] as? [String: Any])?["content"] as? String
        let text = content?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if text.isEmpty {
            throw NSError(domain: "MergeApiClient", code: 3, userInfo: [NSLocalizedDescriptionKey: "Empty response from provider"])
        }
        let modelUsed = (json["model"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? model
        return MergeResult(text: appendModelMetadata(text: text, providerId: providerId, modelUsed: modelUsed, attemptedModels: attemptedModels), providerId: providerId, modelUsed: modelUsed, attemptedModels: attemptedModels)
    }

    private static func callClaude(config: MergeRunConfig, responses: [String: String]) async throws -> MergeResult {
        let endpoint = config.customEndpoint.isEmpty ? config.provider.defaultEndpoint : config.customEndpoint
        let model = config.customModel.isEmpty ? config.provider.defaultModel : config.customModel
        let payload: [String: Any] = [
            "model": model,
            "max_tokens": 1200,
            "system": "Synthesize multi-model output.",
            "messages": [
                ["role": "user", "content": buildMergePrompt(config: config, responses: responses)]
            ]
        ]
        let json = try await postJSON(
            endpoint: endpoint,
            headers: [
                "x-api-key": config.apiKey,
                "anthropic-version": "2023-06-01"
            ],
            body: payload
        )
        let content = ((json["content"] as? [[String: Any]])?.first)?["text"] as? String
        let text = content?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if text.isEmpty {
            throw NSError(domain: "MergeApiClient", code: 4, userInfo: [NSLocalizedDescriptionKey: "Empty Claude response"])
        }
        let modelUsed = (json["model"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? model
        return MergeResult(text: appendModelMetadata(text: text, providerId: config.provider.id, modelUsed: modelUsed, attemptedModels: [modelUsed]), providerId: config.provider.id, modelUsed: modelUsed, attemptedModels: [modelUsed])
    }

    private static func callGemini(config: MergeRunConfig, responses: [String: String]) async throws -> MergeResult {
        let model = config.customModel.isEmpty ? config.provider.defaultModel : config.customModel
        let base = (config.customEndpoint.isEmpty ? config.provider.defaultEndpoint : config.customEndpoint).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let endpoint = "\(base)/models/\(model):generateContent?key=\(config.apiKey)"
        let payload: [String: Any] = [
            "system_instruction": [
                "parts": [["text": "Synthesize multi-model output."]]
            ],
            "contents": [[
                "role": "user",
                "parts": [["text": buildMergePrompt(config: config, responses: responses)]]
            ]],
            "generationConfig": ["temperature": 0.2]
        ]
        let json = try await postJSON(endpoint: endpoint, headers: [:], body: payload)
        let candidates = json["candidates"] as? [[String: Any]]
        let content = (((candidates?.first)?["content"] as? [String: Any])?["parts"] as? [[String: Any]])?.first?["text"] as? String
        let text = content?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if text.isEmpty {
            throw NSError(domain: "MergeApiClient", code: 5, userInfo: [NSLocalizedDescriptionKey: "Empty Gemini response"])
        }
        let modelUsed = (json["modelVersion"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? model
        return MergeResult(text: appendModelMetadata(text: text, providerId: config.provider.id, modelUsed: modelUsed, attemptedModels: [modelUsed]), providerId: config.provider.id, modelUsed: modelUsed, attemptedModels: [modelUsed])
    }

    private static func postJSON(endpoint: String, headers: [String: String], body: [String: Any]) async throws -> [String: Any] {
        guard let url = URL(string: endpoint) else {
            throw NSError(domain: "MergeApiClient", code: 10, userInfo: [NSLocalizedDescriptionKey: "Invalid endpoint"])
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        headers.forEach { key, value in
            request.setValue(value, forHTTPHeaderField: key)
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if !(200...299).contains(status) {
            let errorBody = String(data: data, encoding: .utf8) ?? "HTTP \(status)"
            throw NSError(domain: "MergeApiClient", code: status, userInfo: [NSLocalizedDescriptionKey: "Provider error (\(status)): \(String(errorBody.prefix(300)))"])
        }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(domain: "MergeApiClient", code: 11, userInfo: [NSLocalizedDescriptionKey: "Invalid provider response"])
        }
        return object
    }

    private static func buildModelFallbackChain(primary: String, raw: String) -> [String] {
        ([primary] + raw.split(whereSeparator: { [",", "\n", ";"].contains($0) }).map(String.init))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .reduce(into: [String]()) { acc, value in
                if !acc.contains(value) { acc.append(value) }
            }
    }

    private static func isRateLimited(error: Error) -> Bool {
        let message = error.localizedDescription.lowercased()
        return message.contains("429") || message.contains("rate limit") || message.contains("too many requests")
    }

    private static func appendModelMetadata(text: String, providerId: String, modelUsed: String, attemptedModels: [String]) -> String {
        let attempted = Array(NSOrderedSet(array: attemptedModels)) as? [String] ?? attemptedModels
        let fallbackUsed = attempted.count > 1 ? "yes" : "no"
        return """
        \(text.trimmingCharacters(in: .whitespacesAndNewlines))

        ---
        Merge provider: `\(providerId)`
        LLM used: `\(modelUsed)`
        Fallback used: `\(fallbackUsed)`
        Attempted models: `\(attempted.joined(separator: " -> "))`
        """
    }
}

private extension String {
    var nonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

private extension String {
    mutating func appendLine(_ line: String) {
        append(line)
        append("\n")
    }
}
