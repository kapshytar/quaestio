import Foundation
import AuthenticationServices
import UIKit

@MainActor
final class SystemAuthCoordinator: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published private(set) var status: String = "idle"

    private var session: ASWebAuthenticationSession?

    func start(url: URL) {
        session?.cancel()

        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: nil) { [weak self] callbackURL, error in
            Task { @MainActor in
                if let callbackURL {
                    self?.status = "callback: \(callbackURL.absoluteString)"
                } else if let error {
                    self?.status = "ended: \(error.localizedDescription)"
                } else {
                    self?.status = "ended"
                }
                self?.session = nil
            }
        }

        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        status = "started: \(url.absoluteString)"
        self.session = session
        _ = session.start()
    }

    func cancel() {
        session?.cancel()
        session = nil
        status = "cancelled"
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }),
           let window = windowScene.windows.first(where: \.isKeyWindow) {
            return window
        }

        return ASPresentationAnchor()
    }
}
