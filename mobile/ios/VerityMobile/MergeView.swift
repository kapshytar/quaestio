import SwiftUI
import UIKit
import Security

struct MergeView: View {
    @EnvironmentObject private var appState: MobileAppState
    @State private var apiKey: String = ""
    @State private var customEndpoint: String = ""
    @State private var customModel: String = ""
    @State private var fallbackModels: String = ""
    @State private var mergeInstructions: String = ""
    @State private var clarificationInstructions: String = ""
    @State private var selectedProviderId: String = ""
    @State private var usePreinstalledKey = true

    // UserDefaults key for persisting the selected provider across cold launches.
    // Non-secret (just a provider id string like "deepseek_api"), so UserDefaults
    // is appropriate — mirrors Android where the selected provider is stored in
    // plain SharedPreferences alongside the other merge config (only the key
    // itself lives in EncryptedSharedPreferences / Keychain).
    private static let selectedProviderIdDefaultsKey = "verity.merge.selectedProviderId"
    @State private var showAdvancedConfig = false
    @State private var showInstructionConfig = false
    @State private var showActivityDetails = false
    @State private var showAggregationDetails = false
    @State private var showProviderSection = false
    @State private var showAggregationSection = true
    @State private var showInstructionsSection = false
    @State private var showClarifySection = true
    @State private var showOutputSection = true
    @State private var isRunning = false

    private let catalog = MergeCatalogLoader.loadCatalog()

    private var providers: [MergeProviderDescriptor] {
        catalog?.providers ?? []
    }

    private var selectedProvider: MergeProviderDescriptor? {
        providers.first(where: { $0.id == selectedProviderId }) ?? providers.first
    }

    private var sourcePrompt: String {
        appState.resolvedMergeSourcePrompt()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                mergeHeader

                if !appState.statusMessage.isEmpty || !appState.recentIngestEvents.isEmpty {
                    activityCard
                }

                collapsibleSection(title: "Provider", isExpanded: $showProviderSection) {
                    mergeProviderCardContent
                }

                collapsibleSection(title: "Aggregation", isExpanded: $showAggregationSection) {
                    aggregationCardContent
                }

                collapsibleSection(title: "Instructions", isExpanded: $showInstructionsSection) {
                    instructionsCardContent
                }

                Button {
                    Task {
                        await runMerge()
                    }
                } label: {
                    HStack(spacing: 10) {
                        Text(isRunning ? "Running..." : "Run Merge")
                        Spacer()
                        Image(systemName: "sparkles.rectangle.stack")
                            .font(.system(size: 14, weight: .semibold))
                    }
                }
                .buttonStyle(PrimaryActionButtonStyle())
                .disabled(isRunning)

                if !appState.mergeOutput.isEmpty {
                    collapsibleSection(title: "Output", isExpanded: $showOutputSection) {
                        MergeMarkdownView(markdown: appState.mergeOutput)
                            .frame(maxWidth: .infinity, minHeight: 260, alignment: .topLeading)
                            .padding(16)
                            .glassCard(padding: 0)
                    }

                    collapsibleSection(title: "Clarify", isExpanded: $showClarifySection) {
                        VStack(alignment: .leading, spacing: 12) {
                            TextField("Ask a follow-up about the merged answer", text: $appState.mergeClarificationText, axis: .vertical)
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(AppTheme.textPrimary)
                                .padding(14)
                                .glassCard(padding: 0, radius: AppTheme.compactRadius)

                            Button {
                                Task {
                                    await runClarificationMerge()
                                }
                            } label: {
                                HStack(spacing: 10) {
                                    Text(isRunning ? "Running..." : "Run Clarification")
                                    Spacer()
                                    Image(systemName: "text.append")
                                        .font(.system(size: 14, weight: .semibold))
                                }
                            }
                            .buttonStyle(PrimaryActionButtonStyle())
                            .disabled(isRunning)
                        }
                    }
                }
            }
            .padding(.horizontal, AppTheme.pagePadding)
            .padding(.top, AppTheme.pagePadding)
            .padding(.bottom, 28)
        }
        .shellBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            bootstrapDefaults()
        }
    }

    private var mergeHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("MERGE")
                .font(.system(size: 11, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(AppTheme.textMuted)

            Text("One final answer")
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .foregroundStyle(AppTheme.textPrimary)

            Text("Collect model replies, then synthesize one focused response.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(AppTheme.textSecondary)
        }
    }

    @ViewBuilder
    private func collapsibleSection<Content: View>(
        title: String,
        isExpanded: Binding<Bool>,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            DisclosureGroup(isExpanded: isExpanded) {
                content()
                    .padding(.top, 10)
            } label: {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
            }
            .tint(AppTheme.textPrimary)
        }
        .glassCard()
    }

    private var mergeProviderCardContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let selectedProvider {
                Picker("Provider", selection: $selectedProviderId) {
                    ForEach(providers) { provider in
                        Text(provider.title).tag(provider.id)
                    }
                }
                .pickerStyle(.menu)
                .onChange(of: selectedProviderId) { _, newId in
                    // BUG-B FIX: persist the chosen provider id to UserDefaults so
                    // bootstrapDefaults() on the next cold launch restores it before
                    // loading the Keychain key (which is keyed per-provider).
                    UserDefaults.standard.set(newId, forKey: Self.selectedProviderIdDefaultsKey)
                    syncProviderDefaults()
                }

                if selectedProvider.supportsPreinstalledKey {
                    Picker("API Key Source", selection: $usePreinstalledKey) {
                        Text("Use Preinstalled Key").tag(true)
                        Text("Enter Custom Key").tag(false)
                    }
                    .pickerStyle(.segmented)
                }

                if !selectedProvider.supportsPreinstalledKey || !usePreinstalledKey {
                    compactField("API key", text: $apiKey, secure: true)
                        .onChange(of: apiKey) { _, newValue in
                            mergeApiKeySave(providerId: selectedProviderId, key: newValue)
                        }
                }

                if shouldShowAdvancedConfig(for: selectedProvider) {
                    DisclosureGroup(isExpanded: $showAdvancedConfig) {
                        VStack(alignment: .leading, spacing: 10) {
                            if selectedProvider.supportsCustomEndpoint {
                                compactField("Endpoint", text: $customEndpoint)
                            }

                            if selectedProvider.supportsCustomModel {
                                compactField("Model", text: $customModel)
                            }

                            if supportsFallbackModels(selectedProvider) {
                                compactField("Fallback models", text: $fallbackModels, axis: .vertical)
                            }
                        }
                        .padding(.top, 10)
                    } label: {
                        Text("Advanced config")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.textPrimary)
                    }
                    .tint(AppTheme.textPrimary)
                }
            }
        }
    }

    private var aggregationCardContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Button {
                    Task {
                        await appState.refreshMergeAggregationStatuses(sourcePrompt: sourcePrompt)
                    }
                } label: {
                    Text("Refresh")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryCapsuleButtonStyle())
                .frame(maxWidth: .infinity)

                Button {
                    Task {
                        _ = await appState.manualCollectCurrentQuestion()
                    }
                } label: {
                    HStack(spacing: 8) {
                        if appState.isManualCollecting {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(appState.isManualCollecting ? "Collecting..." : "Collect")
                            .frame(maxWidth: .infinity)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryCapsuleButtonStyle())
                .disabled(appState.isManualCollecting)
                .frame(maxWidth: .infinity)
            }

            Text(appState.mergeAggregationSummary)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(AppTheme.textSecondary)

            if !appState.mergeAggregationSnapshots.isEmpty {
                DisclosureGroup(isExpanded: $showAggregationDetails) {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(appState.mergeAggregationSnapshots) { snapshot in
                            HStack(spacing: 10) {
                                Circle()
                                    .fill(color(for: snapshot.status))
                                    .frame(width: 8, height: 8)
                                Text(snapshot.title)
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(AppTheme.textPrimary)
                                Spacer()
                                Text(label(for: snapshot.status))
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                        }
                    }
                    .padding(.top, 10)
                } label: {
                    Text("Show per-slot status")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                }
                .tint(AppTheme.textPrimary)
            }
        }
    }

    private var instructionsCardContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            compactField("Merge instructions", text: $mergeInstructions, axis: .vertical)

            DisclosureGroup(isExpanded: $showInstructionConfig) {
                VStack(alignment: .leading, spacing: 10) {
                    compactField("Clarification instructions", text: $clarificationInstructions, axis: .vertical)
                }
                .padding(.top, 10)
            } label: {
                Text("Clarification settings")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
            }
            .tint(AppTheme.textPrimary)
        }
    }

    @ViewBuilder
    private func compactField(
        _ placeholder: String,
        text: Binding<String>,
        axis: Axis = .horizontal,
        secure: Bool = false
    ) -> some View {
        if secure && axis == .horizontal {
            SecureField(placeholder, text: text)
                .textContentType(.password)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(AppTheme.textPrimary)
                .padding(14)
                .glassCard(padding: 0, radius: AppTheme.compactRadius)
        } else {
            TextField(placeholder, text: text, axis: axis)
                .autocorrectionDisabled(secure)
                .textInputAutocapitalization(secure ? .never : .sentences)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(AppTheme.textPrimary)
                .padding(14)
                .glassCard(padding: 0, radius: AppTheme.compactRadius)
        }
    }

    private func bootstrapDefaults() {
        guard !providers.isEmpty else { return }
        if selectedProviderId.isEmpty {
            // BUG-B FIX (part 1): restore the provider id that was persisted on the
            // previous launch BEFORE loading the Keychain key. Prior code always fell
            // through to catalog?.defaultProviderId here, so if the user had selected
            // a non-default provider the Keychain load below ran against the wrong
            // (default) provider and loaded "" for the key.
            let persisted = UserDefaults.standard.string(forKey: Self.selectedProviderIdDefaultsKey) ?? ""
            let restoredId = persisted.trimmingCharacters(in: .whitespacesAndNewlines)
            if !restoredId.isEmpty, providers.contains(where: { $0.id == restoredId }) {
                selectedProviderId = restoredId
            } else {
                selectedProviderId = catalog?.defaultProviderId ?? providers.first?.id ?? ""
            }
            // Persist whatever we resolved — .onChange(of: selectedProviderId) only
            // fires on user-driven changes, not programmatic assignments here.
            UserDefaults.standard.set(selectedProviderId, forKey: Self.selectedProviderIdDefaultsKey)
        }
        if mergeInstructions.isEmpty {
            mergeInstructions = catalog?.defaultMergeInstructions ?? ""
        }
        if clarificationInstructions.isEmpty {
            clarificationInstructions = catalog?.defaultClarificationInstructions ?? ""
        }
        // syncProviderDefaults loads the persisted API key from Keychain for the
        // current provider, so no separate load is needed here.
        syncProviderDefaults()
    }

    private func syncProviderDefaults() {
        guard let selectedProvider else { return }
        // Load the persisted API key for the newly-selected provider.
        // Mirrors Android MergeFragment.loadFieldsForProvider which reads
        // prefs.getString(prefsKey(p, "api_key"), "") for each provider.
        apiKey = mergeApiKeyLoad(providerId: selectedProvider.id)
        let hasCustomKey = !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if !selectedProvider.supportsPreinstalledKey {
            // Provider has no preinstalled key option — custom key is the only path.
            usePreinstalledKey = false
        } else if hasCustomKey {
            // BUG-B FIX (part 2): when a custom key was previously saved to Keychain
            // for this provider, switch the picker to "custom" mode so:
            //   (a) the API key field becomes visible (condition: !supportsPreinstalledKey || !usePreinstalledKey)
            //   (b) resolvedApiKey() returns apiKey instead of the preinstalled key.
            // Prior code left usePreinstalledKey = true (the @State default), which
            // hid the field and caused resolvedApiKey to ignore the loaded key entirely.
            // Mirrors Android where selecting a provider always loads the saved key into
            // the field regardless of the preinstalled-key toggle state.
            usePreinstalledKey = false
        } else {
            // No custom key stored — default to preinstalled key if supported.
            usePreinstalledKey = true
        }
        if customEndpoint.isEmpty || customEndpoint == providers.first(where: { $0.id == selectedProviderId })?.defaultEndpoint {
            customEndpoint = selectedProvider.defaultEndpoint
        }
        if customModel.isEmpty || customModel == providers.first(where: { $0.id == selectedProviderId })?.defaultModel {
            customModel = selectedProvider.defaultModel
        }
        if !shouldShowAdvancedConfig(for: selectedProvider) {
            showAdvancedConfig = false
        }
    }

    // MARK: - Merge API key Keychain persistence
    //
    // Mirrors Android's MergeFragment.saveFields / loadFieldsForProvider which
    // use EncryptedSharedPreferences keyed as "merge_<providerId>_api_key".
    // iOS uses the Keychain (same security tier) with:
    //   service  = "verity.merge.apikey"
    //   account  = "merge.<providerId>.api_key"
    // Not cleared on sign-out — Android does not clear merge keys on sign-out
    // either (they live in a separate SharedPreferences file from the auth session).

    private static let mergeApiKeyKeychainService = "verity.merge.apikey"

    private func mergeApiKeyKeychainAccount(providerId: String) -> String {
        "merge.\(providerId).api_key"
    }

    private func mergeApiKeySave(providerId: String, key: String) {
        guard !providerId.isEmpty else { return }
        let account = mergeApiKeyKeychainAccount(providerId: providerId)
        let service = Self.mergeApiKeyKeychainService
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
        guard let data = key.data(using: .utf8), !key.isEmpty else { return }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    private func mergeApiKeyLoad(providerId: String) -> String {
        guard !providerId.isEmpty else { return "" }
        let account = mergeApiKeyKeychainAccount(providerId: providerId)
        let service = Self.mergeApiKeyKeychainService
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8)
        else { return "" }
        return value
    }

    private var activityCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(appState.statusMessage)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(AppTheme.textSecondary)
                .lineLimit(3)

            if !appState.recentIngestEvents.isEmpty {
                DisclosureGroup(isExpanded: $showActivityDetails) {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(appState.recentIngestEvents, id: \.self) { event in
                            Text(event)
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundStyle(AppTheme.textMuted)
                                .multilineTextAlignment(.leading)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                        }
                    }
                    .padding(.top, 8)
                } label: {
                    HStack(spacing: 10) {
                        Text("Recent activity")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.textPrimary)
                        Spacer(minLength: 0)
                        Button {
                            copyRecentActivity()
                        } label: {
                            Label("Copy", systemImage: "doc.on.doc")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .tint(AppTheme.textPrimary)
            }
        }
        .padding(14)
        .glassCard(padding: 0, radius: AppTheme.compactRadius)
    }

    private func copyRecentActivity() {
        let payload = appState.recentIngestEvents.reversed().joined(separator: "\n")
        UIPasteboard.general.string = payload
        appState.statusMessage = "Recent activity copied"
    }

    private func runMerge() async {
        guard let selectedProvider else { return }
        let resolvedApiKey = resolvedApiKey(for: selectedProvider)
        guard !resolvedApiKey.isEmpty else {
            appState.statusMessage = "Merge API key required"
            appState.mergeOutput = "Merge API key required."
            return
        }

        isRunning = true
        appState.statusMessage = "Collecting source replies..."
        let responses = await appState.collectLatestRepliesForMerge(sourcePrompt: sourcePrompt, manual: true)
        guard !responses.isEmpty else {
            isRunning = false
            appState.statusMessage = "No source replies available"
            appState.mergeOutput = "No source replies were found in enabled slots."
            return
        }
        appState.beginMergeConversation(responses: responses)

        let config = MergeRunConfig(
            provider: selectedProvider,
            apiKey: resolvedApiKey,
            customEndpoint: customEndpoint.trimmingCharacters(in: .whitespacesAndNewlines),
            customModel: customModel.trimmingCharacters(in: .whitespacesAndNewlines),
            fallbackModelsRaw: fallbackModels,
            sourcePrompt: sourcePrompt,
            mergeInstructions: mergeInstructions.trimmingCharacters(in: .whitespacesAndNewlines),
            clarificationInstructions: clarificationInstructions.trimmingCharacters(in: .whitespacesAndNewlines),
            clarificationText: "",
            previousSummary: "",
            isClarificationMerge: false,
            originalResponses: responses
        )

        appState.statusMessage = "Running merge via \(selectedProvider.title)..."
        appState.mergeOutput = ""
        do {
            let result = try await MergeApiClient.merge(config: config, responses: responses) { partial in
                await MainActor.run {
                    appState.mergeOutput = partial
                }
            }
            appState.finishMergeConversation(with: result.text)
            appState.statusMessage = "Merge completed with \(responses.count) source reply(s)"
            // ingest-parity: BOOTSTRAP_BEFORE_MERGE
            // Pass the same `responses` we just fed the LLM so the bootstrap
            // path does not re-scrape and risk picking up a different reply set.
            let persisted = await appState.persistMergeMarkdown(
                result.text,
                sourcePrompt: sourcePrompt,
                isClarification: false,
                prebuiltResponses: responses
            )
            if !persisted {
                appState.statusMessage = "Merge LLM ok, DB persist failed"
            }
        } catch {
            appState.mergeOutput = "Merge failed: \(error.localizedDescription)"
            appState.statusMessage = "Merge failed"
        }
        isRunning = false
    }

    private func runClarificationMerge() async {
        guard let selectedProvider else { return }
        let clarification = appState.mergeClarificationText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clarification.isEmpty else {
            appState.statusMessage = "Clarification text required"
            return
        }
        let resolvedApiKey = resolvedApiKey(for: selectedProvider)
        guard !resolvedApiKey.isEmpty else {
            appState.statusMessage = "Merge API key required"
            return
        }

        isRunning = true
        appState.appendClarificationUserTurn(clarification)
        appState.statusMessage = "Running clarification via \(selectedProvider.title)..."

        let config = MergeRunConfig(
            provider: selectedProvider,
            apiKey: resolvedApiKey,
            customEndpoint: customEndpoint.trimmingCharacters(in: .whitespacesAndNewlines),
            customModel: customModel.trimmingCharacters(in: .whitespacesAndNewlines),
            fallbackModelsRaw: fallbackModels,
            sourcePrompt: sourcePrompt,
            mergeInstructions: mergeInstructions.trimmingCharacters(in: .whitespacesAndNewlines),
            clarificationInstructions: clarificationInstructions.trimmingCharacters(in: .whitespacesAndNewlines),
            clarificationText: clarification,
            previousSummary: appState.mergeHistory,
            isClarificationMerge: true,
            originalResponses: appState.lastOriginalResponses
        )

        do {
            appState.mergeOutput = ""
            let result = try await MergeApiClient.merge(config: config, responses: [:]) { partial in
                await MainActor.run {
                    appState.mergeOutput = partial
                }
            }
            appState.finishMergeConversation(with: result.text)
            appState.mergeClarificationText = ""
            appState.statusMessage = "Clarification completed"
            // ingest-parity: BOOTSTRAP_BEFORE_MERGE
            _ = await appState.persistMergeMarkdown(
                result.text,
                sourcePrompt: clarification,
                isClarification: true
            )
        } catch {
            appState.mergeOutput = "Clarification failed: \(error.localizedDescription)"
            appState.statusMessage = "Clarification failed"
        }
        isRunning = false
    }

    private func resolvedApiKey(for provider: MergeProviderDescriptor) -> String {
        if provider.supportsPreinstalledKey && usePreinstalledKey && provider.id == "deepseek_api" {
            return KeyObfuscation.getDeepSeekPreinstalledKey().trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func shouldShowAdvancedConfig(for provider: MergeProviderDescriptor) -> Bool {
        provider.supportsCustomEndpoint || provider.supportsCustomModel || supportsFallbackModels(provider)
    }

    private func supportsFallbackModels(_ provider: MergeProviderDescriptor) -> Bool {
        provider.supportsFallbackModels
    }

    private func color(for status: MergeAggregationSlotStatus) -> Color {
        switch status {
        case .ready:
            return Color(red: 0.36, green: 0.86, blue: 0.64)
        case .collected:
            return Color(red: 0.36, green: 0.86, blue: 0.64)
        case .waiting:
            return Color(red: 0.96, green: 0.75, blue: 0.33)
        case .error:
            return Color(red: 0.96, green: 0.40, blue: 0.40)
        }
    }

    private func label(for status: MergeAggregationSlotStatus) -> String {
        switch status {
        case .ready:
            return "Ready"
        case .collected:
            return "Collected"
        case .waiting:
            return "Waiting"
        case .error:
            return "Empty"
        }
    }
}
