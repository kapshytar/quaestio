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
- service/state loaders for shared presets and shared JS

## Intended MVP Shape

- 4 chat slots rendered through `WKWebView`
- separate merge tab
- settings/debug tab
- shared service presets loaded from `shared/contracts/servicePresets.json`
- shared WebView JS loaded from `shared/js/`

## What Has Been Validated

- shared JS files pass local JS syntax checks
- Swift source tree exists and is organized for an Xcode project to consume

## What Is Blocked

This machine currently has:

- Swift command line tools
- but not full Xcode

Missing capabilities right now:

- `xcodebuild`
- `simctl`
- iOS Simulator
- real app bundle build validation

## Honest Status

This is a near-launch source scaffold, not a proven running iOS MVP yet.

The codebase is now far enough along that the next major milestone should be:

1. install full Xcode
2. create `.xcodeproj`
3. wire these files into the target
4. fix compile/runtime issues against real simulator output

