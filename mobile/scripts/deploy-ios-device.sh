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

# Print a device-not-connected guidance message and exit 1.
# $1 = optional device name to include in the message.
_device_not_available() {
  local name="${1:-}"
  local intro
  if [ -n "$name" ]; then
    intro="Device \"$name\" is paired but is NOT currently connected/available."
  else
    intro="No connected iOS device is currently available as a build destination."
  fi
  cat >&2 <<EOF
$intro

To fix:
  1. Connect the iPhone to this Mac via a USB cable.
  2. Unlock the iPhone.
  3. Tap "Trust This Computer" on the iPhone if prompted, then enter your passcode.
  4. Enable Developer Mode if not already on:
       Settings > Privacy & Security > Developer Mode (toggle ON, then reboot).
  5. Wait for Xcode to finish "Preparing device" (visible in Xcode's Devices window).
  6. Re-run this script.
EOF
  exit 1
}

# Check whether a given UDID is a currently-available build destination by running
# xcodebuild -showdestinations.  Returns 0 if the UDID appears as a concrete
# "platform:iOS, id:<udid>" destination WITHOUT an error marker; returns 1 otherwise.
# The project path is passed in so this function has no dependency on globals.
_udid_is_available_destination() {
  local udid="$1"
  local project_path="$2"
  local scheme="$3"
  # xcodebuild -showdestinations output format (one entry per line):
  #   { platform:iOS, id:<UDID>, OS:17.x, name:iPhone 15 Pro }           <- available
  #   { platform:iOS, id:<UDID>, OS:17.x, name:iPhone 15 Pro, error:... } <- unavailable
  #   { platform:iOS, id:dvtdevice-DVTiPhonePlaceholder-..., name:Any ... } <- placeholder
  # We accept a UDID only when it appears WITHOUT an "error:" key in that line.
  local destinations
  # Suppress stderr (provisioning warnings etc.) but keep stdout for parsing.
  destinations="$(xcodebuild -project "$project_path" -scheme "$scheme" -showdestinations 2>/dev/null)" || true
  # Match a line that contains the literal UDID, has "platform:iOS," (not Simulator),
  # and does NOT contain "error:".
  if echo "$destinations" | grep -q "id:${udid}" && \
     echo "$destinations" | grep "id:${udid}" | grep -q "platform:iOS," && \
     ! echo "$destinations" | grep "id:${udid}" | grep -q "error:"; then
    return 0
  fi
  return 1
}

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

# Build two lists:
#   live_devices  — iOS devices that appear genuinely connected right now
#   stale_devices — iOS devices that are paired but not live
# Primary liveness signal: connectionProperties.tunnelState == "connected".
# tunnelState is populated by Xcode 15+ devicectl; if absent we fall back to
# checking that pairingState == "paired" and mark the device as "maybe live"
# (the xcodebuild destination cross-check will sort them out downstream).
live_devices = []
stale_devices = []
for device in devices:
    platform = device.get("hardwareProperties", {}).get("platform")
    if platform != "iOS":
        continue
    conn = device.get("connectionProperties", {})
    pairing = conn.get("pairingState")
    if pairing != "paired":
        continue
    tunnel = conn.get("tunnelState")  # "connected" | "disconnected" | "unavailable" | absent
    udid = device.get("hardwareProperties", {}).get("udid")
    name = device.get("deviceProperties", {}).get("name", "")
    identifier = device.get("identifier")
    hostnames = set(conn.get("potentialHostnames", []))
    aliases = {value for value in [udid, name, identifier] if value}
    aliases.update(hostnames)
    entry = (device, aliases)
    if tunnel is None or tunnel == "connected":
        # tunnelState absent = older Xcode without the field; treat as candidate.
        live_devices.append(entry)
    else:
        # tunnelState present but NOT "connected" → device is stale/offline.
        stale_devices.append(entry)

if requested:
    # Check live devices first.
    for device, aliases in live_devices:
        if requested in aliases:
            print(device["hardwareProperties"]["udid"])
            sys.exit(0)
    # Check stale devices — if found there, emit a special marker so the shell
    # can report the right message.
    for device, aliases in stale_devices:
        if requested in aliases:
            name = device.get("deviceProperties", {}).get("name", requested)
            print(f"__STALE__:{name}", file=sys.stderr)
            sys.exit(2)
    print(f"Could not find requested iOS device: {requested}", file=sys.stderr)
    sys.exit(1)

if len(live_devices) == 1:
    print(live_devices[0][0]["hardwareProperties"]["udid"])
    sys.exit(0)

if not live_devices:
    # No live devices — check if there are stale ones to give a better message.
    if stale_devices:
        names = ", ".join(d.get("deviceProperties", {}).get("name", "?") for d, _ in stale_devices)
        print(f"__STALE__:{names}", file=sys.stderr)
        sys.exit(2)
    print("No paired iOS devices found.", file=sys.stderr)
    sys.exit(1)

names = ", ".join(device["deviceProperties"]["name"] for device, _ in live_devices)
print(f"Multiple connected iOS devices found; set IOS_DEVICE_ID or pass one explicitly. Devices: {names}", file=sys.stderr)
sys.exit(1)
PY
  local py_exit=$?
  rm -f "$json_file"
  # Exit code 2 from the Python block means "device found but stale/offline".
  # The error message was already written to stderr by Python; surface it here.
  if [ "$py_exit" -eq 2 ]; then
    local stale_name
    # Re-read from stderr; Python wrote "__STALE__:<name>" to stderr which was
    # already printed.  We only need to call _device_not_available now.
    _device_not_available ""
  fi
  # Any other non-zero exit propagates (set -e will catch it from the $(...) caller).
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
