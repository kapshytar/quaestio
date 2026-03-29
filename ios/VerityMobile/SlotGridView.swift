import SwiftUI

struct SlotGridView: View {
    @EnvironmentObject private var appState: MobileAppState

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(appState.slots) { slot in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Slot \(slot.id)")
                                .font(.headline)
                            Spacer()
                            Text(slot.title)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 8)

                        WebViewSlot(slot: slot)
                            .frame(minHeight: 280)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .padding(8)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
                }
            }
            .padding()
        }
        .navigationTitle("Chats")
    }
}
