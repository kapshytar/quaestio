import SwiftUI

struct MergeView: View {
    @EnvironmentObject private var appState: MobileAppState
    @State private var prompt: String = ""
    @State private var apiKey: String = ""
    @State private var customEndpoint: String = ""
    @State private var customModel: String = ""
    @State private var fallbackModels: String = ""
    @State private var mergeInstructions: String = ""
    @State private var selectedProviderId: String = ""
    @State private var isRunning = false

    private let catalog = MergeCatalogLoader.loadCatalog()

    private var providers: [MergeProviderDescriptor] {
        catalog?.providers ?? []
    }

    private var selectedProvider: MergeProviderDescriptor? {
        providers.first(where: { $0.id == selectedProviderId }) ?? providers.first
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

                            TextField("API key", text: $apiKey)
                                .textContentType(.password)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(AppTheme.textPrimary)
                                .padding(14)
                                .glassCard(padding: 0, radius: AppTheme.compactRadius)

                            TextField("Endpoint", text: $customEndpoint, axis: .vertical)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(AppTheme.textPrimary)
                                .padding(14)
                                .glassCard(padding: 0, radius: AppTheme.compactRadius)

                            TextField("Model", text: $customModel)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(AppTheme.textPrimary)
                                .padding(14)
                                .glassCard(padding: 0, radius: AppTheme.compactRadius)

                            TextField("Fallback models (comma or newline separated)", text: $fallbackModels, axis: .vertical)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(AppTheme.textPrimary)
                                .padding(14)
                                .glassCard(padding: 0, radius: AppTheme.compactRadius)
                        }
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionLabel(text: "Prompt")

                        TextField("Describe what the merge should produce", text: $prompt, axis: .vertical)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.textPrimary)
                            .padding(14)
                            .glassCard(padding: 0, radius: AppTheme.compactRadius)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionLabel(text: "Instructions")

                        TextField("Merge instructions", text: $mergeInstructions, axis: .vertical)
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

                    VStack(alignment: .leading, spacing: 12) {
                        SectionLabel(text: "Output")

                        Text(appState.mergeOutput.isEmpty ? "Merged output will appear here." : appState.mergeOutput)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.textPrimary)
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
        syncProviderDefaults()
    }

    private func syncProviderDefaults() {
        guard let selectedProvider else { return }
        if customEndpoint.isEmpty || customEndpoint == providers.first(where: { $0.id == selectedProviderId })?.defaultEndpoint {
            customEndpoint = selectedProvider.defaultEndpoint
        }
        if customModel.isEmpty || customModel == providers.first(where: { $0.id == selectedProviderId })?.defaultModel {
            customModel = selectedProvider.defaultModel
        }
    }

    private func runMerge() async {
        guard let selectedProvider else { return }
        guard !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            appState.statusMessage = "Merge API key required"
            appState.mergeOutput = "Merge API key required."
            return
        }

        isRunning = true
        appState.statusMessage = "Collecting source replies..."
        let responses = await appState.collectLatestRepliesForMerge(sourcePrompt: prompt)
        guard !responses.isEmpty else {
            isRunning = false
            appState.statusMessage = "No source replies available"
            appState.mergeOutput = "No source replies were found in enabled slots."
            return
        }

        let config = MergeRunConfig(
            provider: selectedProvider,
            apiKey: apiKey.trimmingCharacters(in: .whitespacesAndNewlines),
            customEndpoint: customEndpoint.trimmingCharacters(in: .whitespacesAndNewlines),
            customModel: customModel.trimmingCharacters(in: .whitespacesAndNewlines),
            fallbackModelsRaw: fallbackModels,
            sourcePrompt: prompt,
            mergeInstructions: mergeInstructions.trimmingCharacters(in: .whitespacesAndNewlines)
        )

        appState.statusMessage = "Running merge via \(selectedProvider.title)..."
        do {
            let result = try await MergeApiClient.merge(config: config, responses: responses)
            appState.mergeOutput = result.text
            appState.statusMessage = "Merge completed with \(responses.count) source reply(s)"
        } catch {
            appState.mergeOutput = "Merge failed: \(error.localizedDescription)"
            appState.statusMessage = "Merge failed"
        }
        isRunning = false
    }
}
