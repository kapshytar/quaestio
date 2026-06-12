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
    // Project the session belongs to (bridge `project_tag_id`); optional —
    // absent/null keeps the previous "no project" behavior.
    let projectTagId: String?

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
        case projectTagId = "project_tag_id"
    }
}

extension SessionSnapshot {
    // Tolerant decode (defined in an extension so the memberwise init is kept):
    // a legacy/partial stored row missing a non-optional field (e.g. an older
    // entry without `slot_live_urls`) must NOT fail the decode of the whole
    // array — that silently emptied the on-device Sessions list (the local
    // session counter kept advancing while no rows ever showed). Missing fields
    // fall back to empty defaults instead.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        timestamp = (try c.decodeIfPresent(Int64.self, forKey: .timestamp)) ?? 0
        sessionId = try c.decodeIfPresent(Int.self, forKey: .sessionId)
        noteId = try c.decodeIfPresent(String.self, forKey: .noteId)
        name = (try c.decodeIfPresent(String.self, forKey: .name)) ?? ""
        slotConfig = (try c.decodeIfPresent([String: String].self, forKey: .slotConfig)) ?? [:]
        slotURLs = (try c.decodeIfPresent([String: String].self, forKey: .slotURLs)) ?? [:]
        slotEnabled = (try c.decodeIfPresent([String: Bool].self, forKey: .slotEnabled)) ?? [:]
        slotLiveURLs = (try c.decodeIfPresent([String: String].self, forKey: .slotLiveURLs)) ?? [:]
        createdAt = (try c.decodeIfPresent(String.self, forKey: .createdAt)) ?? ""
        updatedAt = (try c.decodeIfPresent(String.self, forKey: .updatedAt)) ?? ""
        projectTagId = (try c.decodeIfPresent(String.self, forKey: .projectTagId))?.nilIfEmpty
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
        static let localSessionCounter = "verity.mobile.localSession.counter"
        static let suppressSlotRestore = "verity.mobile.suppressSlotRestore"
    }

    // One-shot guard: after sign-in / late-login migration, suppress
    // slot-fingerprint restore so a new question doesn't resurrect a pre-login
    // session sharing the slot layout. Lifted on explicit load / fresh ingest.
    var suppressSlotRestore: Bool {
        get { defaults.bool(forKey: Keys.suppressSlotRestore) }
        set { defaults.set(newValue, forKey: Keys.suppressSlotRestore) }
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

    /// Concurrency-safe wrapper: runs the gated bridge `save` on a fresh,
    /// non-isolated instance so the main-actor-isolated shared manager is never
    /// sent across actors (Swift 6). Mirrors `loadSessionsFromDatabase` above.
    static func syncSessionToDatabase(_ session: SessionSnapshot, defaults: UserDefaults = .standard) async -> Bool {
        await SessionManager(defaults: defaults).syncSessionToDatabase(session)
    }

    /// Concurrency-safe wrapper for late-login migration (bridge `migrate`).
    static func migrateLocalSession(_ session: SessionSnapshot, defaults: UserDefaults = .standard) async -> Bool {
        await SessionManager(defaults: defaults).migrateLocalSession(session)
    }

    /// Concurrency-safe wrapper for per-session delete (bridge `delete`).
    static func deleteSessionFromDatabase(_ session: SessionSnapshot, defaults: UserDefaults = .standard) async -> Bool {
        await SessionManager(defaults: defaults).deleteSessionFromDatabase(session)
    }

    /// Monotonic local session number for local-only mode (no backend
    /// `session_id`). Uses a high base so it is visually distinct from backend
    /// session ids and won't collide before a future late-login renumber.
    func nextLocalSessionNumber() -> Int {
        let base = 900_000
        let current = defaults.integer(forKey: Keys.localSessionCounter)
        let next = (current == 0 ? base : current) + 1
        defaults.set(next, forKey: Keys.localSessionCounter)
        return next
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

    func startNewQuestionInCurrentSession(sourcePrompt: String) {
        var state = getParallelIngestState()
        state.activeNoteId = ""
        state.sourcePrompt = sourcePrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        replaceParallelIngestState(state)
    }

    /// Query the notes table for the latest note in this session and update activeNoteId.
    /// This ensures that when loading a note-backed session, new questions are attached
    /// to the current tip of the chain instead of creating parallel root notes.
    @MainActor
    func refreshActiveNoteIdForSession(_ sessionId: Int) async {
        let rpcBaseURL = KeyObfuscation.getSupabaseRPCURL(nil)
        let apiKey = KeyObfuscation.getSupabaseAPIKey(nil)
        guard !rpcBaseURL.isEmpty, !apiKey.isEmpty else { return }

        let query = "select=id,updated_at&note_type=eq.1&note_session_id=eq.\(sessionId)&order=updated_at.desc&limit=1"
        let endpoint = normalizeRestEndpoint(rpcBaseURL) + "/notes?\(query)"
        guard let url = URL(string: endpoint) else { return }

        // Gate: signed out = no remote reads (local-only mode).
        guard let authBearer = await AuthStore.shared.accessToken() else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 30
        request.setValue(apiKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(authBearer)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              let latestNote = rows.first,
              let noteId = latestNote["id"] as? String
        else { return }

        var state = getParallelIngestState()
        state.activeNoteId = noteId
        replaceParallelIngestState(state)
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
            updatedAt: iso,
            projectTagId: getParallelIngestState().activeProjectId?.nilIfEmpty ?? existing?.projectTagId
        )

        addSessionToList(snapshot)
        return snapshot
    }

    func getAllSessions() -> [SessionSnapshot] {
        dedupeLatestSnapshots(getStoredSessions())
    }

    /// Remove a session from on-device storage (local-only; the backend delete
    /// is a separate, gated call). Matches Android `deleteSession(id)`.
    func deleteSession(_ id: String) {
        saveSessions(getStoredSessions().filter { $0.id != id })
    }

    /// Delete a session on the backend via the gated bridge `delete` action.
    /// Parity with the Android/desktop clients: pass the integer `session_id`
    /// and the `note_id` so the bridge deletes the note subtree (the row leaves
    /// the web's notes tree) AND the aggregator_sessions rows. Passing only the
    /// snapshot UUID as `p_record_id` makes the backend's int-cast fallback throw
    /// and nothing gets deleted — so always forward session_id / note_id too.
    /// Signed out, `postBridgeRequest` throws → returns false (local delete in
    /// the caller still stands).
    func deleteSessionFromDatabase(_ session: SessionSnapshot) async -> Bool {
        let rpcBaseURL = KeyObfuscation.getSupabaseRPCURL(nil)
        let apiKey = KeyObfuscation.getSupabaseAPIKey(nil)
        guard !rpcBaseURL.isEmpty, !apiKey.isEmpty else { return false }

        let body: [String: Any?] = [
            "p_action": "delete",
            "p_record_id": session.id,
            "p_session_id": session.sessionId,
            "p_note_id": session.noteId,
            "p_name": nil,
            "p_slot_config": nil,
            "p_slot_urls": nil,
            "p_slot_enabled": nil,
            "p_limit": 1
        ]

        do {
            _ = try await postBridgeRequest(rpcBaseURL: rpcBaseURL, apiKey: apiKey, body: body)
            return true
        } catch {
            return false
        }
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

    /// Late-login migration: re-create a local-only session under the account
    /// via the gated bridge `migrate` action. The backend allocates a fresh real
    /// session_id (ignoring the local 900000+ number, so it never collides across
    /// devices) and the owner trigger stamps owner_id = auth.uid(). Returns true
    /// on success. Signed out, postBridgeRequest throws → false.
    func migrateLocalSession(_ session: SessionSnapshot) async -> Bool {
        let rpcBaseURL = KeyObfuscation.getSupabaseRPCURL(nil)
        let apiKey = KeyObfuscation.getSupabaseAPIKey(nil)
        guard !rpcBaseURL.isEmpty, !apiKey.isEmpty else { return false }

        let body: [String: Any?] = [
            "p_action": "migrate",
            "p_record_id": nil,
            "p_session_id": nil,
            "p_note_id": nil,
            "p_name": session.name,
            "p_slot_config": session.slotConfig,
            "p_slot_urls": session.slotURLs,
            "p_slot_enabled": session.slotEnabled,
            "p_limit": 1
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
            // Note-less session snapshots (e.g. local sessions migrated on login:
            // note_id = null) have no row in notes, so they are absent from
            // noteBackedRows. Append them so they stay visible instead of
            // vanishing whenever any note-backed session exists.
            let resolvedSessions: [SessionSnapshot]
            if noteBackedRows.isEmpty {
                resolvedSessions = sessions
            } else {
                let noteBackedSessionIds = Set(noteBackedRows.compactMap { $0.sessionId })
                let sessionOnly = sessions.filter { snapshot in
                    guard (snapshot.noteId ?? "").isEmpty, let sid = snapshot.sessionId else { return false }
                    return !noteBackedSessionIds.contains(sid)
                }
                resolvedSessions = noteBackedRows + sessionOnly
            }
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
        // Gate: signed out = no remote writes. Local session save already
        // happened in the caller, so this just skips the backend sync.
        guard let authBearer = await AuthStore.shared.accessToken() else {
            throw NSError(domain: "SessionManager", code: 401, userInfo: [NSLocalizedDescriptionKey: "Not signed in — local only"])
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(authBearer)", forHTTPHeaderField: "Authorization")
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

        // Gate: signed out = no remote reads (local-only mode).
        guard let authBearer = await AuthStore.shared.accessToken() else { return [] }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 30
        request.setValue(apiKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(authBearer)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { return [] }
        guard (200...299).contains(http.statusCode) else { return [] }
        guard let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }

        var snapshotByNote: [String: SessionSnapshot] = [:]
        var latestSnapshotBySession: [Int: SessionSnapshot] = [:]
        var rpcBySession: [Int: SessionSnapshot] = [:]

        for snapshot in snapshots {
            if let noteId = snapshot.noteId?.nilIfEmpty {
                snapshotByNote[noteId] = snapshot
            }
            if let sessionId = snapshot.sessionId {
                let existing = latestSnapshotBySession[sessionId]
                if existing == nil || snapshot.timestamp >= existing!.timestamp {
                    latestSnapshotBySession[sessionId] = snapshot
                }
                // Keep original RPC snapshots as fallback for note-backed rows
                // when no local snapshot matches the note row's session ID.
                rpcBySession[sessionId] = snapshot
            }
        }

        // Build snapshots from note rows, then deduplicate by session ID
        // to keep only the latest note's snapshot per session.
        var bySession: [Int: SessionSnapshot] = [:]
        print("[loadNoteBacked] notes rows=\(rows.count), rpc snapshots=\(snapshots.count)")
        print("[loadNoteBacked] snapshotByNote keys=\(snapshotByNote.keys.sorted())")
        print("[loadNoteBacked] latestBySession keys=\(latestSnapshotBySession.keys.sorted())")
        print("[loadNoteBacked] rpcBySession keys=\(rpcBySession.keys.sorted())")
        for row in rows {
            guard let rawId = row["id"] as? String else { continue }
            let noteId = rawId.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !noteId.isEmpty else { continue }

            let rowSessionId =
                (row["note_session_id"] as? NSNumber)?.intValue
                ?? (row["session_id"] as? NSNumber)?.intValue
                ?? Int((row["note_session_id"] as? String) ?? "")
                ?? Int((row["session_id"] as? String) ?? "")
            guard let rowSessionId else { continue }

            let updatedAt = (row["updated_at"] as? String) ?? ""
            let exactNoteSnapshot = snapshotByNote[noteId]
            let matchingSnapshot = exactNoteSnapshot ?? latestSnapshotBySession[rowSessionId]
            let rpcFallback = rpcBySession[rowSessionId]
            let title = ((row["title"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

            print("[loadNoteBacked] note=\(noteId.prefix(8)) session=\(rowSessionId) exactMatch=\(exactNoteSnapshot != nil) match=\(matchingSnapshot != nil) rpcFallback=\(rpcFallback != nil)")
            if let rpc = rpcFallback {
                print("[loadNoteBacked]   rpcFallback slot_urls=\(rpc.slotURLs)")
                print("[loadNoteBacked]   rpcFallback slot_config=\(rpc.slotConfig)")
            }
            if let match = matchingSnapshot {
                print("[loadNoteBacked]   matching slot_urls=\(match.slotURLs)")
                print("[loadNoteBacked]   matching slot_config=\(match.slotConfig)")
            }

            // All slot data falls back through: exact note snapshot →
            // matching session snapshot → original RPC response.
            let exactURLs = exactNoteSnapshot?.slotURLs
            let exactLive = exactNoteSnapshot?.slotLiveURLs
            let resolvedSlotURLs = (exactURLs?.isEmpty == false ? exactURLs : nil)
                ?? matchingSnapshot?.slotURLs
                ?? rpcFallback?.slotURLs
                ?? [:]
            let resolvedLiveURLs = (exactLive?.isEmpty == false ? exactLive : nil)
                ?? matchingSnapshot?.slotLiveURLs
                ?? rpcFallback?.slotLiveURLs
                ?? [:]
            let resolvedSlotConfig = matchingSnapshot?.slotConfig
                ?? rpcFallback?.slotConfig
                ?? [:]
            let resolvedSlotEnabled = matchingSnapshot?.slotEnabled
                ?? rpcFallback?.slotEnabled
                ?? [:]

            let snapshot = SessionSnapshot(
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
                slotConfig: resolvedSlotConfig,
                slotURLs: resolvedSlotURLs,
                slotEnabled: resolvedSlotEnabled,
                slotLiveURLs: resolvedLiveURLs,
                createdAt: matchingSnapshot?.createdAt ?? "",
                updatedAt: updatedAt.ifEmpty(matchingSnapshot?.updatedAt ?? ""),
                projectTagId: ((row["project_tag_id"] as? String) ?? (row["projectTagId"] as? String))?.nilIfEmpty
                    ?? matchingSnapshot?.projectTagId
                    ?? rpcFallback?.projectTagId
            )

            // Keep only the latest snapshot per session
            let existing = bySession[rowSessionId]
            if existing == nil || snapshot.timestamp >= existing!.timestamp {
                bySession[rowSessionId] = snapshot
            }
        }

        return Array(bySession.values)
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
            updatedAt: updatedAt,
            projectTagId: ((row["project_tag_id"] as? String) ?? (row["projectTagId"] as? String))?.nilIfEmpty
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
