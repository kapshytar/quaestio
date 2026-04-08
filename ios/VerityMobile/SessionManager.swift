import Foundation

struct SessionSnapshot: Codable, Identifiable, Hashable {
    let id: String
    let timestamp: Int64
    let sessionId: Int?
    let noteId: String?
    let name: String
    let slotConfig: [String: String]
    let slotURLs: [String: String]
    let slotEnabled: [String: Bool]
    // Live chat URLs captured from the web view at snapshot time
    let slotLiveURLs: [String: String]
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case timestamp
        case sessionId = "session_id"
        case noteId = "note_id"
        case name
        case slotConfig = "slot_config"
        case slotURLs = "slot_urls"
        case slotEnabled = "slot_enabled"
        case slotLiveURLs = "slot_live_urls"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct ParallelIngestState: Codable, Equatable {
    var sessionId: Int?
    var activeNoteId: String
    var sourcePrompt: String
    var externalChatId: String
    var traceId: String
    var sequence: Int
    var activeProjectId: String?

    static let empty = ParallelIngestState(
        sessionId: nil,
        activeNoteId: "",
        sourcePrompt: "",
        externalChatId: "",
        traceId: "",
        sequence: 0,
        activeProjectId: nil
    )
}

final class SessionManager {
    private enum Keys {
        static let sessions = "verity.mobile.sessions.list"
        static let parallelState = "verity.mobile.parallelIngest.state"
    }

    private let defaults: UserDefaults
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    private let maxSessions = 1000

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    static func loadSessionsFromDatabase(defaults: UserDefaults = .standard) async -> [SessionSnapshot] {
        await SessionManager(defaults: defaults).loadSessionsFromDatabase()
    }

    func getParallelIngestState() -> ParallelIngestState {
        guard let data = defaults.data(forKey: Keys.parallelState),
              let state = try? decoder.decode(ParallelIngestState.self, from: data)
        else {
            return .empty
        }
        return state
    }

    func replaceParallelIngestState(_ state: ParallelIngestState) {
        if let data = try? encoder.encode(state) {
            defaults.set(data, forKey: Keys.parallelState)
        }
    }

    func clearParallelIngestState(preservingProject: Bool = true) {
        let existing = getParallelIngestState()
        let projectId = preservingProject ? existing.activeProjectId : nil
        replaceParallelIngestState(.init(
            sessionId: nil,
            activeNoteId: "",
            sourcePrompt: existing.sourcePrompt,
            externalChatId: "",
            traceId: "",
            sequence: 0,
            activeProjectId: projectId
        ))
    }

    func rememberSourcePrompt(_ prompt: String) {
        var state = getParallelIngestState()
        state.sourcePrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        replaceParallelIngestState(state)
    }

    func setActiveProjectId(_ projectId: String?) {
        var state = getParallelIngestState()
        state.activeProjectId = projectId?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        replaceParallelIngestState(state)
    }

    func nextSequence() -> Int {
        var state = getParallelIngestState()
        state.sequence += 1
        replaceParallelIngestState(state)
        return state.sequence
    }

    func ensureTraceId() -> String {
        var state = getParallelIngestState()
        if state.traceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            state.traceId = UUID().uuidString
            replaceParallelIngestState(state)
        }
        return state.traceId
    }

    func ensureExternalChatId() -> String {
        var state = getParallelIngestState()
        if state.externalChatId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            state.externalChatId = UUID().uuidString
            replaceParallelIngestState(state)
        }
        return state.externalChatId
    }

    func updateSessionLink(sessionId: Int?, noteId: String?, sourcePrompt: String?) {
        var state = getParallelIngestState()
        state.sessionId = sessionId
        if let noteId {
            state.activeNoteId = noteId.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let sourcePrompt {
            state.sourcePrompt = sourcePrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        replaceParallelIngestState(state)
    }

    func clearCurrentSessionLink(preservingProject: Bool = true) {
        clearParallelIngestState(preservingProject: preservingProject)
    }

    func saveCurrentSession(
        name: String,
        dreamSessionId: Int?,
        slotStates: [SlotState],
        slotURLs: [String: String]? = nil,
        noteId: String? = nil,
        slotLiveURLs: [String: String]? = nil
    ) -> SessionSnapshot {
        let timestamp = Int64(Date().timeIntervalSince1970 * 1000)
        let iso = ISO8601DateFormatter().string(from: Date())
        let existing = dreamSessionId.flatMap { targetSessionId in
            getAllSessions()
                .filter { $0.sessionId == targetSessionId && (($0.noteId ?? "") == (noteId ?? "")) }
                .max { $0.timestamp < $1.timestamp }
        }

        let snapshot = SessionSnapshot(
            id: existing?.id ?? "\(String(timestamp, radix: 36))_\(UUID().uuidString.prefix(6))",
            timestamp: timestamp,
            sessionId: dreamSessionId,
            noteId: noteId?.nilIfEmpty,
            name: name.isEmpty ? "Session" : name,
            slotConfig: Dictionary(uniqueKeysWithValues: slotStates.map { ("slot-\($0.id)", $0.serviceId) }),
            slotURLs: slotURLs ?? Dictionary(uniqueKeysWithValues: slotStates.map { ("slot-\($0.id)", $0.url) }),
            slotEnabled: Dictionary(uniqueKeysWithValues: slotStates.map { ("slot-\($0.id)", $0.isEnabled) }),
            slotLiveURLs: slotLiveURLs ?? [:],
            createdAt: existing?.createdAt ?? iso,
            updatedAt: iso
        )

        addSessionToList(snapshot)
        return snapshot
    }

    func getAllSessions() -> [SessionSnapshot] {
        dedupeLatestSnapshots(getStoredSessions())
    }

    func replaceSessions(_ sessions: [SessionSnapshot]) {
        saveSessions(dedupeLatestSnapshots(sessions))
    }

    func syncSessionToDatabase(_ session: SessionSnapshot) async -> Bool {
        let rpcBaseURL = KeyObfuscation.getSupabaseRPCURL(nil)
        let apiKey = KeyObfuscation.getSupabaseAPIKey(nil)
        guard !rpcBaseURL.isEmpty, !apiKey.isEmpty else { return false }

        let body: [String: Any?] = [
            "p_action": "save",
            "p_record_id": nil,
            "p_session_id": session.sessionId,
            "p_note_id": session.noteId,
            "p_name": session.name,
            "p_slot_config": session.slotConfig,
            "p_slot_urls": session.slotURLs,
            "p_slot_enabled": session.slotEnabled,
            "p_limit": maxSessions
        ]

        do {
            _ = try await postBridgeRequest(rpcBaseURL: rpcBaseURL, apiKey: apiKey, body: body)
            return true
        } catch {
            return false
        }
    }

    func loadSessionsFromDatabase() async -> [SessionSnapshot] {
        let rpcBaseURL = KeyObfuscation.getSupabaseRPCURL(nil)
        let apiKey = KeyObfuscation.getSupabaseAPIKey(nil)
        guard !rpcBaseURL.isEmpty, !apiKey.isEmpty else { return [] }

        let body: [String: Any?] = [
            "p_action": "list",
            "p_record_id": nil,
            "p_session_id": nil,
            "p_name": nil,
            "p_slot_config": nil,
            "p_slot_urls": nil,
            "p_slot_enabled": nil,
            "p_limit": maxSessions
        ]

        do {
            let raw = try await postBridgeRequest(rpcBaseURL: rpcBaseURL, apiKey: apiKey, body: body)
            guard let data = raw.data(using: .utf8),
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let rows = json["data"] as? [[String: Any]]
            else {
                return []
            }

            let sessions = rows.compactMap(Self.parseSessionSnapshot)
            let noteBackedRows = try await loadNoteBackedSessions(
                rpcBaseURL: rpcBaseURL,
                apiKey: apiKey,
                snapshots: sessions
            )
            let resolvedSessions = noteBackedRows.isEmpty ? sessions : noteBackedRows
            replaceSessions(resolvedSessions)
            return resolvedSessions
        } catch {
            return []
        }
    }

    private func getStoredSessions() -> [SessionSnapshot] {
        guard let data = defaults.data(forKey: Keys.sessions),
              let sessions = try? decoder.decode([SessionSnapshot].self, from: data)
        else {
            return []
        }
        return sessions
    }

    private func addSessionToList(_ session: SessionSnapshot) {
        let existing = getStoredSessions().filter { current in
            if current.id == session.id { return false }
            if session.sessionId != nil,
               current.sessionId == session.sessionId,
               (current.noteId ?? "") == (session.noteId ?? "") {
                return false
            }
            return true
        }
        saveSessions([session] + existing)
    }

    private func saveSessions(_ sessions: [SessionSnapshot]) {
        if let data = try? encoder.encode(sessions) {
            defaults.set(data, forKey: Keys.sessions)
        }
    }

    private func dedupeLatestSnapshots(_ sessions: [SessionSnapshot]) -> [SessionSnapshot] {
        var latestByKey: [String: SessionSnapshot] = [:]
        for session in sessions {
            let key = snapshotKey(session)
            if let existing = latestByKey[key] {
                if session.timestamp >= existing.timestamp {
                    latestByKey[key] = session
                }
            } else {
                latestByKey[key] = session
            }
        }

        let normalized = latestByKey.values.sorted { $0.timestamp > $1.timestamp }
        let noteBackedKeys = Set(normalized.compactMap { snapshot -> String? in
            guard let sessionId = snapshot.sessionId, snapshot.noteId?.isEmpty == false else { return nil }
            return "\(sessionId)|\(snapshot.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())"
        })

        return normalized.filter { snapshot in
            guard let sessionId = snapshot.sessionId else { return true }
            if snapshot.noteId?.isEmpty == false { return true }
            return !noteBackedKeys.contains("\(sessionId)|\(snapshot.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())")
        }
        .prefix(maxSessions)
        .map { $0 }
    }

    private func snapshotKey(_ session: SessionSnapshot) -> String {
        let sessionPart = session.sessionId.map(String.init) ?? "id:\(session.id)"
        let notePart = session.noteId?.nilIfEmpty ?? "row:\(session.id)"
        return "\(sessionPart)|\(notePart)"
    }

    private func postBridgeRequest(rpcBaseURL: String, apiKey: String, body: [String: Any?]) async throws -> String {
        let endpoint = rpcBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/rest/v1/rpc/aggregator_sessions_bridge_v1"
        guard let url = URL(string: endpoint) else {
            throw NSError(domain: "SessionManager", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid session bridge URL"])
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body.mapValues { $0 ?? NSNull() }, options: [.sortedKeys])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(domain: "SessionManager", code: 2, userInfo: [NSLocalizedDescriptionKey: "Missing HTTP response"])
        }
        let text = String(data: data, encoding: .utf8) ?? ""
        guard (200...299).contains(http.statusCode) else {
            throw NSError(domain: "SessionManager", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: text])
        }
        return text
    }

    private func loadNoteBackedSessions(
        rpcBaseURL: String,
        apiKey: String,
        snapshots: [SessionSnapshot]
    ) async throws -> [SessionSnapshot] {
        let query = "select=id,note_session_id,title,updated_at&note_type=eq.1&order=updated_at.desc&limit=\(maxSessions)&note_session_id=not.is.null"
        let endpoint = normalizeRestEndpoint(rpcBaseURL) + "/notes?\(query)"
        guard let url = URL(string: endpoint) else { return [] }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 30
        request.setValue(apiKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { return [] }
        guard (200...299).contains(http.statusCode) else { return [] }
        guard let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }

        var snapshotByNote: [String: SessionSnapshot] = [:]
        var latestSnapshotBySession: [Int: SessionSnapshot] = [:]

        for snapshot in snapshots {
            if let noteId = snapshot.noteId?.nilIfEmpty {
                snapshotByNote[noteId] = snapshot
            }
            if let sessionId = snapshot.sessionId {
                let existing = latestSnapshotBySession[sessionId]
                if existing == nil || snapshot.timestamp >= existing!.timestamp {
                    latestSnapshotBySession[sessionId] = snapshot
                }
            }
        }

        return rows.compactMap { (row: [String: Any]) -> SessionSnapshot? in
            guard let rawId = row["id"] as? String else { return nil }
            let noteId = rawId.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !noteId.isEmpty else { return nil }

            let rowSessionId =
                (row["note_session_id"] as? NSNumber)?.intValue
                ?? (row["session_id"] as? NSNumber)?.intValue
                ?? Int((row["note_session_id"] as? String) ?? "")
                ?? Int((row["session_id"] as? String) ?? "")
            guard let rowSessionId else { return nil }

            let updatedAt = (row["updated_at"] as? String) ?? ""
            let exactNoteSnapshot = snapshotByNote[noteId]
            let matchingSnapshot = exactNoteSnapshot ?? latestSnapshotBySession[rowSessionId]
            let title = ((row["title"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

            // Notes table doesn't store slot URLs — fall back to the RPC snapshot.
            let exactURLs = exactNoteSnapshot?.slotURLs
            let exactLive = exactNoteSnapshot?.slotLiveURLs
            let resolvedSlotURLs = (exactURLs?.isEmpty == false ? exactURLs : nil)
                ?? matchingSnapshot?.slotURLs
                ?? [:]
            let resolvedLiveURLs = (exactLive?.isEmpty == false ? exactLive : nil)
                ?? matchingSnapshot?.slotLiveURLs
                ?? [:]

            return SessionSnapshot(
                id: matchingSnapshot?.id ?? "note:\(noteId)",
                timestamp: Self.parseISO(updatedAt)
                    ?? matchingSnapshot?.timestamp
                    ?? Int64(Date().timeIntervalSince1970 * 1000),
                sessionId: rowSessionId,
                noteId: noteId,
                name: title.ifEmpty(
                    matchingSnapshot?.name.trimmingCharacters(in: .whitespacesAndNewlines).ifEmpty("Session #\(rowSessionId)")
                    ?? "Session #\(rowSessionId)"
                ),
                slotConfig: matchingSnapshot?.slotConfig ?? [:],
                slotURLs: resolvedSlotURLs,
                slotEnabled: matchingSnapshot?.slotEnabled ?? [:],
                slotLiveURLs: resolvedLiveURLs,
                createdAt: matchingSnapshot?.createdAt ?? "",
                updatedAt: updatedAt.ifEmpty(matchingSnapshot?.updatedAt ?? "")
            )
        }
        .sorted(by: { $0.timestamp > $1.timestamp })
        .prefix(maxSessions)
        .map { $0 }
    }

    private func normalizeRestEndpoint(_ baseInput: String) -> String {
        let base = baseInput
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let rpcMarker = "/rest/v1/rpc"
        let restMarker = "/rest/v1"
        if base.hasSuffix(rpcMarker) {
            return String(base.dropLast("/rpc".count))
        }
        if let range = base.range(of: "\(rpcMarker)/") {
            return String(base[..<range.lowerBound]) + restMarker
        }
        if base.hasSuffix(restMarker) {
            return base
        }
        if let range = base.range(of: "\(restMarker)/") {
            return String(base[..<range.lowerBound]) + restMarker
        }
        return base + restMarker
    }

    private static func parseSessionSnapshot(row: [String: Any]) -> SessionSnapshot? {
        guard let id = row["id"] as? String else { return nil }
        let createdAt = (row["created_at"] as? String) ?? (row["createdAt"] as? String) ?? ""
        let updatedAt = (row["updated_at"] as? String) ?? (row["updatedAt"] as? String) ?? ""
        let slotConfig = (row["slot_config"] as? [String: String]) ?? (row["slotConfig"] as? [String: String]) ?? [:]
        let slotURLs = (row["slot_urls"] as? [String: String]) ?? (row["slotUrls"] as? [String: String]) ?? (row["slots"] as? [String: String]) ?? [:]
        let slotEnabled = (row["slot_enabled"] as? [String: Bool]) ?? (row["slotEnabled"] as? [String: Bool]) ?? [:]
        let slotLiveURLs = (row["slot_live_urls"] as? [String: String]) ?? (row["slotLiveURLs"] as? [String: String]) ?? [:]
        let sessionId = (row["session_id"] as? NSNumber)?.intValue
            ?? (row["sessionId"] as? NSNumber)?.intValue
            ?? Int((row["session_id"] as? String) ?? "")
            ?? Int((row["sessionId"] as? String) ?? "")
        let noteId = ((row["note_id"] as? String) ?? (row["noteId"] as? String) ?? (row["question_note_id"] as? String) ?? (row["questionNoteId"] as? String))?.nilIfEmpty
        let timestamp = parseISO(updatedAt) ?? parseISO(createdAt) ?? Int64(Date().timeIntervalSince1970 * 1000)
        return SessionSnapshot(
            id: id,
            timestamp: timestamp,
            sessionId: sessionId,
            noteId: noteId,
            name: (row["name"] as? String) ?? "",
            slotConfig: slotConfig,
            slotURLs: slotURLs,
            slotEnabled: slotEnabled,
            slotLiveURLs: slotLiveURLs,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }

    private static func parseISO(_ value: String) -> Int64? {
        guard !value.isEmpty else { return nil }
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        let standardFormatter = ISO8601DateFormatter()
        standardFormatter.formatOptions = [.withInternetDateTime]

        if let date = fractionalFormatter.date(from: value)
            ?? standardFormatter.date(from: value) {
            return Int64(date.timeIntervalSince1970 * 1000)
        }
        return nil
    }
}

private extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    func ifEmpty(_ fallback: String) -> String {
        isEmpty ? fallback : self
    }
}

extension Dictionary {
    var nilIfEmptyDict: Self? { isEmpty ? nil : self }
}
