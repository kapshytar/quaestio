#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS_DIR="$ROOT_DIR/.tools"
XCODEGEN_DIR="$TOOLS_DIR/xcodegen"
XCODEGEN_BIN="$XCODEGEN_DIR/bin/xcodegen"
XCODEGEN_VERSION="2.45.3"
XCODEGEN_URL="https://github.com/yonaskolb/XcodeGen/releases/download/${XCODEGEN_VERSION}/xcodegen.zip"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild is not available. Install full Xcode first."
  exit 1
fi

if [ ! -x "$XCODEGEN_BIN" ]; then
  echo "Installing local XcodeGen ${XCODEGEN_VERSION}..."
  mkdir -p "$TOOLS_DIR"
  TMP_ZIP="$TOOLS_DIR/xcodegen.zip"
  rm -rf "$XCODEGEN_DIR"
  curl -fsSL "$XCODEGEN_URL" -o "$TMP_ZIP"
  unzip -q "$TMP_ZIP" -d "$TOOLS_DIR"
  rm -f "$TMP_ZIP"
  chmod +x "$XCODEGEN_BIN"
fi

echo "Generating latest-changelog resource..."
"$ROOT_DIR/scripts/generate-changelog-resource.py"

echo "Generating Xcode project..."
"$XCODEGEN_BIN" generate --spec "$ROOT_DIR/project.yml"

echo "Done."
echo "Next:"
echo "  open \"$ROOT_DIR/VerityMobile.xcodeproj\""
echo "or:"
echo "  xcodebuild -project \"$ROOT_DIR/VerityMobile.xcodeproj\" -scheme VerityMobile -destination 'platform=iOS Simulator,name=iPhone 16' build"
