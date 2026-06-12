import XCTest
@testable import VerityMobile

/// Regression guard for the multi-user invariant:
/// **when signed out, the client makes ZERO Supabase calls** (no anonymous
/// writes/reads). This is what stops a not-logged-in device from leaking rows
/// into the backend with `owner_id = null`. See
/// `shared/contracts/AUTH_AND_SESSION_SYNC.md`.
final class AnonGateTests: XCTestCase {

    override func setUp() async throws {
        try await super.setUp()
        RequestSpy.reset()
        URLProtocol.registerClass(RequestSpy.self)
        // Ensure a clean signed-out state regardless of prior keychain content.
        await AuthStore.shared.signOut()
        RequestSpy.reset() // signOut may hit /logout if a session existed; ignore it
    }

    override func tearDown() async throws {
        URLProtocol.unregisterClass(RequestSpy.self)
        try await super.tearDown()
    }

    func testAccessTokenIsNilWhenSignedOut() async {
        let token = await AuthStore.shared.accessToken()
        XCTAssertNil(token, "Signed out must yield no access token (no anon fallback).")
    }

    func testIngestThrowsAndSendsNothingWhenSignedOut() async {
        let payload = AggregatedIngestClient.buildPayload(
            sessionId: nil,
            title: "gate-test",
            responses: ["chatgpt": "hello"]
        )
        do {
            _ = try await AggregatedIngestClient.sendAggregated(
                rpcBaseURL: "https://pphntxcslmbymvcwvhnr.supabase.co",
                apiKey: "sb_publishable_test",
                payload: payload,
                traceId: "gate-test-trace",
                idempotencyKey: "gate-test-key",
                detailedLogging: false
            )
            XCTFail("Signed-out ingest must throw, not silently send.")
        } catch let error as AuthError {
            guard case .notSignedIn = error else {
                return XCTFail("Expected .notSignedIn, got \(error)")
            }
        } catch {
            XCTFail("Expected AuthError.notSignedIn, got \(error)")
        }

        XCTAssertEqual(
            RequestSpy.supabaseRequestCount, 0,
            "Signed-out ingest must make zero Supabase requests (it made \(RequestSpy.supabaseRequestCount))."
        )
    }
}

/// Records every outbound request so a test can assert none reached Supabase.
/// Never actually completes a request — if one is attempted it is failed and
/// counted, which fails the test.
final class RequestSpy: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var _supabaseRequestCount = 0

    static var supabaseRequestCount: Int {
        lock.lock(); defer { lock.unlock() }
        return _supabaseRequestCount
    }

    static func reset() {
        lock.lock(); _supabaseRequestCount = 0; lock.unlock()
    }

    override class func canInit(with request: URLRequest) -> Bool {
        if let host = request.url?.host, host.contains("supabase.co") {
            lock.lock(); _supabaseRequestCount += 1; lock.unlock()
            return true
        }
        return false
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
    }

    override func stopLoading() {}
}
