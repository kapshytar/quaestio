import CryptoKit
import Foundation

struct AggregatedResponseItem: Codable {
    let segmentId: String
    let provider: String
    let sourceURL: String
    let markdown: String

    enum CodingKeys: String, CodingKey {
        case segmentId = "segment_id"
        case provider
        case sourceURL = "source_url"
        case markdown
    }
}

struct AggregatedPayload: Codable {
    let schema: String
    let sessionId: Int?
    let title: String
    let responses: [AggregatedResponseItem]
    let projectTagId: String?
    let aggregatedNoteId: String?
    let replaceExisting: Bool
    let platformCode: String

    init(
        schema: String = "aggregated_ingest_v1",
        sessionId: Int?,
        title: String,
        responses: [AggregatedResponseItem],
        projectTagId: String? = nil,
        aggregatedNoteId: String? = nil,
        replaceExisting: Bool = false,
        platformCode: String = "IOS"
    ) {
        self.schema = schema
        self.sessionId = sessionId
        self.title = title
        self.responses = responses
        self.projectTagId = projectTagId?.trimmedNilIfEmpty
        self.aggregatedNoteId = aggregatedNoteId?.trimmedNilIfEmpty
        self.replaceExisting = replaceExisting
        self.platformCode = platformCode
    }

    enum CodingKeys: String, CodingKey {
        case schema
        case sessionId = "session_id"
        case title
        case responses
        case projectTagId = "project_tag_id"
        case aggregatedNoteId = "aggregated_note_id"
        case replaceExisting = "replace_existing"
        case platformCode = "platform_code"
    }
}

struct MergeIngestPayload: Codable {
    let schema: String
    let sessionId: Int
    let aggregatedNoteId: String?
    let title: String?
    let promptText: String?
    let markdown: String
    let platformCode: String

    init(
        schema: String = "merge_ingest_v1",
        sessionId: Int,
        aggregatedNoteId: String? = nil,
        title: String? = nil,
        promptText: String? = nil,
        markdown: String,
        platformCode: String = "IOS"
    ) {
        self.schema = schema
        self.sessionId = sessionId
        self.aggregatedNoteId = aggregatedNoteId?.trimmedNilIfEmpty
        self.title = title?.trimmedNilIfEmpty
        self.promptText = promptText?.trimmedNilIfEmpty
        self.markdown = markdown
        self.platformCode = platformCode
    }

    enum CodingKeys: String, CodingKey {
        case schema
        case sessionId = "session_id"
        case aggregatedNoteId = "aggregated_note_id"
        case title
        case promptText = "prompt_text"
        case markdown
        case platformCode = "platform_code"
    }
}

struct ClarificationIngestPayload: Codable {
    let schema: String
    let sessionId: Int
    let title: String?
    let promptText: String?
    let markdown: String
    let platformCode: String

    init(
        schema: String = "clarification_ingest_v1",
        sessionId: Int,
        title: String? = nil,
        promptText: String? = nil,
        markdown: String,
        platformCode: String = "IOS"
    ) {
        self.schema = schema
        self.sessionId = sessionId
        self.title = title?.trimmedNilIfEmpty
        self.promptText = promptText?.trimmedNilIfEmpty
        self.markdown = markdown
        self.platformCode = platformCode
    }

    enum CodingKeys: String, CodingKey {
        case schema
        case sessionId = "session_id"
        case title
        case promptText = "prompt_text"
        case markdown
        case platformCode = "platform_code"
    }
}

struct AggregatedIngestResult {
    let sessionId: Int?
    let noteId: String?
    let payloadHash: String
    let idempotencyKey: String
    let idempotentReplay: Bool
    let rawResponse: String
}

struct IngestScrapeMetaRow: Codable, Sendable {
    let slot: Int
    let serviceName: String
    let serviceId: String
    let sourceURL: String

    enum CodingKeys: String, CodingKey {
        case slot
        case serviceName = "service_name"
        case serviceId = "service_id"
        case sourceURL = "source_url"
    }
}

enum AggregatedIngestClient {
    private static let sourcePlatformCode = "IOS"
    private static let appName = "chat-aggregator-mobile-ios"
    private static let jsonEncoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()
    static func buildPayload(
        sessionId: Int?,
        title: String,
        responses: [String: String],
        scrapeMeta: [IngestScrapeMetaRow] = [],
        projectTagId: String? = nil,
        aggregatedNoteId: String? = nil,
        replaceExisting: Bool = false
    ) -> AggregatedPayload {
        let serviceByName = Dictionary(uniqueKeysWithValues: ServicePresetLoader.loadCatalog()?.services.values.map {
            ($0.name.lowercased(), $0)
        } ?? [])
        let metaByServiceName = Dictionary(uniqueKeysWithValues: scrapeMeta.compactMap { row -> (String, IngestScrapeMetaRow)? in
            let normalized = row.serviceName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return normalized.isEmpty ? nil : (normalized, row)
        })

        let items = responses.map { serviceName, markdown -> AggregatedResponseItem in
            let normalizedName = serviceName.lowercased()
            let preset = serviceByName[normalizedName]
            let meta = metaByServiceName[normalizedName]
            let providerId = meta?.serviceId.trimmedNilIfEmpty
                ?? preset?.id
                ?? normalizeSegmentId(serviceName)
            let slotNumber = meta.map { $0.slot + 1 }
            let segmentId: String
            if let slotNumber, slotNumber > 0 {
                segmentId = "slot-\(slotNumber):\(providerId)"
            } else {
                segmentId = providerId
            }
            let sourceURL = meta?.sourceURL.trimmedNilIfEmpty
                ?? preset?.url
                ?? ""
            return AggregatedResponseItem(
                segmentId: segmentId,
                provider: providerId,
                sourceURL: sourceURL,
                markdown: markdown
            )
        }
        .sorted { $0.segmentId < $1.segmentId }

        return AggregatedPayload(
            sessionId: sessionId,
            title: title.trimmedNilIfEmpty ?? "Gunshi Merge",
            responses: items,
            projectTagId: projectTagId,
            aggregatedNoteId: aggregatedNoteId,
            replaceExisting: replaceExisting
        )
    }

    static func stableJSON<T: Encodable>(_ payload: T) throws -> String {
        let data = try jsonEncoder.encode(payload)
        guard let string = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "AggregatedIngestClient", code: 1001, userInfo: [NSLocalizedDescriptionKey: "Failed to encode RPC payload"])
        }
        return string
    }

    static func sha256(_ input: String) -> String {
        let data = Data(input.utf8)
        let hash = SHA256.hash(data: data)
        return hash.map { String(format: "%02x", $0) }.joined()
    }

    static func buildIdempotencyKey(kind: String, sessionIdOrTmp: String, sequence: Int, traceId: String) -> String {
        "ios:\(kind):\(sessionIdOrTmp):\(sequence):\(traceId)"
    }

    static func sendAggregated(
        rpcBaseURL: String,
        apiKey: String,
        payload: AggregatedPayload,
        traceId: String,
        idempotencyKey: String,
        scrapeMeta: [IngestScrapeMetaRow] = [],
        detailedLogging: Bool = false
    ) async throws -> AggregatedIngestResult {
        let payloadJSON = try stableJSON(payload)
        print("[INGEST] sendAggregated called: endpoint=\(rpcBaseURL)/rest/v1/rpc/ingest_aggregated_v1, responses=\(payload.responses.count), detailedLogging=\(detailedLogging)")
        return try await callRPC(
            rpcBaseURL: rpcBaseURL,
            apiKey: apiKey,
            rpcName: "ingest_aggregated_v1",
            step: "aggregated",
            sessionId: payload.sessionId,
            payloadJSON: payloadJSON,
            traceId: traceId,
            idempotencyKey: idempotencyKey,
            scrapeMeta: scrapeMeta,
            detailedLogging: detailedLogging
        )
    }

    static func sendMerge(
        rpcBaseURL: String,
        apiKey: String,
        payload: MergeIngestPayload,
        traceId: String,
        idempotencyKey: String,
        scrapeMeta: [IngestScrapeMetaRow] = [],
        detailedLogging: Bool = false
    ) async throws -> AggregatedIngestResult {
        let payloadJSON = try stableJSON(payload)
        return try await callRPC(
            rpcBaseURL: rpcBaseURL,
            apiKey: apiKey,
            rpcName: "ingest_merge_v1",
            step: "merge",
            sessionId: payload.sessionId,
            payloadJSON: payloadJSON,
            traceId: traceId,
            idempotencyKey: idempotencyKey,
            scrapeMeta: scrapeMeta,
            detailedLogging: detailedLogging
        )
    }

    static func sendClarification(
        rpcBaseURL: String,
        apiKey: String,
        payload: ClarificationIngestPayload,
        traceId: String,
        idempotencyKey: String,
        scrapeMeta: [IngestScrapeMetaRow] = [],
        detailedLogging: Bool = false
    ) async throws -> AggregatedIngestResult {
        let payloadJSON = try stableJSON(payload)
        return try await callRPC(
            rpcBaseURL: rpcBaseURL,
            apiKey: apiKey,
            rpcName: "ingest_clarification_v1",
            step: "clarification",
            sessionId: payload.sessionId,
            payloadJSON: payloadJSON,
            traceId: traceId,
            idempotencyKey: idempotencyKey,
            scrapeMeta: scrapeMeta,
            detailedLogging: detailedLogging
        )
    }

    private static func callRPC(
        rpcBaseURL: String,
        apiKey: String,
        rpcName: String,
        step: String,
        sessionId: Int?,
        payloadJSON: String,
        traceId: String,
        idempotencyKey: String,
        scrapeMeta: [IngestScrapeMetaRow],
        detailedLogging: Bool
    ) async throws -> AggregatedIngestResult {
        let payloadHash = sha256(payloadJSON)
        let endpoint = normalizeRPCEndpoint(base: rpcBaseURL, rpcName: rpcName)
        print("[INGEST] callRPC: endpoint=\(endpoint), rpcName=\(rpcName), idempotencyKey=\(idempotencyKey)")
        let payloadObject = try JSONSerialization.jsonObject(with: Data(payloadJSON.utf8))
        let bodyObject: [String: Any] = [
            "p_payload": payloadObject,
            "p_idempotency_key": idempotencyKey,
            "p_payload_hash": payloadHash
        ]
        let rpcBodyData = try JSONSerialization.data(withJSONObject: bodyObject, options: [.sortedKeys])
        print("[INGEST] callRPC: body size=\(rpcBodyData.count) bytes")

        try await logDebugEvent(
            rpcBaseURL: rpcBaseURL,
            apiKey: apiKey,
            event: buildDebugEvent(
                traceId: traceId,
                sessionId: sessionId,
                step: step,
                rpcName: rpcName,
                idempotencyKey: idempotencyKey,
                payload: payloadObject,
                requestBody: bodyObject,
                scrapeMeta: scrapeMeta
            ),
            detailedLogging: detailedLogging
        )

        var lastError: Error?
        for attempt in 0..<2 {
            print("[INGEST] callRPC: attempt=\(attempt + 1)")
            do {
                let raw = try await postJSON(
                    endpoint: endpoint,
                    headers: [
                        "apikey": apiKey,
                        "Authorization": "Bearer \(apiKey)"
                    ],
                    bodyData: rpcBodyData
                )
                print("[INGEST] callRPC: response received, length=\(raw.count)")
                let result = AggregatedIngestResult(
                    sessionId: extractSessionId(raw),
                    noteId: extractNoteId(raw),
                    payloadHash: payloadHash,
                    idempotencyKey: idempotencyKey,
                    idempotentReplay: extractIdempotentReplay(raw),
                    rawResponse: raw
                )
                print("[INGEST] callRPC: result sessionId=\(result.sessionId ?? -1), noteId=\(result.noteId ?? "nil"), replay=\(result.idempotentReplay)")
                try await logDebugEvent(
                    rpcBaseURL: rpcBaseURL,
                    apiKey: apiKey,
                    event: buildDebugEvent(
                        traceId: traceId,
                        sessionId: result.sessionId ?? sessionId,
                        step: "result",
                        rpcName: rpcName,
                        idempotencyKey: idempotencyKey,
                        payload: payloadObject,
                        requestBody: bodyObject,
                        scrapeMeta: scrapeMeta,
                        rpcResult: parseJSONObject(raw)
                    ),
                    detailedLogging: detailedLogging
                )
                return result
            } catch {
                lastError = error
                print("[INGEST] callRPC: error on attempt \(attempt + 1): \(error.localizedDescription)")
                if attempt == 0 {
                    try? await logDebugEvent(
                        rpcBaseURL: rpcBaseURL,
                        apiKey: apiKey,
                        event: buildDebugEvent(
                            traceId: traceId,
                            sessionId: sessionId,
                            step: "error",
                            rpcName: rpcName,
                            idempotencyKey: idempotencyKey,
                            payload: payloadObject,
                            requestBody: bodyObject,
                            scrapeMeta: scrapeMeta,
                            errorText: error.localizedDescription
                        ),
                        detailedLogging: detailedLogging
                    )
                    try? await Task.sleep(nanoseconds: 900_000_000)
                }
            }
        }

        print("[INGEST] callRPC: all attempts failed, throwing error")
        throw lastError ?? NSError(domain: "AggregatedIngestClient", code: 1002, userInfo: [NSLocalizedDescriptionKey: "RPC failed without specific error"])
    }

    private static func normalizeRPCEndpoint(base: String, rpcName: String) -> String {
        let trimmed = base.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let suffix = "/rest/v1/rpc/\(rpcName)"
        if trimmed.hasSuffix(suffix) {
            return trimmed
        }
        return trimmed + suffix
    }

    private static func buildDebugEvent(
        traceId: String,
        sessionId: Int?,
        step: String,
        rpcName: String,
        idempotencyKey: String,
        payload: Any? = nil,
        requestBody: Any? = nil,
        scrapeMeta: [IngestScrapeMetaRow] = [],
        rpcResult: Any? = nil,
        errorText: String? = nil
    ) -> [String: Any] {
        [
            "trace_id": traceId,
            "source_platform_code": sourcePlatformCode,
            "app_name": appName,
            "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "session_id": sessionId ?? NSNull(),
            "step": step,
            "rpc_name": rpcName,
            "idempotency_key": idempotencyKey,
            "payload": sanitizeJSONValue(payload),
            "request_body": sanitizeJSONValue(requestBody),
            "scrape_meta": sanitizeJSONValue(codableJSONArray(scrapeMeta)),
            "rpc_result": sanitizeJSONValue(rpcResult),
            "error_text": errorText ?? NSNull(),
            "logged_at": ISO8601DateFormatter().string(from: Date())
        ]
    }

    private static func logDebugEvent(
        rpcBaseURL: String,
        apiKey: String,
        event: [String: Any],
        detailedLogging: Bool
    ) async throws {
        let endpoint = normalizeRPCEndpoint(base: rpcBaseURL, rpcName: "log_ingest_debug_v1")
        let body = ["p_event": event]
        let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        _ = try await postJSON(
            endpoint: endpoint,
            headers: [
                "apikey": apiKey,
                "Authorization": "Bearer \(apiKey)"
            ],
            bodyData: data,
            ignoreFailures: true
        )
        if detailedLogging {
            print("AggregatedIngestClient debug event logged: \(event["step"] ?? "")")
        }
    }

    private static func postJSON(
        endpoint: String,
        headers: [String: String],
        bodyData: Data,
        ignoreFailures: Bool = false
    ) async throws -> String {
        guard let url = URL(string: endpoint) else {
            throw NSError(domain: "AggregatedIngestClient", code: 1003, userInfo: [NSLocalizedDescriptionKey: "Invalid RPC endpoint"])
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.httpBody = bodyData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(domain: "AggregatedIngestClient", code: 1004, userInfo: [NSLocalizedDescriptionKey: "Missing HTTP response"])
        }
        let text = String(data: data, encoding: .utf8) ?? ""
        guard ignoreFailures || (200...299).contains(http.statusCode) else {
            throw NSError(domain: "AggregatedIngestClient", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "RPC error (\(http.statusCode)): \(String(text.prefix(500)))"])
        }
        return text
    }

    private static func extractSessionId(_ raw: String) -> Int? {
        guard let json = parseJSONObject(raw) else { return nil }
        if let object = json as? [String: Any] {
            return parseInt(object["session_id"])
        }
        if let array = json as? [[String: Any]], let first = array.first {
            return parseInt(first["session_id"])
        }
        return nil
    }

    private static func extractNoteId(_ raw: String) -> String? {
        guard let json = parseJSONObject(raw) else { return nil }
        if let object = json as? [String: Any] {
            return (object["note_id"] as? String)?.trimmedNilIfEmpty
        }
        if let array = json as? [[String: Any]], let first = array.first {
            return (first["note_id"] as? String)?.trimmedNilIfEmpty
        }
        return nil
    }

    private static func extractIdempotentReplay(_ raw: String) -> Bool {
        guard let json = parseJSONObject(raw) else { return false }
        if let object = json as? [String: Any] {
            return object["idempotent_replay"] as? Bool ?? false
        }
        if let array = json as? [[String: Any]], let first = array.first {
            return first["idempotent_replay"] as? Bool ?? false
        }
        return false
    }

    private static func parseJSONObject(_ raw: String) -> Any? {
        guard let data = raw.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private static func sanitizeJSONValue(_ value: Any?) -> Any {
        guard let value else { return NSNull() }
        if let dictionary = value as? [String: Any] {
            return dictionary.mapValues { sanitizeJSONValue($0) }
        }
        if let array = value as? [Any] {
            return array.map { sanitizeJSONValue($0) }
        }
        return value
    }

    private static func codableJSONArray<T: Encodable>(_ value: T) -> Any? {
        guard let data = try? jsonEncoder.encode(value) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private static func parseInt(_ value: Any?) -> Int? {
        switch value {
        case let int as Int:
            return int
        case let number as NSNumber:
            return number.intValue
        case let string as String:
            return Int(string)
        default:
            return nil
        }
    }

    private static func normalizeSegmentId(_ value: String) -> String {
        let lowered = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let collapsed = lowered.map { $0.isLetter || $0.isNumber ? String($0) : "_" }.joined()
        let reduced = collapsed.replacingOccurrences(of: "_+", with: "_", options: .regularExpression)
        let trimmed = reduced.trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        return trimmed.isEmpty ? "unknown" : trimmed
    }
}

private extension String {
    var trimmedNilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
