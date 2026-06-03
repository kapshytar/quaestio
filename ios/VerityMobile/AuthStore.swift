import Foundation
import Security

// Supabase Auth for the iOS client.
//
// Multi-user: when signed in we send the user's access token as the
// `Authorization: Bearer` on every Supabase REST/RPC call (the `apikey` header
// stays the publishable/anon key), so the backend's owner_id triggers stamp
// rows to this user. Signed out, callers fall back to the publishable key and
// the app behaves as the legacy anon client.
//
// Tokens persist in the iOS Keychain so the session survives restarts without
// a plaintext refresh token on disk. Mirrors desktop `auth-store.js` and the
// shared contract `shared/contracts/AUTH_AND_SESSION_SYNC.md`.
actor AuthStore {
    static let shared = AuthStore()

    struct Status: Sendable {
        let signedIn: Bool
        let email: String?
        let userId: String?
    }

    private struct Session: Codable, Sendable {
        var accessToken: String
        var refreshToken: String?
        var expiresAt: Int
        var email: String?
        var userId: String?
    }

    // Refresh a little before the token actually expires to avoid edge races.
    private static let refreshSkewSeconds = 60
    private static let keychainService = "verity.auth.session"
    private static let keychainAccount = "frankfurt"

    private var session: Session?
    private var loaded = false

    // MARK: - Config (pulled from the embedded Frankfurt config)

    private var supabaseURL: String {
        KeyObfuscation.getSupabaseRPCURL(nil).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private var apiKey: String {
        KeyObfuscation.getSupabaseAPIKey(nil)
    }

    // MARK: - Public API

    /// The user's valid access token (refreshed if near expiry), or `nil` when
    /// not signed in. This is the **gate** for every Supabase call: `nil` means
    /// local-only mode — the caller must NOT touch the backend (no anonymous
    /// fallback). Returning a token means signed in; use it as the
    /// `Authorization: Bearer` (the `apikey` header stays the publishable key).
    func accessToken() async -> String? {
        loadFromKeychain()
        guard let current = session, !current.accessToken.isEmpty else { return nil }
        let nowSec = Int(Date().timeIntervalSince1970)
        if current.expiresAt - nowSec <= Self.refreshSkewSeconds {
            let ok = await refresh()
            if !ok { return nil }
        }
        return session?.accessToken
    }

    func status() -> Status {
        loadFromKeychain()
        return Status(
            signedIn: !(session?.accessToken.isEmpty ?? true),
            email: session?.email,
            userId: session?.userId
        )
    }

    @discardableResult
    func signIn(email: String, password: String) async -> Result<Status, AuthError> {
        let url = supabaseURL
        let key = apiKey
        guard !url.isEmpty, !key.isEmpty else { return .failure(.notConfigured) }
        let body: [String: Any] = [
            "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
            "password": password
        ]
        do {
            let (_, data) = try await post(
                endpoint: "\(url)/auth/v1/token?grant_type=password",
                headers: ["apikey": key],
                body: body
            )
            guard setSession(fromResponse: data) else {
                return .failure(.server(message(from: data) ?? "Sign-in failed."))
            }
            return .success(status())
        } catch let error as AuthError {
            return .failure(error)
        } catch {
            return .failure(.network(error.localizedDescription))
        }
    }

    func signOut() async {
        loadFromKeychain()
        let url = supabaseURL
        let key = apiKey
        if let token = session?.accessToken, !token.isEmpty, !url.isEmpty {
            // Best-effort server-side revoke; the local clear is what matters.
            _ = try? await post(
                endpoint: "\(url)/auth/v1/logout",
                headers: ["apikey": key, "Authorization": "Bearer \(token)"],
                body: [:]
            )
        }
        session = nil
        deleteKeychain()
        // Deliberate sign-out is not an expiry — drop any pending prompt.
        UserDefaults.standard.removeObject(forKey: Self.sessionExpiredKey)
    }

    // MARK: - Refresh

    @discardableResult
    private func refresh() async -> Bool {
        loadFromKeychain()
        guard let refreshToken = session?.refreshToken, !refreshToken.isEmpty else { return false }
        let url = supabaseURL
        let key = apiKey
        do {
            let (code, data) = try await post(
                endpoint: "\(url)/auth/v1/token?grant_type=refresh_token",
                headers: ["apikey": key],
                body: ["refresh_token": refreshToken]
            )
            if (200...299).contains(code), setSession(fromResponse: data) { return true }
            if code == 400 || code == 401 {
                // Definitive auth rejection: the refresh token is
                // invalid/revoked/expired. Nothing local recovers it — clear
                // the session and flag the expiry so the UI prompts re-sign-in.
                session = nil
                deleteKeychain()
                Self.markSessionExpired()
                return false
            }
            // Transient failure (5xx / unexpected): keep the session so a later
            // call can retry instead of nuking a valid session over a blip.
            return false
        } catch {
            // Network error: keep the session, just report failure so the caller
            // treats this call as local-only; a later call retries.
            return false
        }
    }

    // MARK: - Session-expired signal (consumed by the UI to prompt re-sign-in)

    private static let sessionExpiredKey = "verity.auth.sessionExpired"

    private static func markSessionExpired() {
        UserDefaults.standard.set(true, forKey: sessionExpiredKey)
    }

    /// True exactly once after a refresh was definitively rejected (token
    /// revoked/expired); consuming clears it. The UI surfaces "session expired —
    /// sign in again" instead of silently showing stale local sessions while in
    /// account mode. Nonisolated so the main-actor UI can read it directly.
    nonisolated static func consumeSessionExpired() -> Bool {
        let d = UserDefaults.standard
        guard d.bool(forKey: sessionExpiredKey) else { return false }
        d.removeObject(forKey: sessionExpiredKey)
        return true
    }

    // MARK: - Session decoding / persistence

    private func setSession(fromResponse data: [String: Any]) -> Bool {
        guard let accessToken = data["access_token"] as? String, !accessToken.isEmpty else {
            return false
        }
        let nowSec = Int(Date().timeIntervalSince1970)
        let expiresAt: Int = {
            if let at = data["expires_at"] as? Int { return at }
            if let at = data["expires_at"] as? Double { return Int(at) }
            let expiresIn = (data["expires_in"] as? Int) ?? 3600
            return nowSec + expiresIn
        }()
        let user = data["user"] as? [String: Any]
        session = Session(
            accessToken: accessToken,
            refreshToken: (data["refresh_token"] as? String) ?? session?.refreshToken,
            expiresAt: expiresAt,
            email: (user?["email"] as? String) ?? session?.email,
            userId: (user?["id"] as? String) ?? session?.userId
        )
        saveKeychain()
        // A fresh token clears any pending expiry prompt.
        UserDefaults.standard.removeObject(forKey: Self.sessionExpiredKey)
        return true
    }

    private func message(from data: [String: Any]) -> String? {
        (data["error_description"] as? String)
            ?? (data["msg"] as? String)
            ?? (data["error"] as? String)
    }

    // MARK: - Keychain

    private func loadFromKeychain() {
        if loaded { return }
        loaded = true
        guard let data = keychainRead() else { return }
        session = try? JSONDecoder().decode(Session.self, from: data)
    }

    private func saveKeychain() {
        guard let session, let data = try? JSONEncoder().encode(session) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    private func keychainRead() -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }

    private func deleteKeychain() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - HTTP

    /// Returns the HTTP status code alongside the parsed JSON body (body is
    /// returned on non-2xx too, so callers can read GoTrue's error and decide —
    /// e.g. refresh() distinguishes a 400/401 token rejection from a transient
    /// 5xx). Throws only on a transport/parse failure (no HTTP response).
    private func post(endpoint: String, headers: [String: String], body: [String: Any]) async throws -> (status: Int, json: [String: Any]) {
        guard let url = URL(string: endpoint) else { throw AuthError.network("Invalid auth endpoint") }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])

        let (data, response) = try await URLSession.shared.data(for: request)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard let http = response as? HTTPURLResponse else { throw AuthError.network("Missing HTTP response") }
        return (http.statusCode, json)
    }
}

enum AuthError: Error, Sendable {
    case notConfigured
    case notSignedIn
    case server(String)
    case network(String)

    var displayMessage: String {
        switch self {
        case .notConfigured: return "Supabase is not configured."
        case .notSignedIn: return "Not signed in — local-only mode."
        case .server(let msg): return msg
        case .network(let msg): return msg
        }
    }
}
