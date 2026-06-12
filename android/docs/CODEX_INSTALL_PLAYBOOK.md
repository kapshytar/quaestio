# Codex Install Playbook (Android)

Purpose: avoid repeating install mistakes.

## Golden Rule

Always install a signed APK from GitHub Actions artifacts.
Do not rely on local release signing unless explicitly requested.

Never uninstall an existing Android package that may contain live cookies, sessions, or user state unless the user explicitly approves that exact uninstall.
If `adb install -r` fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, stop and warn the user that uninstalling the old package will wipe that package sandbox, including cookies, webview storage, and app-local session state.
Default behavior in that case:
- do not uninstall automatically
- explain the signature mismatch
- ask the user whether wiping the installed package is acceptable
- prefer preserving the currently installed build over forcing a fresh debug install

## Standard Flow

1. Commit and push Android changes:
   - `git -C C:\Users\kvita\PROJECTS\chat-aggregator-mobile add <changed-files>`
   - `git -C C:\Users\kvita\PROJECTS\chat-aggregator-mobile commit -m "<message>"`
   - `git -C C:\Users\kvita\PROJECTS\chat-aggregator-mobile push origin main`

2. Wait for CI:
   - `gh run list --repo kapshytar/chat-aggregator-mobile --limit 5`
   - Take latest run id for workflow `Build Android Artifacts`
   - `gh run watch <run_id> --repo kapshytar/chat-aggregator-mobile --exit-status`
   - Continue only on `success`

3. Download artifacts to isolated folder:
   - `gh run download <run_id> --repo kapshytar/chat-aggregator-mobile --dir C:\Users\kvita\PROJECTS\chat-aggregator-mobile\ci-output\latest-ci-install\run-<run_id>`

4. Locate APK and install:
   - Find APK: `...\run-<run_id>\chat-aggregator-build-*\app-release.apk`
   - Check device: `adb -s R58M550RNCH devices -l`
   - Install: `adb -s R58M550RNCH install -r <apk_path>`

## Known Pitfalls

- `gh run download` may fail if target files already exist.
  Fix: download into a new unique folder per run (`run-<run_id>`).

- `adb` may fail in sandbox due to `.android` path permissions.
  Fix: set `ANDROID_SDK_HOME` to writable project dir for log commands.

- On this macOS workspace, `adb` is not on `PATH` by default.
  Fix: use `~/Library/Android/sdk/platform-tools/adb` directly, or add `~/Library/Android/sdk/platform-tools` to shell `PATH`.

- Multiple adb transports for same phone (USB + TCP).
  Fix: always pin `-s R58M550RNCH` to avoid installing to wrong target.

- User needs signed build.
  Fix: use CI `app-release.apk`, not local unsigned/debug unless requested.

- `INSTALL_FAILED_UPDATE_INCOMPATIBLE` means the installed package was signed with a different key.
  This is not a normal update failure.
  Uninstalling to get past it will delete the package sandbox.
  For this project, that means losing things like:
  - cookies
  - webview login state
  - local sessions/cache tied to that package
  Treat this as a destructive action and require user approval first.

- Wireless debugging may fail even when `adb tcpip 5555` succeeds on the phone.
  Observed macOS failure mode:
  - phone is visible over USB
  - `adb shell ss -ltn` shows `*:5555` listening
  - `adb connect <phone-ip>:5555` still returns `No route to host`
  This is a network-layer problem, not an `adb` command problem.
  First things to check:
  - disable VPN on the phone
  - confirm Mac and phone are on the same Wi-Fi subnet
  - verify the Mac can reach the phone IP with `ping` or `nc`
  - prefer Android 11+ `Wireless debugging` pairing flow over guessing ports
  If the Mac still cannot reach the phone IP, stay on USB and do not waste time retrying `adb connect`.

- Practical workaround when Wi-Fi debug is blocked by the network but USB works:
  - create a local forwarded TCP endpoint through the USB transport:
    - `~/Library/Android/sdk/platform-tools/adb -s R58M550RNCH forward tcp:15555 tcp:5555`
    - `~/Library/Android/sdk/platform-tools/adb connect 127.0.0.1:15555`
  - this creates a second usable adb transport such as `127.0.0.1:15555`
  - useful for scripts that expect `host:port` style targets, even though it still depends on the USB cable
  - verify with:
    - `~/Library/Android/sdk/platform-tools/adb devices -l`

- Local Android builds on this Mac currently need a JDK/Android Studio install.
  If `java -version` fails with `Unable to locate a Java Runtime`, local Gradle builds will not work yet.

- Win/Mac debug builds must use the same debug keystore.
  Otherwise `com.chataggregator.app.debug` will hit `INSTALL_FAILED_UPDATE_INCOMPATIBLE` between machines.
  Current working source of truth:
  - Windows key found at `/Volumes/BOOTCAMP/Users/kvita/.android/debug.keystore`
  - Copied to macOS at `/Users/v/.android/debug.keystore`
  - Old macOS key backup stored as `/Users/v/.android/debug.keystore.backup-*`
  Rule:
  - do not regenerate or overwrite `/Users/v/.android/debug.keystore` casually
  - if debug installs start conflicting again, first verify both machines still use the same keystore
  - prefer fixing the keystore mismatch once instead of repeatedly uninstalling the debug package

## Post-Install Sanity

1. Launch app.
2. Verify expected version behavior.
3. If session features were changed:
   - save session
   - load session
   - confirm URLs and session continuity

## Revert Package Disables (if needed)

If temporary package disables were applied:
- `adb -s R58M550RNCH shell pm enable <package>`
