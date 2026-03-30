import SwiftUI

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
    @State private var showAdvancedConfig = false
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
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: AppTheme.blockSpacing) {
                    ScreenHeader(
                        eyebrow: "Merge",
                        title: "Shape one final answer",
                        subtitle: "Collect outputs from multiple models and turn them into one focused response."
                    )

                    VStack(alignment: .leading, spacing: 12) {
                        SectionLabel(text: "Provider")

                        if let selectedProvider {
                            Picker("Provider", selection: $selectedProviderId) {
                                ForEach(providers) { provider in
                                    Text(provider.title).tag(provider.id)
                                }
                            }
                            .pickerStyle(.menu)
                            .onChange(of: selectedProviderId) { _, _ in
                                syncProviderDefaults()
                            }

                            if selectedProvider.supportsPreinstalledKey {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text("API Key Source")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(AppTheme.textSecondary)

                                    Picker("API Key Source", selection: $usePreinstalledKey) {
                                        Text("Use Preinstalled Key").tag(true)
                                        Text("Enter Custom Key").tag(false)
                                    }
                                    .pickerStyle(.segmented)
                                }
                            }

                            if !selectedProvider.supportsPreinstalledKey || !usePreinstalledKey {
                                TextField("API key", text: $apiKey)
                                    .textContentType(.password)
                                    .autocorrectionDisabled()
                                    .textInputAutocapitalization(.never)
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundStyle(AppTheme.textPrimary)
                                    .padding(14)
                                    .glassCard(padding: 0, radius: AppTheme.compactRadius)
                            }

                            if shouldShowAdvancedConfig(for: selectedProvider) {
                                VStack(alignment: .leading, spacing: 10) {
                                    Button {
                                        withAnimation(.easeInOut(duration: 0.16)) {
                                            showAdvancedConfig.toggle()
                                        }
                                    } label: {
                                        HStack {
                                            Text(showAdvancedConfig ? "Hide advanced config" : "Show advanced config")
                                            Spacer()
                                            Image(systemName: showAdvancedConfig ? "chevron.up" : "chevron.down")
                                                .font(.system(size: 12, weight: .semibold))
                                        }
                                    }
                                    .buttonStyle(SecondaryCapsuleButtonStyle())

                                    if showAdvancedConfig {
                                        if selectedProvider.supportsCustomEndpoint {
                                            TextField("Endpoint", text: $customEndpoint, axis: .vertical)
                                                .font(.system(size: 14, weight: .medium))
                                                .foregroundStyle(AppTheme.textPrimary)
                                                .padding(14)
                                                .glassCard(padding: 0, radius: AppTheme.compactRadius)
                                        }

                                        if selectedProvider.supportsCustomModel {
                                            TextField("Model", text: $customModel)
                                                .font(.system(size: 14, weight: .medium))
                                                .foregroundStyle(AppTheme.textPrimary)
                                                .padding(14)
                                                .glassCard(padding: 0, radius: AppTheme.compactRadius)
                                        }

                                        if supportsFallbackModels(selectedProvider) {
                                            TextField("Fallback models (comma or newline separated)", text: $fallbackModels, axis: .vertical)
                                                .font(.system(size: 14, weight: .medium))
                                                .foregroundStyle(AppTheme.textPrimary)
                                                .padding(14)
                                                .glassCard(padding: 0, radius: AppTheme.compactRadius)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionLabel(text: "Aggregation")

                        HStack(spacing: 10) {
                            Button {
                                Task {
                                    await appState.refreshMergeAggregationStatuses(sourcePrompt: sourcePrompt)
                                }
                            } label: {
                                Text("Refresh statuses")
                            }
                            .buttonStyle(SecondaryCapsuleButtonStyle())

                            Button {
                                Task {
                                    _ = await appState.collectLatestRepliesForMerge(sourcePrompt: sourcePrompt)
                                }
                            } label: {
                                Text("Collect now")
                            }
                            .buttonStyle(SecondaryCapsuleButtonStyle())
                        }

                        Text(appState.mergeAggregationSummary)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(AppTheme.textSecondary)

                        if !appState.mergeAggregationSnapshots.isEmpty {
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
                            .padding(14)
                            .glassCard(padding: 0, radius: AppTheme.compactRadius)
                        }
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionLabel(text: "Instructions")

                        TextField("Merge instructions", text: $mergeInstructions, axis: .vertical)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(AppTheme.textPrimary)
                            .padding(14)
                            .glassCard(padding: 0, radius: AppTheme.compactRadius)

                        TextField("Clarification instructions", text: $clarificationInstructions, axis: .vertical)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(AppTheme.textPrimary)
                            .padding(14)
                            .glassCard(padding: 0, radius: AppTheme.compactRadius)
                    }

                    Button {
                        Task {
                            await runMerge()
                        }
                    } label: {
                        HStack {
                            Text(isRunning ? "Running..." : "Run Merge")
                            Spacer()
                            Image(systemName: "sparkles.rectangle.stack")
                                .font(.system(size: 14, weight: .semibold))
                        }
                    }
                    .buttonStyle(PrimaryActionButtonStyle())
                    .disabled(isRunning)

                    if !appState.mergeOutput.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionLabel(text: "Clarify")

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
                                HStack {
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

                    VStack(alignment: .leading, spacing: 12) {
                        SectionLabel(text: "Output")

                        MergeMarkdownView(markdown: appState.mergeOutput)
                            .frame(maxWidth: .infinity, minHeight: 260, alignment: .topLeading)
                            .padding(16)
                            .glassCard(padding: 0)
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
    }

    private func bootstrapDefaults() {
        guard !providers.isEmpty else { return }
        if selectedProviderId.isEmpty {
            selectedProviderId = catalog?.defaultProviderId ?? providers.first?.id ?? ""
        }
        if mergeInstructions.isEmpty {
            mergeInstructions = catalog?.defaultMergeInstructions ?? ""
        }
        if clarificationInstructions.isEmpty {
            clarificationInstructions = catalog?.defaultClarificationInstructions ?? ""
        }
        syncProviderDefaults()
    }

    private func syncProviderDefaults() {
        guard let selectedProvider else { return }
        if !selectedProvider.supportsPreinstalledKey {
            usePreinstalledKey = false
        } else if selectedProvider.id == "deepseek_api" && apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
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
        let responses = await appState.collectLatestRepliesForMerge(sourcePrompt: sourcePrompt)
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
        case .waiting:
            return "Waiting"
        case .error:
            return "Empty"
        }
    }
}
