import SwiftUI

struct MergeView: View {
    @EnvironmentObject private var appState: MobileAppState
    @State private var prompt: String = ""

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                TextField("Prompt", text: $prompt, axis: .vertical)
                    .textFieldStyle(.roundedBorder)

                Button("Run Merge") {
                    appState.statusMessage = "Merge MVP placeholder"
                    appState.mergeOutput = prompt.isEmpty ? "No prompt yet." : "Merge placeholder for: \(prompt)"
                }
                .buttonStyle(.borderedProminent)

                Text(appState.mergeOutput)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding()
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
            }
            .padding()
            .navigationTitle("Merge")
        }
    }
}
