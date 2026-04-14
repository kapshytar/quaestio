#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_PATH="$ROOT_DIR/VerityMobile.xcodeproj"
SCHEME="VerityMobile"
CONFIGURATION="${IOS_CONFIGURATION:-Debug}"
DERIVED_DATA_PATH="${IOS_DERIVED_DATA_PATH:-$ROOT_DIR/.build/ios-device}"
BUNDLE_ID="${IOS_BUNDLE_ID:-com.verity.mobile}"
APP_NAME="${IOS_APP_NAME:-VerityMobile}"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/${CONFIGURATION}-iphoneos/${APP_NAME}.app"
DEVICE_INPUT="${1:-${IOS_DEVICE_ID:-}}"

require_tool() {
  local tool="$1"
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool" >&2
    exit 1
  fi
}

require_tool xcodebuild
require_tool xcrun
require_tool python3

"$ROOT_DIR/scripts/bootstrap-ios.sh" >/dev/null

resolve_device_udid() {
  local requested="${1:-}"
  local json_file
  json_file="$(mktemp)"
  xcrun devicectl list devices -j "$json_file" >/dev/null 2>&1
  python3 - <<'PY' "$json_file" "$requested"
import json
import sys

path = sys.argv[1]
requested = sys.argv[2]
with open(path, "r", encoding="utf-8") as fh:
    data = json.load(fh)
devices = data.get("result", {}).get("devices", [])
ios_devices = []
for device in devices:
    platform = device.get("hardwareProperties", {}).get("platform")
    if platform != "iOS":
        continue
    state = device.get("connectionProperties", {}).get("pairingState")
    if state != "paired":
        continue
    udid = device.get("hardwareProperties", {}).get("udid")
    name = device.get("deviceProperties", {}).get("name")
    identifier = device.get("identifier")
    hostnames = set(device.get("connectionProperties", {}).get("potentialHostnames", []))
    aliases = {value for value in [udid, name, identifier] if value}
    aliases.update(hostnames)
    ios_devices.append((device, aliases))

if requested:
    for device, aliases in ios_devices:
        if requested in aliases:
            print(device["hardwareProperties"]["udid"])
            sys.exit(0)
    print(f"Could not find requested iOS device: {requested}", file=sys.stderr)
    sys.exit(1)

if len(ios_devices) == 1:
    print(ios_devices[0][0]["hardwareProperties"]["udid"])
    sys.exit(0)

if not ios_devices:
    print("No paired iOS devices are currently available.", file=sys.stderr)
    sys.exit(1)

names = ", ".join(device["deviceProperties"]["name"] for device, _ in ios_devices)
print(f"Multiple paired iOS devices are available; set IOS_DEVICE_ID or pass one explicitly. Devices: {names}", file=sys.stderr)
sys.exit(1)
PY
  rm -f "$json_file"
}

read_plist_value() {
  local plist_path="$1"
  local key="$2"
  python3 - <<'PY' "$plist_path" "$key"
import plistlib
import sys

path, key = sys.argv[1], sys.argv[2]
with open(path, "rb") as fh:
    data = plistlib.load(fh)
value = data.get(key)
if value is None:
    raise SystemExit(f"Missing plist key: {key}")
print(value)
PY
}

read_installed_version() {
  local device_udid="$1"
  local bundle_id="$2"
  local json_file
  json_file="$(mktemp)"
  xcrun devicectl device info apps --device "$device_udid" -j "$json_file" >/dev/null 2>&1
  python3 - <<'PY' "$json_file" "$bundle_id"
import json
import sys

path, bundle_id = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as fh:
    data = json.load(fh)
apps = data.get("result", {}).get("apps", [])
for app in apps:
    if app.get("bundleIdentifier") == bundle_id:
        print(f"{app.get('version','')} {app.get('bundleVersion','')}")
        sys.exit(0)
print("", file=sys.stderr)
sys.exit(1)
PY
  rm -f "$json_file"
}

terminate_existing_process() {
  local device_udid="$1"
  local bundle_id="$2"
  local json_file
  json_file="$(mktemp)"
  xcrun devicectl device info processes --device "$device_udid" -j "$json_file" >/dev/null 2>&1 || true
  local pid
  pid="$(python3 - <<'PY' "$json_file" "$bundle_id"
import json
import sys

path, bundle_id = sys.argv[1], sys.argv[2]
try:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
except Exception:
    print("")
    sys.exit(0)

for process in data.get("result", {}).get("runningProcesses", []):
    if process.get("bundleIdentifier") == bundle_id:
        print(process.get("processIdentifier", ""))
        sys.exit(0)
print("")
PY
)"
  rm -f "$json_file"
  if [ -n "$pid" ]; then
    xcrun devicectl device process terminate --device "$device_udid" --pid "$pid" >/dev/null 2>&1 || true
  fi
}

DEVICE_UDID="$(resolve_device_udid "$DEVICE_INPUT")"
DESTINATION="id=$DEVICE_UDID"

echo "Building $APP_NAME for device $DEVICE_UDID..."
xcodebuild \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  -allowProvisioningUpdates \
  build

if [ ! -d "$APP_PATH" ]; then
  echo "Built app not found at $APP_PATH" >&2
  exit 1
fi

PLIST_PATH="$APP_PATH/Info.plist"
BUILT_VERSION="$(read_plist_value "$PLIST_PATH" CFBundleShortVersionString)"
BUILT_BUILD="$(read_plist_value "$PLIST_PATH" CFBundleVersion)"

echo "Built version: $BUILT_VERSION ($BUILT_BUILD)"
echo "Installing $APP_NAME via direct devicectl install..."
xcrun devicectl device install app --device "$DEVICE_UDID" "$APP_PATH"

INSTALLED_INFO="$(read_installed_version "$DEVICE_UDID" "$BUNDLE_ID")"
INSTALLED_VERSION="${INSTALLED_INFO% *}"
INSTALLED_BUILD="${INSTALLED_INFO##* }"

if [ "$INSTALLED_VERSION" != "$BUILT_VERSION" ] || [ "$INSTALLED_BUILD" != "$BUILT_BUILD" ]; then
  echo "Installed version mismatch: expected $BUILT_VERSION ($BUILT_BUILD), found $INSTALLED_VERSION ($INSTALLED_BUILD)" >&2
  exit 1
fi

echo "Installed version verified: $INSTALLED_VERSION ($INSTALLED_BUILD)"

terminate_existing_process "$DEVICE_UDID" "$BUNDLE_ID"

echo "Launching $BUNDLE_ID..."
if xcrun devicectl device process launch --device "$DEVICE_UDID" "$BUNDLE_ID"; then
  echo "Launch succeeded."
else
  echo "Install is good, but launch failed. Device may be locked; open the app manually." >&2
fi
