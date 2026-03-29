# iOS Placeholder

This directory is reserved for the future native iOS port.

Planned direction:

- native Swift / SwiftUI shell
- `WKWebView`-based chat slots
- shared WebView JS loaded from `../shared/js`

Current state:

- source scaffold now exists under `ios/VerityMobile/`
- no `.xcodeproj` has been created yet
- full Xcode is still required before build/simulator validation
- once Xcode is installed, run:
  - `./scripts/bootstrap-ios.sh`
  - this installs local `XcodeGen` and generates `VerityMobile.xcodeproj`
