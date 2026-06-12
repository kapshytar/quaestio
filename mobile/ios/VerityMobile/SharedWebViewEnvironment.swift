import WebKit

@MainActor
enum SharedWebViewEnvironment {
    static let websiteDataStore = WKWebsiteDataStore.default()
    static let processPool = WKProcessPool()

    static func makeConfiguration() -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = websiteDataStore
        configuration.processPool = processPool
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        return configuration
    }
}
