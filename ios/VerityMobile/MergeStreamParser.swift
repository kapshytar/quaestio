import Foundation
@preconcurrency
import JavaScriptCore

struct MergeParsedChunk {
    let deltaText: String
    let modelUsed: String?
}

enum MergeStreamParser {
    private static let fallbackConfigJSON = """
    {"sseDataPrefix":"data:","doneTokens":["[DONE]"],"modelPaths":["model","modelVersion"],"deltaTextPaths":["choices[0].delta.content","choices[0].delta.text","choices[0].text","choices[0].message.content","delta.text","delta.content"],"finalTextPaths":["choices[0].message.content","choices[0].delta.content","choices[0].delta.text","choices[0].text","delta.text","delta.content","content[0].text","candidates[0].content.parts[0].text"]}
    """

    private static let configJSON: String = {
        guard
            let url = Bundle.main.url(forResource: "streamParserConfig", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let text = String(data: data, encoding: .utf8),
            !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return fallbackConfigJSON
        }
        return text
    }()

    nonisolated(unsafe) private static let context: JSContext? = {
        let context = JSContext()
        guard
            let url = Bundle.main.url(forResource: "mergeStreamParser", withExtension: "js"),
            let script = try? String(contentsOf: url, encoding: .utf8)
        else {
            return context
        }
        context?.evaluateScript(script)
        return context
    }()

    static func parseSsePayload(_ rawLine: String) -> [String: Any]? {
        guard
            let function = context?.objectForKeyedSubscript("parseMergeSsePayload"),
            let payloadJSONString = function.call(withArguments: [rawLine, configJSON])?.toString(),
            !payloadJSONString.isEmpty,
            let data = payloadJSONString.data(using: .utf8)
        else {
            return nil
        }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    static func parseChunk(_ object: [String: Any]) -> MergeParsedChunk {
        guard
            let data = try? JSONSerialization.data(withJSONObject: object),
            let objectJSONString = String(data: data, encoding: .utf8),
            let function = context?.objectForKeyedSubscript("parseMergeChunk"),
            let chunkJSONString = function.call(withArguments: [objectJSONString, configJSON])?.toString(),
            let chunkData = chunkJSONString.data(using: .utf8),
            let chunkObject = try? JSONSerialization.jsonObject(with: chunkData) as? [String: Any]
        else {
            return MergeParsedChunk(deltaText: "", modelUsed: nil)
        }

        return MergeParsedChunk(
            deltaText: (chunkObject["deltaText"] as? String) ?? "",
            modelUsed: chunkObject["modelUsed"] as? String
        )
    }

    static func extractFinalText(from object: [String: Any], fallback: String) -> String {
        guard
            let data = try? JSONSerialization.data(withJSONObject: object),
            let objectJSONString = String(data: data, encoding: .utf8),
            let function = context?.objectForKeyedSubscript("extractMergeFinalText"),
            let text = function.call(withArguments: [objectJSONString, fallback, configJSON])?.toString()
        else {
            return fallback
        }
        return text
    }
}

extension String {
    var nonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
