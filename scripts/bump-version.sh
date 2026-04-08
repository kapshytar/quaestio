#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_YML="$ROOT_DIR/project.yml"
ANDROID_VERSION_FILE="$ROOT_DIR/android/version.properties"
CHANGELOG_FILE="$ROOT_DIR/CHANGELOG.md"
MODE="${1:-}"

if [[ -z "$MODE" ]]; then
  echo "usage: ./scripts/bump-version.sh <patch|push>" >&2
  echo "see: $ROOT_DIR/VERSIONING.md" >&2
  exit 1
fi

if [[ "$MODE" != "patch" && "$MODE" != "push" ]]; then
  echo "unknown mode: $MODE" >&2
  echo "expected one of: patch, push" >&2
  exit 1
fi

python3 - <<'PY' "$PROJECT_YML" "$ANDROID_VERSION_FILE" "$CHANGELOG_FILE" "$MODE"
from pathlib import Path
import re
import sys

project_yml = Path(sys.argv[1])
android_file = Path(sys.argv[2])
changelog = Path(sys.argv[3])
mode = sys.argv[4]

project_text = project_yml.read_text()
android_text = android_file.read_text()

marketing_match = re.search(r"MARKETING_VERSION:\s*([0-9]+)\.([0-9]+)\.([0-9]+)", project_text)
build_match = re.search(r"CURRENT_PROJECT_VERSION:\s*([0-9]+)", project_text)
base_match = re.search(r"^VERSION_BASE=([0-9]+)\.([0-9]+)$", android_text, re.M)
patch_match = re.search(r"^VERSION_PATCH=([0-9]+)$", android_text, re.M)
code_match = re.search(r"^VERSION_CODE=([0-9]+)$", android_text, re.M)

if not all([marketing_match, build_match, base_match, patch_match, code_match]):
    raise SystemExit("version sources are incomplete; run ./scripts/check-versioning.sh")

major, minor, patch = map(int, marketing_match.groups())
build = int(build_match.group(1))
base_major, base_minor = map(int, base_match.groups())
android_patch = int(patch_match.group(1))
code = int(code_match.group(1))

if (major, minor) != (base_major, base_minor) or patch != android_patch or build != code:
    raise SystemExit("version sources are out of sync; run ./scripts/check-versioning.sh")

if mode == "patch":
    patch += 1
elif mode == "push":
    minor += 1
    patch = 0

build += 1
new_marketing = f"{major}.{minor}.{patch}"
new_base = f"{major}.{minor}"
new_build = str(build)

project_text = re.sub(r"(MARKETING_VERSION:\s*)([0-9]+\.[0-9]+\.[0-9]+)", rf"\g<1>{new_marketing}", project_text, count=1)
project_text = re.sub(r"(CURRENT_PROJECT_VERSION:\s*)([0-9]+)", rf"\g<1>{new_build}", project_text, count=1)
project_yml.write_text(project_text)

android_text = re.sub(r"(^VERSION_BASE=).*$", rf"\g<1>{new_base}", android_text, count=1, flags=re.M)
android_text = re.sub(r"(^VERSION_PATCH=).*$", rf"\g<1>{patch}", android_text, count=1, flags=re.M)
android_text = re.sub(r"(^VERSION_CODE=).*$", rf"\g<1>{new_build}", android_text, count=1, flags=re.M)
android_file.write_text(android_text)

changelog_text = changelog.read_text()
header = f"## {new_marketing}"
if header not in changelog_text:
    lines = changelog_text.splitlines()
    insert_at = 1 if lines and lines[0].startswith("# ") else 0
    block = ["", header, "", "- pending summary", ""]
    lines[insert_at:insert_at] = block
    changelog.write_text("\n".join(lines).rstrip() + "\n")

print(f"bumped {mode} -> {new_marketing} ({new_build})")
PY

echo "updated version sources"
echo "next:"
echo "  1. edit CHANGELOG.md top entry"
echo "  2. run ./scripts/check-versioning.sh"
echo "see: $ROOT_DIR/VERSIONING.md"
