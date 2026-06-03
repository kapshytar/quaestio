import SwiftUI

/// App mode chosen on first run (and changeable later via Settings → Account).
/// "local" = on-device only (sessions, nothing sent to the server);
/// "account" = signed in (notes/sessions sync to the account).
enum AppMode {
    static let key = "verity.mobile.app.mode"

    static var stored: String? { UserDefaults.standard.string(forKey: key) }
    static func set(_ value: String) { UserDefaults.standard.set(value, forKey: key) }
}

/// First-run choice: Use Locally vs Sign In. Mirrors the desktop onboarding
/// modal and the shared contract `shared/contracts/AUTH_AND_SESSION_SYNC.md`.
struct OnboardingView: View {
    var onDone: () -> Void

    @EnvironmentObject private var appState: MobileAppState
    @State private var showLogin = false
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        VStack(spacing: 22) {
            Spacer()

            Text("Welcome to Verity")
                .font(.system(size: 27, weight: .bold))
            Text("Choose how to use the app. You can change this later in Settings → Account.")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)

            if showLogin {
                VStack(spacing: 12) {
                    TextField("Email", text: $email)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .disableAutocorrection(true)
                    SecureField("Password", text: $password)
                        .textFieldStyle(.roundedBorder)
                    Button { signIn() } label: {
                        Text(busy ? "Signing in…" : "Sign In").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy || email.isEmpty || password.isEmpty)
                    Button("Back") { showLogin = false; message = nil }
                        .disabled(busy)
                }
                .padding(.horizontal, 28)
            } else {
                VStack(spacing: 12) {
                    Button { showLogin = true } label: {
                        Text("Sign In").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    Button { useLocally() } label: {
                        Text("Use Locally").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    Text("Local keeps everything on this device — sessions only, nothing is sent to the server. Sign in to attribute and sync your notes and sessions to your account.")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.top, 4)
                }
                .padding(.horizontal, 28)
            }

            if let message {
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Spacer()
        }
        .interactiveDismissDisabled(true)
    }

    private func useLocally() {
        AppMode.set("local")
        onDone()
    }

    private func signIn() {
        busy = true
        message = nil
        let email = self.email
        let password = self.password
        Task {
            let result = await AuthStore.shared.signIn(email: email, password: password)
            await MainActor.run {
                busy = false
                switch result {
                case .success:
                    AppMode.set("account")
                    onDone()
                    appState.detectLocalSessionsForMigration()
                case .failure(let error):
                    message = error.displayMessage
                }
            }
        }
    }
}
