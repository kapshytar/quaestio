#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_YML="$ROOT_DIR/project.yml"
ANDROID_VERSION_FILE="$ROOT_DIR/android/version.properties"
CHANGELOG_FILE="$ROOT_DIR/CHANGELOG.md"

python3 - <<'PY' "$PROJECT_YML" "$ANDROID_VERSION_FILE" "$CHANGELOG_FILE"
from pathlib import Path
import re
import sys

project_yml = Path(sys.argv[1])
android_file = Path(sys.argv[2])
changelog = Path(sys.argv[3])

project_text = project_yml.read_text()
android_text = android_file.read_text()
changelog_text = changelog.read_text()

marketing_match = re.search(r"MARKETING_VERSION:\s*([0-9]+)\.([0-9]+)\.([0-9]+)", project_text)
build_match = re.search(r"CURRENT_PROJECT_VERSION:\s*([0-9]+)", project_text)
base_match = re.search(r"^VERSION_BASE=([0-9]+)\.([0-9]+)$", android_text, re.M)
patch_match = re.search(r"^VERSION_PATCH=([0-9]+)$", android_text, re.M)
code_match = re.search(r"^VERSION_CODE=([0-9]+)$", android_text, re.M)

errors = []
if not marketing_match:
    errors.append("project.yml missing MARKETING_VERSION")
if not build_match:
    errors.append("project.yml missing CURRENT_PROJECT_VERSION")
if not base_match:
    errors.append("android/version.properties missing VERSION_BASE")
if not patch_match:
    errors.append("android/version.properties missing VERSION_PATCH")
if not code_match:
    errors.append("android/version.properties missing VERSION_CODE")

if errors:
    print("\n".join(errors), file=sys.stderr)
    raise SystemExit(1)

major, minor, patch = map(int, marketing_match.groups())
build = int(build_match.group(1))
base_major, base_minor = map(int, base_match.groups())
android_patch = int(patch_match.group(1))
code = int(code_match.group(1))
semver = f"{major}.{minor}.{patch}"

if (major, minor) != (base_major, base_minor):
    errors.append(f"VERSION_BASE {base_major}.{base_minor} != MARKETING_VERSION major/minor {major}.{minor}")
if patch != android_patch:
    errors.append(f"VERSION_PATCH {android_patch} != MARKETING_VERSION patch {patch}")
if build != code:
    errors.append(f"CURRENT_PROJECT_VERSION {build} != VERSION_CODE {code}")
if f"## {semver}" not in changelog_text:
    errors.append(f"CHANGELOG.md missing top-level entry for {semver}")

if errors:
    print("\n".join(errors), file=sys.stderr)
    raise SystemExit(1)

print(f"ok versioning: {semver} ({build})")
print("sources:")
print(f"  project.yml -> {semver} ({build})")
print(f"  android/version.properties -> {base_major}.{base_minor}.{android_patch} ({code})")
print(f"  changelog entry -> ## {semver}")
PY

echo "see: $ROOT_DIR/VERSIONING.md"
