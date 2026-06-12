# iOS Placeholder

This directory is reserved for the future native iOS port.

Planned direction:

- native Swift / SwiftUI shell
- `WKWebView`-based chat slots
- shared WebView JS loaded from `../shared/js`

Current state:

- source scaffold now exists under `ios/VerityMobile/`
- `project.yml` is the source of truth; `VerityMobile.xcodeproj` must be regenerated from it
- full Xcode is still required before device validation
- once Xcode is installed, run:
  - `./scripts/bootstrap-ios.sh`
  - this installs local `XcodeGen` and regenerates `VerityMobile.xcodeproj`
- canonical real-device deploy path:
  - `./scripts/deploy-ios-device.sh`
  - this performs `build -> direct devicectl install -> installed-version verification -> relaunch`
  - do not treat plain `xcodebuild install` as the canonical update path, because it can leave the phone on an older visible build even when the local build artifact is newer
