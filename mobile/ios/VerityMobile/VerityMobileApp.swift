import SwiftUI

@main
struct VerityMobileApp: App {
    @StateObject private var appState = MobileAppState()

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(appState)
        }
    }
}
