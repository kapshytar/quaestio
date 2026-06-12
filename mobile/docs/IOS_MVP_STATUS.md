# iOS MVP Status

## What Exists Now

Source scaffold exists under:

- `ios/VerityMobile/`

Current source pieces:

- `VerityMobileApp.swift`
- `RootTabView.swift`
- `SlotGridView.swift`
- `WebViewSlot.swift`
- `MergeView.swift`
- `SettingsView.swift`
- `SlotWebViewModel.swift`
- `SharedScriptBridge.swift`
- `SharedScriptLoader.swift`
- `DesignSystem.swift`
- service/state loaders for shared presets and shared JS
- `project.yml` for XcodeGen-based project generation
- `scripts/bootstrap-ios.sh` for local setup and project generation

## Intended MVP Shape

- provider tabs across the top
- one active `WKWebView` workspace at a time
- one shared composer that sends to all enabled slots
- merge/settings utilities attached to the top tab row
- shared service presets loaded from `shared/contracts/servicePresets.json`
- shared WebView JS loaded from `shared/js/`

## What Has Been Validated

- shared JS files pass local JS syntax checks
- XcodeGen project generation works locally
- `xcodebuild` succeeds against the iOS simulator target
- the app now builds, signs, installs, and launches on a real iPhone
- simulator app bundle now includes:
  - `sendMessage.js`
  - `attachFile.js`
  - `scrapeReply.js`
  - `servicePresets.json`
- iOS slot switching now preserves live provider sessions instead of force-reloading the home URL
- inactive slots are preloaded so send-to-all can target more than the currently visible slot
- webview session state currently uses `WKWebsiteDataStore.default()`, so non-destructive app updates should preserve cookies/session state

## What Is Still In Progress

- real send-to-all behavior still needs provider-by-provider validation
- current iOS wrapper now shares DOM logic with Android, but Android still has a more mature retry/verification flow overall
- simulator runtime can still be noisy and CPU-heavy, so final behavior should be confirmed on a real iPhone
- merge/settings utility icons and shell density are still being polished
- embedded provider auth compatibility is not uniform; some providers can render normally in `WKWebView` but reject social/OAuth login inside the embedded browser

## Known Limitation

- ChatGPT `Sign in with Google` on iPhone currently fails inside embedded `WKWebView` with:
  - `Access blocked`
  - `Error 403: disallowed_useragent`
- This is a provider-policy limitation, not a selector bug in our send/scrape code.
- We should not promise that all social login flows will work inside embedded webviews on iOS.

## Honest Status

This is no longer just a scaffold. It is a running iOS MVP shell with:

1. shared bundled JS resources
2. persistent slot webviews
3. top-tab navigation
4. shared bottom composer
5. simulator-validated build/run flow
6. real-device install/run validation

It is still not a shipping client because send-to-all reliability and provider compatibility are not finished yet.
