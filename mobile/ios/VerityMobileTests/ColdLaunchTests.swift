import XCTest
import WebKit
@testable import VerityMobile

/// Exercises the real initializer, not a duplicate of the startup policy.
/// Run serially in the disposable test host: MobileAppState uses standard defaults.
final class ColdLaunchTests: XCTestCase {
    @MainActor
    func testNewAppStateClearsContextButKeepsSavedSessionsAndCookies() async throws {
        let defaults = UserDefaults.standard
        let prefix = "verity.mobile."
        let original = defaults.dictionaryRepresentation().filter { $0.key.hasPrefix(prefix) }
        defer {
            for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
                defaults.removeObject(forKey: key)
            }
            for (key, value) in original { defaults.set(value, forKey: key) }
        }
        for key in original.keys { defaults.removeObject(forKey: key) }

        let manager = SessionManager()
        let initial = MobileAppState()
        XCTAssertFalse(initial.slots.isEmpty, "The bundled provider catalog must load")
        let config = Dictionary(uniqueKeysWithValues: initial.slots.map { ("slot-\($0.id)", $0.serviceId) })
        let urls = Dictionary(uniqueKeysWithValues: initial.slots.map {
            ("slot-\($0.id)", "https://example.invalid/conversation/\($0.id)")
        })
        func snapshot(id: String, sessionId: Int, noteId: String?) -> SessionSnapshot {
            SessionSnapshot(id: id, timestamp: 1, sessionId: sessionId, noteId: noteId,
                name: "Saved question", slotConfig: config, slotURLs: urls,
                slotEnabled: ["slot-1": false], slotLiveURLs: ["slot-2": "https://example.invalid/stale"],
                createdAt: "", updatedAt: "", projectTagId: "saved-project")
        }
        let local = snapshot(id: "local", sessionId: 900001, noteId: nil)
        let remote = snapshot(id: "remote", sessionId: 277, noteId: "question-root")
        manager.replaceSessions([local, remote])
        let storedSessions = defaults.data(forKey: "verity.mobile.sessions.list")
        XCTAssertNotNil(storedSessions)
        let counter = manager.nextLocalSessionNumber()

        // Explicit Load must still work. A note-less local row avoids remote tail refresh.
        initial.loadSession(local)
        XCTAssertEqual(manager.getParallelIngestState().sessionId, local.sessionId)
        XCTAssertEqual(initial.slots.map(\.url), initial.slots.map { urls["slot-\($0.id)"]! })
        // The loaded context exists before constructing the next app state.
        XCTAssertEqual(initial.activeProjectId, "saved-project")
        XCTAssertEqual(initial.lastUserPrompt, local.name)

        let store = SharedWebViewEnvironment.websiteDataStore
        XCTAssertTrue(store.isPersistent)
        let cookie = try XCTUnwrap(HTTPCookie(properties: [
            .domain: "cold-launch-regression.invalid", .path: "/", .name: "auth-sentinel",
            .value: "synthetic-test-value", .expires: Date().addingTimeInterval(3600)
        ]))
        await store.httpCookieStore.setCookie(cookie)

        // Seed after the final suspension: live WebView URL callbacks can
        // otherwise overwrite standard defaults while cookie storage is awaited.
        // Seed every stale context field, including a note-backed session's tail.
        manager.replaceParallelIngestState(ParallelIngestState(sessionId: 277,
            activeNoteId: "question-tail", sourcePrompt: "stale prompt", externalChatId: "old-chat",
            traceId: "old-trace", sequence: 42, activeProjectId: "saved-project",
            activeNoteTitle: "stale title"))
        // Persist actual conversation URLs explicitly: Load writes slots before
        // linking the session, so its first persistence may still contain homes.
        defaults.set(try JSONEncoder().encode(initial.slots), forKey: "verity.mobile.slots")
        defaults.set("stale prompt", forKey: "verity.mobile.lastUserPrompt")
        defaults.set(Date().timeIntervalSince1970, forKey: "verity.mobile.sessionsLoadedAt")

        let persistedSlots = try JSONDecoder().decode([SlotState].self,
            from: XCTUnwrap(defaults.data(forKey: "verity.mobile.slots")))
        XCTAssertFalse(persistedSlots[0].isEnabled, "Fixture must reach startup intact")
        let restarted = MobileAppState()
        XCTAssertEqual(manager.getParallelIngestState(), .empty)
        XCTAssertNil(restarted.activeProjectId)
        XCTAssertNil(restarted.activeProjectPathKey)
        XCTAssertNil(restarted.sessionIndicatorText)
        XCTAssertEqual(restarted.lastUserPrompt, "")
        XCTAssertEqual(restarted.resolvedMergeSourcePrompt(), "")
        XCTAssertEqual(defaults.string(forKey: "verity.mobile.lastUserPrompt"), "")
        for slot in restarted.slots {
            XCTAssertEqual(slot.url, restarted.presets[slot.serviceId]?.url)
            XCTAssertEqual(slot.serviceId, config["slot-\(slot.id)"])
        }
        XCTAssertFalse(restarted.slots[0].isEnabled, "Keep provider layout preferences")
        XCTAssertEqual(defaults.data(forKey: "verity.mobile.sessions.list"), storedSessions)
        XCTAssertEqual(Set(manager.getAllSessions()), Set([local, remote]))
        XCTAssertEqual(manager.nextLocalSessionNumber(), counter + 1)
        await restarted.loadSessions(forceRefresh: false) // fresh cache, no backend
        XCTAssertEqual(Set(restarted.availableSessions), Set([local, remote]))
        XCTAssertEqual(manager.getParallelIngestState(), .empty, "Listing is not explicit Load")

        let configuration = SharedWebViewEnvironment.makeConfiguration()
        XCTAssertTrue(configuration.websiteDataStore === store)
        let cookies = await configuration.websiteDataStore.httpCookieStore.allCookies()
        XCTAssertTrue(cookies.contains { $0.name == cookie.name && $0.domain == cookie.domain && $0.value == cookie.value })
        await store.httpCookieStore.deleteCookie(cookie)

        restarted.loadSession(local)
        XCTAssertEqual(manager.getParallelIngestState().sessionId, local.sessionId)
        XCTAssertEqual(restarted.slots.map(\.url), restarted.slots.map { urls["slot-\($0.id)"]! })
        let secondRestart = MobileAppState()
        XCTAssertEqual(manager.getParallelIngestState(), .empty, "Reset must occur on every new instance")
        XCTAssertTrue(secondRestart.slots.allSatisfy { $0.url == secondRestart.presets[$0.serviceId]?.url })
        XCTAssertEqual(defaults.data(forKey: "verity.mobile.sessions.list"), storedSessions)
    }
}
