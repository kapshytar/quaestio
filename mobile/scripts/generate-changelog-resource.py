#!/usr/bin/env python3
"""Extract the latest changelog entries into an iOS-bundled resource.

Mirrors the Gradle task `generateLatestChangelogResource` in
mobile/android/app/build.gradle.kts (same parsing, same 30-entry cap, same
"[version] Section: text" prefix format) so both clients show identical text.

Parsing rules (keep in sync with the Gradle task):
- Version headers match `## 2.8.9` AND the legacy `## [v1.102.0] - date` form.
- A bullet may wrap across several physical lines in the .md; continuation
  lines (indented, non-bullet, non-header) are joined into ONE entry so the
  in-app text never cuts mid-sentence.
- Inline markdown emphasis (**bold**, __bold__) is stripped for plain-text UI.
"""
import re
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
SOURCE_FILE = ROOT_DIR / "CHANGELOG.md"
OUTPUT_FILE = ROOT_DIR / "ios" / "VerityMobile" / "Resources" / "ChangelogLatest.txt"

VERSION_RE = re.compile(r"^##\s+\[?(v?[\w.]+)\]?")
SECTION_RE = re.compile(r"^###\s+(.+)$")
MAX_ENTRIES = 30


def clean(text: str) -> str:
    return re.sub(r"\*\*|__", "", text).strip()


def main() -> None:
    markdown = SOURCE_FILE.read_text() if SOURCE_FILE.exists() else ""

    entries: list[str] = []
    current_version = ""
    current_section = ""
    open_entry = False  # last appended entry can still absorb continuations

    for raw_line in markdown.splitlines():
        line = raw_line.strip()

        version_match = VERSION_RE.match(line)
        if line.startswith("## ") and version_match:
            current_version = version_match.group(1).strip()
            current_section = ""
            open_entry = False
            continue

        section_match = SECTION_RE.match(line)
        if section_match:
            current_section = section_match.group(1).strip()
            open_entry = False
            continue

        if line.startswith("- ") or line.startswith("* "):
            if len(entries) >= MAX_ENTRIES:
                open_entry = False
                continue
            prefix = ""
            if current_version:
                prefix += f"[{current_version}] "
            if current_section:
                prefix += f"{current_section}: "
            entries.append(f"{prefix}{clean(line[2:])}")
            open_entry = True
            continue

        # Wrapped continuation of the previous bullet: indented, plain line.
        if open_entry and line and raw_line[:1] in (" ", "\t"):
            entries[-1] = f"{entries[-1]} {clean(line)}"
            continue

        open_entry = False

    output = "\n\n".join(entries) if entries else "No changelog entries found."
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(output)


if __name__ == "__main__":
    main()
