import SwiftUI

struct MergeView: View {
    @EnvironmentObject private var appState: MobileAppState
    @State private var prompt: String = ""

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
                        SectionLabel(text: "Prompt")

                        TextField("Describe what the merge should produce", text: $prompt, axis: .vertical)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.textPrimary)
                            .padding(14)
                            .glassCard(padding: 0, radius: AppTheme.compactRadius)
                    }

                    Button {
                        appState.statusMessage = "Merge MVP placeholder"
                        appState.mergeOutput = prompt.isEmpty ? "No prompt yet." : "Merge placeholder for: \(prompt)"
                    } label: {
                        HStack {
                            Text("Run Merge")
                            Spacer()
                            Image(systemName: "sparkles.rectangle.stack")
                                .font(.system(size: 14, weight: .semibold))
                        }
                    }
                    .buttonStyle(PrimaryActionButtonStyle())

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
        }
    }
}
