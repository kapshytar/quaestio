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

    // Parses inline Markdown (bold, italic, inline code, links) using the
    // iOS 15+ AttributedString API and bakes the base font + per-run bold/italic/
    // monospaced traits directly into the AttributedString as SwiftUI Font
    // attributes.
    //
    // WHY: Applying `.font(.system(size:weight:))` as a SwiftUI view modifier to a
    // Text built from an AttributedString overrides every per-run
    // `inlinePresentationIntent` the markdown parser placed on the string — the
    // uniform modifier weight wins and **bold** runs render as non-bold.  Desktop
    // avoids this because CSS `<strong>` is independent of a global font modifier;
    // Markwon on Android sets span-level typeface flags that also survive.  The fix:
    // bake SwiftUI.Font attributes into each run before returning, then render
    // Text(attributed) WITHOUT a competing weight modifier (or with only a size
    // modifier that carries no weight).  This way SwiftUI Honours the per-run font
    // instead of the view-level override.
    private func inlineMarkdown(_ string: String, baseSize: CGFloat = 15, baseWeight: Font.Weight = .medium) -> AttributedString {
        let raw: AttributedString
        do {
            raw = try AttributedString(
                markdown: string,
                options: .init(
                    allowsExtendedAttributes: true,
                    interpretedSyntax: .inlineOnlyPreservingWhitespace,
                    failurePolicy: .returnPartiallyParsedIfPossible
                )
            )
        } catch {
            var fallback = AttributedString(string)
            fallback.font = .system(size: baseSize, weight: baseWeight)
            return fallback
        }

        // Walk runs and convert inlinePresentationIntent → concrete SwiftUI Font
        // so the view-level .font() modifier has nothing left to override.
        var result = raw
        for run in result.runs {
            let intent = run.inlinePresentationIntent ?? []
            let isBold   = intent.contains(.stronglyEmphasized)
            let isItalic = intent.contains(.emphasized)
            let isCode   = intent.contains(.code)

            let font: Font
            if isCode {
                // Inline code: monospaced at base size, ignore weight intent
                font = .system(size: baseSize, weight: .regular, design: .monospaced)
            } else {
                // Derive weight: bold trumps base; italic is a trait modifier
                let weight: Font.Weight = isBold ? .bold : baseWeight
                if isItalic {
                    font = .system(size: baseSize, weight: weight).italic()
                } else {
                    font = .system(size: baseSize, weight: weight)
                }
            }
            result[run.range].font = font
        }
        return result
    }

    // Heading variant: same logic but with the heading size/weight baked in.
    private func inlineMarkdownHeading(_ string: String, level: Int) -> AttributedString {
        let (size, weight): (CGFloat, Font.Weight)
        switch level {
        case 1: (size, weight) = (26, .bold)
        case 2: (size, weight) = (22, .bold)
        default: (size, weight) = (18, .semibold)
        }
        return inlineMarkdown(string, baseSize: size, baseWeight: weight)
    }

    // Tiered bullet marker by nesting depth, mirroring the web canon.
    private func bulletMarker(for level: Int) -> String {
        switch level {
        case 0: return "•"
        case 1: return "◦"
        default: return "▪"
        }
    }

    @ViewBuilder
    private func blockView(_ block: MergeMarkdownBlock) -> some View {
        switch block {
        case .paragraph(let text):
            // No .font(weight:) modifier here — the base weight (.medium) and any
            // per-run bold/italic/code are already baked into the AttributedString
            // by inlineMarkdown(). A competing view-level weight modifier would
            // override the per-run fonts and flatten bold back to .medium.
            Text(inlineMarkdown(text, baseSize: 15, baseWeight: .medium))
                .foregroundStyle(AppTheme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 10)

        case .heading(let level, let text):
            // Heading size+weight baked in; no view-level .font() needed.
            Text(inlineMarkdownHeading(text, level: level))
                .foregroundStyle(AppTheme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 10)

        case .bullet(let level, let text):
            // Nested bullets: indent by level and tier the marker (•/◦/▪) to mirror
            // the desktop/web canon, which renders sub-lists with deeper indentation.
            HStack(alignment: .top, spacing: 10) {
                Text(bulletMarker(for: level))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)

                // Same no-modifier pattern: base weight baked into the AttributedString.
                Text(inlineMarkdown(text, baseSize: 15, baseWeight: .medium))
                    .foregroundStyle(AppTheme.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.leading, CGFloat(level) * 18)
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

        case .table(let tableData):
            tableView(tableData)

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

    @ViewBuilder
    private func tableView(_ data: TableData) -> some View {
        let colCount = max(data.headers.count, data.rows.first?.count ?? 0)
        VStack(alignment: .leading, spacing: 0) {
            // Header row
            HStack(spacing: 0) {
                ForEach(0 ..< colCount, id: \.self) { col in
                    let header = col < data.headers.count ? data.headers[col].text : ""
                    Text(inlineMarkdown(header, baseSize: 13, baseWeight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background(AppTheme.panelStrong.opacity(0.45))
                }
            }
            // Header/body divider
            Rectangle()
                .fill(AppTheme.textSecondary.opacity(0.45))
                .frame(height: 1)
            // Body rows
            ForEach(Array(data.rows.enumerated()), id: \.offset) { rowIdx, row in
                HStack(spacing: 0) {
                    ForEach(0 ..< colCount, id: \.self) { col in
                        let cell = col < row.count ? row[col].text : ""
                        Text(inlineMarkdown(cell, baseSize: 13, baseWeight: .regular))
                            .foregroundStyle(AppTheme.textPrimary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .background(rowIdx % 2 == 0
                                ? Color.clear
                                : AppTheme.panelStrong.opacity(0.20))
                    }
                }
                Rectangle()
                    .fill(AppTheme.textSecondary.opacity(0.15))
                    .frame(height: 1)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(AppTheme.textSecondary.opacity(0.30), lineWidth: 1)
        )
        .padding(.bottom, 12)
    }

}

// Represents one cell in a GFM pipe-table (inline markdown allowed).
private struct TableCell: Identifiable {
    let id = UUID()
    let text: String
}

// Represents a parsed GFM pipe-table: one header row + one or more body rows.
private struct TableData {
    let headers: [TableCell]
    let rows: [[TableCell]]
}

private enum MergeMarkdownBlock {
    case heading(level: Int, text: String)
    case paragraph(String)
    case bullet(level: Int, text: String)
    case code(String)
    case table(TableData)
    case separator
    case spacer(CGFloat)

    static func parse(from markdown: String) -> [MergeMarkdownBlock] {
        let cleaned = markdown.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return [] }

        var blocks: [MergeMarkdownBlock] = []
        var codeBuffer: [String] = []
        var insideCodeBlock = false

        // Collect all lines first so we can do look-ahead for GFM tables.
        let allLines = cleaned.components(separatedBy: .newlines)
        var i = 0
        while i < allLines.count {
            let rawLine = allLines[i]
            let trimmed = rawLine.trimmingCharacters(in: .whitespaces)

            // --- Fenced code block ---
            if trimmed.hasPrefix("```") {
                if insideCodeBlock, !codeBuffer.isEmpty {
                    blocks.append(.code(codeBuffer.joined(separator: "\n")))
                    codeBuffer.removeAll()
                }
                insideCodeBlock.toggle()
                i += 1
                continue
            }

            if insideCodeBlock {
                codeBuffer.append(rawLine)
                i += 1
                continue
            }

            // --- GFM pipe-table detection ---
            // A GFM table starts with a pipe row followed immediately by a
            // separator row made up of dashes/colons/pipes (the alignment row).
            // We collect all subsequent pipe rows as body rows.
            let nextTrimmed = (i + 1 < allLines.count)
                ? allLines[i + 1].trimmingCharacters(in: .whitespaces)
                : ""
            if isPipeRow(trimmed) && isTableSeparator(nextTrimmed) {
                let headers = parsePipeCells(trimmed)
                var rows: [[TableCell]] = []
                // Skip the separator row
                var j = i + 2
                while j < allLines.count {
                    let bodyTrimmed = allLines[j].trimmingCharacters(in: .whitespaces)
                    guard isPipeRow(bodyTrimmed) else { break }
                    rows.append(parsePipeCells(bodyTrimmed))
                    j += 1
                }
                if !headers.isEmpty {
                    blocks.append(.table(TableData(headers: headers, rows: rows)))
                    i = j
                    continue
                }
            }

            // --- Other block types ---
            if trimmed.isEmpty {
                blocks.append(.spacer(8))
                i += 1
                continue
            }

            if trimmed == "---" {
                blocks.append(.separator)
                i += 1
                continue
            }

            if let heading = headingText(from: trimmed, prefix: "# ") {
                blocks.append(.heading(level: 1, text: heading))
                i += 1
                continue
            }

            if let heading = headingText(from: trimmed, prefix: "## ") {
                blocks.append(.heading(level: 2, text: heading))
                i += 1
                continue
            }

            if let heading = headingText(from: trimmed, prefix: "### ") {
                blocks.append(.heading(level: 3, text: heading))
                i += 1
                continue
            }

            if let bullet = bulletText(from: trimmed) {
                let level = bulletIndentLevel(of: rawLine)
                blocks.append(.bullet(level: level, text: bullet))
                i += 1
                continue
            }

            blocks.append(.paragraph(rawLine))
            i += 1
        }

        if !codeBuffer.isEmpty {
            blocks.append(.code(codeBuffer.joined(separator: "\n")))
        }

        return blocks
    }

    // Returns true when the line looks like a GFM pipe row (has at least one '|'
    // and at least two cells, allowing optional leading/trailing pipes).
    private static func isPipeRow(_ line: String) -> Bool {
        guard line.contains("|") else { return false }
        let pipeCount = line.filter { $0 == "|" }.count
        return pipeCount >= 1
    }

    // Returns true when the line is a GFM alignment/separator row:
    // cells consist only of dashes, colons, and spaces.
    private static func isTableSeparator(_ line: String) -> Bool {
        guard isPipeRow(line) else { return false }
        let stripped = line.replacingOccurrences(of: "|", with: "")
        return stripped.allSatisfy { $0 == "-" || $0 == ":" || $0 == " " }
    }

    // Splits a pipe-row into trimmed cell strings, stripping leading/trailing pipes.
    private static func parsePipeCells(_ line: String) -> [TableCell] {
        var raw = line.trimmingCharacters(in: .whitespaces)
        if raw.hasPrefix("|") { raw = String(raw.dropFirst()) }
        if raw.hasSuffix("|") { raw = String(raw.dropLast()) }
        return raw.components(separatedBy: "|")
            .map { TableCell(text: $0.trimmingCharacters(in: .whitespaces)) }
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

    // Nesting depth of a bullet line, derived from its leading whitespace.
    // The block parser trims each line before detecting bullets, which discarded
    // indentation and flattened every sub-bullet to the top level — that's why
    // the web canon showed indented sub-lists but iOS rendered them flat. Tabs
    // count as 4 columns; ~2 columns of indent = one nesting level, capped at 3.
    private static func bulletIndentLevel(of rawLine: String) -> Int {
        var width = 0
        for ch in rawLine {
            if ch == " " { width += 1 }
            else if ch == "\t" { width += 4 }
            else { break }
        }
        return min(width / 2, 3)
    }
}
