#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
APK_PATH="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
APP_ID="${ANDROID_APP_ID:-com.chataggregator.app.debug}"
DEVICE_INPUT="${1:-${ANDROID_DEVICE_ID:-}}"
GRADLE_PROPERTIES="$ANDROID_DIR/gradle.properties"

require_tool() {
  local tool="$1"
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool" >&2
    exit 1
  fi
}

require_tool adb

configure_java_home() {
  if [ -f "$GRADLE_PROPERTIES" ]; then
    local pinned_java_home
    pinned_java_home="$(awk -F= '/^org\.gradle\.java\.home=/{print $2}' "$GRADLE_PROPERTIES" | tail -n 1)"
    if [ -n "$pinned_java_home" ] && [ -x "$pinned_java_home/bin/java" ]; then
      export JAVA_HOME="$pinned_java_home"
      export PATH="$JAVA_HOME/bin:$PATH"
    fi
  fi

  if ! command -v java >/dev/null 2>&1; then
    echo "No Java runtime found. Checked org.gradle.java.home in $GRADLE_PROPERTIES." >&2
    exit 1
  fi
}

resolve_device_serial() {
  local requested="${1:-}"
  local serials=()
  while IFS= read -r serial; do
    [ -n "$serial" ] && serials+=("$serial")
  done < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')

  if [ -n "$requested" ]; then
    for serial in "${serials[@]}"; do
      if [ "$serial" = "$requested" ]; then
        echo "$serial"
        return 0
      fi
    done
    echo "Requested Android device not available: $requested" >&2
    exit 1
  fi

  if [ "${#serials[@]}" -eq 1 ]; then
    echo "${serials[0]}"
    return 0
  fi

  if [ "${#serials[@]}" -eq 0 ]; then
    echo "No Android devices are available in adb." >&2
    echo "Preferred order on this Mac:" >&2
    echo "  1. USB (most reliable)" >&2
    echo "  2. Android Wireless debugging TLS endpoint: adb mdns services; adb connect <phone-ip>:<high-port>" >&2
    echo "  3. Legacy adb tcpip 5555 only if it actually accepts connections" >&2
    echo "See docs/handoff/INTEGRATIONS_AND_KEYS.md and android/docs/CODEX_INSTALL_PLAYBOOK.md." >&2
    exit 1
  fi

  echo "Multiple Android devices are available; pass a serial or set ANDROID_DEVICE_ID. Devices: ${serials[*]}" >&2
  exit 1
}

read_installed_version() {
  local serial="$1"
  local package_name="$2"
  adb -s "$serial" shell dumpsys package "$package_name" 2>/dev/null | \
    awk '
      /versionCode=/ {
        if (match($0, /versionCode=[0-9]+/)) {
          versionCode = substr($0, RSTART + 12, RLENGTH - 12)
        }
      }
      /versionName=/ {
        if (match($0, /versionName=[^[:space:]]+/)) {
          versionName = substr($0, RSTART + 12, RLENGTH - 12)
        }
      }
      END {
        if (versionName != "" && versionCode != "") {
          print versionName, versionCode
        } else {
          exit 1
        }
      }
    '
}

DEVICE_SERIAL="$(resolve_device_serial "$DEVICE_INPUT")"
configure_java_home

echo "Building Android debug APK for $DEVICE_SERIAL..."
(
  cd "$ANDROID_DIR"
  ./gradlew :app:assembleDebug
)

if [ ! -f "$APK_PATH" ]; then
  echo "Debug APK not found at $APK_PATH" >&2
  exit 1
fi

echo "Installing $APP_ID on $DEVICE_SERIAL..."
adb -s "$DEVICE_SERIAL" install -r "$APK_PATH"

INSTALLED_INFO="$(read_installed_version "$DEVICE_SERIAL" "$APP_ID")"
INSTALLED_VERSION="${INSTALLED_INFO% *}"
INSTALLED_CODE="${INSTALLED_INFO##* }"

echo "Installed Android version verified: $INSTALLED_VERSION ($INSTALLED_CODE)"

adb -s "$DEVICE_SERIAL" shell am force-stop "$APP_ID" >/dev/null 2>&1 || true
adb -s "$DEVICE_SERIAL" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null

echo "Launch succeeded for $APP_ID on $DEVICE_SERIAL."
