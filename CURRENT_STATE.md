# Current State

## Document Authority

- This file is the authoritative summary of the current functional state and migration intent for `chat-aggregator-mobile`.
- Root docs in `Verity/` still win for workspace-wide or cross-repo rules.
- `README.md` explains repo purpose and directory layout.
- Migration notes under `docs/` are planning context, not proof that code has already moved.

## Stable

- `chat-aggregator-mobile` now exists as a separate git repo inside the `Verity` workspace.
- The repo is intentionally a scaffold, not yet a shipping mobile app.
- Expected monorepo structure is:
  - `android/`
  - `ios/`
  - `shared/js/`
  - `shared/contracts/`
  - `docs/`
- Shared mobile assets now include:
  - `shared/js/sendMessage.js`
  - `shared/js/attachFile.js`
  - `shared/contracts/servicePresets.json`
- iOS source scaffold now exists under `ios/VerityMobile/` with:
  - SwiftUI app entry
  - 4-slot grid shell
  - merge placeholder view
  - settings/debug placeholder view
  - `WKWebView` wrapper

## In Progress

- Android code has not been moved yet from `../chat-aggregator-android`.
- iOS source scaffold exists, but no `.xcodeproj` or simulator-validated app build exists yet.
- Shared JS boundaries are not finalized yet.
- First shared-surface candidates are now identified:
  - `../chat-aggregator-android/app/src/main/java/com/chataggregator/app/MessageInjector.kt`
  - scrape/injection fragments currently embedded in `ChatFragment.kt`
- iOS runtime validation is blocked by the current machine missing full Xcode / simulator tooling.

## Current Contracts

- Do not delete or rewrite the current standalone Android repo during the scaffold phase.
- Shared logic should prefer:
  - WebView JS injection payloads
  - scrape/extraction JS
  - cross-client payload schemas/contracts
- Shared logic should not prematurely absorb:
  - native UI layers
  - billing
  - platform-specific cookie/file plumbing

## Next Steps

- Identify the first Android files/functions that should migrate into `shared/js`.
- Add an iOS bootstrap plan and initial Xcode-facing folder contract.
- Decide when the Android repo is ready to move into `android/`.
