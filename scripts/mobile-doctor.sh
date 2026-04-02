#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
ANDROID_GRADLE_PROPERTIES="$ANDROID_DIR/gradle.properties"
IOS_PROJECT_YML="$ROOT_DIR/project.yml"
IOS_PROJECT_PATH="$ROOT_DIR/VerityMobile.xcodeproj"
IOS_SOURCE_DIR="$ROOT_DIR/ios/VerityMobile"
IOS_DEPLOY_SCRIPT="$ROOT_DIR/scripts/deploy-ios-device.sh"
ANDROID_DEPLOY_SCRIPT="$ROOT_DIR/scripts/deploy-android-device.sh"

command_status() {
  local tool="$1"
  if command -v "$tool" >/dev/null 2>&1; then
    printf "ok   %s -> %s\n" "$tool" "$(command -v "$tool")"
  else
    printf "miss %s\n" "$tool"
  fi
}

echo "== Mobile Doctor =="
echo
echo "-- Tools --"
command_status xcodebuild
command_status xcrun
command_status adb
command_status java
command_status python3
echo

echo "-- Repo scripts --"
for path in "$IOS_DEPLOY_SCRIPT" "$ANDROID_DEPLOY_SCRIPT" "$ROOT_DIR/scripts/bootstrap-ios.sh" "$ROOT_DIR/scripts/android-gradlew.sh"; do
  if [ -x "$path" ]; then
    printf "ok   %s\n" "$path"
  else
    printf "warn %s (not executable)\n" "$path"
  fi
done
echo

echo "-- Canonical iOS paths --"
printf "source of truth -> %s\n" "$IOS_PROJECT_YML"
printf "generated xcodeproj -> %s\n" "$IOS_PROJECT_PATH"
printf "ios sources -> %s\n" "$IOS_SOURCE_DIR"
if [ -d "$IOS_PROJECT_PATH" ]; then
  echo "ok   xcodeproj exists"
else
  echo "warn xcodeproj missing (run ./scripts/bootstrap-ios.sh or deploy script)"
fi
echo

echo "-- iOS version source --"
python3 - <<'PY' "$IOS_PROJECT_YML"
from pathlib import Path
import re
text = Path(__import__('sys').argv[1]).read_text()
marketing = re.search(r'MARKETING_VERSION:\s*([^\s]+)', text)
build = re.search(r'CURRENT_PROJECT_VERSION:\s*([^\s]+)', text)
print(f"project.yml -> {marketing.group(1)} ({build.group(1)})")
PY
echo

echo "-- Android version source --"
python3 - <<'PY' "$ANDROID_DIR/version.properties"
from pathlib import Path
vals = {}
for line in Path(__import__('sys').argv[1]).read_text().splitlines():
    if "=" in line:
        k, v = line.split("=", 1)
        vals[k.strip()] = v.strip()
print(f"version.properties -> {vals.get('VERSION_BASE')}.{vals.get('VERSION_PATCH')} ({vals.get('VERSION_CODE')})")
PY
echo

echo "-- iOS devices --"
if command -v xcrun >/dev/null 2>&1; then
  json_file="$(mktemp)"
  if xcrun devicectl list devices -j "$json_file" >/dev/null 2>&1; then
    python3 - <<'PY' "$json_file"
import json, sys
data = json.load(open(sys.argv[1], "r", encoding="utf-8"))
devices = data.get("result", {}).get("devices", [])
ios = [d for d in devices if d.get("hardwareProperties", {}).get("platform") == "iOS"]
if not ios:
    print("no paired iOS devices")
else:
    for d in ios:
        name = d.get("deviceProperties", {}).get("name")
        udid = d.get("hardwareProperties", {}).get("udid")
        state = d.get("connectionProperties", {}).get("pairingState")
        os_version = d.get("deviceProperties", {}).get("osVersionNumber")
        print(f"{name} | {udid} | {state} | iOS {os_version}")
PY
  else
    echo "unable to query devicectl devices"
  fi
  rm -f "$json_file"
fi
echo

echo "-- Android devices --"
if command -v adb >/dev/null 2>&1; then
  adb devices -l
fi
echo

echo "-- JDK pin --"
if [ -f "$ANDROID_GRADLE_PROPERTIES" ]; then
  rg -n "^org\\.gradle\\.java\\.home=" "$ANDROID_GRADLE_PROPERTIES" || echo "warn no org.gradle.java.home pin"
  PINNED_JAVA_HOME="$(awk -F= '/^org\.gradle\.java\.home=/{print $2}' "$ANDROID_GRADLE_PROPERTIES" | tail -n 1)"
  if [ -n "${PINNED_JAVA_HOME:-}" ]; then
    printf "resolved org.gradle.java.home -> %s\n" "$PINNED_JAVA_HOME"
    if [ -x "$PINNED_JAVA_HOME/bin/java" ]; then
      printf "ok   pinned java -> %s\n" "$PINNED_JAVA_HOME/bin/java"
    else
      printf "warn pinned java missing executable -> %s/bin/java\n" "$PINNED_JAVA_HOME"
    fi
  fi
else
  echo "warn missing $ANDROID_GRADLE_PROPERTIES"
fi
echo

echo "-- Canonical commands --"
echo "iOS:     cd $ROOT_DIR && ./scripts/deploy-ios-device.sh"
echo "Android: cd $ROOT_DIR && ./scripts/deploy-android-device.sh"
echo "Gradle:  cd $ROOT_DIR && ./scripts/android-gradlew.sh :app:assembleDebug"
echo
echo "-- Android JDK rule --"
echo "Do not run raw ./gradlew from memory on this Mac."
echo "Use ./scripts/deploy-android-device.sh, or export JAVA_HOME from android/gradle.properties first."
