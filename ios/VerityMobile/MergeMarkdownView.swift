import SwiftUI

struct MergeMarkdownView: View {
    let markdown: String

    private var renderedMarkdown: AttributedString? {
        let cleaned = markdown.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return nil }

        return try? AttributedString(
            markdown: cleaned,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .full,
                failurePolicy: .returnPartiallyParsedIfPossible
            )
        )
    }

    var body: some View {
        Group {
            if let renderedMarkdown {
                Text(renderedMarkdown)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.textPrimary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text(markdown.isEmpty ? "Merged output will appear here." : markdown)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.textPrimary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .tint(AppTheme.actionFill)
        .environment(\.openURL, OpenURLAction { _ in
            .systemAction
        })
    }
}
