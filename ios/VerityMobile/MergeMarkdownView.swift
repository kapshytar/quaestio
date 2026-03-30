import SwiftUI

struct MergeMarkdownView: View {
    let markdown: String

    private var blocks: [MergeMarkdownBlock] {
        MergeMarkdownBlock.parse(from: markdown)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if blocks.isEmpty {
                Text("Merged output will appear here.")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                    blockView(block)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tint(AppTheme.actionFill)
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func blockView(_ block: MergeMarkdownBlock) -> some View {
        switch block {
        case .paragraph(let text):
            Text(text)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(AppTheme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 10)

        case .heading(let level, let text):
            Text(text)
                .font(headingFont(for: level))
                .foregroundStyle(AppTheme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 10)

        case .bullet(let text):
            HStack(alignment: .top, spacing: 10) {
                Text("•")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)

                Text(text)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 10)

        case .code(let text):
            Text(text)
                .font(.system(size: 14, weight: .regular, design: .monospaced))
                .foregroundStyle(AppTheme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(AppTheme.panelStrong.opacity(0.6))
                )
                .padding(.bottom, 12)

        case .separator:
            Rectangle()
                .fill(AppTheme.textSecondary.opacity(0.28))
                .frame(height: 1)
                .padding(.vertical, 10)

        case .spacer(let height):
            Color.clear
                .frame(height: height)
        }
    }

    private func headingFont(for level: Int) -> Font {
        switch level {
        case 1:
            return .system(size: 26, weight: .bold)
        case 2:
            return .system(size: 22, weight: .bold)
        default:
            return .system(size: 18, weight: .semibold)
        }
    }
}

private enum MergeMarkdownBlock {
    case heading(level: Int, text: String)
    case paragraph(String)
    case bullet(String)
    case code(String)
    case separator
    case spacer(CGFloat)

    static func parse(from markdown: String) -> [MergeMarkdownBlock] {
        let cleaned = markdown.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return [] }

        var blocks: [MergeMarkdownBlock] = []
        var codeBuffer: [String] = []
        var insideCodeBlock = false

        for rawLine in cleaned.components(separatedBy: .newlines) {
            let trimmed = rawLine.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("```") {
                if insideCodeBlock, !codeBuffer.isEmpty {
                    blocks.append(.code(codeBuffer.joined(separator: "\n")))
                    codeBuffer.removeAll()
                }
                insideCodeBlock.toggle()
                continue
            }

            if insideCodeBlock {
                codeBuffer.append(rawLine)
                continue
            }

            if trimmed.isEmpty {
                blocks.append(.spacer(8))
                continue
            }

            if trimmed == "---" {
                blocks.append(.separator)
                continue
            }

            if let heading = headingText(from: trimmed, prefix: "# ") {
                blocks.append(.heading(level: 1, text: heading))
                continue
            }

            if let heading = headingText(from: trimmed, prefix: "## ") {
                blocks.append(.heading(level: 2, text: heading))
                continue
            }

            if let heading = headingText(from: trimmed, prefix: "### ") {
                blocks.append(.heading(level: 3, text: heading))
                continue
            }

            if let bullet = bulletText(from: trimmed) {
                blocks.append(.bullet(bullet))
                continue
            }

            blocks.append(.paragraph(rawLine))
        }

        if !codeBuffer.isEmpty {
            blocks.append(.code(codeBuffer.joined(separator: "\n")))
        }

        return blocks
    }

    private static func headingText(from line: String, prefix: String) -> String? {
        guard line.hasPrefix(prefix) else { return nil }
        return String(line.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func bulletText(from line: String) -> String? {
        for prefix in ["- ", "* "] {
            if line.hasPrefix(prefix) {
                return String(line.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return nil
    }
}
